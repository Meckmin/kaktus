import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeetingToken, roomAttendance, roomNameForBooking, roomPresence, upsertRoom } from '@/lib/meetings/daily';

describe('Daily client', () => {
  const realFetch = globalThis.fetch;
  let calls: Array<{ url: string; method: string; body: any; auth: string | null }>;

  beforeEach(() => {
    process.env.DAILY_API_KEY = 'daily-test-key';
    calls = [];
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.DAILY_API_KEY;
  });

  function respond(...responses: Array<[number, unknown]>) {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null,
        auth: new Headers(init?.headers).get('authorization'),
      });
      const [status, body] = responses.shift()!;
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
  }

  const opensAt = new Date('2026-10-01T15:45:00Z');
  const closesAt = new Date('2026-10-01T17:45:00Z');

  it('re-times an existing room without recreating it', async () => {
    respond([200, { name: 'kk-abc', url: 'https://kaktus.daily.co/kk-abc' }]);
    const room = await upsertRoom({ name: 'kk-abc', opensAt, closesAt });
    expect(room.url).toBe('https://kaktus.daily.co/kk-abc');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.daily.co/v1/rooms/kk-abc');
    expect(calls[0].auth).toBe('Bearer daily-test-key');
    expect(calls[0].body.properties).toMatchObject({
      nbf: opensAt.getTime() / 1000,
      exp: closesAt.getTime() / 1000,
      eject_at_room_exp: true,
      lang: 'tr',
    });
    expect(calls[0].body.properties.enable_recording).toBeUndefined();
  });

  it('creates a private room when it does not exist yet', async () => {
    respond([404, { error: 'not-found' }], [200, { name: 'kk-abc', url: 'https://kaktus.daily.co/kk-abc' }]);
    await upsertRoom({ name: 'kk-abc', opensAt, closesAt });
    expect(calls[1].url).toBe('https://api.daily.co/v1/rooms');
    expect(calls[1].body).toMatchObject({ name: 'kk-abc', privacy: 'private' });
  });

  it('surfaces other errors instead of silently creating', async () => {
    respond([401, { error: 'authentication-error' }]);
    await expect(upsertRoom({ name: 'kk-abc', opensAt, closesAt })).rejects.toThrow(/401/);
    expect(calls).toHaveLength(1);
  });

  it('issues a room-scoped, expiring token', async () => {
    respond([200, { token: 'tok_123' }]);
    const token = await createMeetingToken({
      roomName: 'kk-abc',
      userId: 'user_1',
      userName: 'Elif Ş.',
      isOwner: true,
      expiresAt: closesAt,
    });
    expect(token).toBe('tok_123');
    expect(calls[0].body.properties).toEqual({
      room_name: 'kk-abc',
      user_id: 'user_1',
      user_name: 'Elif Ş.',
      is_owner: true,
      exp: closesAt.getTime() / 1000,
      eject_at_token_exp: true,
    });
  });

  it("reads who is in the room from Daily's presence endpoint", async () => {
    respond([200, { total_count: 2, data: [{ userId: 'coach_1', userName: 'Koç' }, { userId: null, userName: 'misafir' }] }]);
    expect(await roomPresence('kk-abc')).toEqual(['coach_1']);
    expect(calls[0]).toMatchObject({ url: 'https://api.daily.co/v1/rooms/kk-abc/presence', method: 'GET' });

    respond([404, { error: 'not-found' }]);
    expect(await roomPresence('kk-yok')).toEqual([]); // room not created yet
  });

  it('sums attendance per person across rejoins, within the booking window only', async () => {
    const t = (iso: string) => new Date(iso).getTime() / 1000;
    respond([
      200,
      {
        total_count: 2,
        data: [
          {
            participants: [
              { user_id: 'coach_1', join_time: t('2026-10-01T15:58:00Z'), duration: 600 },
              { user_id: 'student_1', join_time: t('2026-10-01T16:02:00Z'), duration: 300 },
            ],
          },
          {
            participants: [
              { user_id: 'student_1', join_time: t('2026-10-01T16:10:00Z'), duration: 2400 },
              { user_id: 'coach_1', join_time: t('2026-10-01T16:09:00Z'), duration: 2500 },
              // A week earlier, same room name (the session was moved) — not this booking.
              { user_id: 'coach_1', join_time: t('2026-09-24T16:00:00Z'), duration: 3600 },
              { user_id: null, join_time: t('2026-10-01T16:05:00Z'), duration: 60 },
            ],
          },
        ],
      },
    ]);
    const from = new Date('2026-10-01T15:45:00Z');
    const to = new Date('2026-10-01T17:45:00Z');
    const attendance = await roomAttendance('kk-abc', from, to);

    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/v1/meetings');
    expect(url.searchParams.get('room')).toBe('kk-abc');
    expect(url.searchParams.get('timeframe_start')).toBe(String(from.getTime() / 1000));
    expect(attendance.sort((a, b) => a.userId.localeCompare(b.userId))).toEqual([
      { userId: 'coach_1', firstJoinedAt: new Date('2026-10-01T15:58:00Z'), seconds: 3100 },
      { userId: 'student_1', firstJoinedAt: new Date('2026-10-01T16:02:00Z'), seconds: 2700 },
    ]);
  });

  it('derives a valid room name from a booking id', () => {
    expect(roomNameForBooking('cmUfQdrng004r71hq')).toBe('kk-cmufqdrng004r71hq');
  });
});
