import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { getPaymentProvider } from '@/lib/payments/provider';
import { reconcileCheckout } from '@/server/services/payment-service';
import type { JobResult } from './milestones';

/**
 * Workers that talk to the payment provider.
 *
 * All of them share one shape: the database already holds the decision, and
 * these jobs make the outside world match it. That ordering is deliberate —
 * every one of these operations is retryable precisely because the accounting
 * committed first and the provider call is a separate, idempotent step.
 */

const emptyResult = (): JobResult => ({ processed: 0, skipped: 0, failed: 0, errors: [] });

// ─────────────────────────────────────────────────────────────────────────────
// 1. Escrow release: approve the basket item for each released milestone
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Under Iyzico's marketplace model, approving the basket item IS the escrow
 * release: until we call it, Iyzico holds the funds; after it, they settle to
 * the coach's sub-merchant account.
 *
 * The local ledger is written first (by `autoReleaseMilestones`), and this job
 * catches up the provider. The window between the two is the one place where
 * our books say "paid" and Iyzico still holds the money — bounded by this job's
 * 5-minute cadence, visible in `providerApprovedAt`, and safe because the
 * direction of the discrepancy always favours the student.
 */
export async function approveReleasedMilestones(now = new Date()): Promise<JobResult> {
  const result = emptyResult();
  const provider = getPaymentProvider();

  const pending = await prisma.milestone.findMany({
    where: {
      status: 'RELEASED',
      providerApprovedAt: null,
      providerTransactionId: { not: null },
    },
    select: {
      id: true,
      providerTransactionId: true,
      engagement: { select: { id: true, offerId: true } },
    },
    take: 100,
  });

  for (const milestone of pending) {
    try {
      const outcome = await provider.approveItem({
        paymentTransactionId: milestone.providerTransactionId!,
        conversationId: `approve:${milestone.id}`,
      });

      if (outcome.ok) {
        await prisma.milestone.update({
          where: { id: milestone.id },
          data: { providerApprovedAt: new Date(), providerApproveError: null },
        });
        result.processed++;
      } else {
        await prisma.milestone.update({
          where: { id: milestone.id },
          data: { providerApproveError: outcome.message.slice(0, 500) },
        });
        result.failed++;
        result.errors.push({ id: milestone.id, message: outcome.message });
      }
    } catch (error) {
      result.failed++;
      result.errors.push({ id: milestone.id, message: String(error) });
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Reconciliation sweep — the safety net
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-checks checkout sessions that never reached a terminal state.
 *
 * This exists because the two happy paths both have holes: the browser callback
 * never fires if the student closes the tab, and the webhook gives up after
 * three attempts. Without a sweep, a student's money sits in escrow against an
 * offer still marked ACCEPTED, and nobody finds out until they complain.
 *
 * Runs on sessions older than two minutes (giving the callback a chance to win)
 * and younger than 24 hours (after which the token is long dead).
 */
export async function reconcileStaleCheckouts(now = new Date()): Promise<JobResult> {
  const result = emptyResult();

  const stale = await prisma.payment.findMany({
    where: {
      status: { in: ['INITIATED', 'REQUIRES_ACTION'] },
      token: { not: null },
      createdAt: {
        lt: new Date(now.getTime() - 2 * 60_000),
        gt: new Date(now.getTime() - 24 * 3600_000),
      },
    },
    select: { id: true, token: true },
    take: 100,
  });

  for (const payment of stale) {
    try {
      const outcome = await reconcileCheckout(payment.token!);
      if (outcome.outcome === 'CAPTURED') result.processed++;
      else result.skipped++;
    } catch (error) {
      result.failed++;
      result.errors.push({ id: payment.id, message: String(error) });
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Refund submission
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Submits approved refunds to Iyzico.
 *
 * The ledger reversal already committed when the dispute was resolved, so this
 * job only moves money at the bank. Retrying is therefore safe: the worst case
 * is a duplicate refund request for the same `paymentTransactionId`, which
 * Iyzico rejects on amount grounds rather than double-refunding.
 *
 * Refunds go per basket item, so a whole-engagement refund is several Refund
 * rows — one per unreleased milestone — each carrying its own
 * `paymentTransactionId`.
 */
export async function submitPendingRefunds(now = new Date()): Promise<JobResult> {
  const result = emptyResult();
  const provider = getPaymentProvider();

  const pending = await prisma.refund.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now }, attempts: { lt: 6 } },
    include: { payment: { select: { providerRef: true } } },
    take: 50,
  });

  for (const refund of pending) {
    try {
      await prisma.refund.update({
        where: { id: refund.id },
        data: { attempts: { increment: 1 }, submittedAt: now, status: 'SUBMITTED' },
      });

      if (!refund.paymentTransactionId) {
        // Nothing was ever captured at the provider for this item — the
        // accounting reversal is the whole story. Settle rather than retrying
        // forever against a handle that does not exist.
        await settle(refund.id, null, 'no_provider_transaction');
        result.processed++;
        continue;
      }

      const outcome = await provider.refundItem({
        paymentTransactionId: refund.paymentTransactionId,
        priceMinor: refund.amountMinor,
        currency: refund.currency as 'TRY',
        conversationId: refund.idempotencyKey,
        ip: env.SERVER_PUBLIC_IP,
      });

      if (outcome.ok) {
        await settle(refund.id, outcome.providerRef ?? null, null);
        result.processed++;
      } else if (outcome.retryable) {
        await scheduleRetry(refund.id, refund.attempts + 1, outcome.message);
        result.failed++;
        result.errors.push({ id: refund.id, message: outcome.message });
      } else {
        // A permanent rejection needs a human, not another attempt. Most often
        // this means the item was already approved — which should be impossible
        // given we never refund a released milestone, so it signals a real bug.
        await prisma.refund.update({
          where: { id: refund.id },
          data: { status: 'FAILED', lastError: outcome.message.slice(0, 500) },
        });
        result.failed++;
        result.errors.push({ id: refund.id, message: `PERMANENT: ${outcome.message}` });
      }
    } catch (error) {
      await scheduleRetry(refund.id, refund.attempts + 1, String(error));
      result.failed++;
      result.errors.push({ id: refund.id, message: String(error) });
    }
  }

  return result;
}

async function settle(refundId: string, providerRef: string | null, note: string | null) {
  await prisma.refund.update({
    where: { id: refundId },
    data: { status: 'SETTLED', settledAt: new Date(), providerRef, lastError: note },
  });
}

async function scheduleRetry(refundId: string, attempts: number, message: string) {
  // Exponential backoff, capped at six hours. After six attempts the row stops
  // being picked up and waits for a human — silent infinite retry hides real
  // breakage, and an unrefunded student is a complaint, not a mystery.
  const delayMinutes = Math.min(2 ** attempts * 5, 6 * 60);
  await prisma.refund.update({
    where: { id: refundId },
    data: {
      status: attempts >= 6 ? 'FAILED' : 'PENDING',
      lastError: message.slice(0, 500),
      nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000),
    },
  });
}
