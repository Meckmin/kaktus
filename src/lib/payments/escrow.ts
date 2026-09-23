import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Escrow accounting.
 *
 * Rules, in order of importance:
 *  1. Money is Int minor units. No floats, ever.
 *  2. Every movement is a balanced entry group. The DB trigger enforces it;
 *     this module makes it hard to get wrong in the first place.
 *  3. Balances are computed from entries. There is no mutable balance column.
 *  4. Commission is computed once, at capture, from the offer's snapshotted
 *     `commissionBps` — never from the current platform-wide setting.
 */

type Tx = Prisma.TransactionClient | PrismaClient;

export interface Split {
  grossMinor: number;
  commissionMinor: number;
  netToCoachMinor: number;
}

/**
 * Commission split. Rounds the commission DOWN, so any sub-kuruş remainder
 * lands with the coach rather than the platform. That is a deliberate choice:
 * rounding in the platform's own favour is the kind of detail that costs trust
 * for a rounding error's worth of revenue.
 */
export function splitAmount(grossMinor: number, commissionBps: number): Split {
  if (!Number.isInteger(grossMinor) || grossMinor <= 0) {
    throw new Error(`grossMinor must be a positive integer, got ${grossMinor}`);
  }
  if (commissionBps < 0 || commissionBps > 5000) {
    throw new Error(`commissionBps out of range: ${commissionBps}`);
  }
  const commissionMinor = Math.floor((grossMinor * commissionBps) / 10_000);
  return {
    grossMinor,
    commissionMinor,
    netToCoachMinor: grossMinor - commissionMinor,
  };
}

