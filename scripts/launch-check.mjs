#!/usr/bin/env node
/**
 * Pre-launch checklist for the production environment.
 *
 *   node --env-file=.env.production scripts/launch-check.mjs
 *   (or, on Vercel: `vercel env pull .env.production` first)
 *
 * Checks presence and shape only — it never prints a secret's value. Exits 1
 * while anything blocking is left, so it can gate a deploy.
 *
 * lib/env.ts already refuses to boot without the hard requirements; this goes
 * further and catches settings that boot fine but are wrong for a real launch
 * (sandbox Iyzico URL, Resend's shared sender, draft legal texts, dev escape
 * hatches left on).
 */

const env = process.env;
const results = [];

function check(ok, label, fix, { warn = false } = {}) {
  results.push({ ok: Boolean(ok), label, fix, warn });
}

const has = (key) => Boolean(env[key] && env[key].trim());
const host = (value) => {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
};

// ── Site & auth ───────────────────────────────────────────────────────────
check(env.APP_URL?.startsWith('https://'), 'APP_URL is the public https address', 'Set APP_URL=https://<alan-adın>');
check(env.AUTH_URL === env.APP_URL, 'AUTH_URL matches APP_URL', 'Set AUTH_URL to the same value as APP_URL');
check(has('AUTH_SECRET'), 'AUTH_SECRET is set', 'openssl rand -base64 32');
check(has('CRON_SECRET'), 'CRON_SECRET is set (Vercel Cron sends it as a Bearer token)', 'openssl rand -base64 32');
check(
  has('FIELD_ENCRYPTION_KEY') || has('FIELD_ENCRYPTION_KMS_CIPHERTEXT'),
  'Payout-detail encryption key is set',
  'openssl rand -base64 32 → FIELD_ENCRYPTION_KEY',
);

// ── Email ─────────────────────────────────────────────────────────────────
check(has('AUTH_RESEND_KEY') || has('RESEND_API_KEY'), 'Resend API key is set', 'Create a key at resend.com → API Keys');
const from = env.EMAIL_FROM ?? '';
const fromDomain = from.match(/@([^>\s]+)/)?.[1]?.toLowerCase() ?? '';
check(
  fromDomain && !fromDomain.endsWith('resend.dev'),
  'EMAIL_FROM uses your own verified domain',
  'Verify the domain in Resend, then EMAIL_FROM="Kaktüs Koçluk <merhaba@alan-adın>"',
);
const appHost = host(env.APP_URL ?? '') ?? '';
check(
  fromDomain && appHost && appHost.endsWith(fromDomain.replace(/^mail\./, '')),
  'EMAIL_FROM domain matches the site domain',
  'Send from the same domain the site runs on',
  { warn: true },
);

// ── Payments ──────────────────────────────────────────────────────────────
check(env.PAYMENT_PROVIDER === 'iyzico', 'PAYMENT_PROVIDER=iyzico', 'The mock provider does not charge anyone');
check(has('IYZICO_API_KEY') && has('IYZICO_SECRET_KEY'), 'Iyzico live API keys are set', 'Iyzico merchant panel → Ayarlar → API anahtarları');
check(
  host(env.IYZICO_BASE_URL ?? '') === 'api.iyzipay.com',
  'IYZICO_BASE_URL points at live, not sandbox',
  'IYZICO_BASE_URL=https://api.iyzipay.com',
);
check(!has('ALLOW_MOCK_PAYMENTS'), 'ALLOW_MOCK_PAYMENTS is not set', 'Remove it from the production environment');

// ── Infrastructure ────────────────────────────────────────────────────────
check(has('DATABASE_URL') && has('DIRECT_DATABASE_URL'), 'Database URLs are set', 'Supabase → Project Settings → Database');
check(has('SUPABASE_URL') && has('SUPABASE_SERVICE_ROLE_KEY'), 'Supabase storage is configured', 'Supabase → Project Settings → API');
check(
  has('UPSTASH_REDIS_REST_URL') && has('UPSTASH_REDIS_REST_TOKEN'),
  'Upstash Redis (shared rate limiting) is configured',
  'Vercel Marketplace → Upstash, or console.upstash.com',
);

check(has('DAILY_API_KEY'), 'DAILY_API_KEY is set (in-app video meetings)', 'dashboard.daily.co → Developers', { warn: true });

// ── Legal identity ────────────────────────────────────────────────────────
for (const key of ['COMPANY_TITLE', 'COMPANY_ADDRESS', 'COMPANY_TAX_OFFICE', 'COMPANY_TAX_NUMBER', 'COMPANY_EMAIL']) {
  check(has(key), `${key} is set`, 'From your vergi levhası / şirket kaydı');
}
check(has('ETBIS_URL'), 'ETBIS_URL is set (ETBİS kaydı)', 'Register at etbis.ticaret.gov.tr, then paste the QR/doğrulama link');
check(env.LEGAL_TEXTS_APPROVED === '1', 'Legal texts approved by a lawyer (LEGAL_TEXTS_APPROVED=1)', 'See YAYIN-REHBERI.md → Avukat');

// ── Dev escape hatches must be off ────────────────────────────────────────
check(!has('AUTH_FORCE_EMAIL'), 'AUTH_FORCE_EMAIL is not set', 'Dev-only; remove it');
check(!has('AUTH_ALLOW_LOCAL_LINKS'), 'AUTH_ALLOW_LOCAL_LINKS is not set', 'Would write sign-in links to disk; remove it');

// ── Report ────────────────────────────────────────────────────────────────
let blocking = 0;
for (const r of results) {
  const mark = r.ok ? '✓' : r.warn ? '!' : '✗';
  if (!r.ok && !r.warn) blocking++;
  console.log(`${mark} ${r.label}${r.ok ? '' : `\n    → ${r.fix}`}`);
}
console.log(
  blocking === 0
    ? '\nReady to launch.'
    : `\n${blocking} blocking item${blocking === 1 ? '' : 's'} left.`,
);
process.exit(blocking === 0 ? 0 : 1);
