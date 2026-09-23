import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createOffer, transitionOffer } from '@/server/services/offer-service';
import { openDispute, resolveDispute } from '@/server/services/dispute-service';
import { autoReleaseMilestones, closeMilestones } from '@/jobs/milestones';
import { expireOffers, runPayoutBatch } from '@/jobs/workers';
import { SlotUnavailableError, acquireHolds } from '@/lib/booking/holds';
import { ConcurrentModificationError } from '@/lib/tx';
import {
  assertEscrowNonNegative,
  assertLedgerBalanced,
  capturePayment,
  coachPayable,
  makeConversation,
  makeCoach,
  makeStudent,
  race,
  resetDatabase,
  scope,
  slot,
} from './factories';

/**
 * Concurrency and race-condition suite.
 *
 * Requires a real Postgres with the constraints migration applied:
 *
 *   docker compose -f docker-compose.test.yml up -d
 *   DATABASE_URL=postgresql://kaktus:kaktus@localhost:5433/kaktus_test \
 *     npx prisma migrate deploy && npx vitest run tests/concurrency
 *
 * These tests deliberately do NOT mock Prisma. Every guarantee under test lives
 * in the database — an EXCLUDE constraint, a row lock, a conditional UPDATE. A
 * mocked client would report success against a system that double-books in
 * production, which is worse than having no test at all.
 *
 * Note on `Promise.all`: Node runs one event loop, but each Prisma call is a
 * separate connection from the pool executing a separate server-side
 * transaction, so the statements genuinely interleave inside Postgres. That is
 * where the contention we care about happens.
 */

const PRICE = 400_000; // 4.000 ₺

/**
 * Fixture engagement window: started a day ago, a 28-day span — relative to
 * whenever the suite actually runs, not a fixed calendar date. Several
 * fixtures below fire `ENGAGEMENT_STARTED` immediately after funding, which
 * requires `startDate <= now`; a hardcoded date drifts into the future and
 * breaks silently once the calendar catches up to it.
 */
const ENGAGEMENT_START = new Date(Date.now() - 24 * 60 * 60 * 1000);
const ENGAGEMENT_END = new Date(Date.now() + 27 * 24 * 60 * 60 * 1000);

