import { prisma } from '@/lib/db';
import {
  ConcurrentModificationError,
  TX_OPTIONS,
  acquireAdvisoryLock,
  casStatus,
} from '@/lib/tx';
import { milestoneCompletableAt } from '@/lib/offers/scope';
import { postMilestoneRelease } from '@/lib/payments/escrow';
import { getPaymentProvider } from '@/lib/payments/provider';
import { AUTO_RELEASE_DAYS, maybeCompleteEngagement } from '@/jobs/milestones';

/**
 * Manual milestone completion and escrow release.
 *
 * The background worker in `jobs/milestones.ts` is the default path — it opens
 * and closes milestone periods on a schedule and auto-releases on silence. This
 * module is the *interactive* path: a coach saying "I've finished this period"
 * and a student saying "yes, pay it out now". Both converge on the same ledger
 * posting and the same CAS-guarded status write the worker uses, so triggering
 * a release from the panel and triggering it from the cron are the same
 * operation with a different actor.
 */

export class MilestoneActionError extends Error {
  constructor(
    readonly userMessage: string,
    readonly code:
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'WRONG_STATE'
      | 'DISPUTE_OPEN'
      | 'TOO_EARLY'
      | 'CONCURRENT',
  ) {
    super(userMessage);
    this.name = 'MilestoneActionError';
  }
}

const MILESTONE_LOAD = {
  select: {
    id: true,
    index: true,
    status: true,
    amountMinor: true,
    autoReleaseAt: true,
    periodEnd: true,
    bookings: { select: { endsAt: true, status: true } },
    providerTransactionId: true,
    providerApprovedAt: true,
    engagement: {
      select: {
        id: true,
        status: true,
        offerId: true,
        coachProfileId: true,
        commissionBps: true,
        currency: true,
        coach: { select: { userId: true } },
        student: { select: { userId: true } },
      },
    },
  },
} as const;

async function openDisputeCount(engagementId: string): Promise<number> {
  return prisma.dispute.count({
    where: {
      engagementId,
      status: { in: ['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'] },
    },
  });
}

/**
 * Coach marks a milestone's work as done.
 *
 * Moves the milestone to PENDING_CONFIRMATION and starts the 5-day auto-release
 * clock if it has not started already, and records the coach's confirmation on
 * every session in the period. It does not move money — that waits for the
 * student's approval or the clock.
 */
