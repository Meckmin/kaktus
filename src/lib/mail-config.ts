/**
 * Whether and how mail leaves this environment — no `'server-only'` guard,
 * deliberately, so `lib/email.ts` stays importable from the test runner. This
 * file only reads env vars and compares strings; the key itself is only used
 * by `lib/mail-transport.ts`.
 *
 * The provider is Resend. It needs a domain verified in Resend: with the
 * shared `onboarding@resend.dev` sender it only delivers to the Resend
 * account's own address and answers 403 for everyone else.
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

const looksLikePlaceholder = (value: string) => {
  const lower = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
};

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
 * the worst moment — a real user waiting on a login email.
 */
export function isUsableResendKey(key: string | undefined): boolean {
  if (!key) return false;
  const value = key.trim();
  if (value.length < 12) return false;
  if (!value.startsWith('re_')) return false;
  return !looksLikePlaceholder(value);
}

/**
 * Addresses that can never receive mail: RFC 2606/6761 reserved names and the
 * seed/test accounts. Outside production they are routed to the local log, so
 * a dev machine that does send real mail doesn't fire bounces at Gmail (which
 * hurts the sender's reputation) every time someone signs in as a seed user.
 */
export function isReservedTestAddress(email: string): boolean {
  const domain = email.split('@').pop()?.toLowerCase() ?? '';
  return (
    /\.(test|example|invalid|localhost)$/.test(domain) ||
    domain === 'example.com' ||
    domain === 'example.org' ||
    domain === 'test.kaktus.dev'
  );
}

export type DeliveryMode = 'resend' | 'local';

/**
 * Where a message to `to` goes.
 *
 * Development goes local unless `AUTH_FORCE_EMAIL=1`: sending real email by
 * default is how you accidentally mail a customer from a seed script. Tests
 * never send, whatever the developer's .env holds.
 */
export function deliveryMode(to?: string): DeliveryMode {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return 'local';

  if (!isUsableResendKey(readResendKey())) return 'local';
  if (process.env.NODE_ENV === 'development' && process.env.AUTH_FORCE_EMAIL !== '1') return 'local';
  if (to && process.env.NODE_ENV !== 'production' && isReservedTestAddress(to)) return 'local';
  return 'resend';
}
