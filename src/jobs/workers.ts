import { prisma } from '@/lib/db';
import { TX_OPTIONS, idempotencyKey, tryAdvisoryLock } from '@/lib/tx';
import { getPaymentProvider } from '@/lib/payments/provider';
import { coachAvailableBalanceMinor, postPayout } from '@/lib/payments/escrow';
import {
  approveReleasedMilestones,
  reconcileStaleCheckouts,
  submitPendingRefunds,
} from './provider-sync';
import { transitionOffer } from '@/server/services/offer-service';
import { expireStaleHolds } from '@/lib/booking/holds';
import { runMilestoneWorker } from './milestones';
import type { JobResult } from './milestones';

/**
 * Background workers.
 *
 * Scheduling note: these are written as plain async functions with an injected
 * clock, so they are callable from a test, a cron route, or a queue consumer
 * without change. Use pg-boss or Inngest in production — a Vercel cron hitting
 * an HTTP route is fine for expiry sweeps but not for payouts, because a
 * timeout mid-run leaves you unable to tell whether the money moved.
 */

const emptyResult = (): JobResult => ({ processed: 0, skipped: 0, failed: 0, errors: [] });

/**
 * Expires offers whose deadline passed, releasing their slot holds.
 *
 * Runs before the hold sweep so slots are freed by the offer transition (which
 * writes an audit trail) rather than by the blunt hold expiry.
 */
export async function expireOffers(now = new Date()): Promise<JobResult> {
  const result = emptyResult();

  const stale = await prisma.offer.findMany({
    where: { status: { in: ['OFFERED', 'COUNTERED', 'ACCEPTED'] }, expiresAt: { lte: now } },
    select: { id: true, status: true },
    take: 200,
  });

  for (const offer of stale) {
    try {
      await transitionOffer({
        offerId: offer.id,
        event: 'EXPIRE',
        actor: 'SYSTEM',
        reason: 'offer_deadline_passed',
        expectedStatus: offer.status,
      });
      result.processed++;
    } catch (error) {
      // An ACCEPTED offer whose payment landed a second ago will fail the
      // guard. That is correct behaviour, not an error worth paging anyone.
      const message = String(error);
      if (message.includes('Payment already captured') || message.includes('modified concurrently')) {
        result.skipped++;
        continue;
      }
      result.failed++;
      result.errors.push({ id: offer.id, message });
    }
  }

  return result;
}

/**
 * Starts engagements whose start date has arrived.
 *
 * `PAID_IN_ESCROW → ACTIVE` (event `ENGAGEMENT_STARTED`) has no other trigger —
 * nothing else in the state machine fires it. Without this pass an engagement
 * sits in `PAID_IN_ESCROW` forever: `ALL_MILESTONES_RELEASED` only applies from
 * `ACTIVE`, so the milestone worker would never be able to complete it however
 * many milestones release.
 */
export async function startEngagements(now = new Date()): Promise<JobResult> {
  const result = emptyResult();

  const due = await prisma.offer.findMany({
    where: { status: 'PAID_IN_ESCROW', engagement: { startDate: { lte: now } } },
    select: { id: true },
    take: 200,
  });

  for (const offer of due) {
    try {
      await transitionOffer({
        offerId: offer.id,
        event: 'ENGAGEMENT_STARTED',
        actor: 'SYSTEM',
        expectedStatus: 'PAID_IN_ESCROW',
      });
      result.processed++;
    } catch (error) {
      const message = String(error);
      if (message.includes('modified concurrently')) {
        result.skipped++;
        continue;
      }
      result.failed++;
      result.errors.push({ id: offer.id, message });
    }
  }

  return result;
}

/** Minimum balance worth a payout run; below this the provider fee dominates. */
const MIN_PAYOUT_MINOR = 10_000; // 100 ₺

/**
 * Weekly payout batch.
 *
 * ── IMPORTANT: disabled under the Iyzico marketplace model ──
 *
 * The original design had us holding funds and instructing payouts. Iyzico's
 * marketplace model does not work that way: Iyzico is the escrow agent, and
 * approving a basket item settles that money to the coach's sub-merchant
 * account directly. We never hold it, which is what keeps us out of scope as a
 * payment institution under Turkish law 6493.
 *
 * So this job runs only for the mock provider, where it models the payout leg
 * for tests. Against Iyzico it is a no-op, and `Payout` rows become a
 * reconciliation record built from settlement reports rather than an
 * instruction we issue. Deleting the job outright would lose that test
 * coverage; leaving it enabled would double-count every release.
 */
export async function runPayoutBatch(now = new Date()): Promise<JobResult> {
  const result = emptyResult();
  const provider = getPaymentProvider();

  if (provider.name === 'iyzico') {
    // Settlement is Iyzico's. See the note above.
    return result;
  }

  const coaches = await prisma.coachProfile.findMany({
    where: { verificationStatus: 'APPROVED', submerchantKey: { not: null } },
    select: { id: true, submerchantKey: true },
    take: 500,
  });

  for (const coach of coaches) {
    try {
      const payout = await prisma.$transaction(async (tx) => {
        const gotLock = await tryAdvisoryLock(tx, `payout:${coach.id}`);
        if (!gotLock) return null;

        const balance = await coachAvailableBalanceMinor(tx, coach.id);
        if (balance < MIN_PAYOUT_MINOR) return null;

        const created = await tx.payout.create({
          data: {
            coachProfileId: coach.id,
            amountMinor: balance,
            status: 'PENDING',
            provider: provider.name,
            idempotencyKey: idempotencyKey('payout', coach.id, isoWeek(now)),
          },
        });

        await postPayout(tx, {
          payoutId: created.id,
          coachProfileId: coach.id,
          amountMinor: balance,
        });

        return created;
      }, TX_OPTIONS);

      if (!payout) {
        result.skipped++;
        continue;
      }

      // Provider call outside the transaction.
      await prisma.payout.update({
        where: { id: payout.id },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });
      result.processed++;
    } catch (error) {
      const message = String(error);
      // Unique violation on the idempotency key means this week's batch already
      // ran for this coach. Expected under retry, not a failure.
      if (message.includes('Unique constraint')) {
        result.skipped++;
        continue;
      }
      result.failed++;
      result.errors.push({ id: coach.id, message });
    }
  }

  return result;
}

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}W${String(week).padStart(2, '0')}`;
}

/**
 * Everything on the 5-minute tick.
 *
 * Order matters. Reconciliation runs first so a payment that captured while we
 * were not looking becomes an engagement before anything downstream decides
 * what is due. Engagement start runs before the milestone worker so a period
 * whose start date just arrived is ACTIVE by the time milestones are swept.
 * Provider approval runs after the milestone worker, because it acts on
 * milestones that worker just released.
 */
export async function runFrequentJobs(now = new Date()) {
  const reconciled = await reconcileStaleCheckouts(now);
  const offers = await expireOffers(now);
  const holds = await expireStaleHolds(now);
  const started = await startEngagements(now);
  const milestones = await runMilestoneWorker(now);
  const approvals = await approveReleasedMilestones(now);
  const refunds = await submitPendingRefunds(now);
  return { reconciled, offers, holdsExpired: holds, started, milestones, approvals, refunds };
}

export { runMilestoneWorker, approveReleasedMilestones, reconcileStaleCheckouts, submitPendingRefunds };
