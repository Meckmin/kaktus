import { prisma } from '@/lib/db';
import { TX_OPTIONS, ConcurrentModificationError, casStatus, tryAdvisoryLock } from '@/lib/tx';
import { postMilestoneRelease } from '@/lib/payments/escrow';
import { milestoneCompletableAt } from '@/lib/offers/scope';
import { transitionOffer } from '@/server/services/offer-service';

/**
 * Milestone lifecycle worker.
 *
 * Runs every 5 minutes. Three passes, deliberately separate so a failure in one
 * cannot block the others:
 *
 *   1. `activateMilestones`   SCHEDULED → IN_PROGRESS when the period opens
 *   2. `closeMilestones`      IN_PROGRESS → PENDING_CONFIRMATION when it ends,
 *                             setting the auto-release deadline
 *   3. `autoReleaseMilestones` PENDING_CONFIRMATION → RELEASED once both parties
 *                             confirmed, or the deadline passed with no dispute
 *
 * Why auto-release at all: requiring both parties to click before a coach gets
 * paid sounds fair and is a disaster in practice. Students disappear after the
 * exam. Coaches would be unpaid for work they did, would learn not to trust the
 * escrow, and would push students off-platform — which is the exact behaviour
 * the anti-circumvention filter exists to prevent. Silence must therefore mean
 * approval, with a window long enough to object.
 */

/** How long after a milestone period ends before funds release on silence. */
export const AUTO_RELEASE_DAYS = 5;

/** Cap on rows per pass, so one slow run cannot hold locks for minutes. */
const BATCH_SIZE = 200;

export interface JobResult {
  processed: number;
  skipped: number;
  failed: number;
  errors: Array<{ id: string; message: string }>;
}

const emptyResult = (): JobResult => ({ processed: 0, skipped: 0, failed: 0, errors: [] });

export async function activateMilestones(now = new Date()): Promise<JobResult> {
  const result = emptyResult();

  const due = await prisma.milestone.findMany({
    where: { status: 'SCHEDULED', periodStart: { lte: now } },
    select: { id: true },
    take: BATCH_SIZE,
  });

  for (const milestone of due) {
    try {
      await casStatus(prisma.milestone, {
        id: milestone.id,
        from: 'SCHEDULED',
        data: { status: 'IN_PROGRESS' },
        entity: 'Milestone',
      });
      result.processed++;
    } catch (error) {
      if (error instanceof ConcurrentModificationError) {
        result.skipped++; // another worker got there, or a dispute froze it
        continue;
      }
      result.failed++;
      result.errors.push({ id: milestone.id, message: String(error) });
    }
  }

  return result;
}

export async function closeMilestones(now = new Date()): Promise<JobResult> {
  const result = emptyResult();

  const candidates = await prisma.milestone.findMany({
    where: { status: 'IN_PROGRESS', periodEnd: { lte: now } },
    select: { id: true, periodEnd: true, bookings: { select: { endsAt: true, status: true } } },
    take: BATCH_SIZE,
  });
  // A session can be moved past its milestone's period by an accepted invite;
  // the milestone must not start its auto-release clock before that session
  // has actually happened.
  const ended = candidates.filter((m) => milestoneCompletableAt(m.bookings, m.periodEnd) <= now);

  const autoReleaseAt = new Date(now.getTime() + AUTO_RELEASE_DAYS * 24 * 3600 * 1000);

  for (const milestone of ended) {
    try {
      await casStatus(prisma.milestone, {
        id: milestone.id,
        from: 'IN_PROGRESS',
        data: { status: 'PENDING_CONFIRMATION', autoReleaseAt },
        entity: 'Milestone',
      });
      result.processed++;
    } catch (error) {
      if (error instanceof ConcurrentModificationError) {
        result.skipped++;
        continue;
      }
      result.failed++;
      result.errors.push({ id: milestone.id, message: String(error) });
    }
  }

  return result;
}

/**
 * Releases escrow to the coach for milestones that are ready.
 *
 * A milestone is ready when it is PENDING_CONFIRMATION, has no open dispute on
 * its engagement, has no unresolved coach no-show among its sessions, and
 * either both parties confirmed every session or the auto-release deadline has
 * passed.
 */
export async function autoReleaseMilestones(now = new Date()): Promise<JobResult> {
  const result = emptyResult();

  const candidates = await prisma.milestone.findMany({
    where: {
      status: 'PENDING_CONFIRMATION',
      OR: [
        { autoReleaseAt: { lte: now } },
        // Fast path: both parties already confirmed, no reason to make the
        // coach wait five days for money everyone agrees they earned.
        {
          bookings: {
            every: {
              OR: [
                { status: 'COMPLETED' },
                { AND: [{ coachConfirmedAt: { not: null } }, { studentConfirmedAt: { not: null } }] },
              ],
            },
          },
        },
      ],
    },
    select: {
      id: true,
      amountMinor: true,
      autoReleaseAt: true,
      engagement: {
        select: {
          id: true,
          offerId: true,
          coachProfileId: true,
          commissionBps: true,
          currency: true,
          status: true,
        },
      },
      bookings: {
        select: { id: true, status: true, coachConfirmedAt: true, studentConfirmedAt: true },
      },
    },
    take: BATCH_SIZE,
  });

  for (const milestone of candidates) {
    try {
      const released = await releaseOne(milestone, now);
      if (released) result.processed++;
      else result.skipped++;
    } catch (error) {
      result.failed++;
      result.errors.push({ id: milestone.id, message: String(error) });
    }
  }

  return result;
}

