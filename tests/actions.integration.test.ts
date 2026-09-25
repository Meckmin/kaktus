import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { _resetRateLimitsForTests } from '@/lib/rate-limit';
import { createOffer, transitionOffer } from '@/server/services/offer-service';
import {
  fundedEngagement,
  makeConversation,
  makeCoach,
  makeStudent,
  resetDatabase,
  scope,
  slot,
  capturePayment,
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
  // payForOffer reads x-forwarded-for for the buyer IP Iyzico requires.
  const requestHeaders = new Headers({ 'x-forwarded-for': '203.0.113.7' });
  return { cookies: async () => jar, headers: async () => requestHeaders };
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
const { submitCoachApplication } = await import('@/server/actions/coach-application');
const { sendMeetingInvite, answerMeetingInvite, withdrawMeetingInvite, setExternalMeetingLink, joinMeeting } =
  await import('@/server/actions/meetings');
const { expireInvites } = await import('@/server/services/meeting-invite-service');
const { closeMilestones, runMilestoneWorker } = await import('@/jobs/milestones');
const { dateToIstanbulLocal } = await import('@/lib/meetings/rules');
const { addStudyTask, editStudyTask, removeStudyTask, markStudyTask, loadPlannerWeek, copyPlannerWeek } =
  await import('@/server/actions/planner');
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

  it('lets the coach discount below half their list price, but not a student', async () => {
    const { coach, coachUser, studentUser, offer } = await openOffer();
    await prisma.pricingTier.create({
      data: {
        coachProfileId: coach.id,
        name: 'Aylık',
        cadence: 'MONTHLY_STANDARD',
        priceMinor: 400_000,
        sessionsPerCycle: 4,
        minutesPerSession: 60,
      },
    });

    // Coach offers 1.500 ₺ on a 4.000 ₺ list price: their call to make.
    asUser(coachUser.id);
    const coachCounter = await counterOffer(offer.id, { priceMinor: 150_000 });
    expect(coachCounter.ok).toBe(true);
    if (!coachCounter.ok || !coachCounter.offerId) throw new Error('unreachable');

    // The student can't push it under half the list price (2.000 ₺).
    asUser(studentUser.id);
    const studentCounter = await counterOffer(coachCounter.offerId, { priceMinor: 100_000 });
    expect(studentCounter).toEqual({ ok: false, message: 'En az 2.000 ₺ teklif edebilirsin.' });
  });

  it('rejects a price below the minimum before hitting the database', async () => {
    const { coachUser, offer } = await openOffer();
    asUser(coachUser.id);

    const result = await counterOffer(offer.id, { priceMinor: 1 });
    expect(result).toEqual({ ok: false, message: 'Geçerli bir tutar gir.' });
  });
});

