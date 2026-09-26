/**
 * Calendar-day arithmetic for the weekly planner, on "YYYY-MM-DD" strings.
 *
 * Planner days are dates, not instants, so everything here works on the
 * string form and does its arithmetic at UTC midnight — no local timezone can
 * shift a day by accident. "Today" is the one place a clock is read, and it is
 * read in Europe/Istanbul (UTC+3 year-round), where every user is.
 */

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function istanbulToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the week containing `day` (weeks start on Monday in Turkey). */
export function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, weekday === 0 ? -6 : 1 - weekday);
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The DATE column value Prisma expects for a day. */
export function dayToDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function dateToDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
// Not a slice of the full name: that gives "Paz" twice and "Cum" twice.
const DAY_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

export function dayLabel(day: string): { weekday: string; short: string; date: string } {
  const date = new Date(`${day}T00:00:00Z`);
  return {
    weekday: DAY_NAMES[date.getUTCDay()],
    short: DAY_SHORT[date.getUTCDay()],
    date: `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`,
  };
}
