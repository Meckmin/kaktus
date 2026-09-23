import { prisma } from '@/lib/db';
import { coachAvailableBalanceMinor } from '@/lib/payments/escrow';

/**
 * The coach's read model for "what have I earned and what's been paid out."
 *
 * Balance is always derived from the ledger (`coachAvailableBalanceMinor`),
 * never from a cached column — the same rule the escrow module itself follows
 * for money. `Payout` rows exist independently of that balance: under the
 * mock provider nothing currently submits them automatically (see the
 * scheduling note on `runPayoutBatch` in `jobs/workers.ts`), so a coach can
 * have a positive available balance with no payout yet — that is accurate,
 * not a bug, and the page says so rather than implying money is already on
 * its way.
 */

export interface EarningEntry {
  id: string;
  amountMinor: number;
  description: string;
  createdAt: Date;
  offerTitle: string | null;
}

export interface PayoutEntry {
  id: string;
  amountMinor: number;
  status: 'PENDING' | 'SUBMITTED' | 'PAID' | 'FAILED';
  submittedAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
}

export interface CoachEarnings {
  availableBalanceMinor: number;
  recentEarnings: EarningEntry[];
  payouts: PayoutEntry[];
}

export async function getCoachEarnings(coachProfileId: string): Promise<CoachEarnings> {
  const [availableBalanceMinor, earnings, payouts] = await Promise.all([
    coachAvailableBalanceMinor(prisma, coachProfileId),
    prisma.ledgerEntry.findMany({
      where: { coachProfileId, account: 'COACH_PAYABLE', direction: 'CREDIT' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        amountMinor: true,
        description: true,
        createdAt: true,
        engagement: { select: { offer: { select: { title: true } } } },
      },
    }),
    prisma.payout.findMany({
      where: { coachProfileId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        amountMinor: true,
        status: true,
        submittedAt: true,
        paidAt: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    availableBalanceMinor,
    recentEarnings: earnings.map((e) => ({
      id: e.id,
      amountMinor: e.amountMinor,
      description: e.description,
      createdAt: e.createdAt,
      offerTitle: e.engagement?.offer.title ?? null,
    })),
    payouts,
  };
}
