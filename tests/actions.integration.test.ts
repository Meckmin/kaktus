import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { _resetRateLimitsForTests } from '@/lib/rate-limit';
import { createOffer } from '@/server/services/offer-service';
import {
  fundedEngagement,
  makeConversation,
  makeCoach,
  makeStudent,
  resetDatabase,
  scope,
  slot,
} from './factories';

/**
 * Action-layer suite.
 *
 * `src/server/actions/*` is the thin RPC layer Next turns into callable
 * endpoints — auth checks, ownership checks, input shape — sitting on top of
 * the service layer the other integration suite already exercises hard. That
 * service layer being correct does not prove the action wired the right actor
 * id into it, or actually rejects the wrong caller; that is what this file is
 * for. Runs against a real Postgres like `concurrency.integration.test.ts`,
 * with only `@/lib/auth` and `next/cache` replaced — the pieces that need a
 * real Next.js request context this process does not have.
 */

const mockAuth = vi.fn();
const mockRequireAdmin = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
  requireAdmin: () => mockRequireAdmin(),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
// `@/lib/crypto/field` carries a `server-only` guard because it handles a real
// secret (FIELD_ENCRYPTION_KEY) — legitimately, so the fix is to stub it here
// rather than loosen the guard. No test in this file asserts on the encrypted
// original, only that the masked body is stored instead of it.
vi.mock('@/lib/crypto/field', () => ({
  encryptField: (plaintext: string) => Buffer.from(plaintext, 'utf8'),
  decryptField: (payload: Buffer) => Buffer.from(payload).toString('utf8'),
  encryptionAvailable: () => false,
}));
// `submitOffer` clears its draft cookie on success via `next/headers`'s
// `cookies()`, which only resolves inside a real Next.js request — stub a
// trivial in-memory jar so the action-layer call under test doesn't need one.
vi.mock('next/headers', () => {
  const store = new Map<string, string>();
  const jar = {
    get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
    set: (name: string, value: string) => store.set(name, value),
    delete: (name: string) => store.delete(name),
  };
  return { cookies: async () => jar };
});

function asUser(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId } });
}
function signedOut() {
  mockAuth.mockResolvedValue(null);
}

const { sendMessage, acceptOffer, declineOffer, counterOffer, payForOffer } = await import(
  '@/server/actions/negotiation'
);
const {
  completeMilestone,
  releaseMilestoneToCoach,
  raiseDispute,
  requestCancellation,
} = await import('@/server/actions/milestones');
const { approveCoach, resolveDisputeAction } = await import('@/server/actions/admin');
const { submitOffer } = await import('@/server/actions/offers');
const { submitReviewAction } = await import('@/server/actions/reviews');

