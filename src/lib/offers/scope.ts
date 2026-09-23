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
