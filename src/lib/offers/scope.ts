import { z } from 'zod';

/**
 * The negotiated terms, stored on `Offer.scope` as JSON.
 *
 * JSON rather than columns because this is the part of the product that will
 * change shape most often — deliverables, session formats, trial weeks — and
 * every change would otherwise be a migration on a hot table. It is validated
 * on write, so it is JSON in storage but not in practice.
 *
 * The requested slots live here too: they are a *proposal* until escrow is
 * funded, at which point they become SlotHolds → Bookings.
 */

export const slotSchema = z
  .object({
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((s) => s.endsAt > s.startsAt, { message: 'Slot must end after it starts' });

export const offerScopeSchema = z.object({
  cadence: z.enum(['WEEKLY_SYNC', 'MONTHLY_STANDARD', 'INTENSIVE', 'SINGLE_SESSION']),
  sessionsPerCycle: z.number().int().min(1).max(14),
  minutesPerSession: z.number().int().min(15).max(240),
  weeks: z.number().int().min(1).max(52),
  includesMessaging: z.boolean().default(true),
  deliverables: z.array(z.string().max(200)).max(12).default([]),
  notes: z.string().max(2000).optional(),
  slots: z.array(slotSchema).max(60).default([]),
});

export type OfferScope = z.infer<typeof offerScopeSchema>;

export function parseScope(raw: unknown): OfferScope {
  return offerScopeSchema.parse(raw);
}

/**
 * Milestone boundaries.
 *
 * Milestones are the escrow release unit, so their periods must tile the
 * engagement exactly — no gaps where a session belongs to no milestone and no
 * overlaps where it belongs to two. The final period is extended to the
 * engagement end rather than truncated, so a 5-week engagement split into 4
 * milestones does not silently drop the last 7 days of sessions.
 */
export function milestonePeriods(
  startDate: Date,
  endDate: Date,
  count: number,
): Array<{ index: number; periodStart: Date; periodEnd: Date }> {
  if (count < 1) throw new Error('Milestone count must be >= 1');
  if (endDate <= startDate) throw new Error('endDate must be after startDate');

  const totalMs = endDate.getTime() - startDate.getTime();
  const step = Math.floor(totalMs / count);

  return Array.from({ length: count }, (_, i) => ({
    index: i,
    periodStart: new Date(startDate.getTime() + step * i),
    periodEnd: i === count - 1 ? endDate : new Date(startDate.getTime() + step * (i + 1)),
  }));
}

/**
 * Milestone boundaries anchored to the booked sessions.
 *
 * Each milestone owns a contiguous run of sessions, and its period starts at
 * its first session and ends where the next milestone's first session starts
 * (the last one runs to the engagement end). Bookings are assigned by
 * `startsAt ∈ [periodStart, periodEnd)`, so every session lands in exactly one
 * milestone and no milestone is left without a session — which the even time
 * split above could not promise: four sessions packed into two weeks left the
 * middle two milestones empty, i.e. money released for no lesson at all.
 *
 * Falls back to the time split when there are fewer sessions than milestones
 * (or none), since then there is nothing to anchor to.
 */
export function milestonePeriodsForSlots(
  slots: Array<{ startsAt: Date; endsAt: Date }>,
  startDate: Date,
  endDate: Date,
  count: number,
): Array<{ index: number; periodStart: Date; periodEnd: Date }> {
  if (count < 1) throw new Error('Milestone count must be >= 1');
  if (slots.length < count) return milestonePeriods(startDate, endDate, count);

  const sorted = [...slots].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  // Spread any remainder over the first milestones: 5 sessions / 4 → 2,1,1,1.
  const base = Math.floor(sorted.length / count);
  const extra = sorted.length % count;
  const firstIndexes: number[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    firstIndexes.push(cursor);
    cursor += base + (i < extra ? 1 : 0);
  }

  const last = sorted[sorted.length - 1];
  const end = new Date(Math.max(endDate.getTime(), last.endsAt.getTime()));

  return firstIndexes.map((first, i) => ({
    index: i,
    periodStart: sorted[first].startsAt,
    periodEnd: i === count - 1 ? end : sorted[firstIndexes[i + 1]].startsAt,
  }));
}

/**
 * The earliest moment a coach may mark a milestone as done: when its last
 * (non-cancelled) session has ended. A milestone with no sessions falls back to
 * its period end. Before this existed, every milestone could be marked done on
 * day one, and five days of student silence released the whole program's money
 * before a single lesson happened.
 */
export function milestoneCompletableAt(
  bookings: Array<{ endsAt: Date; status: string }>,
  periodEnd: Date,
): Date {
  const held = bookings.filter(
    (b) => b.status !== 'CANCELLED_BY_STUDENT' && b.status !== 'CANCELLED_BY_COACH',
  );
  if (held.length === 0) return periodEnd;
  return new Date(Math.max(...held.map((b) => b.endsAt.getTime())));
}