beforeEach(async () => {
  await resetDatabase();
  mockAuth.mockReset();
  mockRequireAdmin.mockReset();
  _resetRateLimitsForTests();
});
afterAll(async () => {
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────
// negotiation.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('sendMessage', () => {
  it('rejects an unauthenticated caller', async () => {
    signedOut();
    const { coach } = await makeCoach();
    const { student } = await makeStudent();
    const conversation = await makeConversation(coach.id, student.id);

    await expect(sendMessage(conversation.id, 'merhaba')).rejects.toThrow('UNAUTHENTICATED');
  });

  it('rejects someone who is not a party to the conversation', async () => {
    const { coach } = await makeCoach();
    const { student } = await makeStudent();
    const conversation = await makeConversation(coach.id, student.id);
    const { user: outsider } = await makeStudent();
    asUser(outsider.id);

    await expect(sendMessage(conversation.id, 'merhaba')).rejects.toThrow('FORBIDDEN');
  });

  it('sends a plain message as the student', async () => {
    const { coach } = await makeCoach();
    const { user: studentUser, student } = await makeStudent();
    const conversation = await makeConversation(coach.id, student.id);
    asUser(studentUser.id);

    const result = await sendMessage(conversation.id, 'Merhaba, ne zaman başlayabiliriz?');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.masked).toBe(false);
    expect(result.message.body).toContain('Merhaba');

    const stored = await prisma.message.count({ where: { conversationId: conversation.id } });
    expect(stored).toBe(1);
  });

  it('masks a lower-severity signal (a platform mention) instead of blocking it', async () => {
    const { coach } = await makeCoach();
    const { user: studentUser, student } = await makeStudent();
    const conversation = await makeConversation(coach.id, student.id);
    asUser(studentUser.id);

    const result = await sendMessage(conversation.id, 'bana instagramdan da ulaşabilirsin');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.masked).toBe(true);
  });

  it('blocks a bare phone number outright and never stores the message', async () => {
    const { coach } = await makeCoach();
    const { user: studentUser, student } = await makeStudent();
    const conversation = await makeConversation(coach.id, student.id);
    asUser(studentUser.id);

    const result = await sendMessage(conversation.id, 'beni ara 0532 111 22 33');

    expect(result).toMatchObject({ ok: false, blocked: true });
    const stored = await prisma.message.count({ where: { conversationId: conversation.id } });
    expect(stored).toBe(0);
    const after = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(after.riskScore).toBeGreaterThan(0);
  });

  it('rejects an empty message before touching the database', async () => {
    const { coach } = await makeCoach();
    const { user: studentUser, student } = await makeStudent();
    const conversation = await makeConversation(coach.id, student.id);
    asUser(studentUser.id);

    const result = await sendMessage(conversation.id, '   ');

    expect(result).toEqual({ ok: false, blocked: false, message: 'Mesaj boş olamaz.' });
  });

  it('rate-limits a caller sending more than the per-minute cap', async () => {
    const { coach } = await makeCoach();
    const { user: studentUser, student } = await makeStudent();
    const conversation = await makeConversation(coach.id, student.id);
    asUser(studentUser.id);

    for (let i = 0; i < 20; i++) {
      const r = await sendMessage(conversation.id, `mesaj ${i}`);
      expect(r.ok).toBe(true);
    }
    const blocked = await sendMessage(conversation.id, 'bir mesaj daha');
    expect(blocked).toEqual({
      ok: false,
      blocked: false,
      message: 'Çok hızlı mesaj gönderiyorsun. Biraz yavaşla.',
    });
  });
});

async function openOffer() {
  const { coach } = await makeCoach();
  const { user: studentUser, student } = await makeStudent();
  const conversation = await makeConversation(coach.id, student.id);
  const coachUser = await prisma.user.findFirstOrThrow({
    where: { coachProfile: { id: coach.id } },
  });

  const offer = await createOffer({
    conversationId: conversation.id,
    coachProfileId: coach.id,
    studentProfileId: student.id,
    initiatorRole: 'STUDENT',
    actorId: studentUser.id,
    actorProfileId: student.id,
    title: 'Aylık koçluk',
    scope: scope({ slots: [slot(0)] }),
    priceMinor: 400_000,
    startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    endDate: new Date(Date.now() + 27 * 24 * 60 * 60 * 1000),
    milestoneCount: 4,
  });

  return { coach, coachUser, student, studentUser, conversation, offer };
}

