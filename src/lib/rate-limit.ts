/**
 * Fixed-window, in-memory rate limiting for server actions.
 *
 * No `'server-only'` guard here, unlike `crypto/field.ts` or `magic-link.ts`:
 * this module holds no secret and touches nothing sensitive, so the only
 * thing that guard would buy is being unimportable from a plain Vitest unit
 * test — which is the opposite of what's wanted, since the whole point of
 * this file is logic worth testing without a database. Every real caller is
 * still a `'use server'` action, which is its own server-only boundary.
 *
 * In-memory only — on a multi-instance deploy each instance enforces its own
 * window, so the real ceiling is `limit × instance count`, not `limit`. That
 * is still a meaningful backstop against a single runaway script, a client
 * retry loop with a bug, or one abusive account — which is the actual threat
 * this closes, since nothing today stops any of that. A shared limiter
 * (Upstash/Redis) is the upgrade once traffic is large enough to make the
 * per-instance gap worth exploiting deliberately.
 *
 * Deliberately not middleware: the limit that matters differs by action (a
 * message send and an offer accept are not equally spammable), so each
 * server action picks its own key and budget rather than one blanket rule.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Bounds memory on a long-lived process — without this, a growing set of
// distinct keys (one per user per action) would never shrink.
const CLEANUP_INTERVAL_MS = 5 * 60_000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupScheduled() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

export class RateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`Rate limit exceeded, retry after ${retryAfterMs}ms`);
    this.name = 'RateLimitError';
  }
}

/**
 * Throws `RateLimitError` once `key` has been called `limit` times inside the
 * current `windowMs` window. Call with a key that identifies both the actor
 * and the action, e.g. `` `send-message:${userId}` ``.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): void {
  ensureCleanupScheduled();

  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (bucket.count >= limit) {
    throw new RateLimitError(bucket.resetAt - now);
  }

  bucket.count++;
}

/** Reset all state — tests only. */
export function _resetRateLimitsForTests(): void {
  buckets.clear();
}

/**
 * The limiter server actions should call.
 *
 * With UPSTASH_REDIS_REST_URL/TOKEN set (required in production — see
 * lib/env.ts), the window lives in Redis and is shared by every serverless
 * instance, which the in-memory map above can't be. Without them (local dev,
 * tests) it falls back to `checkRateLimit`.
 *
 * Fails open: if Redis is unreachable the call is allowed and the error
 * logged. Refusing every message and offer because a rate limiter is down
 * would turn a monitoring problem into an outage.
 */
export async function enforceRateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    checkRateLimit(key, limit, windowMs);
    return;
  }

  let count: number;
  let ttlMs: number;
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCR', `rl:${key}`],
        // NX: only the first hit in a window sets the expiry, so the window is
        // fixed from its first request rather than sliding on every call.
        ['PEXPIRE', `rl:${key}`, String(windowMs), 'NX'],
        ['PTTL', `rl:${key}`],
      ]),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Upstash responded ${response.status}`);
    const results = (await response.json()) as Array<{ result?: number; error?: string }>;
    count = Number(results[0]?.result);
    ttlMs = Number(results[2]?.result);
    if (!Number.isFinite(count)) throw new Error('Upstash returned no count');
  } catch (error) {
    console.error('[rate-limit] shared limiter unavailable, allowing request', error);
    return;
  }

  if (count > limit) throw new RateLimitError(ttlMs > 0 ? ttlMs : windowMs);
}
