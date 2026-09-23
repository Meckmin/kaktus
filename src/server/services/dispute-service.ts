import { prisma } from '@/lib/db';
import { ConcurrentModificationError, TX_OPTIONS, type Tx, acquireAdvisoryLock, casStatus } from '@/lib/tx';
import { transitionOffer } from './offer-service';
import { OfferTransitionError } from '@/lib/offers/state-machine';
import { refundFromEscrow, releaseMilestone, splitAmount } from '@/lib/payments/escrow';

/**
 * Dispute handling.
 *
 * The governing principle: **freeze first, decide later.** Opening a dispute
 * must be instant and must stop the auto-release clock, because the failure
 * mode that destroys trust is a student reporting a no-show on day 6 and the
 * money releasing to the coach on day 7 while an admin is still reading the
 * ticket.
 *
 * The second principle: **already-released milestones are not clawed back.** A
 * coach who was paid for weeks 1–2 that the student confirmed keeps that money
 * even if week 3 goes wrong. Reversible earnings are not earnings, and a
 * marketplace whose payouts can be retroactively voided cannot recruit supply.
 */

export type DisputeReason =
  | 'COACH_NO_SHOW'
  | 'STUDENT_NO_SHOW'
  | 'QUALITY'
  | 'SCOPE_NOT_DELIVERED'
  | 'UNRESPONSIVE'
  | 'OTHER';

export interface OpenDisputeInput {
  engagementId: string;
  milestoneId?: string;
  openedByUserId: string;
  openedByRole: 'STUDENT' | 'COACH' | 'ADMIN';
  reason: DisputeReason;
  detail: string;
  evidence?: unknown;
}

