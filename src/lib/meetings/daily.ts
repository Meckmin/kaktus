/**
 * Daily (daily.co) REST client for in-app video meetings — one private room
 * per session, joined with a per-person meeting token. Plain fetch, no SDK.
 *
 * Rooms are private, so the room URL alone gets nobody in; the token is
 * scoped to that room and expires when the join window closes. Recording is
 * never enabled — most students are minors.
 */

const API = 'https://api.daily.co/v1';

export class DailyError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'DailyError';
  }
}

export function dailyConfigured(): boolean {
  return Boolean(process.env.DAILY_API_KEY?.trim());
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DAILY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    // Someone is waiting on a button; a hung API must not hang the page.
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new DailyError(`Daily ${path} responded ${response.status}: ${detail.slice(0, 200)}`, response.status);
  }
  return (await response.json()) as T;
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/**
 * Creates the room, or re-times it if it already exists — a rescheduled
 * session keeps its room name but needs the new join window.
 */
export async function upsertRoom(args: { name: string; opensAt: Date; closesAt: Date }): Promise<{ name: string; url: string }> {
  const properties = {
    nbf: seconds(args.opensAt),
    exp: seconds(args.closesAt),
    eject_at_room_exp: true,
    enable_prejoin_ui: true,
    enable_chat: true,
    // Coach, student, and room for a parent to sit in.
    max_participants: 4,
    lang: 'tr',
  };
  try {
    return await call<{ name: string; url: string }>(`/rooms/${encodeURIComponent(args.name)}`, { properties });
  } catch (error) {
    if (!(error instanceof DailyError) || error.status !== 404) throw error;
    return call<{ name: string; url: string }>('/rooms', { name: args.name, privacy: 'private', properties });
  }
}

export async function createMeetingToken(args: {
  roomName: string;
  /** Our user id — comes back in presence and attendance, so we know who was there. */
  userId: string;
  userName: string;
  isOwner: boolean;
  expiresAt: Date;
}): Promise<string> {
  const { token } = await call<{ token: string }>('/meeting-tokens', {
    properties: {
      room_name: args.roomName,
      user_id: args.userId,
      user_name: args.userName,
      is_owner: args.isOwner,
      exp: seconds(args.expiresAt),
      eject_at_token_exp: true,
    },
  });
  return token;
}

/** Daily room names allow letters, numbers, "-" and "_"; booking ids are cuids. */
export function roomNameForBooking(bookingId: string): string {
  return `kk-${bookingId.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
}

/** User ids of everyone in the room right now. Empty when the room doesn't exist yet. */
export async function roomPresence(roomName: string): Promise<string[]> {
  try {
    const { data } = await call<{ data?: Array<{ userId?: string | null }> }>(
      `/rooms/${encodeURIComponent(roomName)}/presence`,
    );
    return (data ?? []).map((p) => p.userId).filter((id): id is string => Boolean(id));
  } catch (error) {
    if (error instanceof DailyError && error.status === 404) return [];
    throw error;
  }
}

export interface Attendance {
  userId: string;
  /** First time they joined within the window. */
  firstJoinedAt: Date;
  /** Summed over every join (people drop and rejoin). */
  seconds: number;
}

/**
 * Who was in a room between `from` and `to`, from Daily's meeting-session
 * log — the record a dispute over "the coach never showed up" turns on.
 * Sessions are filtered by time because a rescheduled booking reuses its
 * room name.
 */
export async function roomAttendance(roomName: string, from: Date, to: Date): Promise<Attendance[]> {
  const query = new URLSearchParams({
    room: roomName,
    timeframe_start: String(seconds(from)),
    timeframe_end: String(seconds(to)),
    limit: '100',
  });
  const { data } = await call<{
    data?: Array<{ participants?: Array<{ user_id?: string | null; join_time: number; duration: number }> }>;
  }>(`/meetings?${query}`);

  const byUser = new Map<string, Attendance>();
  for (const session of data ?? []) {
    for (const p of session.participants ?? []) {
      if (!p.user_id) continue;
      const joinedAt = new Date(p.join_time * 1000);
      if (joinedAt < from || joinedAt > to) continue;
      const seen = byUser.get(p.user_id);
      if (seen) {
        seen.seconds += p.duration;
        if (joinedAt < seen.firstJoinedAt) seen.firstJoinedAt = joinedAt;
      } else {
        byUser.set(p.user_id, { userId: p.user_id, firstJoinedAt: joinedAt, seconds: p.duration });
      }
    }
  }
  return [...byUser.values()];
}
