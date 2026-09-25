import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RateLimitError,
  _resetRateLimitsForTests,
  checkRateLimit,
  enforceRateLimit,
} from '@/lib/rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetRateLimitsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows exactly `limit` calls within the window', () => {
    for (let i = 0; i < 5; i++) {
      expect(() => checkRateLimit('k', 5, 1000)).not.toThrow();
    }
  });

  it('throws RateLimitError on the call past the limit', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('k', 5, 1000);
    expect(() => checkRateLimit('k', 5, 1000)).toThrow(RateLimitError);
  });

  it('keeps rejecting further calls in the same window, not just the first one over', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('k', 5, 1000);
    expect(() => checkRateLimit('k', 5, 1000)).toThrow(RateLimitError);
    expect(() => checkRateLimit('k', 5, 1000)).toThrow(RateLimitError);
  });

  it('resets once the window elapses', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('k', 5, 1000);
    expect(() => checkRateLimit('k', 5, 1000)).toThrow(RateLimitError);

    vi.advanceTimersByTime(1001);

    expect(() => checkRateLimit('k', 5, 1000)).not.toThrow();
  });

  it('tracks each key independently', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('a', 5, 1000);
    // 'a' is exhausted, 'b' must be unaffected.
    expect(() => checkRateLimit('a', 5, 1000)).toThrow(RateLimitError);
    expect(() => checkRateLimit('b', 5, 1000)).not.toThrow();
  });

  it('reports a positive retryAfterMs that does not exceed the window', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('k', 3, 2000);
    try {
      checkRateLimit('k', 3, 2000);
      throw new Error('expected checkRateLimit to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitError);
      const retryAfterMs = (error as RateLimitError).retryAfterMs;
      expect(retryAfterMs).toBeGreaterThan(0);
      expect(retryAfterMs).toBeLessThanOrEqual(2000);
    }
  });
});

describe('enforceRateLimit (shared, Upstash)', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  function redisReturning(count: number, ttlMs = 40_000) {
    const calls: Array<{ url: string; body: unknown; auth: string | null }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        auth: new Headers(init?.headers).get('authorization'),
      });
      return new Response(JSON.stringify([{ result: count }, { result: 1 }, { result: ttlMs }]));
    }) as typeof fetch;
    return calls;
  }

  it('counts in Redis with a fixed window and the bearer token', async () => {
    const calls = redisReturning(1);
    await expect(enforceRateLimit('send:u1', 5, 60_000)).resolves.toBeUndefined();
    expect(calls[0].url).toBe('https://example.upstash.io/pipeline');
    expect(calls[0].auth).toBe('Bearer test-token');
    expect(calls[0].body).toEqual([
      ['INCR', 'rl:send:u1'],
      ['PEXPIRE', 'rl:send:u1', '60000', 'NX'],
      ['PTTL', 'rl:send:u1'],
    ]);
  });

  it('allows the call that reaches the limit and refuses the one past it', async () => {
    redisReturning(5);
    await expect(enforceRateLimit('k', 5, 60_000)).resolves.toBeUndefined();
    redisReturning(6, 12_000);
    await expect(enforceRateLimit('k', 5, 60_000)).rejects.toMatchObject({ retryAfterMs: 12_000 });
  });

  it('lets the request through when Redis is unreachable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as typeof fetch;
    await expect(enforceRateLimit('k', 1, 60_000)).resolves.toBeUndefined();
    error.mockRestore();
  });

  it('falls back to the in-memory limiter when Upstash is not configured', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    _resetRateLimitsForTests();
    await enforceRateLimit('mem', 1, 60_000);
    await expect(enforceRateLimit('mem', 1, 60_000)).rejects.toBeInstanceOf(RateLimitError);
  });
});
