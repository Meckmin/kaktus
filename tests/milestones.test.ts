import { describe, expect, it } from 'vitest';
import { milestoneCompletableAt, milestonePeriodsForSlots } from '@/lib/offers/scope';

const at = (iso: string) => new Date(iso);
const slot = (start: string) => ({
  startsAt: at(start),
  endsAt: new Date(at(start).getTime() + 60 * 60 * 1000),
});

/** Which milestone a booking lands in — same rule as lib/booking/holds.ts. */
function owner(periods: ReturnType<typeof milestonePeriodsForSlots>, startsAt: Date) {
  return periods.find((p) => startsAt >= p.periodStart && startsAt < p.periodEnd)?.index;
}

describe('milestonePeriodsForSlots', () => {
  it('gives each of four weekly sessions its own milestone', () => {
    const slots = [
      slot('2026-09-28T16:00:00Z'),
      slot('2026-10-05T16:00:00Z'),
      slot('2026-10-12T16:00:00Z'),
      slot('2026-10-19T16:00:00Z'),
    ];
    const periods = milestonePeriodsForSlots(slots, slots[0].startsAt, at('2026-10-19T17:00:00Z'), 4);

    expect(slots.map((s) => owner(periods, s.startsAt))).toEqual([0, 1, 2, 3]);
    expect(periods[0].periodStart).toEqual(slots[0].startsAt);
  });

  it('leaves no milestone empty when sessions are bunched together', () => {
    // The E2E case: four sessions inside two weeks used to leave milestones
    // 2 and 3 with no session at all under the even time split.
    const slots = [
      slot('2026-09-28T16:00:00Z'),
      slot('2026-09-30T16:00:00Z'),
      slot('2026-10-05T16:00:00Z'),
      slot('2026-10-07T16:00:00Z'),
    ];
    const periods = milestonePeriodsForSlots(slots, slots[0].startsAt, at('2026-10-07T17:00:00Z'), 4);

    expect(slots.map((s) => owner(periods, s.startsAt))).toEqual([0, 1, 2, 3]);
  });

  it('accepts slots in any order', () => {
    const slots = [
      slot('2026-10-12T16:00:00Z'),
      slot('2026-09-28T16:00:00Z'),
      slot('2026-10-19T16:00:00Z'),
      slot('2026-10-05T16:00:00Z'),
    ];
    const periods = milestonePeriodsForSlots(slots, at('2026-09-28T16:00:00Z'), at('2026-10-19T17:00:00Z'), 4);
    expect(periods.map((p) => p.periodStart.toISOString())).toEqual([
      '2026-09-28T16:00:00.000Z',
      '2026-10-05T16:00:00.000Z',
      '2026-10-12T16:00:00.000Z',
      '2026-10-19T16:00:00.000Z',
    ]);
  });

  it('spreads extra sessions over the first milestones', () => {
    const slots = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map((d) =>
      slot(`${d}T16:00:00Z`),
    );
    const periods = milestonePeriodsForSlots(slots, slots[0].startsAt, at('2026-10-05T17:00:00Z'), 4);
    expect(slots.map((s) => owner(periods, s.startsAt))).toEqual([0, 0, 1, 2, 3]);
  });

  it('extends the last period to cover the final session even if endDate is earlier', () => {
    const slots = [slot('2026-10-01T16:00:00Z')];
    const periods = milestonePeriodsForSlots(slots, slots[0].startsAt, slots[0].startsAt, 1);
    expect(periods[0].periodEnd).toEqual(slots[0].endsAt);
  });

  it('falls back to the time split when there are fewer sessions than milestones', () => {
    const periods = milestonePeriodsForSlots([], at('2026-10-01T00:00:00Z'), at('2026-10-29T00:00:00Z'), 4);
    expect(periods).toHaveLength(4);
    expect(periods[1].periodStart).toEqual(at('2026-10-08T00:00:00Z'));
  });
});

describe('milestoneCompletableAt', () => {
  const periodEnd = at('2026-10-10T00:00:00Z');

  it('is the end of the last session', () => {
    const bookings = [
      { endsAt: at('2026-10-01T17:00:00Z'), status: 'SCHEDULED' },
      { endsAt: at('2026-10-03T17:00:00Z'), status: 'SCHEDULED' },
    ];
    expect(milestoneCompletableAt(bookings, periodEnd)).toEqual(at('2026-10-03T17:00:00Z'));
  });

  it('ignores cancelled sessions', () => {
    const bookings = [
      { endsAt: at('2026-10-01T17:00:00Z'), status: 'COMPLETED' },
      { endsAt: at('2026-10-05T17:00:00Z'), status: 'CANCELLED_BY_COACH' },
    ];
    expect(milestoneCompletableAt(bookings, periodEnd)).toEqual(at('2026-10-01T17:00:00Z'));
  });

  it('falls back to the period end when the milestone has no sessions', () => {
    expect(milestoneCompletableAt([], periodEnd)).toEqual(periodEnd);
  });
});
