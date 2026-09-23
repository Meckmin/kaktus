import { prisma } from '@/lib/db';

/**
 * Turns a coach's recurring weekly rules into concrete, dated slots and marks
 * what each one is currently doing.
 *
 * Four states, and the distinction between two of them is the whole reason the
 * hold mechanism exists:
 *
 *   AVAILABLE  — free to propose
 *   HELD       — someone has an open offer against it (soft, expires)
 *   MINE       — held by *this* student, so their own offer doesn't look taken
 *   BOOKED     — a paid engagement owns it (hard)
 *
 * A student looking at a popular coach needs to see HELD as visibly different
 * from BOOKED: held slots free up, often within hours, and hiding that makes a
 * calendar look fuller than it is.
 */

export type SlotState = 'AVAILABLE' | 'HELD' | 'MINE' | 'BOOKED';

export interface CalendarSlot {
  /** ISO string; the client never does timezone maths. */
  startsAt: string;
  endsAt: string;
  state: SlotState;
  /** For HELD slots: when it frees up, so the UI can say "18:40'ta boşalıyor". */
  heldUntil?: string;
}

export interface CalendarDay {
  /** YYYY-MM-DD in the coach's timezone. */
  date: string;
  weekday: number;
  slots: CalendarSlot[];
}

/**
 * Offset of a zone at a given instant, in minutes.
 *
 * Turkey is UTC+3 year-round with no DST, so this is constant in practice. It
 * is computed rather than hard-coded because coaches studying abroad are a real
 * segment and a hard-coded +180 would silently produce wrong slots for them.
 * If that segment grows, replace this with a real tz library — this handles
 * fixed and standard offsets correctly but is not a substitute for one.
 */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - instant.getTime()) / 60_000;
}

/** Local wall-clock (y/m/d + minutes) in `timeZone` → the UTC instant. */
function zonedToUtc(
  year: number,
  month: number,
  day: number,
  minutes: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month, day, 0, minutes);
  // Two passes: the first offset lookup may itself sit on the wrong side of a
  // transition. Converging twice is enough for every real zone.
  let guess = new Date(naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60_000);
  guess = new Date(naive - zoneOffsetMinutes(guess, timeZone) * 60_000);
  return guess;
}

function localParts(instant: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
  aStart < bEnd && bStart < aEnd;

export interface AvailabilityOptions {
  /** How many days forward to render. */
  days?: number;
  slotMinutes?: number;
  now?: Date;
  /** Marks this student's own holds as MINE rather than HELD. */
  viewerStudentProfileId?: string | null;
}

export async function getCoachCalendar(
  coachProfileId: string,
  options: AvailabilityOptions = {},
): Promise<{ timezone: string; days: CalendarDay[] }> {
  const now = options.now ?? new Date();
  const dayCount = options.days ?? 14;
  const slotMinutes = options.slotMinutes ?? 60;

  const coach = await prisma.coachProfile.findUniqueOrThrow({
    where: { id: coachProfileId },
    select: { timezone: true },
  });
  const timeZone = coach.timezone;

  const horizonEnd = new Date(now.getTime() + dayCount * 86_400_000);

  const [rules, exceptions, holds, bookings] = await Promise.all([
    prisma.availabilityRule.findMany({
      where: {
        coachProfileId,
        active: true,
        effectiveFrom: { lte: horizonEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      select: { weekday: true, startMinute: true, endMinute: true },
    }),
    prisma.availabilityException.findMany({
      where: { coachProfileId, date: { gte: startOfDay(now), lte: horizonEnd } },
      select: { date: true, allDay: true, startMinute: true, endMinute: true },
    }),
    // Expired holds are excluded here rather than relying on the sweep job:
    // a student should never see a slot blocked by a hold that lapsed four
    // minutes ago just because the worker has not run yet.
    prisma.slotHold.findMany({
      where: {
        coachProfileId,
        status: 'HELD',
        expiresAt: { gt: now },
        endsAt: { gt: now },
        startsAt: { lt: horizonEnd },
      },
      select: { startsAt: true, endsAt: true, expiresAt: true, studentProfileId: true },
    }),
    prisma.booking.findMany({
      where: {
        coachProfileId,
        status: 'SCHEDULED',
        endsAt: { gt: now },
        startsAt: { lt: horizonEnd },
      },
      select: { startsAt: true, endsAt: true },
    }),
  ]);

  const rulesByWeekday = new Map<number, Array<{ startMinute: number; endMinute: number }>>();
  for (const rule of rules) {
    const bucket = rulesByWeekday.get(rule.weekday) ?? [];
    bucket.push(rule);
    rulesByWeekday.set(rule.weekday, bucket);
  }

  const exceptionsByDate = new Map<string, typeof exceptions>();
  for (const exception of exceptions) {
    const key = exception.date.toISOString().slice(0, 10);
    exceptionsByDate.set(key, [...(exceptionsByDate.get(key) ?? []), exception]);
  }

  const days: CalendarDay[] = [];

  for (let offset = 0; offset < dayCount; offset++) {
    const cursor = new Date(now.getTime() + offset * 86_400_000);
    const { year, month, day, date } = localParts(cursor, timeZone);
    const weekday = new Date(zonedToUtc(year, month, day, 12 * 60, timeZone)).getUTCDay();

    const dayRules = rulesByWeekday.get(weekday) ?? [];
    const dayExceptions = exceptionsByDate.get(date) ?? [];
    if (dayExceptions.some((e) => e.allDay)) {
      days.push({ date, weekday, slots: [] });
      continue;
    }

    const slots: CalendarSlot[] = [];

    for (const rule of dayRules) {
      for (let m = rule.startMinute; m + slotMinutes <= rule.endMinute; m += slotMinutes) {
        const startsAt = zonedToUtc(year, month, day, m, timeZone);
        const endsAt = new Date(startsAt.getTime() + slotMinutes * 60_000);

        // A slot that has already started is not bookable, whatever else is true.
        if (startsAt <= now) continue;

        const blockedByException = dayExceptions.some(
          (e) =>
            !e.allDay &&
            e.startMinute != null &&
            e.endMinute != null &&
            m < e.endMinute &&
            e.startMinute < m + slotMinutes,
        );
        if (blockedByException) continue;

        const booking = bookings.find((b) => overlaps(startsAt, endsAt, b.startsAt, b.endsAt));
        if (booking) {
          slots.push({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), state: 'BOOKED' });
          continue;
        }

        const hold = holds.find((h) => overlaps(startsAt, endsAt, h.startsAt, h.endsAt));
        if (hold) {
          slots.push({
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            state:
              options.viewerStudentProfileId &&
              hold.studentProfileId === options.viewerStudentProfileId
                ? 'MINE'
                : 'HELD',
            heldUntil: hold.expiresAt.toISOString(),
          });
          continue;
        }

        slots.push({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), state: 'AVAILABLE' });
      }
    }

    slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    days.push({ date, weekday, slots });
  }

  return { timezone: timeZone, days };
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}
