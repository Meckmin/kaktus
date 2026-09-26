/**
 * Which way mail leaves this environment — no `'server-only'` guard,
 * deliberately, so `lib/email.ts` stays importable from the test runner. This
 * file only reads env vars and compares strings; the secrets themselves are
 * only ever used by `lib/mail-transport.ts`.
 *
 * Two real providers:
 *
 *   - **SMTP** (e.g. a Gmail account with an app password). Works before the
 *     site has a domain of its own; Gmail caps it at ~500 messages a day.
 *   - **Resend**. Needs a domain verified in Resend — with the shared
 *     `onboarding@resend.dev` sender it only delivers to the Resend account's
 *     own address and answers 403 for everyone else.
 *
 * `EMAIL_PROVIDER` picks one explicitly; otherwise SMTP wins when configured
 * (it's the one that works without a domain), then Resend.
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

export interface SmtpSettings {
  host: string;
  port: number;
  /** Implicit TLS (port 465). Port 587 upgrades with STARTTLS instead. */
  secure: boolean;
  user: string;
  pass: string;
}

export function readSmtpSettings(): SmtpSettings | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  // Google shows app passwords in groups of four ("abcd efgh ijkl mnop");
  // people paste them with the spaces.
  const pass = process.env.SMTP_PASS?.replace(/\s+/g, '');
  if (!host || !user || !pass || looksLikePlaceholder(pass)) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  return { host, port, secure: port === 465, user, pass };
}

export type MailProvider = 'smtp' | 'resend';

/** The configured provider, or null when nothing usable is configured. */
export function mailProvider(): MailProvider | null {
  const explicit = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  const smtp = readSmtpSettings() !== null;
  const resend = isUsableResendKey(readResendKey());
  if (explicit === 'smtp') return smtp ? 'smtp' : null;
  if (explicit === 'resend') return resend ? 'resend' : null;
  if (smtp) return 'smtp';
  if (resend) return 'resend';
  return null;
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

export type DeliveryMode = MailProvider | 'local';

/**
 * Where a message to `to` goes.
 *
 * Development goes local unless `AUTH_FORCE_EMAIL=1`: sending real email by
 * default is how you accidentally mail a customer from a seed script. Tests
 * never send, whatever the developer's .env holds.
 */
export function deliveryMode(to?: string): DeliveryMode {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return 'local';

  const provider = mailProvider();
  if (!provider) return 'local';
  if (process.env.NODE_ENV === 'development' && process.env.AUTH_FORCE_EMAIL !== '1') return 'local';
  if (to && process.env.NODE_ENV !== 'production' && isReservedTestAddress(to)) return 'local';
  return provider;
}