async function releaseOne(
  milestone: {
    id: string;
    amountMinor: number;
    autoReleaseAt: Date | null;
    engagement: {
      id: string;
      offerId: string;
      coachProfileId: string;
      commissionBps: number;
      currency: string;
      status: string;
    };
    bookings: Array<{
      id: string;
      status: string;
      coachConfirmedAt: Date | null;
      studentConfirmedAt: Date | null;
    }>;
  },
  now: Date,
): Promise<boolean> {
  const { engagement } = milestone;

  // A coach no-show blocks release regardless of the clock. Auto-releasing
  // payment for a session the coach did not attend is the single worst thing
  // this worker could do.
  const hasNoShow = milestone.bookings.some((b) => b.status === 'NO_SHOW_COACH');
  if (hasNoShow) return false;

  const deadlinePassed = milestone.autoReleaseAt != null && milestone.autoReleaseAt <= now;
  const allConfirmed =
    milestone.bookings.length > 0 &&
    milestone.bookings.every(
      (b) =>
        b.status === 'COMPLETED' ||
        (b.coachConfirmedAt != null && b.studentConfirmedAt != null),
    );
  if (!deadlinePassed && !allConfirmed) return false;

  const releasedNow = await prisma.$transaction(async (tx) => {
    // Non-blocking: if another worker holds this engagement, skip and let the
    // next run pick it up. Queuing workers behind each other turns a 200-row
    // batch into a serial crawl.
    const gotLock = await tryAdvisoryLock(tx, `engagement:${engagement.id}`);
    if (!gotLock) return false;

    // Re-check inside the lock. The dispute may have been opened in the
    // milliseconds since the candidate query — this is the race that would
    // otherwise pay a coach while a student is filing a no-show report.
    const openDispute = await tx.dispute.count({
      where: {
        engagementId: engagement.id,
        status: { in: ['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'] },
      },
    });
    if (openDispute > 0) return false;

    // CAS: only a milestone still PENDING_CONFIRMATION may be released. If a
    // dispute froze it to DISPUTED between the candidate query and here, this
    // matches zero rows, throws, and rolls the whole transaction back — no
    // partial ledger posting, no money moved for a disputed session.
    //
    // This single statement is the entire defence against the worst race in the
    // system: auto-release firing at the same instant a student reports a
    // no-show. Both paths CAS the same row from the same expected state, so
    // exactly one wins and the loser aborts cleanly.
    await casStatus(tx.milestone, {
      id: milestone.id,
      from: 'PENDING_CONFIRMATION',
      data: { status: 'RELEASED', releasedAt: now },
      entity: 'Milestone',
    });

    await postMilestoneRelease(tx, {
      engagementId: engagement.id,
      milestoneId: milestone.id,
      coachProfileId: engagement.coachProfileId,
      amountMinor: milestone.amountMinor,
      commissionBps: engagement.commissionBps,
      currency: engagement.currency,
    });

    // Sessions with no explicit outcome are recorded as completed, so the
    // booking history matches what was paid for.
    await tx.booking.updateMany({
      where: { milestoneId: milestone.id, status: 'SCHEDULED', endsAt: { lte: now } },
      data: { status: 'COMPLETED' },
    });

    return true;
  }, TX_OPTIONS);

  if (!releasedNow) return false;

  await maybeCompleteEngagement(engagement.id, engagement.offerId);
  return true;
}

/**
 * Moves the engagement and its offer to COMPLETED once every milestone has
 * settled. Runs outside the release transaction: it is a consequence of the
 * release, not part of it, and a failure here must not roll back a payout.
 */
export async function maybeCompleteEngagement(engagementId: string, offerId: string) {
  const outstanding = await prisma.milestone.count({
    where: {
      engagementId,
      status: { in: ['SCHEDULED', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'DISPUTED'] },
    },
  });
  if (outstanding > 0) return false;

  const engagement = await prisma.engagement.findUnique({
    where: { id: engagementId },
    select: { status: true, coachProfileId: true },
  });
  if (!engagement || engagement.status !== 'ACTIVE') return false;

  await prisma.$transaction(async (tx) => {
    await casStatus(tx.engagement, {
      id: engagementId,
      from: 'ACTIVE',
      data: { status: 'COMPLETED', completedAt: new Date() },
      entity: 'Engagement',
    });
    await tx.coachProfile.update({
      where: { id: engagement.coachProfileId },
      data: {
        activeEngagements: { decrement: 1 },
        completedEngagements: { increment: 1 },
      },
    });
  }, TX_OPTIONS);

  await transitionOffer({
    offerId,
    event: 'ALL_MILESTONES_RELEASED',
    actor: 'SYSTEM',
  });

  return true;
}

/** Convenience entry point for the scheduler. */
export async function runMilestoneWorker(now = new Date()) {
  return {
    activated: await activateMilestones(now),
    closed: await closeMilestones(now),
    released: await autoReleaseMilestones(now),
  };
}