describe('acceptOffer / declineOffer', () => {
  it('lets the coach accept a student-initiated offer', async () => {
    const { coachUser, offer } = await openOffer();
    asUser(coachUser.id);

    const result = await acceptOffer(offer.id);

    expect(result).toEqual({ ok: true, offerId: offer.id });
    const after = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(after.status).toBe('ACCEPTED');
  });

  it('refuses to let the initiator accept their own offer', async () => {
    const { studentUser, offer } = await openOffer();
    asUser(studentUser.id);

    const result = await acceptOffer(offer.id);

    expect(result).toEqual({ ok: false, message: 'Kendi teklifini kabul edemezsin.' });
    const after = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(after.status).toBe('OFFERED');
  });

  it('refuses a caller who is not a party to the offer', async () => {
    const { offer } = await openOffer();
    const { user: outsider } = await makeCoach();
    asUser(outsider.id);

    await expect(acceptOffer(offer.id)).rejects.toThrow('FORBIDDEN');
  });

  it('lets the student decline their own offer, freeing the held slot', async () => {
    const { studentUser, offer } = await openOffer();
    asUser(studentUser.id);

    const result = await declineOffer(offer.id, 'vazgeçtim');

    expect(result).toEqual({ ok: true, offerId: offer.id });
    const after = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(after.status).toBe('CANCELLED');
    const held = await prisma.slotHold.count({ where: { offerId: offer.id, status: 'HELD' } });
    expect(held).toBe(0);
  });

  it('returns not-found for a bogus offer id instead of throwing', async () => {
    const { coachUser } = await openOffer();
    asUser(coachUser.id);

    const result = await acceptOffer('does-not-exist');
    expect(result).toEqual({ ok: false, message: 'Teklif bulunamadı.' });
  });
});

