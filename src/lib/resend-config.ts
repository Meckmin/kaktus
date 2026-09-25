/**
 * Shared Resend delivery decisions — no `'server-only'` guard, deliberately.
 *
 * Split out of `magic-link.ts` so `lib/email.ts` (generic notification
 * delivery) doesn't have to import a module that guards itself out of any
 * non-Next test runner. This file only reads env vars and does string
 * comparisons; it holds no secret itself and does nothing unsafe if it ever
 * ended up in a client bundle by accident — the actual key material stays
 * behind `magic-link.ts`'s and `email.ts`'s own server-only send functions.
 */

const PLACEHOLDER_MARKERS = [
  'xxx',
  'your',
  'placeholder',
  'dummy',
  'changeme',
  'replace',
  'todo',
  'example',
  'test-key',
  'sk_test',
];

export function readResendKey(): string | undefined {
  // Auth.js reads AUTH_RESEND_KEY; the Resend SDK's own convention is
  // RESEND_API_KEY. Accept either, so a key copied from Resend's dashboard
  // instructions works without anyone having to know which name we chose.
  return process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY;
}

/**
 * Whether a key looks like a genuine Resend key rather than an empty string or
 * scaffolding left in `.env.example`.
 *
 * Deliberately strict about the `re_` prefix. A malformed key produces a 401 at
 * the worst moment — a real user waiting on a login email — and failing over to
 * console output is strictly better than failing.
 */
export function isUsableResendKey(key: string | undefined): boolean {
  if (!key) return false;
  const value = key.trim();
  if (value.length < 12) return false;
  if (!value.startsWith('re_')) return false;
  const lower = value.toLowerCase();
  return !PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

export type DeliveryMode = 'resend' | 'local';

/**
 * Picks the delivery route.
 *
 * Development always goes local, even with a valid key: sending real email
 * during development is how you accidentally mail a customer from a seed
 * script. `AUTH_FORCE_EMAIL=1` overrides that when you specifically want to
 * test the real template.
 */
export function deliveryMode(): DeliveryMode {
  // Tests never send real mail, whatever keys the developer's .env holds —
  // not even with AUTH_FORCE_EMAIL. The integration suite creates dozens of
  // fake users per run; with a real key it was calling Resend for each one.
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return 'local';

  const key = readResendKey();
  if (!isUsableResendKey(key)) return 'local';
  if (process.env.NODE_ENV === 'development' && process.env.AUTH_FORCE_EMAIL !== '1') {
    return 'local';
  }
  return 'resend';
}
