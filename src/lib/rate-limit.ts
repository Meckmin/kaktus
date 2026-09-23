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
