import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeetingToken, roomNameForBooking, upsertRoom } from '@/lib/meetings/daily';

describe('Daily client', () => {
  const realFetch = globalThis.fetch;
  let calls: Array<{ url: string; body: any; auth: string | null }>;

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
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get('authorization') });
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
    const token = await createMeetingToken({ roomName: 'kk-abc', userName: 'Elif Ş.', isOwner: true, expiresAt: closesAt });
    expect(token).toBe('tok_123');
    expect(calls[0].body.properties).toEqual({
      room_name: 'kk-abc',
      user_name: 'Elif Ş.',
      is_owner: true,
      exp: closesAt.getTime() / 1000,
      eject_at_token_exp: true,
    });
  });

  it('derives a valid room name from a booking id', () => {
    expect(roomNameForBooking('cmUfQdrng004r71hq')).toBe('kk-cmufqdrng004r71hq');
  });
});
