import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitError, _resetRateLimitsForTests, checkRateLimit } from '@/lib/rate-limit';

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