/** Divides a total across n milestones so the parts sum exactly to the total. */
export function splitIntoMilestones(totalMinor: number, count: number): number[] {
  if (count < 1) throw new Error('Milestone count must be >= 1');
  const base = Math.floor(totalMinor / count);
  const remainder = totalMinor - base * count;
  // Front-load the remainder: earlier milestones are worth marginally more,
  // which slightly favours the student if the engagement ends early.
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

type EntryInput = {
  account: Prisma.LedgerEntryCreateManyInput['account'];
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: number;
  description: string;
};

async function postGroup(
  tx: Tx,
  entries: EntryInput[],
  refs: {
    engagementId?: string;
    milestoneId?: string;
    paymentId?: string;
    payoutId?: string;
    coachProfileId?: string;
    currency?: string;
  },
): Promise<string> {
  const balance = entries.reduce(
    (sum, e) => sum + (e.direction === 'DEBIT' ? e.amountMinor : -e.amountMinor),
    0,
  );
  if (balance !== 0) {
    throw new Error(`Refusing to post unbalanced ledger group (off by ${balance})`);
  }

  const entryGroupId = randomUUID();
  await tx.ledgerEntry.createMany({
    data: entries.map((e) => ({
      entryGroupId,
      account: e.account,
      direction: e.direction,
      amountMinor: e.amountMinor,
      currency: refs.currency ?? 'TRY',
      description: e.description,
      engagementId: refs.engagementId,
      milestoneId: refs.milestoneId,
      paymentId: refs.paymentId,
      payoutId: refs.payoutId,
      coachProfileId: refs.coachProfileId,
    })),
  });
  return entryGroupId;
}

/**
 * Student's card is captured. Funds sit at the PSP and are owed to escrow.
 * Nothing is earned by anyone yet — that is the whole point of escrow.
 */
export async function postEscrowFunding(
  tx: Tx,
  args: { engagementId: string; paymentId: string; amountMinor: number; currency?: string },
) {
  return postGroup(
    tx,
    [
      {
        account: 'PSP_RECEIVABLE',
        direction: 'DEBIT',
        amountMinor: args.amountMinor,
        description: 'Card capture received at provider',
      },
      {
        account: 'PLATFORM_ESCROW',
        direction: 'CREDIT',
        amountMinor: args.amountMinor,
        description: 'Funds held in escrow for engagement',
      },
    ],
    { engagementId: args.engagementId, paymentId: args.paymentId, currency: args.currency },
  );
}

/**
 * Posts the ledger entries for a milestone release WITHOUT touching milestone
 * status. Callers that need to guard the status transition themselves (the
 * auto-release worker, which must CAS from PENDING_CONFIRMATION) use this and
 * own the write; everything else uses `releaseMilestone` below.
 */
export async function postMilestoneRelease(
  tx: Tx,
  args: {
    engagementId: string;
    milestoneId: string;
    coachProfileId: string;
    amountMinor: number;
    commissionBps: number;
    currency?: string;
  },
) {
  const split = splitAmount(args.amountMinor, args.commissionBps);

  const entries: EntryInput[] = [
    {
      account: 'PLATFORM_ESCROW',
      direction: 'DEBIT',
      amountMinor: split.grossMinor,
      description: 'Escrow released on milestone completion',
    },
    {
      account: 'COACH_PAYABLE',
      direction: 'CREDIT',
      amountMinor: split.netToCoachMinor,
      description: 'Coach earnings',
    },
  ];
  if (split.commissionMinor > 0) {
    entries.push({
      account: 'PLATFORM_REVENUE',
      direction: 'CREDIT',
      amountMinor: split.commissionMinor,
      description: `Platform commission (${args.commissionBps} bps)`,
    });
  }

  const entryGroupId = await postGroup(tx, entries, {
    engagementId: args.engagementId,
    milestoneId: args.milestoneId,
    coachProfileId: args.coachProfileId,
    currency: args.currency,
  });

  return { entryGroupId, split };
}

/**
 * A milestone period closed cleanly. Escrow is drawn down; the split lands in
 * coach payable and platform revenue.
 */
export async function releaseMilestone(
  tx: Tx,
  args: {
    engagementId: string;
    milestoneId: string;
    coachProfileId: string;
    amountMinor: number;
    commissionBps: number;
    currency?: string;
  },
) {
  const result = await postMilestoneRelease(tx, args);

  await tx.milestone.update({
    where: { id: args.milestoneId },
    data: { status: 'RELEASED', releasedAt: new Date() },
  });

  return result;
}

/** Money goes back to the student. Only unreleased escrow can be refunded. */
export async function refundFromEscrow(
  tx: Tx,
  args: {
    engagementId: string;
    milestoneId?: string;
    amountMinor: number;
    reason: string;
    currency?: string;
  },
) {
  const entryGroupId = await postGroup(
    tx,
    [
      {
        account: 'PLATFORM_ESCROW',
        direction: 'DEBIT',
        amountMinor: args.amountMinor,
        description: `Escrow refunded: ${args.reason}`,
      },
      {
        account: 'STUDENT_REFUND',
        direction: 'CREDIT',
        amountMinor: args.amountMinor,
        description: `Refund to student: ${args.reason}`,
      },
    ],
    {
      engagementId: args.engagementId,
      milestoneId: args.milestoneId,
      currency: args.currency,
    },
  );

  if (args.milestoneId) {
    await tx.milestone.update({
      where: { id: args.milestoneId },
      data: { status: 'REFUNDED', refundedAt: new Date() },
    });
  }
  return entryGroupId;
}

/** Coach withdraws. Payable is drawn down against the PSP receivable. */
export async function postPayout(
  tx: Tx,
  args: {
    payoutId: string;
    coachProfileId: string;
    amountMinor: number;
    currency?: string;
  },
) {
  return postGroup(
    tx,
    [
      {
        account: 'COACH_PAYABLE',
        direction: 'DEBIT',
        amountMinor: args.amountMinor,
        description: 'Payout to coach',
      },
      {
        account: 'PSP_RECEIVABLE',
        direction: 'CREDIT',
        amountMinor: args.amountMinor,
        description: 'Funds disbursed via provider',
      },
    ],
    {
      payoutId: args.payoutId,
      coachProfileId: args.coachProfileId,
      currency: args.currency,
    },
  );
}

/** Withdrawable balance, derived. Never read a cached column for this. */
export async function coachAvailableBalanceMinor(
  tx: Tx,
  coachProfileId: string,
): Promise<number> {
  const rows = await tx.ledgerEntry.groupBy({
    by: ['direction'],
    where: { coachProfileId, account: 'COACH_PAYABLE' },
    _sum: { amountMinor: true },
  });
  const credits = rows.find((r) => r.direction === 'CREDIT')?._sum.amountMinor ?? 0;
  const debits = rows.find((r) => r.direction === 'DEBIT')?._sum.amountMinor ?? 0;
  return credits - debits;
}

export async function engagementEscrowBalanceMinor(
  tx: Tx,
  engagementId: string,
): Promise<number> {
  const rows = await tx.ledgerEntry.groupBy({
    by: ['direction'],
    where: { engagementId, account: 'PLATFORM_ESCROW' },
    _sum: { amountMinor: true },
  });
  const credits = rows.find((r) => r.direction === 'CREDIT')?._sum.amountMinor ?? 0;
  const debits = rows.find((r) => r.direction === 'DEBIT')?._sum.amountMinor ?? 0;
  return credits - debits;
}