describe('counterOffer', () => {
  it('creates a child offer with the new price, keeping the same scope', async () => {
    const { coachUser, coach, offer } = await openOffer();
    asUser(coachUser.id);

    const result = await counterOffer(offer.id, { priceMinor: 450_000, note: 'biraz daha yüksek' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const child = await prisma.offer.findUniqueOrThrow({ where: { id: result.offerId } });
    expect(child.parentOfferId).toBe(offer.id);
    expect(child.priceMinor).toBe(450_000);
    expect(child.coachProfileId).toBe(coach.id);
  });

  it('refuses to counter an offer that already left the negotiable states', async () => {
    const { coachUser, offer } = await openOffer();
    asUser(coachUser.id);
    await acceptOffer(offer.id);

    const result = await counterOffer(offer.id, { priceMinor: 450_000 });

    expect(result).toEqual({ ok: false, message: 'Bu teklife artık karşı teklif verilemez.' });
  });

  it('rejects a price below the minimum before hitting the database', async () => {
    const { coachUser, offer } = await openOffer();
    asUser(coachUser.id);

    const result = await counterOffer(offer.id, { priceMinor: 1 });
    expect(result).toEqual({ ok: false, message: 'Geçerli bir tutar gir.' });
  });
});

describe('payForOffer', () => {
  it('opens checkout for the student on an accepted offer', async () => {
    const { coachUser, studentUser, offer } = await openOffer();
    asUser(coachUser.id);
    await acceptOffer(offer.id);
    asUser(studentUser.id);

    const result = await payForOffer(offer.id);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.token).toBeTruthy();
  });

  it('refuses a coach trying to pay for their own offer', async () => {
    const { coachUser, offer } = await openOffer();
    asUser(coachUser.id);
    await acceptOffer(offer.id);

    const result = await payForOffer(offer.id);

    expect(result).toEqual({ ok: false, message: 'Ödemeyi yalnızca öğrenci yapabilir.' });
  });

  it('refuses to open checkout before the offer is accepted', async () => {
    const { studentUser, offer } = await openOffer();
    asUser(studentUser.id);

    const result = await payForOffer(offer.id);

    expect(result).toEqual({
      ok: false,
      message: 'Ödeme yalnızca kabul edilmiş teklifler için yapılabilir.',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// milestones.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('completeMilestone', () => {
  it('lets the coach mark a scheduled milestone as pending confirmation', async () => {
    const { coachUser, engagement } = await fundedEngagement();
    asUser(coachUser.id);

    const result = await completeMilestone(engagement.milestones[0].id);

    expect(result.ok).toBe(true);
    const after = await prisma.milestone.findUniqueOrThrow({ where: { id: engagement.milestones[0].id } });
    expect(after.status).toBe('PENDING_CONFIRMATION');
  });

  it('refuses a student trying to mark their own milestone complete', async () => {
    const { studentUser, engagement } = await fundedEngagement();
    asUser(studentUser.id);

    const result = await completeMilestone(engagement.milestones[0].id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toContain('koç');
  });

  it('requires authentication', async () => {
    const { engagement } = await fundedEngagement();
    signedOut();

    const result = await completeMilestone(engagement.milestones[0].id);
    expect(result).toEqual({ ok: false, message: 'Önce giriş yapman gerekiyor.' });
  });
});

describe('releaseMilestoneToCoach', () => {
  async function pendingConfirmation() {
    const built = await fundedEngagement();
    await prisma.milestone.update({
      where: { id: built.engagement.milestones[0].id },
      data: { status: 'PENDING_CONFIRMATION', autoReleaseAt: new Date(Date.now() + 5 * 86_400_000) },
    });
    return built;
  }

  it('lets the student release escrow for a milestone pending confirmation', async () => {
    const { studentUser, coach, engagement } = await pendingConfirmation();
    asUser(studentUser.id);

    const result = await releaseMilestoneToCoach(engagement.milestones[0].id);

    expect(result.ok).toBe(true);
    const after = await prisma.milestone.findUniqueOrThrow({ where: { id: engagement.milestones[0].id } });
    expect(after.status).toBe('RELEASED');
    const payable = await prisma.ledgerEntry.count({
      where: { coachProfileId: coach.id, account: 'COACH_PAYABLE' },
    });
    expect(payable).toBeGreaterThan(0);
  });

  it('refuses a coach trying to release their own payout', async () => {
    const { coachUser, engagement } = await pendingConfirmation();
    asUser(coachUser.id);

    const result = await releaseMilestoneToCoach(engagement.milestones[0].id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toContain('öğrenci');
  });

  it('refuses to release a milestone that is still scheduled', async () => {
    const { studentUser, engagement } = await fundedEngagement();
    asUser(studentUser.id);

    const result = await releaseMilestoneToCoach(engagement.milestones[0].id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toContain('henüz onaya hazır değil');
  });
});

describe('raiseDispute', () => {
  it('lets the student on the engagement open a dispute', async () => {
    const { studentUser, offer, engagement } = await fundedEngagement();
    asUser(studentUser.id);

    const result = await raiseDispute({
      offerId: offer.id,
      milestoneId: engagement.milestones[0].id,
      reason: 'COACH_NO_SHOW',
      detail: 'Koç bugünkü seansa gelmedi.',
    });

    expect(result.ok).toBe(true);
    const dispute = await prisma.dispute.findFirst({ where: { engagementId: engagement.id } });
    expect(dispute).not.toBeNull();
    expect(dispute?.reason).toBe('COACH_NO_SHOW');
  });

  it('refuses a caller who is not the student on the offer', async () => {
    const { coachUser, offer, engagement } = await fundedEngagement();
    asUser(coachUser.id);

    const result = await raiseDispute({
      offerId: offer.id,
      milestoneId: engagement.milestones[0].id,
      reason: 'QUALITY',
      detail: 'Beklediğim gibi gitmedi bu program.',
    });

    expect(result).toEqual({ ok: false, message: 'Bu teklif için itiraz açamazsın.' });
  });

  it('rejects a detail shorter than 10 characters before touching the database', async () => {
    const { studentUser, offer } = await fundedEngagement();
    asUser(studentUser.id);

    const result = await raiseDispute({ offerId: offer.id, reason: 'OTHER', detail: 'kısa' });

    expect(result).toEqual({ ok: false, message: 'Lütfen en az 10 karakterlik bir açıklama yaz.' });
  });

  it('rate-limits repeated dispute attempts', async () => {
    const { studentUser, offer, engagement } = await fundedEngagement();
    asUser(studentUser.id);

    for (let i = 0; i < 5; i++) {
      await raiseDispute({
        offerId: offer.id,
        milestoneId: engagement.milestones[0].id,
        reason: 'OTHER',
        detail: `deneme ${i} - yeterince uzun bir açıklama`,
      });
    }
    const result = await raiseDispute({
      offerId: offer.id,
      milestoneId: engagement.milestones[0].id,
      reason: 'OTHER',
      detail: 'bir deneme daha, yeterince uzun',
    });

    expect(result).toEqual({ ok: false, message: 'Çok hızlı işlem yapıyorsun. Biraz yavaşla.' });
  });
});

describe('requestCancellation', () => {
  it('cancels a not-yet-paid offer outright', async () => {
    const { studentUser, offer } = await openOffer();
    asUser(studentUser.id);

    const result = await requestCancellation(offer.id, 'vazgeçtim');

    expect(result).toEqual({ ok: true, message: 'Teklif iptal edildi.' });
    const after = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(after.status).toBe('CANCELLED');
  });

  it('routes a post-payment cancellation through the dispute path instead of cancelling outright', async () => {
    const { studentUser, offer, engagement } = await fundedEngagement();
    asUser(studentUser.id);

    const result = await requestCancellation(offer.id, 'artık devam etmek istemiyorum çünkü uygun değil');

    expect(result.ok).toBe(true);
    const dispute = await prisma.dispute.findFirst({ where: { engagementId: engagement.id } });
    expect(dispute).not.toBeNull();
    const after = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(after.status).not.toBe('CANCELLED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// admin.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('approveCoach', () => {
  it('approves the coach and their pending documents', async () => {
    const { user: adminUser } = await makeStudent();
    mockRequireAdmin.mockResolvedValue({ id: adminUser.id });
    const { coach } = await makeCoach();
    await prisma.coachProfile.update({ where: { id: coach.id }, data: { verificationStatus: 'IN_REVIEW' } });
    await prisma.verificationDocument.create({
      data: {
        coachProfileId: coach.id,
        type: 'DIPLOMA',
        storageKey: `doc/${coach.id}`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        status: 'PENDING',
      },
    });

    const result = await approveCoach({ coachProfileId: coach.id, note: 'belgeler tamam' });

    expect(result).toEqual({ ok: true });
    const after = await prisma.coachProfile.findUniqueOrThrow({ where: { id: coach.id } });
    expect(after.verificationStatus).toBe('APPROVED');
    const doc = await prisma.verificationDocument.findFirstOrThrow({ where: { coachProfileId: coach.id } });
    expect(doc.status).toBe('APPROVED');
    const log = await prisma.auditLog.findFirst({ where: { entityId: coach.id, action: 'coach.approved' } });
    expect(log).not.toBeNull();
  });

  it('propagates a non-admin rejection from requireAdmin', async () => {
    mockRequireAdmin.mockRejectedValue(new Error('FORBIDDEN'));
    const { coach } = await makeCoach();

    await expect(approveCoach({ coachProfileId: coach.id })).rejects.toThrow('FORBIDDEN');
  });
});

describe('resolveDisputeAction', () => {
  async function openDisputeCase() {
    const { user: adminUser } = await makeStudent();
    mockRequireAdmin.mockResolvedValue({ id: adminUser.id });
    const built = await fundedEngagement();
    asUser(built.studentUser.id);
    await raiseDispute({
      offerId: built.offer.id,
      milestoneId: built.engagement.milestones[0].id,
      reason: 'COACH_NO_SHOW',
      detail: 'Koç seansa gelmedi, kanıtım var.',
    });
    const dispute = await prisma.dispute.findFirstOrThrow({ where: { engagementId: built.engagement.id } });
    return { ...built, dispute };
  }

  it('refunds the student when the admin rules REFUND', async () => {
    const { dispute, engagement } = await openDisputeCase();

    const result = await resolveDisputeAction({
      disputeId: dispute.id,
      outcome: 'REFUND',
      note: 'Koç seansa gelmemiş, kayıtlarla doğrulandı.',
    });

    expect(result).toEqual({ ok: true });
    const after = await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } });
    expect(after.status).toBe('RESOLVED_REFUND');
    const refunds = await prisma.refund.count({ where: { engagementId: engagement.id } });
    expect(refunds).toBeGreaterThan(0);
  });

  it('rejects a decision note shorter than 5 characters', async () => {
    const { dispute } = await openDisputeCase();

    const result = await resolveDisputeAction({ disputeId: dispute.id, outcome: 'RELEASE', note: 'ok' });

    expect(result).toEqual({ ok: false, message: 'Karar gerekçesi en az 5 karakter olmalı.' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// offers.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('submitOffer', () => {
  it('creates a conversation and a draft offer for a signed-in student', async () => {
    const { coach } = await makeCoach();
    const { user: studentUser } = await makeStudent();
    asUser(studentUser.id);
    const futureSlot = new Date(Date.now() + 7 * 86_400_000).toISOString();

    const result = await submitOffer({
      coachProfileId: coach.id,
      coachSlug: coach.slug,
      packageType: 'EXPLORATORY',
      slots: [futureSlot],
      priceMinor: 50_000,
      createdAt: new Date().toISOString(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const offer = await prisma.offer.findUniqueOrThrow({ where: { id: result.offerId } });
    expect(offer.coachProfileId).toBe(coach.id);
    expect(offer.status).toBe('OFFERED');
  });

  it('rejects an unauthenticated submission', async () => {
    const { coach } = await makeCoach();
    signedOut();

    const result = await submitOffer({
      coachProfileId: coach.id,
      coachSlug: coach.slug,
      packageType: 'EXPLORATORY',
      slots: [new Date(Date.now() + 86_400_000).toISOString()],
      priceMinor: 50_000,
      createdAt: new Date().toISOString(),
    });

    expect(result).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Önce giriş yapman gerekiyor.',
    });
  });

  it('refuses a coach that is not accepting students', async () => {
    const { coach } = await makeCoach();
    await prisma.coachProfile.update({ where: { id: coach.id }, data: { acceptingStudents: false } });
    const { user: studentUser } = await makeStudent();
    asUser(studentUser.id);

    const result = await submitOffer({
      coachProfileId: coach.id,
      coachSlug: coach.slug,
      packageType: 'EXPLORATORY',
      slots: [new Date(Date.now() + 86_400_000).toISOString()],
      priceMinor: 50_000,
      createdAt: new Date().toISOString(),
    });

    expect(result).toEqual({
      ok: false,
      code: 'INVALID',
      message: 'Bu koç şu anda yeni öğrenci almıyor.',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reviews.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('submitReviewAction', () => {
  async function completedEngagement() {
    const built = await fundedEngagement();
    await prisma.engagement.update({ where: { id: built.engagement.id }, data: { status: 'COMPLETED' } });
    return built;
  }

  it('lets the student review a completed engagement', async () => {
    const { studentUser, engagement } = await completedEngagement();
    asUser(studentUser.id);

    const result = await submitReviewAction(engagement.id, { rating: 5, body: 'harikaydı' });

    expect(result).toEqual({ ok: true });
    const review = await prisma.review.findFirstOrThrow({ where: { engagementId: engagement.id } });
    expect(review.rating).toBe(5);
  });

  it('refuses a review before the engagement is completed', async () => {
    const { studentUser, engagement } = await fundedEngagement();
    asUser(studentUser.id);

    const result = await submitReviewAction(engagement.id, { rating: 4 });

    expect(result).toEqual({
      ok: false,
      message: 'Değerlendirme yalnızca program tamamlandıktan sonra yazılabilir.',
    });
  });

  it('refuses a caller who is not the student on the engagement', async () => {
    const { coachUser, engagement } = await completedEngagement();
    asUser(coachUser.id);

    const result = await submitReviewAction(engagement.id, { rating: 3 });

    expect(result).toEqual({ ok: false, message: 'Bu program için değerlendirme yazamazsın.' });
  });

  it('rejects a rating outside 1-5 before touching the database', async () => {
    const { studentUser, engagement } = await completedEngagement();
    asUser(studentUser.id);

    const result = await submitReviewAction(engagement.id, { rating: 9 });

    expect(result).toEqual({ ok: false, message: 'Geçerli bir puan seç.' });
  });
});