export async function markMilestoneCompleted(args: {
  milestoneId: string;
  coachUserId: string;
}): Promise<{ status: 'PENDING_CONFIRMATION'; autoReleaseAt: string }> {
  const milestone = await prisma.milestone.findUnique({
    where: { id: args.milestoneId },
    ...MILESTONE_LOAD,
  });
  if (!milestone) throw new MilestoneActionError('Dilim bulunamadı.', 'NOT_FOUND');
  if (milestone.engagement.coach.userId !== args.coachUserId) {
    throw new MilestoneActionError('Bu dilimi yalnızca koç tamamlandı işaretleyebilir.', 'FORBIDDEN');
  }
  if (milestone.engagement.status !== 'ACTIVE') {
    throw new MilestoneActionError('Bu programın ödemesi henüz alınmadı.', 'WRONG_STATE');
  }
  if (!['SCHEDULED', 'IN_PROGRESS', 'PENDING_CONFIRMATION'].includes(milestone.status)) {
    throw new MilestoneActionError(
      `Bu dilim "${milestone.status}" durumunda; tamamlandı işaretlenemez.`,
      'WRONG_STATE',
    );
  }

  const now = new Date();
  const completableAt = milestoneCompletableAt(milestone.bookings, milestone.periodEnd);
  if (now < completableAt) {
    throw new MilestoneActionError(
      `Bu dilimin dersi henüz bitmedi. ${completableAt.toLocaleString('tr-TR', {
        timeZone: 'Europe/Istanbul',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      })} sonrasında işaretleyebilirsin.`,
      'TOO_EARLY',
    );
  }

  const autoReleaseAt =
    milestone.autoReleaseAt ?? new Date(now.getTime() + AUTO_RELEASE_DAYS * 24 * 3600 * 1000);

  try {
    await prisma.$transaction(async (tx) => {
      await acquireAdvisoryLock(tx, `engagement:${milestone.engagement.id}`);

      if ((await openDisputeCount(milestone.engagement.id)) > 0) {
        throw new MilestoneActionError(
          'Açık bir itiraz var. Önce onun çözülmesi gerekiyor.',
          'DISPUTE_OPEN',
        );
      }

      await tx.booking.updateMany({
        where: { milestoneId: milestone.id, coachConfirmedAt: null },
        data: { coachConfirmedAt: now },
      });

      if (milestone.status !== 'PENDING_CONFIRMATION') {
        await casStatus(tx.milestone, {
          id: milestone.id,
          from: ['SCHEDULED', 'IN_PROGRESS'],
          data: { status: 'PENDING_CONFIRMATION', autoReleaseAt },
          entity: 'Milestone',
        });
      }
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof MilestoneActionError) throw error;
    if (error instanceof ConcurrentModificationError) {
      throw new MilestoneActionError('Dilim az önce güncellendi. Sayfayı yenile.', 'CONCURRENT');
    }
    throw error;
  }

  return { status: 'PENDING_CONFIRMATION', autoReleaseAt: autoReleaseAt.toISOString() };
}

/**
 * Student approves the release for a milestone that is awaiting confirmation.
 *
 * This is the interactive equivalent of `autoReleaseMilestones`: CAS the
 * milestone from PENDING_CONFIRMATION to RELEASED, post the escrow → coach split
 * to the ledger, complete the sessions, then (best effort, after commit) tell
 * the provider to settle the basket item so the funds actually move.
 */
export async function approveMilestoneRelease(args: {
  milestoneId: string;
  studentUserId: string;
}): Promise<{ status: 'RELEASED'; amountMinor: number; providerApproved: boolean }> {
  const milestone = await prisma.milestone.findUnique({
    where: { id: args.milestoneId },
    ...MILESTONE_LOAD,
  });
  if (!milestone) throw new MilestoneActionError('Dilim bulunamadı.', 'NOT_FOUND');
  if (milestone.engagement.student.userId !== args.studentUserId) {
    throw new MilestoneActionError('Bu onayı yalnızca öğrenci verebilir.', 'FORBIDDEN');
  }
  if (milestone.engagement.status !== 'ACTIVE') {
    throw new MilestoneActionError('Bu programın ödemesi henüz alınmadı.', 'WRONG_STATE');
  }
  if (milestone.status !== 'PENDING_CONFIRMATION') {
    throw new MilestoneActionError(
      'Bu dilim henüz onaya hazır değil. Koç önce tamamlandı işaretlemeli.',
      'WRONG_STATE',
    );
  }

  const now = new Date();
  const { engagement } = milestone;

  try {
    await prisma.$transaction(async (tx) => {
      await acquireAdvisoryLock(tx, `engagement:${engagement.id}`);

      if ((await openDisputeCount(engagement.id)) > 0) {
        throw new MilestoneActionError(
          'Açık bir itiraz var; ücret aktarılamaz.',
          'DISPUTE_OPEN',
        );
      }

      await tx.booking.updateMany({
        where: { milestoneId: milestone.id, studentConfirmedAt: null },
        data: { studentConfirmedAt: now },
      });

      // Same CAS the worker uses. If a dispute froze this row to DISPUTED since
      // the load above, this matches zero rows and the whole transaction rolls
      // back — no partial ledger posting.
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

      await tx.booking.updateMany({
        where: { milestoneId: milestone.id, status: 'SCHEDULED' },
        data: { status: 'COMPLETED' },
      });
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof MilestoneActionError) throw error;
    if (error instanceof ConcurrentModificationError) {
      throw new MilestoneActionError(
        'Bu dilim az önce güncellendi (itiraz açılmış olabilir). Sayfayı yenile.',
        'CONCURRENT',
      );
    }
    throw error;
  }

  // Follow-ups run outside the money transaction: a failure here must never
  // roll back a completed payout.
  try {
    await maybeCompleteEngagement(engagement.id, engagement.offerId);
  } catch (error) {
    // The offer may still be PAID_IN_ESCROW (start date not yet reached), in
    // which case ALL_MILESTONES_RELEASED is not a legal transition yet. The
    // worker reconciles it once the engagement is ACTIVE. Money is already
    // correct; only the status label lags.
    console.error('[milestone-service] engagement completion deferred', error);
  }

  let providerApproved = false;
  if (milestone.providerTransactionId) {
    try {
      const outcome = await getPaymentProvider().approveItem({
        paymentTransactionId: milestone.providerTransactionId,
        conversationId: `approve:${milestone.id}`,
      });
      if (outcome.ok) {
        await prisma.milestone.update({
          where: { id: milestone.id },
          data: { providerApprovedAt: new Date(), providerApproveError: null },
        });
        providerApproved = true;
      } else {
        await prisma.milestone.update({
          where: { id: milestone.id },
          data: { providerApproveError: outcome.message.slice(0, 500) },
        });
      }
    } catch (error) {
      // The `approveReleasedMilestones` worker retries this on its 5-minute
      // cadence; the ledger is already settled.
      console.error('[milestone-service] provider approve deferred', error);
    }
  }

  return { status: 'RELEASED', amountMinor: milestone.amountMinor, providerApproved };
}
