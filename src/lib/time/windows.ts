/**
 * Weekly time windows, expressed in minutes from local midnight.
 *
 * Turkey is UTC+3 year-round with no DST, so weekday+minute arithmetic is safe
 * for the domestic case. The `timezone` field is carried anyway because coaches
 * studying abroad are a real segment, and retrofitting timezones later is
 * expensive.
 */

export interface TimeWindow {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  /** minutes from local midnight, 0..1440 */
  startMinute: number;
  endMinute: number;
}

export const MINUTES_PER_DAY = 1440;

export function isValidWindow(w: TimeWindow): boolean {
  return (
    Number.isInteger(w.weekday) &&
    w.weekday >= 0 &&
    w.weekday <= 6 &&
    w.startMinute >= 0 &&
    w.endMinute <= MINUTES_PER_DAY &&
    w.endMinute > w.startMinute
  );
}

/** Merges overlapping/adjacent windows per weekday. Input is not mutated. */
export function normalizeWindows(windows: TimeWindow[]): TimeWindow[] {
  const byDay = new Map<number, TimeWindow[]>();

  for (const w of windows) {
    if (!isValidWindow(w)) continue;
    const bucket = byDay.get(w.weekday) ?? [];
    bucket.push({ ...w });
    byDay.set(w.weekday, bucket);
  }

  const out: TimeWindow[] = [];
  for (const [weekday, bucket] of byDay) {
    bucket.sort((a, b) => a.startMinute - b.startMinute);
    let current = bucket[0];
    for (let i = 1; i < bucket.length; i++) {
      const next = bucket[i];
      if (next.startMinute <= current.endMinute) {
        current = {
          weekday,
          startMinute: current.startMinute,
          endMinute: Math.max(current.endMinute, next.endMinute),
        };
      } else {
        out.push(current);
        current = next;
      }
    }
    out.push(current);
  }

  return out.sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
}

export function totalMinutes(windows: TimeWindow[]): number {
  return normalizeWindows(windows).reduce(
    (sum, w) => sum + (w.endMinute - w.startMinute),
    0,
  );
}

/** Intersection of two window sets, as a new normalized set. */
export function intersectWindows(a: TimeWindow[], b: TimeWindow[]): TimeWindow[] {
  const left = normalizeWindows(a);
  const right = normalizeWindows(b);
  const out: TimeWindow[] = [];

  for (const l of left) {
    for (const r of right) {
      if (l.weekday !== r.weekday) continue;
      const start = Math.max(l.startMinute, r.startMinute);
      const end = Math.min(l.endMinute, r.endMinute);
      if (end > start) out.push({ weekday: l.weekday, startMinute: start, endMinute: end });
    }
  }

  return normalizeWindows(out);
}

export function overlapMinutes(a: TimeWindow[], b: TimeWindow[]): number {
  return totalMinutes(intersectWindows(a, b));
}

/** Distinct weekdays covered, useful for "kaç gün ortak müsaitlik" copy. */
export function coveredWeekdays(windows: TimeWindow[]): number[] {
  return [...new Set(normalizeWindows(windows).map((w) => w.weekday))].sort();
}

export function subtractWindow(base: TimeWindow, cut: TimeWindow): TimeWindow[] {
  if (base.weekday !== cut.weekday) return [base];
  const start = Math.max(base.startMinute, cut.startMinute);
  const end = Math.min(base.endMinute, cut.endMinute);
  if (end <= start) return [base];

  const pieces: TimeWindow[] = [];
  if (base.startMinute < start) {
    pieces.push({ weekday: base.weekday, startMinute: base.startMinute, endMinute: start });
  }
  if (end < base.endMinute) {
    pieces.push({ weekday: base.weekday, startMinute: end, endMinute: base.endMinute });
  }
  return pieces;
}

const TR_WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

export function formatWindowTr(w: TimeWindow): string {
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `${TR_WEEKDAYS[w.weekday]} ${fmt(w.startMinute)}–${fmt(w.endMinute)}`;
}
