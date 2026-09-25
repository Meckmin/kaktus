import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Slot locking.
 *
 * The exclusion constraint in the database is the actual guarantee. This module
 * turns its error into something a UI can render, and never tries to prevent
 * the collision by checking first — a SELECT-then-INSERT loses the race under
 * exactly the conditions that matter (two students, one popular coach, one
 * evening slot).
 */

type Tx = Prisma.TransactionClient | PrismaClient;

const PG_EXCLUSION_VIOLATION = '23P01';

export class SlotUnavailableError extends Error {
  constructor(readonly slot: { startsAt: Date; endsAt: Date }) {
    super('SLOT_TAKEN');
    this.name = 'SlotUnavailableError';
  }
}

export interface HoldRequest {
  coachProfileId: string;
  studentProfileId: string;
  offerId?: string;
  slots: Array<{ startsAt: Date; endsAt: Date }>;
  ttlMinutes: number;
}

export function isExclusionViolation(error: unknown): boolean {
  const e = error as { code?: string; message?: string; meta?: { code?: string } };
  return (
    e?.code === PG_EXCLUSION_VIOLATION ||
    e?.meta?.code === PG_EXCLUSION_VIOLATION ||
    Boolean(e?.message?.includes('SLOT_TAKEN')) ||
    // The native EXCLUDE constraint (as opposed to the cross-table trigger,
    // which raises with the SLOT_TAKEN message above) surfaces through
    // Prisma as a PrismaClientUnknownRequestError for this query shape —
    // no structured .code/.meta.code, only the connector's raw message text.
    Boolean(e?.message?.includes(PG_EXCLUSION_VIOLATION)) ||
    Boolean(e?.message?.includes('exclusion constraint'))
  );
}

/**
 * Acquires all slots or none. Partial holds would let a student pay for an
 * engagement whose calendar is half-booked, which is worse than failing.
 */
export async function acquireHolds(req: HoldRequest, tx: Tx = prisma) {
  const expiresAt = new Date(Date.now() + req.ttlMinutes * 60 * 1000);

  const run = async (client: Tx) => {
    const created = [];
    for (const slot of req.slots) {
      try {
        created.push(
          await client.slotHold.create({
            data: {
              coachProfileId: req.coachProfileId,
              studentProfileId: req.studentProfileId,
              offerId: req.offerId,
              startsAt: slot.startsAt,
              endsAt: slot.endsAt,
              expiresAt,
              status: 'HELD',
            },
          }),
        );
      } catch (error) {
        if (isExclusionViolation(error)) throw new SlotUnavailableError(slot);
        throw error;
      }
    }
    return created;
  };

  // If the caller already owns a transaction, join it — the all-or-nothing
  // guarantee must span their other writes too.
  return 'slotHold' in tx && '$transaction' in tx
    ? (tx as PrismaClient).$transaction((inner) => run(inner))
    : run(tx);
}

export async function extendHolds(offerId: string, minutes: number, tx: Tx = prisma) {
  return tx.slotHold.updateMany({
    where: { offerId, status: 'HELD' },
    data: { expiresAt: new Date(Date.now() + minutes * 60 * 1000) },
  });
}

export async function releaseHolds(offerId: string, tx: Tx = prisma) {
  return tx.slotHold.updateMany({
    where: { offerId, status: 'HELD' },
    data: { status: 'RELEASED' },
  });
}

/**
 * Converts held slots into scheduled bookings once escrow is funded.
 * Holds are released first so the cross-table trigger doesn't see the coach's
 * own hold as a conflict with their own booking.
 */
export async function convertHoldsToBookings(
  args: { offerId: string; engagementId: string; milestoneIds: string[] },
  tx: Tx,
) {
  const holds = await tx.slotHold.findMany({
    where: { offerId: args.offerId, status: 'HELD' },
    orderBy: { startsAt: 'asc' },
  });
  if (holds.length === 0) return [];

  const milestones = await tx.milestone.findMany({
    where: { id: { in: args.milestoneIds } },
    orderBy: { index: 'asc' },
  });

  await tx.slotHold.updateMany({
    where: { offerId: args.offerId, status: 'HELD' },
    data: { status: 'CONVERTED' },
  });

  const bookings = [];
  for (const hold of holds) {
    const milestone = milestones.find(
      (m) => hold.startsAt >= m.periodStart && hold.startsAt < m.periodEnd,
    );
    bookings.push(
      await tx.booking.create({
        data: {
          coachProfileId: hold.coachProfileId,
          studentProfileId: hold.studentProfileId,
          engagementId: args.engagementId,
          milestoneId: milestone?.id,
          startsAt: hold.startsAt,
          endsAt: hold.endsAt,
          status: 'SCHEDULED',
        },
      }),
    );
  }
  return bookings;
}

/** Job: sweep expired holds. Runs every minute. */
export async function expireStaleHolds(now = new Date()) {
  const { count } = await prisma.slotHold.updateMany({
    where: { status: 'HELD', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  });
  return count;
}