export async function openDispute(input: OpenDisputeInput) {
  const engagement = await prisma.engagement.findUniqueOrThrow({
    where: { id: input.engagementId },
    select: { id: true, offerId: true, status: true },
  });

  // Freezing runs through the FSM *first*, so the guard that refuses a second
  // dispute ("a dispute is already open") is checked against the state before
  // this call's own ticket exists — checking it after creating the row would
  // make every call collide with itself. The offer-level advisory lock inside
  // `transitionOffer`, plus its CAS on status, is what actually serialises two
  // concurrent opens; only the winner reaches the dispute row below.
  try {
    await transitionOffer({
      offerId: engagement.offerId,
      event: 'OPEN_DISPUTE',
      actor: input.openedByRole,
      actorId: input.openedByUserId,
      reason: input.reason,
    });
  } catch (error) {
    const isCollision =
      (error instanceof OfferTransitionError && error.code === 'ILLEGAL_TRANSITION') ||
      error instanceof ConcurrentModificationError;

    if (isCollision) {
      // Most likely a double-tap racing itself, or a re-open attempt on an
      // engagement that's already disputed. Idempotent: hand back the ticket
      // that's already open instead of erroring.
      //
      // Under a genuine concurrent race the winner's `transitionOffer` may
      // have committed (which is what makes *this* call see the collision)
      // microseconds before the winner has written its own dispute row —
      // those two writes are deliberately not atomic (see the comment below).
      // A short bounded retry closes that window instead of surfacing a
      // transient "not found" to the loser of a race that, from the outside,
      // looks like it should have just worked.
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await prisma.dispute.findFirst({
          where: {
            engagementId: engagement.id,
            status: { in: ['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'] },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) return existing;
        if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    throw error;
  }

  // A consequence of the transition above, not a precondition of it — same
  // reasoning as `maybeCompleteEngagement` in jobs/milestones.ts. If this
  // write fails, the offer is DISPUTED with no ticket describing why; rare,
  // and recoverable by re-raising, unlike the alternative ordering which
  // failed on every single call.
  return prisma.dispute.create({
    data: {
      engagementId: engagement.id,
      milestoneId: input.milestoneId,
      openedById: input.openedByUserId,
      openedByRole: input.openedByRole,
      reason: input.reason,
      detail: input.detail,
      evidence: (input.evidence ?? undefined) as never,
      status: 'OPEN',
    },
  });
}

export type Resolution =
  | { outcome: 'RELEASE'; note: string }
  | { outcome: 'REFUND'; note: string }
  | { outcome: 'SPLIT'; coachShareMinor: number; note: string };

/**
 * Admin decision. Only an admin reaches this — the FSM enforces that, and it is
 * worth keeping strict: letting a coach "resolve" a dispute in their own favour
 * is the single most exploitable path in a marketplace.
 */
export async function resolveDispute(args: {
  disputeId: string;
  adminUserId: string;
  resolution: Resolution;
}) {
  const dispute = await prisma.dispute.findUniqueOrThrow({
    where: { id: args.disputeId },
    include: {
      engagement: {
        select: {
          id: true,
          offerId: true,
          coachProfileId: true,
          commissionBps: true,
          currency: true,
        },
      },
    },
  });

  if (!['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'].includes(dispute.status)) {
    throw new Error(`Dispute ${dispute.id} is already resolved (${dispute.status})`);
  }

  const { engagement } = dispute;
  const now = new Date();

  /**
   * Hoisted into a local const before the branch, deliberately.
   *
   * TypeScript discards discriminated-union narrowing on a *property access*
   * (`args.resolution`) once it crosses into a callback, because the property
   * could in principle be reassigned before that callback runs. Narrowing a
   * `const` local survives. Without this the SPLIT branch below cannot see
   * `coachShareMinor` at all, and the build fails.
   */
  const resolution = args.resolution;

  // SPLIT is settled here directly: it is a partial release and a partial
  // refund of the same frozen milestones, which no single FSM transition
  // expresses. RELEASE and REFUND go through the FSM, which owns those paths.
  if (resolution.outcome === 'SPLIT') {
    await prisma.$transaction(async (tx) => {
      await acquireAdvisoryLock(tx, `engagement:${engagement.id}`);
      await settleSplit(tx, {
        engagementId: engagement.id,
        coachProfileId: engagement.coachProfileId,
        commissionBps: engagement.commissionBps,
        currency: engagement.currency,
        coachShareMinor: resolution.coachShareMinor,
        now,
      });
      await casStatus(tx.dispute, {
        id: dispute.id,
        from: ['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'],
        data: {
          status: 'RESOLVED_SPLIT',
          resolution: resolution.note,
          resolvedById: args.adminUserId,
          resolvedAt: now,
          coachShareMinor: resolution.coachShareMinor,
        },
        entity: 'Dispute',
      });
    }, TX_OPTIONS);

    // The offer follows the money: a split that leaves nothing in escrow ends
    // the engagement.
    await transitionOffer({
      offerId: engagement.offerId,
      event: 'RESOLVE_DISPUTE_REFUND',
      actor: 'ADMIN',
      actorId: args.adminUserId,
      reason: resolution.note,
      metadata: { disputeId: dispute.id, outcome: 'SPLIT' },
    });
    return;
  }

  const event =
    resolution.outcome === 'RELEASE'
      ? ('RESOLVE_DISPUTE_RELEASE' as const)
      : ('RESOLVE_DISPUTE_REFUND' as const);

  const result = await transitionOffer({
    offerId: engagement.offerId,
    event,
    actor: 'ADMIN',
    actorId: args.adminUserId,
    reason: resolution.note,
    metadata: { disputeId: dispute.id },
  });

  await prisma.$transaction(async (tx) => {
    await casStatus(tx.dispute, {
      id: dispute.id,
      from: ['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'],
      data: {
        status: resolution.outcome === 'RELEASE' ? 'RESOLVED_RELEASE' : 'RESOLVED_REFUND',
        resolution: resolution.note,
        resolvedById: args.adminUserId,
        resolvedAt: now,
      },
      entity: 'Dispute',
    });

    if (resolution.outcome === 'RELEASE') {
      await tx.engagement.update({
        where: { id: engagement.id },
        data: { status: 'ACTIVE' },
      });
    }
  }, TX_OPTIONS);

  return result;
}

/**
 * Partial settlement: the coach keeps `coachShareMinor` of the frozen escrow,
 * the student gets the rest back.
 *
 * Implemented by walking frozen milestones in order and paying them out until
 * the coach's share is exhausted, splitting at most one milestone. Milestone
 * amounts are the ledger's unit of account, so allocating share proportionally
 * across all of them would produce rounding drift across four rows; walking in
 * order produces at most one partial and keeps the arithmetic exact.
 */
async function settleSplit(
  tx: Tx,
  args: {
    engagementId: string;
    coachProfileId: string;
    commissionBps: number;
    currency: string;
    coachShareMinor: number;
    now: Date;
  },
) {
  const frozen = await tx.milestone.findMany({
    where: { engagementId: args.engagementId, status: 'DISPUTED' },
    orderBy: { index: 'asc' },
  });

  const frozenTotal = frozen.reduce((sum, m) => sum + m.amountMinor, 0);
  if (args.coachShareMinor < 0 || args.coachShareMinor > frozenTotal) {
    throw new Error(
      `Coach share ${args.coachShareMinor} outside frozen escrow of ${frozenTotal}`,
    );
  }

  let remainingToCoach = args.coachShareMinor;

  for (const milestone of frozen) {
    if (remainingToCoach >= milestone.amountMinor) {
      await releaseMilestone(tx, {
        engagementId: args.engagementId,
        milestoneId: milestone.id,
        coachProfileId: args.coachProfileId,
        amountMinor: milestone.amountMinor,
        commissionBps: args.commissionBps,
        currency: args.currency,
      });
      remainingToCoach -= milestone.amountMinor;
      continue;
    }

    if (remainingToCoach > 0) {
      // Partial: release what the coach earned, refund the balance. Both
      // postings carry the same milestoneId so the two halves reconcile.
      await releaseMilestone(tx, {
        engagementId: args.engagementId,
        milestoneId: milestone.id,
        coachProfileId: args.coachProfileId,
        amountMinor: remainingToCoach,
        commissionBps: args.commissionBps,
        currency: args.currency,
      });
      await refundFromEscrow(tx, {
        engagementId: args.engagementId,
        milestoneId: milestone.id,
        amountMinor: milestone.amountMinor - remainingToCoach,
        reason: 'dispute_split',
        currency: args.currency,
      });
      remainingToCoach = 0;
      continue;
    }

    await refundFromEscrow(tx, {
      engagementId: args.engagementId,
      milestoneId: milestone.id,
      amountMinor: milestone.amountMinor,
      reason: 'dispute_split',
      currency: args.currency,
    });
  }

  // Future sessions are cancelled either way; the slots return to the coach.
  await tx.booking.updateMany({
    where: {
      engagementId: args.engagementId,
      status: 'SCHEDULED',
      startsAt: { gte: args.now },
    },
    data: { status: 'CANCELLED_BY_STUDENT', cancelReason: 'dispute_split' },
  });

  const refundTotal = frozenTotal - args.coachShareMinor;
  if (refundTotal > 0) {
    const engagement = await tx.engagement.findUniqueOrThrow({
      where: { id: args.engagementId },
      select: { offerId: true, currency: true },
    });
    const payment = await tx.payment.findFirst({
      where: { offerId: engagement.offerId, status: 'CAPTURED' },
      select: { id: true },
    });
    await tx.refund.create({
      data: {
        engagementId: args.engagementId,
        paymentId: payment?.id,
        amountMinor: refundTotal,
        currency: engagement.currency,
        reason: 'dispute_split',
        status: 'PENDING',
        idempotencyKey: `refund:${args.engagementId}:dispute_split`,
      },
    });
  }

  await tx.engagement.update({
    where: { id: args.engagementId },
    data: { status: 'CANCELLED', completedAt: args.now },
  });
}

/**
 * No-show detection.
 *
 * A coach no-show is the case the product must handle well, so it does not wait
 * for the student to file paperwork: when a session passes with the coach
 * unconfirmed and the student having marked it, a dispute is opened
 * automatically. The student's obligation is one tap, not a support ticket.
 */
export async function flagCoachNoShow(args: {
  bookingId: string;
  reportedByUserId: string;
}) {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: args.bookingId },
    select: {
      id: true,
      status: true,
      engagementId: true,
      milestoneId: true,
      endsAt: true,
      coachConfirmedAt: true,
    },
  });

  if (!booking.engagementId) throw new Error('Booking has no engagement');
  if (booking.endsAt > new Date()) throw new Error('Session has not ended yet');

  await prisma.$transaction(async (tx) => {
    await casStatus(tx.booking, {
      id: booking.id,
      from: 'SCHEDULED',
      data: { status: 'NO_SHOW_COACH', cancelledByRole: 'STUDENT' },
      entity: 'Booking',
    });
  }, TX_OPTIONS);

  return openDispute({
    engagementId: booking.engagementId,
    milestoneId: booking.milestoneId ?? undefined,
    openedByUserId: args.reportedByUserId,
    openedByRole: 'STUDENT',
    reason: 'COACH_NO_SHOW',
    detail: `Koç ${booking.id} numaralı seansta yer almadı.`,
    evidence: { bookingId: booking.id, endsAt: booking.endsAt },
  });
}

export { splitAmount };
