/**
 * Meeting timing rules, shared by the server (which enforces them) and the UI
 * (which uses them to enable buttons). No node or DB imports.
 */

/** Allowed meeting lengths, in minutes. */
export const MEETING_DURATIONS = [30, 45, 60, 90] as const;
export type MeetingDuration = (typeof MEETING_DURATIONS)[number];

/** An invite must leave the student time to see it. */
export const INVITE_MIN_LEAD_MINUTES = 30;
/** And can't be booked absurdly far out. */
export const INVITE_MAX_DAYS_AHEAD = 60;

/** "Görüşmeye gir" opens this long before the start… */
export const JOIN_OPENS_BEFORE_MINUTES = 10;
/** …and stays open this long after the scheduled end, for overruns. */
export const JOIN_CLOSES_AFTER_MINUTES = 30;

const MINUTE = 60_000;

export function joinWindow(startsAt: Date, endsAt: Date): { opensAt: Date; closesAt: Date } {
  return {
    opensAt: new Date(startsAt.getTime() - JOIN_OPENS_BEFORE_MINUTES * MINUTE),
    closesAt: new Date(endsAt.getTime() + JOIN_CLOSES_AFTER_MINUTES * MINUTE),
  };
}

export type JoinState = 'TOO_EARLY' | 'OPEN' | 'ENDED';

export function joinState(startsAt: Date, endsAt: Date, now: Date = new Date()): JoinState {
  const { opensAt, closesAt } = joinWindow(startsAt, endsAt);
  if (now < opensAt) return 'TOO_EARLY';
  if (now > closesAt) return 'ENDED';
  return 'OPEN';
}

/** Returns a user-facing reason the time can't be proposed, or null if it can. */
export function inviteTimeProblem(startsAt: Date, durationMinutes: number, now: Date = new Date()): string | null {
  if (Number.isNaN(startsAt.getTime())) return 'Geçerli bir tarih ve saat seç.';
  if (!(MEETING_DURATIONS as readonly number[]).includes(durationMinutes)) {
    return 'Görüşme süresi 30, 45, 60 ya da 90 dakika olabilir.';
  }
  if (startsAt.getTime() < now.getTime() + INVITE_MIN_LEAD_MINUTES * MINUTE) {
    return `Görüşme en az ${INVITE_MIN_LEAD_MINUTES} dakika sonrası için planlanmalı.`;
  }
  if (startsAt.getTime() > now.getTime() + INVITE_MAX_DAYS_AHEAD * 24 * 60 * MINUTE) {
    return `Görüşme en fazla ${INVITE_MAX_DAYS_AHEAD} gün sonrası için planlanabilir.`;
  }
  return null;
}

/**
 * Only well-known meeting hosts are accepted as a fallback link, so the field
 * can't become a way to pass arbitrary URLs (or contact details) around the
 * message filter.
 */
const MEETING_HOSTS = ['zoom.us', 'meet.google.com', 'teams.microsoft.com', 'teams.live.com'];

export function isAllowedMeetingUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return MEETING_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

/**
 * `<input type="datetime-local">` gives "2026-09-30T19:00" with no zone. Every
 * user is in Turkey, which has been on UTC+3 year-round since 2016, so the
 * value is read as Istanbul time. Returns null for anything malformed.
 */
export function istanbulLocalToDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The inverse, for pre-filling the input from a Date. */
export function dateToIstanbulLocal(date: Date): string {
  const shifted = new Date(date.getTime() + 3 * 60 * 60_000);
  return shifted.toISOString().slice(0, 16);
}