describe('payForOffer', () => {
  // Checksum-valid dummy identity, not a real person.
  const BUYER = {
    name: 'Ayşe',
    surname: 'Yılmaz',
    identityNumber: '12345678950',
    gsmNumber: '0555 111 22 33',
    city: 'İstanbul',
    address: 'Test Mah. Deneme Sok. No:1 Kadıköy',
    acceptedContract: true as const,
  };

  it('opens checkout for the student on an accepted offer', async () => {
    const { coachUser, studentUser, offer } = await openOffer();
    asUser(coachUser.id);
    await acceptOffer(offer.id);
    asUser(studentUser.id);

    const result = await payForOffer(offer.id, BUYER);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.token).toBeTruthy();
  });

  it('refuses a coach trying to pay for their own offer', async () => {
    const { coachUser, offer } = await openOffer();
    asUser(coachUser.id);
    await acceptOffer(offer.id);

    const result = await payForOffer(offer.id, BUYER);

    expect(result).toEqual({ ok: false, message: 'Ödemeyi yalnızca öğrenci yapabilir.' });
  });

  it('refuses to open checkout before the offer is accepted', async () => {
    const { studentUser, offer } = await openOffer();
    asUser(studentUser.id);

    const result = await payForOffer(offer.id, BUYER);

    expect(result).toEqual({
      ok: false,
      message: 'Ödeme yalnızca kabul edilmiş teklifler için yapılabilir.',
    });
  });

  it('rejects invalid payer details field by field, before opening checkout', async () => {
    const { coachUser, studentUser, offer } = await openOffer();
    asUser(coachUser.id);
    await acceptOffer(offer.id);
    asUser(studentUser.id);

    const result = await payForOffer(offer.id, { ...BUYER, identityNumber: '12345678901', gsmNumber: '123' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.fieldErrors?.identityNumber).toBeDefined();
    expect(result.fieldErrors?.gsmNumber).toBeDefined();
    expect(await prisma.payment.count({ where: { offerId: offer.id } })).toBe(0);
  });

  it('refuses to open checkout until the distance contract is accepted', async () => {
    const { coachUser, studentUser, offer } = await openOffer();
    asUser(coachUser.id);
    await acceptOffer(offer.id);
    asUser(studentUser.id);

    const result = await payForOffer(offer.id, { ...BUYER, acceptedContract: false as unknown as true });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.fieldErrors?.acceptedContract).toBeDefined();
    expect(await prisma.payment.count({ where: { offerId: offer.id } })).toBe(0);
  });

  it('records which contract version the payer accepted, for this offer', async () => {
    const { coachUser, studentUser, offer } = await openOffer();
    asUser(coachUser.id);
    await acceptOffer(offer.id);
    asUser(studentUser.id);

    await payForOffer(offer.id, BUYER);

    const consent = await prisma.legalConsent.findFirstOrThrow({
      where: { userId: studentUser.id, document: 'mesafeli-hizmet-sozlesmesi' },
    });
    expect(consent.context).toBe(`offer:${offer.id}`);
    expect(consent.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(consent.ipHash).toHaveLength(32);
  });

  it('does not store the payer\'s identity anywhere on the payment', async () => {
    const { coachUser, studentUser, offer } = await openOffer();
    asUser(coachUser.id);
    await acceptOffer(offer.id);
    asUser(studentUser.id);

    await payForOffer(offer.id, BUYER);

    const payment = await prisma.payment.findFirstOrThrow({ where: { offerId: offer.id } });
    expect(JSON.stringify(payment)).not.toContain(BUYER.identityNumber);
    expect(JSON.stringify(payment)).not.toContain('Kadıköy');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// milestones.ts
// ─────────────────────────────────────────────────────────────────────────────

/** Moves a milestone's sessions (and period) into the past so it can be marked done. */
async function lessonsHeld(milestoneId: string) {
  const past = new Date(Date.now() - 60 * 60 * 1000);
  await prisma.milestone.update({ where: { id: milestoneId }, data: { periodEnd: past } });
  await prisma.booking.updateMany({
    where: { milestoneId },
    data: { startsAt: new Date(past.getTime() - 60 * 60 * 1000), endsAt: past },
  });
}

describe('completeMilestone', () => {
  it('lets the coach mark a milestone as pending confirmation once its lesson has ended', async () => {
    const { coachUser, engagement } = await fundedEngagement();
    await lessonsHeld(engagement.milestones[0].id);
    asUser(coachUser.id);

    const result = await completeMilestone(engagement.milestones[0].id);

    expect(result.ok).toBe(true);
    const after = await prisma.milestone.findUniqueOrThrow({ where: { id: engagement.milestones[0].id } });
    expect(after.status).toBe('PENDING_CONFIRMATION');
  });

  it('refuses before the milestone\'s lesson has ended', async () => {
    // Otherwise a coach could mark every week done on day one and let the
    // 5-day auto-release pay out the whole program before any lesson.
    const { coachUser, engagement } = await fundedEngagement();
    asUser(coachUser.id);

    const result = await completeMilestone(engagement.milestones[0].id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toContain('henüz bitmedi');
    const after = await prisma.milestone.findUniqueOrThrow({ where: { id: engagement.milestones[0].id } });
    expect(after.status).toBe('SCHEDULED');
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
    // A real submission parks acceptingStudents at false until approval.
    await prisma.coachProfile.update({
      where: { id: coach.id },
      data: { verificationStatus: 'IN_REVIEW', acceptingStudents: false },
    });
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
    // Approval is what makes the coach discoverable to matching.
    expect(after.acceptingStudents).toBe(true);
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

  it('refuses an offer under half the coach\'s list price for the package', async () => {
    const { coach } = await makeCoach();
    await prisma.pricingTier.create({
      data: {
        coachProfileId: coach.id,
        name: 'Tanışma',
        cadence: 'SINGLE_SESSION',
        priceMinor: 120_000,
        sessionsPerCycle: 1,
        minutesPerSession: 60,
      },
    });
    const { user: studentUser } = await makeStudent();
    asUser(studentUser.id);

    const result = await submitOffer({
      coachProfileId: coach.id,
      coachSlug: coach.slug,
      packageType: 'EXPLORATORY',
      slots: [new Date(Date.now() + 7 * 86_400_000).toISOString()],
      priceMinor: 50_000,
      createdAt: new Date().toISOString(),
    });

    expect(result).toEqual({ ok: false, code: 'INVALID', message: 'En az 600 ₺ teklif edebilirsin.' });
    expect(await prisma.offer.count({ where: { coachProfileId: coach.id } })).toBe(0);
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
      message:
        'Değerlendirme, program tamamlandıktan ya da en az bir ders yapıldıktan sonra yazılabilir.',
    });
  });

  it('lets a student review a program that ended early after a released lesson, labelled as such', async () => {
    const { studentUser, engagement } = await fundedEngagement();
    await prisma.milestone.update({
      where: { id: engagement.milestones[0].id },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
    await prisma.engagement.update({ where: { id: engagement.id }, data: { status: 'CANCELLED' } });
    asUser(studentUser.id);

    const result = await submitReviewAction(engagement.id, { rating: 2, body: 'yarıda bıraktık' });

    expect(result).toEqual({ ok: true });
    const review = await prisma.review.findFirstOrThrow({ where: { engagementId: engagement.id } });
    expect(review.programIncomplete).toBe(true);
  });

  it('refuses a review on a program cancelled before any lesson happened', async () => {
    const { studentUser, engagement } = await fundedEngagement();
    await prisma.engagement.update({ where: { id: engagement.id }, data: { status: 'CANCELLED' } });
    asUser(studentUser.id);

    const result = await submitReviewAction(engagement.id, { rating: 1 });

    expect(result.ok).toBe(false);
    expect(await prisma.review.count({ where: { engagementId: engagement.id } })).toBe(0);
  });

  it('marks a completed program\'s review as complete', async () => {
    const { studentUser, engagement } = await completedEngagement();
    asUser(studentUser.id);

    await submitReviewAction(engagement.id, { rating: 5 });

    const review = await prisma.review.findFirstOrThrow({ where: { engagementId: engagement.id } });
    expect(review.programIncomplete).toBe(false);
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

describe('submitCoachApplication', () => {
  // Checksum-valid dummies (same algorithm as lib/coach/identifiers), not real people.
  const application = {
    displayName: 'Elif Ş.',
    university: 'Hacettepe Üniversitesi',
    department: 'Tıp',
    yksTrack: 'SAYISAL' as const,
    yksRank: 2400,
    yksYear: 2025,
    wasMezun: false,
    headline: 'Mezun yılımda ilk 2.500e çıktım',
    bio: 'Her hafta programı birlikte çıkarıyoruz; denemelerden sonra konu konu analiz yapıyor, en çok puan getirecek konuları öne alıyoruz. Hafta içi mesajla takip ediyorum.',
    styles: ['STRICT' as const],
    tracks: ['SAYISAL' as const],
    subjects: [],
    supportedGrades: ['MEZUN' as const],
    monthlyPriceMinor: 400_000,
    sessionsPerMonth: 4,
    minutesPerSession: 60,
    maxActiveStudents: 8,
    availability: [{ weekday: 1, startMinute: 18 * 60, endMinute: 21 * 60 }],
    submerchantType: 'PERSONAL' as const,
    legalName: 'Gizli Yasal Ad',
    identityNumber: '12345678950',
    iban: 'TR330006100519786457841326',
    address: 'Test Mah. Deneme Sok. No:1',
    city: 'Ankara',
    phone: '05551112233',
    acceptedTerms: true as const,
  };

  it('publishes the display name and keeps the legal name out of the profile URL', async () => {
    const { user } = await makeStudent();
    await prisma.user.update({ where: { id: user.id }, data: { name: null } });
    asUser(user.id);

    const result = await submitCoachApplication(application);

    expect(result.ok).toBe(true);
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { name: true, coachProfile: { select: { slug: true } } },
    });
    expect(after.name).toBe('Elif Ş.');
    expect(after.coachProfile?.slug).toMatch(/^elif-s/);
    expect(after.coachProfile?.slug).not.toContain('gizli');
  });

  it('records acceptance of the intermediary agreement with the application', async () => {
    const { user } = await makeStudent();
    asUser(user.id);

    await submitCoachApplication(application);

    const consent = await prisma.legalConsent.findFirst({
      where: { userId: user.id, document: 'araci-hizmet-sozlesmesi' },
    });
    expect(consent).not.toBeNull();
  });

  it('requires a display name', async () => {
    const { user } = await makeStudent();
    asUser(user.id);

    const result = await submitCoachApplication({ ...application, displayName: ' ' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.fieldErrors?.displayName).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// meetings.ts — invites
// ─────────────────────────────────────────────────────────────────────────────

describe('meeting invites', () => {
  // Whole minutes, far enough out to clear the 30-minute lead time.
  const inDays = (days: number, hour = 19) => {
    const d = new Date(Date.now() + days * 86_400_000);
    d.setUTCHours(hour - 3, 0, 0, 0); // hour in Istanbul
    return d;
  };

  it('lets the coach invite an extra meeting and the student accept it', async () => {
    const { coachUser, studentUser, engagement } = await fundedEngagement();
    asUser(coachUser.id);
    const sent = await sendMeetingInvite({
      engagementId: engagement.id,
      startsAtLocal: dateToIstanbulLocal(inDays(2)),
      durationMinutes: 45,
      message: 'Denemeni konuşalım',
    });
    expect(sent).toEqual({ ok: true });

    const invite = await prisma.meetingInvite.findFirstOrThrow({ where: { engagementId: engagement.id } });
    asUser(studentUser.id);
    expect(await answerMeetingInvite(invite.id, true)).toEqual({ ok: true });

    const booking = await prisma.booking.findFirstOrThrow({
      where: { engagementId: engagement.id, startsAt: invite.startsAt },
    });
    expect(booking.milestoneId).toBeNull(); // extra meetings are unbilled
    expect(booking.endsAt.getTime() - booking.startsAt.getTime()).toBe(45 * 60_000);
    expect((await prisma.meetingInvite.findUniqueOrThrow({ where: { id: invite.id } })).status).toBe('ACCEPTED');
  });

  it('moves an existing session when the student accepts a new time, keeping its instalment', async () => {
    const { coachUser, studentUser, engagement } = await fundedEngagement();
    const booking = await prisma.booking.findFirstOrThrow({ where: { engagementId: engagement.id } });
    await prisma.booking.update({ where: { id: booking.id }, data: { videoRoomName: 'kk-old-room' } });

    asUser(coachUser.id);
    const target = inDays(3, 20);
    await sendMeetingInvite({
      engagementId: engagement.id,
      bookingId: booking.id,
      startsAtLocal: dateToIstanbulLocal(target),
      durationMinutes: 60,
    });
    const invite = await prisma.meetingInvite.findFirstOrThrow({ where: { bookingId: booking.id } });

    asUser(studentUser.id);
    await answerMeetingInvite(invite.id, true);

    const moved = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(moved.startsAt.getTime()).toBe(target.getTime());
    expect(moved.milestoneId).toBe(booking.milestoneId);
    expect(moved.videoRoomName).toBeNull(); // the old room belonged to the old time
  });

  it('replaces an older pending proposal for the same session', async () => {
    const { coachUser, engagement } = await fundedEngagement();
    const booking = await prisma.booking.findFirstOrThrow({ where: { engagementId: engagement.id } });
    asUser(coachUser.id);
    for (const days of [2, 3]) {
      await sendMeetingInvite({
        engagementId: engagement.id,
        bookingId: booking.id,
        startsAtLocal: dateToIstanbulLocal(inDays(days)),
        durationMinutes: 60,
      });
    }
    const statuses = await prisma.meetingInvite.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: 'asc' },
      select: { status: true },
    });
    expect(statuses.map((i) => i.status)).toEqual(['CANCELLED', 'PENDING']);
  });

  it('refuses an invite from the student and an answer from the coach', async () => {
    const { coachUser, studentUser, engagement } = await fundedEngagement();
    asUser(studentUser.id);
    const fromStudent = await sendMeetingInvite({
      engagementId: engagement.id,
      startsAtLocal: dateToIstanbulLocal(inDays(2)),
      durationMinutes: 60,
    });
    expect(fromStudent).toEqual({ ok: false, message: 'Görüşme davetini yalnızca koç gönderebilir.' });

    asUser(coachUser.id);
    await sendMeetingInvite({ engagementId: engagement.id, startsAtLocal: dateToIstanbulLocal(inDays(2)), durationMinutes: 60 });
    const invite = await prisma.meetingInvite.findFirstOrThrow({ where: { engagementId: engagement.id } });
    expect(await answerMeetingInvite(invite.id, true)).toEqual({
      ok: false,
      message: 'Bu daveti yalnızca öğrenci yanıtlayabilir.',
    });
  });

  it('rejects a time too soon or with an odd duration', async () => {
    const { coachUser, engagement } = await fundedEngagement();
    asUser(coachUser.id);
    const soon = await sendMeetingInvite({
      engagementId: engagement.id,
      startsAtLocal: dateToIstanbulLocal(new Date(Date.now() + 10 * 60_000)),
      durationMinutes: 60,
    });
    expect(soon.ok).toBe(false);
    const odd = await sendMeetingInvite({
      engagementId: engagement.id,
      startsAtLocal: dateToIstanbulLocal(inDays(2)),
      durationMinutes: 75,
    });
    expect(odd.ok).toBe(false);
  });

  it('refuses to double-book the coach and leaves the invite answerable', async () => {
    const { coachUser, studentUser, engagement } = await fundedEngagement();
    const at = dateToIstanbulLocal(inDays(4));
    asUser(coachUser.id);
    await sendMeetingInvite({ engagementId: engagement.id, startsAtLocal: at, durationMinutes: 60 });
    await sendMeetingInvite({ engagementId: engagement.id, startsAtLocal: at, durationMinutes: 30 });
    const [first, second] = await prisma.meetingInvite.findMany({
      where: { engagementId: engagement.id },
      orderBy: { createdAt: 'asc' },
    });

    asUser(studentUser.id);
    expect(await answerMeetingInvite(first.id, true)).toEqual({ ok: true });
    const clash = await answerMeetingInvite(second.id, true);
    expect(clash.ok).toBe(false);
    if (clash.ok) throw new Error('unreachable');
    expect(clash.message).toContain('başka bir görüşmesi var');
    expect((await prisma.meetingInvite.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('PENDING');
  });

  it('lets the student decline and the coach withdraw', async () => {
    const { coachUser, studentUser, engagement } = await fundedEngagement();
    const bookingsBefore = await prisma.booking.count({ where: { engagementId: engagement.id } });
    asUser(coachUser.id);
    await sendMeetingInvite({ engagementId: engagement.id, startsAtLocal: dateToIstanbulLocal(inDays(2)), durationMinutes: 60 });
    await sendMeetingInvite({ engagementId: engagement.id, startsAtLocal: dateToIstanbulLocal(inDays(5)), durationMinutes: 60 });
    const [a, b] = await prisma.meetingInvite.findMany({ where: { engagementId: engagement.id }, orderBy: { startsAt: 'asc' } });

    asUser(studentUser.id);
    await answerMeetingInvite(a.id, false);
    asUser(coachUser.id);
    await withdrawMeetingInvite(b.id);

    const statuses = await prisma.meetingInvite.findMany({ where: { engagementId: engagement.id }, orderBy: { startsAt: 'asc' } });
    expect(statuses.map((i) => i.status)).toEqual(['DECLINED', 'CANCELLED']);
    expect(await prisma.booking.count({ where: { engagementId: engagement.id } })).toBe(bookingsBefore);
  });

  it('expires invites nobody answered before their time', async () => {
    const { coachUser, engagement } = await fundedEngagement();
    asUser(coachUser.id);
    await sendMeetingInvite({ engagementId: engagement.id, startsAtLocal: dateToIstanbulLocal(inDays(2)), durationMinutes: 60 });

    await expireInvites(new Date(Date.now() + 3 * 86_400_000));

    const invite = await prisma.meetingInvite.findFirstOrThrow({ where: { engagementId: engagement.id } });
    expect(invite.status).toBe('EXPIRED');
  });

  it('accepts only Zoom, Meet or Teams as a fallback link, and only from the coach', async () => {
    const { coachUser, studentUser, engagement } = await fundedEngagement();
    const booking = await prisma.booking.findFirstOrThrow({ where: { engagementId: engagement.id } });

    asUser(studentUser.id);
    expect((await setExternalMeetingLink(booking.id, 'https://meet.google.com/abc-defg-hij')).ok).toBe(false);

    asUser(coachUser.id);
    expect((await setExternalMeetingLink(booking.id, 'https://evil.example.com/meet')).ok).toBe(false);
    expect(await setExternalMeetingLink(booking.id, 'https://us02web.zoom.us/j/123')).toEqual({ ok: true });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).meetingUrl).toBe(
      'https://us02web.zoom.us/j/123',
    );
  });

  it('does not start a milestone\'s release clock while its moved session is still ahead', async () => {
    const { engagement } = await fundedEngagement();
    const milestone = engagement.milestones[0];
    // The period has ended, but its session was moved to next week.
    await prisma.milestone.update({
      where: { id: milestone.id },
      data: { status: 'IN_PROGRESS', periodEnd: new Date(Date.now() - 60_000) },
    });
    const session = await prisma.booking.findFirstOrThrow({ where: { engagementId: engagement.id } });
    await prisma.booking.update({
      where: { id: session.id },
      data: { milestoneId: milestone.id, startsAt: new Date(Date.now() + 7 * 86_400_000), endsAt: new Date(Date.now() + 7 * 86_400_000 + 3_600_000) },
    });

    await closeMilestones(new Date());

    expect((await prisma.milestone.findUniqueOrThrow({ where: { id: milestone.id } })).status).toBe('IN_PROGRESS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// planner.ts — weekly study plan
// ─────────────────────────────────────────────────────────────────────────────

describe('weekly planner', () => {
  const MONDAY = '2026-10-05';
  const task = (overrides: Record<string, unknown> = {}) => ({
    day: '2026-10-06',
    examPart: 'AYT' as const,
    subject: 'Matematik',
    topic: 'Türev',
    kind: 'SORU_BANKASI' as const,
    quantity: 60,
    unit: 'SORU' as const,
    ...overrides,
  });

  it('is closed to a pair that has never had a paid program', async () => {
    const { coachUser, conversation } = await openOffer();
    asUser(coachUser.id);
    const result = await addStudyTask(conversation.id, task());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toContain('ödemesi yapılmış');
  });

  it('is invisible to anyone outside the pair', async () => {
    const { conversation } = await fundedEngagement();
    const { user: stranger } = await makeStudent();
    asUser(stranger.id);
    const result = await loadPlannerWeek(conversation.id, MONDAY);
    expect(result).toEqual({ ok: false, message: 'Program bulunamadı.' });
  });

  it('lets the coach add tasks and the student see and tick them off', async () => {
    const { coachUser, studentUser, conversation } = await fundedEngagement();
    asUser(coachUser.id);
    const added = await addStudyTask(conversation.id, task());
    expect(added.ok).toBe(true);

    asUser(studentUser.id);
    const week = await loadPlannerWeek(conversation.id, '2026-10-08'); // any day of that week
    if (!week.ok) throw new Error(week.message);
    expect(week.data).toHaveLength(1);
    expect(week.data[0]).toMatchObject({ day: '2026-10-06', subject: 'Matematik', done: false, editable: false });

    const ticked = await markStudyTask(conversation.id, week.data[0].id, true);
    if (!ticked.ok) throw new Error(ticked.message);
    expect(ticked.data.done).toBe(true);
  });

  it("keeps the coach's tasks out of the student's hands, but lets the student manage their own", async () => {
    const { coachUser, studentUser, conversation } = await fundedEngagement();
    asUser(coachUser.id);
    const coachTask = await addStudyTask(conversation.id, task());
    if (!coachTask.ok) throw new Error(coachTask.message);

    asUser(studentUser.id);
    expect((await editStudyTask(conversation.id, coachTask.data.id, task({ quantity: 10 }))).ok).toBe(false);
    expect((await removeStudyTask(conversation.id, coachTask.data.id)).ok).toBe(false);

    const own = await addStudyTask(conversation.id, task({ kind: 'TEKRAR', description: 'Limit tekrarı' }));
    if (!own.ok) throw new Error(own.message);
    expect(own.data.editable).toBe(true);
    expect((await editStudyTask(conversation.id, own.data.id, task({ kind: 'TEKRAR', quantity: 30, unit: 'DAKIKA' }))).ok).toBe(true);
    expect((await removeStudyTask(conversation.id, own.data.id)).ok).toBe(true);

    // The coach can edit anything on the plan.
    asUser(coachUser.id);
    expect((await editStudyTask(conversation.id, coachTask.data.id, task({ quantity: 80 }))).ok).toBe(true);
  });

  it('rejects a task with nothing in it', async () => {
    const { coachUser, conversation } = await fundedEngagement();
    asUser(coachUser.id);
    const result = await addStudyTask(conversation.id, { day: '2026-10-06', kind: 'DIGER' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.fieldErrors?.description).toBeDefined();
  });

  it('copies a week forward, unticked, for the coach only', async () => {
    const { coachUser, studentUser, conversation } = await fundedEngagement();
    asUser(coachUser.id);
    const first = await addStudyTask(conversation.id, task());
    await addStudyTask(conversation.id, task({ day: '2026-10-09', subject: 'Fizik', topic: null }));
    if (!first.ok) throw new Error(first.message);
    await markStudyTask(conversation.id, first.data.id, true);

    asUser(studentUser.id);
    expect((await copyPlannerWeek(conversation.id, MONDAY)).ok).toBe(false);

    asUser(coachUser.id);
    const copied = await copyPlannerWeek(conversation.id, MONDAY);
    expect(copied).toEqual({ ok: true, data: 2 });
    const next = await loadPlannerWeek(conversation.id, '2026-10-12');
    if (!next.ok) throw new Error(next.message);
    expect(next.data.map((t) => [t.day, t.done])).toEqual([
      ['2026-10-13', false],
      ['2026-10-16', false],
    ]);
  });
});

describe('joinMeeting', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.DAILY_API_KEY;
  });

  async function meetingStartingIn(minutes: number) {
    const built = await fundedEngagement();
    const booking = await prisma.booking.findFirstOrThrow({ where: { engagementId: built.engagement.id } });
    const startsAt = new Date(Date.now() + minutes * 60_000);
    await prisma.booking.update({
      where: { id: booking.id },
      data: { startsAt, endsAt: new Date(startsAt.getTime() + 60 * 60_000) },
    });
    return { ...built, booking };
  }

  it('keeps the room closed until 10 minutes before the start', async () => {
    const { studentUser, booking } = await meetingStartingIn(60);
    asUser(studentUser.id);
    const result = await joinMeeting(booking.id);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('10 dakika önce') });
  });

  it('turns strangers away', async () => {
    const { booking } = await meetingStartingIn(5);
    const { user: stranger } = await makeStudent();
    asUser(stranger.id);
    expect(await joinMeeting(booking.id)).toEqual({ ok: false, message: 'Görüşme bulunamadı.', fallbackUrl: null });
  });

  it("falls back to the coach's link when Daily isn't configured", async () => {
    const { studentUser, booking } = await meetingStartingIn(5);
    await prisma.booking.update({ where: { id: booking.id }, data: { meetingUrl: 'https://meet.google.com/abc-defg-hij' } });
    asUser(studentUser.id);
    const result = await joinMeeting(booking.id);
    expect(result).toMatchObject({ ok: false, fallbackUrl: 'https://meet.google.com/abc-defg-hij' });
  });

  it('opens the Daily room with a personal token, owner rights for the coach only', async () => {
    const { coachUser, studentUser, booking } = await meetingStartingIn(5);
    process.env.DAILY_API_KEY = 'daily-test-key';
    const tokens: Array<{ is_owner: boolean }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith('/meeting-tokens')) {
        tokens.push(body.properties);
        return new Response(JSON.stringify({ token: `tok_${tokens.length}` }));
      }
      return new Response(JSON.stringify({ name: 'kk-room', url: 'https://kaktus.daily.co/kk-room' }));
    }) as typeof fetch;

    asUser(coachUser.id);
    expect(await joinMeeting(booking.id)).toEqual({ ok: true, url: 'https://kaktus.daily.co/kk-room?t=tok_1' });
    asUser(studentUser.id);
    expect(await joinMeeting(booking.id)).toEqual({ ok: true, url: 'https://kaktus.daily.co/kk-room?t=tok_2' });

    expect(tokens.map((t) => t.is_owner)).toEqual([true, false]);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).videoRoomName).toBe('kk-room');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Abandoned checkout — found in a multi-student E2E run
// ─────────────────────────────────────────────────────────────────────────────

describe('an opened but unpaid checkout', () => {
  const BUYER = {
    name: 'Ayşe',
    surname: 'Yılmaz',
    identityNumber: '12345678950',
    gsmNumber: '05551112233',
    city: 'İstanbul',
    address: 'Test Mah. Deneme Sok. No:1',
    acceptedContract: true as const,
  };

  async function checkoutOpened() {
    const built = await openOffer();
    asUser(built.coachUser.id);
    await acceptOffer(built.offer.id);
    asUser(built.studentUser.id);
    expect((await payForOffer(built.offer.id, BUYER)).ok).toBe(true);
    const engagement = await prisma.engagement.findUniqueOrThrow({
      where: { offerId: built.offer.id },
      include: { milestones: true },
    });
    return { ...built, engagement };
  }

  it('is PENDING_PAYMENT, not counted, and opens no planner', async () => {
    const { coach, studentUser, conversation, engagement } = await checkoutOpened();
    expect(engagement.status).toBe('PENDING_PAYMENT');
    expect((await prisma.coachProfile.findUniqueOrThrow({ where: { id: coach.id } })).activeEngagements).toBe(0);
    asUser(studentUser.id);
    expect((await loadPlannerWeek(conversation.id, '2026-10-05')).ok).toBe(false);
  });

  it('never moves money: the milestone worker leaves it alone however much time passes', async () => {
    const { engagement } = await checkoutOpened();
    // Its only period is long over.
    await prisma.milestone.updateMany({
      where: { engagementId: engagement.id },
      data: { periodStart: new Date(Date.now() - 3 * 86_400_000), periodEnd: new Date(Date.now() - 2 * 86_400_000) },
    });

    for (const days of [1, 10, 40]) await runMilestoneWorker(new Date(Date.now() + days * 86_400_000));

    const milestones = await prisma.milestone.findMany({ where: { engagementId: engagement.id } });
    expect(milestones.every((m) => m.status === 'SCHEDULED')).toBe(true);
    expect(await prisma.ledgerEntry.count({ where: { engagementId: engagement.id } })).toBe(0);
  });

  it('refuses the coach marking a lesson done on it', async () => {
    const { coachUser, engagement } = await checkoutOpened();
    await prisma.milestone.updateMany({
      where: { engagementId: engagement.id },
      data: { periodEnd: new Date(Date.now() - 60_000) },
    });
    asUser(coachUser.id);
    const result = await completeMilestone(engagement.milestones[0].id);
    expect(result).toEqual({ ok: false, message: 'Bu programın ödemesi henüz alınmadı.' });
  });

  it('becomes ACTIVE and counts toward the coach once the payment is captured', async () => {
    const { coach, offer, engagement } = await checkoutOpened();
    await capturePayment(offer.id, offer.priceMinor);
    await transitionOffer({ offerId: offer.id, event: 'PAYMENT_CAPTURED', actor: 'SYSTEM' });

    expect((await prisma.engagement.findUniqueOrThrow({ where: { id: engagement.id } })).status).toBe('ACTIVE');
    expect((await prisma.coachProfile.findUniqueOrThrow({ where: { id: coach.id } })).activeEngagements).toBe(1);
  });
});