beforeEach(resetDatabase);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('slot contention', () => {
  it('lets exactly one of many simultaneous holds win the same slot', async () => {
    const { coach } = await makeCoach();
    const students = await Promise.all(Array.from({ length: 20 }, () => makeStudent()));
    const contested = slot(0);

    const { fulfilled, rejected } = await race(20, (i) =>
      acquireHolds({
        coachProfileId: coach.id,
        studentProfileId: students[i].student.id,
        slots: [contested],
        ttlMinutes: 60,
      }),
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(19);
    expect(rejected.every((e) => e instanceof SlotUnavailableError)).toBe(true);

    const held = await prisma.slotHold.count({ where: { status: 'HELD' } });
    expect(held).toBe(1);
  });

  it('allows adjacent, non-overlapping slots to be held simultaneously', async () => {
    const { coach } = await makeCoach();
    const students = await Promise.all(Array.from({ length: 4 }, () => makeStudent()));

    const { fulfilled, rejected } = await race(4, (i) =>
      acquireHolds({
        coachProfileId: coach.id,
        studentProfileId: students[i].student.id,
        slots: [slot(i)], // 18:00, 19:00, 20:00, 21:00 — back-to-back, no overlap
        ttlMinutes: 60,
      }),
    );

    expect(fulfilled).toHaveLength(4);
    expect(rejected).toHaveLength(0);
  });

  it('rejects a partially-conflicting multi-slot request atomically', async () => {
    const { coach } = await makeCoach();
    const a = await makeStudent();
    const b = await makeStudent();

    await acquireHolds({
      coachProfileId: coach.id,
      studentProfileId: a.student.id,
      slots: [slot(2)],
      ttlMinutes: 60,
    });

    // B wants three slots, one of which A already holds. All three must fail:
    // a student must never pay for a half-booked calendar.
    await expect(
      acquireHolds({
        coachProfileId: coach.id,
        studentProfileId: b.student.id,
        slots: [slot(0), slot(2), slot(4)],
        ttlMinutes: 60,
      }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);

    const bHolds = await prisma.slotHold.count({
      where: { studentProfileId: b.student.id, status: 'HELD' },
    });
    expect(bHolds).toBe(0);
  });

  it('detects overlap between a hold and a confirmed booking across tables', async () => {
    const { coach } = await makeCoach();
    const a = await makeStudent();
    const b = await makeStudent();
    const s = slot(0);

    await prisma.booking.create({
      data: {
        coachProfileId: coach.id,
        studentProfileId: a.student.id,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        status: 'SCHEDULED',
      },
    });

    // Half-overlapping, not identical — the range operator must catch it where
    // an equality check on start time would not.
    await expect(
      acquireHolds({
        coachProfileId: coach.id,
        studentProfileId: b.student.id,
        slots: [{ startsAt: new Date(s.startsAt.getTime() + 30 * 60_000), endsAt: new Date(s.endsAt.getTime() + 30 * 60_000) }],
        ttlMinutes: 60,
      }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it('frees the slot for the next student once a hold expires', async () => {
    const { coach } = await makeCoach();
    const a = await makeStudent();
    const b = await makeStudent();

    await acquireHolds({
      coachProfileId: coach.id,
      studentProfileId: a.student.id,
      slots: [slot(0)],
      ttlMinutes: 60,
    });
    await prisma.slotHold.updateMany({
      where: { studentProfileId: a.student.id },
      data: { status: 'EXPIRED' },
    });

    // The partial index only covers status='HELD', so an expired hold does not
    // block. This is what makes expiry a status change rather than a delete.
    await expect(
      acquireHolds({
        coachProfileId: coach.id,
        studentProfileId: b.student.id,
        slots: [slot(0)],
        ttlMinutes: 60,
      }),
    ).resolves.toHaveLength(1);
  });
});

describe('concurrent offer acceptance', () => {
  async function openOffer() {
    const { coach } = await makeCoach();
    const { user: studentUser, student } = await makeStudent();
    const conversation = await makeConversation(coach.id, student.id);

    const offer = await createOffer({
      conversationId: conversation.id,
      coachProfileId: coach.id,
      studentProfileId: student.id,
      initiatorRole: 'STUDENT',
      actorId: studentUser.id,
      actorProfileId: student.id,
      title: 'Aylık koçluk',
      scope: scope({ slots: [slot(0), slot(24)] }),
      priceMinor: PRICE,
      startDate: ENGAGEMENT_START,
      endDate: ENGAGEMENT_END,
      milestoneCount: 4,
    });

    return { coach, student, studentUser, conversation, offer };
  }

  it('applies exactly one of ten simultaneous accepts', async () => {
    const { coach, offer } = await openOffer();
    const coachUser = await prisma.user.findFirstOrThrow({
      where: { coachProfile: { id: coach.id } },
    });

    const { fulfilled, rejected } = await race(10, () =>
      transitionOffer({
        offerId: offer.id,
        event: 'ACCEPT',
        actor: 'COACH',
        actorId: coachUser.id,
        actorProfileId: coach.id,
      }),
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    expect(rejected.every((e) => e instanceof ConcurrentModificationError)).toBe(true);

    const events = await prisma.offerEvent.count({
      where: { offerId: offer.id, toStatus: 'ACCEPTED' },
    });
    expect(events).toBe(1);

    const after = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(after.status).toBe('ACCEPTED');
  });

  it('resolves accept-versus-cancel to exactly one winner', async () => {
    const { coach, student, studentUser, offer } = await openOffer();
    const coachUser = await prisma.user.findFirstOrThrow({
      where: { coachProfile: { id: coach.id } },
    });

    const outcomes = await Promise.allSettled([
      transitionOffer({
        offerId: offer.id,
        event: 'ACCEPT',
        actor: 'COACH',
        actorId: coachUser.id,
        actorProfileId: coach.id,
      }),
      transitionOffer({
        offerId: offer.id,
        event: 'CANCEL',
        actor: 'STUDENT',
        actorId: studentUser.id,
        actorProfileId: student.id,
      }),
    ]);

    const won = outcomes.filter((o) => o.status === 'fulfilled');
    expect(won).toHaveLength(1);

    const after = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(['ACCEPTED', 'CANCELLED']).toContain(after.status);

    // If cancel won, the slots must be free. If accept won, they must still be
    // held. Either is correct; a mix is not.
    const heldCount = await prisma.slotHold.count({
      where: { offerId: offer.id, status: 'HELD' },
    });
    expect(heldCount).toBe(after.status === 'CANCELLED' ? 0 : 2);
  });

  it('refuses to expire an offer whose payment landed first', async () => {
    const { offer } = await openOffer();
    await prisma.offer.update({
      where: { id: offer.id },
      data: { status: 'ACCEPTED', expiresAt: new Date(Date.now() - 60_000) },
    });
    await capturePayment(offer.id, PRICE);

    const result = await expireOffers();
    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(1);

    const after = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(after.status).toBe('ACCEPTED');
  });
});

describe('escrow funding idempotency', () => {
  async function fundedEngagement() {
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
      scope: scope({ slots: [slot(0), slot(24 * 7), slot(24 * 14), slot(24 * 21)] }),
      priceMinor: PRICE,
      startDate: ENGAGEMENT_START,
      endDate: ENGAGEMENT_END,
      milestoneCount: 4,
    });

    await transitionOffer({
      offerId: offer.id,
      event: 'ACCEPT',
      actor: 'COACH',
      actorId: coachUser.id,
      actorProfileId: coach.id,
    });
    await capturePayment(offer.id, PRICE);
    await transitionOffer({ offerId: offer.id, event: 'PAYMENT_CAPTURED', actor: 'SYSTEM' });

    const engagement = await prisma.engagement.findUniqueOrThrow({
      where: { offerId: offer.id },
      include: { milestones: { orderBy: { index: 'asc' } } },
    });

    return { coach, student, studentUser, offer, engagement };
  }

  it('creates one engagement, one escrow posting and four milestones', async () => {
    const { engagement } = await fundedEngagement();

    expect(engagement.milestones).toHaveLength(4);
    expect(engagement.milestones.reduce((s, m) => s + m.amountMinor, 0)).toBe(PRICE);

    const escrow = await assertEscrowNonNegative(engagement.id);
    expect(escrow).toBe(PRICE);
    await assertLedgerBalanced();

    const bookings = await prisma.booking.count({ where: { engagementId: engagement.id } });
    expect(bookings).toBe(4);
    const stillHeld = await prisma.slotHold.count({
      where: { offerId: engagement.offerId, status: 'HELD' },
    });
    expect(stillHeld).toBe(0);
  });

  it('survives a duplicated payment webhook without double-crediting escrow', async () => {
    const { offer, engagement } = await fundedEngagement();

    // The provider redelivers. The FSM rejects the second transition because
    // the offer already left ACCEPTED — but even if it did not, the effects
    // are individually idempotent.
    await expect(
      transitionOffer({ offerId: offer.id, event: 'PAYMENT_CAPTURED', actor: 'SYSTEM' }),
    ).rejects.toThrow();

    const escrow = await assertEscrowNonNegative(engagement.id);
    expect(escrow).toBe(PRICE);

    const engagements = await prisma.engagement.count({ where: { offerId: offer.id } });
    expect(engagements).toBe(1);
    const milestones = await prisma.milestone.count({ where: { engagementId: engagement.id } });
    expect(milestones).toBe(4);
  });
});

describe('auto-release versus dispute', () => {
  async function readyForRelease() {
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
      priceMinor: PRICE,
      startDate: ENGAGEMENT_START,
      endDate: ENGAGEMENT_END,
      milestoneCount: 4,
    });
    await transitionOffer({
      offerId: offer.id,
      event: 'ACCEPT',
      actor: 'COACH',
      actorId: coachUser.id,
      actorProfileId: coach.id,
    });
    await capturePayment(offer.id, PRICE);
    await transitionOffer({ offerId: offer.id, event: 'PAYMENT_CAPTURED', actor: 'SYSTEM' });
    await transitionOffer({
      offerId: offer.id,
      event: 'ENGAGEMENT_STARTED',
      actor: 'SYSTEM',
      metadata: {},
    });

    const engagement = await prisma.engagement.findUniqueOrThrow({
      where: { offerId: offer.id },
      include: { milestones: { orderBy: { index: 'asc' } } },
    });

    // Put milestone 0 one second past its auto-release deadline.
    await prisma.milestone.update({
      where: { id: engagement.milestones[0].id },
      data: {
        status: 'PENDING_CONFIRMATION',
        autoReleaseAt: new Date(Date.now() - 1000),
      },
    });

    return { coach, student, studentUser, offer, engagement };
  }

  it('releases escrow and splits the commission correctly', async () => {
    const { coach, engagement } = await readyForRelease();
    const milestoneAmount = engagement.milestones[0].amountMinor;

    const result = await autoReleaseMilestones();
    expect(result.processed).toBe(1);

    await assertLedgerBalanced();
    const escrow = await assertEscrowNonNegative(engagement.id);
    expect(escrow).toBe(PRICE - milestoneAmount);

    // 18% default commission, rounded toward the coach.
    const expectedCommission = Math.floor((milestoneAmount * 1800) / 10_000);
    expect(await coachPayable(coach.id)).toBe(milestoneAmount - expectedCommission);
  });

  it('never both releases and freezes the same milestone', async () => {
    const { studentUser, engagement } = await readyForRelease();
    const milestone = engagement.milestones[0];

    // The dangerous moment: a student files a no-show at the exact instant the
    // worker sweeps. Both paths compare-and-swap the same row from
    // PENDING_CONFIRMATION, so one must lose.
    const [releaseOutcome, disputeOutcome] = await Promise.allSettled([
      autoReleaseMilestones(),
      openDispute({
        engagementId: engagement.id,
        milestoneId: milestone.id,
        openedByUserId: studentUser.id,
        openedByRole: 'STUDENT',
        reason: 'COACH_NO_SHOW',
        detail: 'Koç seansa gelmedi.',
      }),
    ]);

    const after = await prisma.milestone.findUniqueOrThrow({ where: { id: milestone.id } });
    expect(['RELEASED', 'DISPUTED']).toContain(after.status);

    // Whichever won, the books must be consistent and escrow must not be
    // double-spent.
    await assertLedgerBalanced();
    const escrow = await assertEscrowNonNegative(engagement.id);

    if (after.status === 'RELEASED') {
      expect(escrow).toBe(PRICE - milestone.amountMinor);
    } else {
      // Frozen: nothing left escrow at all.
      expect(escrow).toBe(PRICE);
      const releaseEntries = await prisma.ledgerEntry.count({
        where: { milestoneId: milestone.id, account: 'COACH_PAYABLE' },
      });
      expect(releaseEntries).toBe(0);
    }

    void releaseOutcome;
    void disputeOutcome;
  });

  it('refuses to auto-release a milestone containing a coach no-show', async () => {
    const { engagement } = await readyForRelease();
    const milestone = engagement.milestones[0];

    await prisma.booking.updateMany({
      where: { engagementId: engagement.id },
      data: { milestoneId: milestone.id, status: 'NO_SHOW_COACH' },
    });

    const result = await autoReleaseMilestones();
    expect(result.processed).toBe(0);

    const after = await prisma.milestone.findUniqueOrThrow({ where: { id: milestone.id } });
    expect(after.status).toBe('PENDING_CONFIRMATION');
    expect(await coachPayable(engagement.coachProfileId)).toBe(0);
  });

  it('is idempotent when two workers sweep at once', async () => {
    const { coach, engagement } = await readyForRelease();
    const milestoneAmount = engagement.milestones[0].amountMinor;

    const results = await Promise.all([
      autoReleaseMilestones(),
      autoReleaseMilestones(),
      autoReleaseMilestones(),
    ]);

    const totalProcessed = results.reduce((s, r) => s + r.processed, 0);
    expect(totalProcessed).toBe(1);

    const expectedCommission = Math.floor((milestoneAmount * 1800) / 10_000);
    expect(await coachPayable(coach.id)).toBe(milestoneAmount - expectedCommission);
    await assertLedgerBalanced();
  });
});

describe('dispute resolution', () => {
  async function disputedEngagement() {
    const { coach } = await makeCoach();
    const { user: studentUser, student } = await makeStudent();
    const conversation = await makeConversation(coach.id, student.id);
    const coachUser = await prisma.user.findFirstOrThrow({
      where: { coachProfile: { id: coach.id } },
    });
    const admin = await prisma.user.create({
      data: { email: `admin-${Date.now()}@example.com`, roles: ['ADMIN'] },
    });

    const offer = await createOffer({
      conversationId: conversation.id,
      coachProfileId: coach.id,
      studentProfileId: student.id,
      initiatorRole: 'STUDENT',
      actorId: studentUser.id,
      actorProfileId: student.id,
      title: 'Aylık koçluk',
      scope: scope({ slots: [slot(0), slot(24 * 7)] }),
      priceMinor: PRICE,
      startDate: ENGAGEMENT_START,
      endDate: ENGAGEMENT_END,
      milestoneCount: 4,
    });
    await transitionOffer({
      offerId: offer.id,
      event: 'ACCEPT',
      actor: 'COACH',
      actorId: coachUser.id,
      actorProfileId: coach.id,
    });
    await capturePayment(offer.id, PRICE);
    await transitionOffer({ offerId: offer.id, event: 'PAYMENT_CAPTURED', actor: 'SYSTEM' });
    await transitionOffer({ offerId: offer.id, event: 'ENGAGEMENT_STARTED', actor: 'SYSTEM' });

    const engagement = await prisma.engagement.findUniqueOrThrow({
      where: { offerId: offer.id },
      include: { milestones: { orderBy: { index: 'asc' } } },
    });

    return { coach, student, studentUser, admin, offer, engagement };
  }

  /**
   * Regression test for a bug where `openDispute` always failed on its very
   * first legitimate call: it created the `Dispute` row, then asked the FSM
   * to transition the offer to DISPUTED — and the FSM's "a dispute is already
   * open" guard saw the row `openDispute` had *just* created and refused the
   * transition every single time, leaving an orphaned OPEN dispute with the
   * offer stuck at its prior status. Fixed by transitioning first and writing
   * the ticket only once that succeeds.
   */
  it('opens a dispute on the first call against a freshly-funded engagement', async () => {
    const { studentUser, offer, engagement } = await disputedEngagement();

    const dispute = await openDispute({
      engagementId: engagement.id,
      openedByUserId: studentUser.id,
      openedByRole: 'STUDENT',
      reason: 'OTHER',
      detail: 'Fikrim değişti, programı iptal etmek istiyorum.',
    });

    expect(dispute.status).toBe('OPEN');

    const updated = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(updated.status).toBe('DISPUTED');
  });

  it('is idempotent when two dispute-open calls race each other', async () => {
    const { studentUser, engagement } = await disputedEngagement();

    const { fulfilled, rejected } = await race(2, () =>
      openDispute({
        engagementId: engagement.id,
        openedByUserId: studentUser.id,
        openedByRole: 'STUDENT',
        reason: 'OTHER',
        detail: 'İki kez tıkladım ama tek itiraz açılmalı.',
      }),
    );

    // Both calls must resolve — neither the FSM race nor the double-tap path
    // should surface as an error to the caller.
    expect(rejected).toHaveLength(0);
    expect(fulfilled).toHaveLength(2);
    expect(fulfilled[0].id).toBe(fulfilled[1].id);

    const disputes = await prisma.dispute.findMany({
      where: { engagementId: engagement.id },
    });
    expect(disputes).toHaveLength(1);
  });

  it('freezes every unreleased milestone and cancels nothing already paid', async () => {
    const { coach, studentUser, engagement } = await disputedEngagement();
    const first = engagement.milestones[0];

    // Release milestone 0 legitimately first.
    await prisma.milestone.update({
      where: { id: first.id },
      data: { status: 'PENDING_CONFIRMATION', autoReleaseAt: new Date(Date.now() - 1000) },
    });
    await autoReleaseMilestones();
    const paidOut = await coachPayable(coach.id);
    expect(paidOut).toBeGreaterThan(0);

    await openDispute({
      engagementId: engagement.id,
      openedByUserId: studentUser.id,
      openedByRole: 'STUDENT',
      reason: 'UNRESPONSIVE',
      detail: 'Koç iki haftadır cevap vermiyor.',
    });

    const after = await prisma.milestone.findMany({
      where: { engagementId: engagement.id },
      orderBy: { index: 'asc' },
    });
    expect(after[0].status).toBe('RELEASED'); // untouched — already earned
    expect(after.slice(1).every((m) => m.status === 'DISPUTED')).toBe(true);
    expect(await coachPayable(coach.id)).toBe(paidOut);
  });

  it('refunds unreleased escrow and frees future slots on a refund ruling', async () => {
    const { admin, studentUser, engagement } = await disputedEngagement();

    const dispute = await openDispute({
      engagementId: engagement.id,
      openedByUserId: studentUser.id,
      openedByRole: 'STUDENT',
      reason: 'COACH_NO_SHOW',
      detail: 'Hiç seans yapılmadı.',
    });

    await resolveDispute({
      disputeId: dispute.id,
      adminUserId: admin.id,
      resolution: { outcome: 'REFUND', note: 'Koç seanslara katılmadı.' },
    });

    await assertLedgerBalanced();
    expect(await assertEscrowNonNegative(engagement.id)).toBe(0);

    // One Refund row per milestone, not one per engagement — see the docstring
    // on refundUnreleasedEscrow. Iyzico refunds against a per-milestone
    // paymentTransactionId, so a single aggregate row would have nothing to
    // submit against; the rows must sum to the full price instead.
    const refunds = await prisma.refund.findMany({
      where: { engagementId: engagement.id },
    });
    expect(refunds.reduce((sum, r) => sum + r.amountMinor, 0)).toBe(PRICE);
    expect(refunds.every((r) => r.status === 'PENDING')).toBe(true); // provider call is the worker's job

    const futureBookings = await prisma.booking.count({
      where: { engagementId: engagement.id, status: 'SCHEDULED' },
    });
    expect(futureBookings).toBe(0);

    const engagementAfter = await prisma.engagement.findUniqueOrThrow({
      where: { id: engagement.id },
    });
    expect(engagementAfter.status).toBe('CANCELLED');
  });

  it('splits frozen escrow exactly, with no rounding drift', async () => {
    const { admin, coach, studentUser, engagement } = await disputedEngagement();

    const dispute = await openDispute({
      engagementId: engagement.id,
      openedByUserId: studentUser.id,
      openedByRole: 'STUDENT',
      reason: 'QUALITY',
      detail: 'İlk iki hafta iyiydi, sonrası kötü.',
    });

    // Award the coach an amount that does not align to a milestone boundary.
    const coachShare = 150_001;
    await resolveDispute({
      disputeId: dispute.id,
      adminUserId: admin.id,
      resolution: { outcome: 'SPLIT', coachShareMinor: coachShare, note: 'Kısmi iade.' },
    });

    await assertLedgerBalanced();
    expect(await assertEscrowNonNegative(engagement.id)).toBe(0);

    const expectedCommission = 0; // computed below per posting; assert the sum instead
    void expectedCommission;

    const payable = await coachPayable(coach.id);
    const refund = await prisma.refund.findFirstOrThrow({
      where: { engagementId: engagement.id, reason: 'dispute_split' },
    });

    // Coach's net + platform commission + refund must reconstruct the total.
    const commission = await prisma.ledgerEntry.aggregate({
      where: { engagementId: engagement.id, account: 'PLATFORM_REVENUE' },
      _sum: { amountMinor: true },
    });
    expect(payable + (commission._sum.amountMinor ?? 0)).toBe(coachShare);
    expect(refund.amountMinor).toBe(PRICE - coachShare);
  });

  it('opens only one dispute when a student double-taps', async () => {
    const { studentUser, engagement } = await disputedEngagement();

    const { fulfilled } = await race(5, () =>
      openDispute({
        engagementId: engagement.id,
        openedByUserId: studentUser.id,
        openedByRole: 'STUDENT',
        reason: 'UNRESPONSIVE',
        detail: 'Cevap yok.',
      }),
    );

    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const disputes = await prisma.dispute.count({ where: { engagementId: engagement.id } });
    expect(disputes).toBe(1);
  });
});

describe('payout batching', () => {
  it('produces one payout per coach per week under concurrent runs', async () => {
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
      priceMinor: PRICE,
      startDate: ENGAGEMENT_START,
      endDate: ENGAGEMENT_END,
      milestoneCount: 4,
    });
    await transitionOffer({
      offerId: offer.id,
      event: 'ACCEPT',
      actor: 'COACH',
      actorId: coachUser.id,
      actorProfileId: coach.id,
    });
    await capturePayment(offer.id, PRICE);
    await transitionOffer({ offerId: offer.id, event: 'PAYMENT_CAPTURED', actor: 'SYSTEM' });

    const milestone = await prisma.milestone.findFirstOrThrow({
      where: { engagement: { offerId: offer.id } },
      orderBy: { index: 'asc' },
    });
    await prisma.milestone.update({
      where: { id: milestone.id },
      data: { status: 'PENDING_CONFIRMATION', autoReleaseAt: new Date(Date.now() - 1000) },
    });
    await autoReleaseMilestones();

    const balanceBefore = await coachPayable(coach.id);
    expect(balanceBefore).toBeGreaterThan(0);

    await Promise.all([runPayoutBatch(), runPayoutBatch(), runPayoutBatch()]);

    const payouts = await prisma.payout.findMany({ where: { coachProfileId: coach.id } });
    expect(payouts).toHaveLength(1);
    expect(payouts[0].amountMinor).toBe(balanceBefore);
    expect(await coachPayable(coach.id)).toBe(0);
    await assertLedgerBalanced();
  });
});

describe('milestone lifecycle', () => {
  it('closes an ended milestone and sets the auto-release deadline', async () => {
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
      scope: scope({ slots: [] }),
      priceMinor: PRICE,
      startDate: new Date('2020-01-01'),
      endDate: new Date('2020-02-01'),
      milestoneCount: 4,
    });
    await transitionOffer({
      offerId: offer.id,
      event: 'ACCEPT',
      actor: 'COACH',
      actorId: coachUser.id,
      actorProfileId: coach.id,
    });
    await capturePayment(offer.id, PRICE);
    await transitionOffer({ offerId: offer.id, event: 'PAYMENT_CAPTURED', actor: 'SYSTEM' });

    await prisma.milestone.updateMany({
      where: { engagement: { offerId: offer.id } },
      data: { status: 'IN_PROGRESS' },
    });

    const closed = await closeMilestones();
    expect(closed.processed).toBe(4);

    const milestones = await prisma.milestone.findMany({
      where: { engagement: { offerId: offer.id } },
    });
    expect(milestones.every((m) => m.status === 'PENDING_CONFIRMATION')).toBe(true);
    expect(milestones.every((m) => m.autoReleaseAt !== null)).toBe(true);
  });
});
