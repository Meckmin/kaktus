import { z } from 'zod';

/**
 * Runtime environment validation.
 *
 * Parsed once, on first import. A missing or malformed variable fails loudly
 * here — at process boot — instead of as an opaque 500 three requests later, or
 * (worse) as silently-wrong behaviour like encrypting payout details with a
 * short key.
 *
 * What is *hard required* depends on context, so the rules are conditional:
 *
 *   - `DATABASE_URL` / `DIRECT_DATABASE_URL`  — always.
 *   - `AUTH_SECRET`, `FIELD_ENCRYPTION_KEY`   — required in production; in dev the
 *     app supplies safe fallbacks (see `lib/auth.ts`) and encryption degrades.
 *   - Iyzico keys                              — required whenever
 *     `PAYMENT_PROVIDER=iyzico`, in any environment.
 *   - Google pair                             — all-or-nothing: set both or neither.
 *
 * Set `SKIP_ENV_VALIDATION=1` to bypass entirely (CI image builds that have no
 * secrets and only need the bundle).
 */

const isProd = process.env.NODE_ENV === 'production';
// `next build` runs with NODE_ENV=production but has no business needing live
// company details or a Redis URL; those are checked when the server starts.
const isProdRuntime = isProd && process.env.NEXT_PHASE !== 'phase-production-build';

/** A base64 string that decodes to exactly 32 bytes — an AES-256 key. */
const base64Key32 = z
  .string()
  .refine((v) => {
    try {
      return Buffer.from(v, 'base64').length === 32;
    } catch {
      return false;
    }
  }, 'must be a base64 string that decodes to exactly 32 bytes (openssl rand -base64 32)');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // ── Database ────────────────────────────────────────────────────────────
    DATABASE_URL: z.string().url('must be a postg:// connection string'),
    DIRECT_DATABASE_URL: z.string().url('must be a postg:// connection string'),

    // ── Auth.js ─────────────────────────────────────────────────────────────
    AUTH_SECRET: z.string().min(1).optional(),
    AUTH_URL: z.string().url().optional(),
    APP_URL: z.string().url().default('http://localhost:3000'),
    AUTH_GOOGLE_ID: z.string().min(1).optional(),
    AUTH_GOOGLE_SECRET: z.string().min(1).optional(),
    AUTH_RESEND_KEY: z.string().min(1).optional(),
    // Resend's own SDK convention — lib/magic-link.ts accepts either name.
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(1).default('Kaktüs Koçluk <merhaba@kaktuskocluk.com>'),
    // '1' to send real mail from a dev machine, or to allow the local
    // link-on-disk fallback in production. See lib/magic-link.ts.
    AUTH_FORCE_EMAIL: z.string().optional(),
    AUTH_ALLOW_LOCAL_LINKS: z.string().optional(),

    // ── Payments ────────────────────────────────────────────────────────────
    PAYMENT_PROVIDER: z.enum(['mock', 'iyzico']).default('mock'),
    IYZICO_API_KEY: z.string().min(1).optional(),
    IYZICO_SECRET_KEY: z.string().min(1).optional(),
    IYZICO_BASE_URL: z.string().url().default('https://sandbox-api.iyzipay.com'),
    SERVER_PUBLIC_IP: z.string().min(1).default('127.0.0.1'),

    // ── Field encryption (coach payout details: IBAN, TCKN/VKN, message evidence)
    // Read directly by lib/crypto/field.ts, not through this `env` object — the
    // name must match exactly, or that module fails at first use instead of at
    // boot, which is the whole point of validating it here.
    FIELD_ENCRYPTION_KEY: base64Key32.optional(),
    // ── Field encryption key, KMS-wrapped (see lib/crypto/kms.ts) ────────────
    // When set, instrumentation.ts unwraps this through AWS KMS at boot and
    // FIELD_ENCRYPTION_KEY above is never read — the plaintext env var is the
    // dev/fallback path, this is the production one. Generated once with
    // scripts/kms-generate-key.mjs; read directly by lib/crypto/kms.ts.
    FIELD_ENCRYPTION_KMS_CIPHERTEXT: z.string().min(1).optional(),
    AWS_REGION: z.string().min(1).optional(),
    // Optional, but recommended once set: pins Decrypt to this specific key so
    // a ciphertext blob swapped in from elsewhere fails instead of silently
    // decrypting under the wrong key. Accepts a key id or ARN.
    AWS_KMS_KEY_ID: z.string().min(1).optional(),

    // ── Storage (private bucket for verification documents) ─────────────────
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    SUPABASE_VERIFICATION_BUCKET: z.string().min(1).default('verification'),

    // ── Background jobs ───────────────────────────────────────────────────
    // Bearer token the scheduler (Vercel Cron or equivalent) must present to
    // POST /api/cron/jobs. Unset in dev, the route runs unauthenticated so it
    // stays trivial to trigger by hand while iterating.
    CRON_SECRET: z.string().min(1).optional(),

    // ── Shared rate limiting (Upstash Redis REST) ─────────────────────────
    // Serverless instances don't share memory, so the in-memory limiter is a
    // dev fallback only. Required in production.
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

    // ── Legal identity (shown in the footer and legal texts) ──────────────
    // Turkish e-commerce law (6563) requires the service provider's title,
    // address, contact and tax details to be visible on the site. Kept in env
    // so they can be filled in once the company exists, without a code change.
    COMPANY_TITLE: z.string().min(1).optional(),
    COMPANY_ADDRESS: z.string().min(1).optional(),
    COMPANY_TAX_OFFICE: z.string().min(1).optional(),
    COMPANY_TAX_NUMBER: z.string().min(1).optional(),
    COMPANY_MERSIS: z.string().min(1).optional(),
    COMPANY_EMAIL: z.string().email().optional(),
    COMPANY_PHONE: z.string().min(1).optional(),
    COMPANY_KEP: z.string().min(1).optional(),
    ETBIS_URL: z.string().url().optional(),
    // '1' once a lawyer has approved src/content/legal. Until then every legal
    // page carries a visible draft notice; scripts/launch-check.mjs flags it.
    LEGAL_TEXTS_APPROVED: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    const need = (key: keyof typeof val, why: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: why });

    if (isProd && !val.AUTH_SECRET) {
      need('AUTH_SECRET', 'required in production — generate with: openssl rand -base64 32');
    }
    if (isProd && !val.FIELD_ENCRYPTION_KEY) {
      need('FIELD_ENCRYPTION_KEY', 'required in production — generate with: openssl rand -base64 32');
    }
    if (isProd && !val.CRON_SECRET) {
      need('CRON_SECRET', 'required in production — generate with: openssl rand -base64 32');
    }
    if (val.PAYMENT_PROVIDER === 'iyzico') {
      if (!val.IYZICO_API_KEY) need('IYZICO_API_KEY', 'required when PAYMENT_PROVIDER=iyzico');
      if (!val.IYZICO_SECRET_KEY) need('IYZICO_SECRET_KEY', 'required when PAYMENT_PROVIDER=iyzico');
    }
    if (Boolean(val.AUTH_GOOGLE_ID) !== Boolean(val.AUTH_GOOGLE_SECRET)) {
      need('AUTH_GOOGLE_SECRET', 'set both AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET, or neither');
    }
    if (val.FIELD_ENCRYPTION_KMS_CIPHERTEXT && !val.AWS_REGION) {
      need('AWS_REGION', 'required when FIELD_ENCRYPTION_KMS_CIPHERTEXT is set');
    }
    if (isProd && val.SUPABASE_URL && !val.SUPABASE_SERVICE_ROLE_KEY) {
      need('SUPABASE_SERVICE_ROLE_KEY', 'required when SUPABASE_URL is set');
    }

    if (isProdRuntime) {
      if (!val.APP_URL.startsWith('https://')) {
        need('APP_URL', 'must be the public https:// address in production');
      }
      // Verification documents: the local-disk driver refuses to run in
      // production, so a missing bucket would only surface on first upload.
      if (!val.SUPABASE_URL) need('SUPABASE_URL', 'required in production for document storage');
      if (!val.UPSTASH_REDIS_REST_URL || !val.UPSTASH_REDIS_REST_TOKEN) {
        need('UPSTASH_REDIS_REST_URL', 'required in production (with _TOKEN) for shared rate limiting');
      }
      for (const key of [
        'COMPANY_TITLE',
        'COMPANY_ADDRESS',
        'COMPANY_TAX_OFFICE',
        'COMPANY_TAX_NUMBER',
        'COMPANY_EMAIL',
      ] as const) {
        if (!val[key]) need(key, 'required in production — shown in the footer and legal texts (6563)');
      }
    }
  });

export type Env = z.infer<typeof schema>;

/**
 * `KEY=""` means "not set". .env.example ships every key empty, and dashboards
 * like Vercel's keep empty values around; without this, an empty optional key
 * failed its `.min(1)` / `.url()` check and the app refused to boot.
 */
function withoutEmptyValues(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => Boolean(entry[1]?.trim())),
  );
}

function load(): Env {
  if (process.env.SKIP_ENV_VALIDATION === '1') {
    // Trust the caller; still coerce defaults so the shape is stable.
    return schema.parse(withoutEmptyValues(process.env));
  }

  const parsed = schema.safeParse(withoutEmptyValues(process.env));
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(
      `Invalid environment configuration:\n${lines.join('\n')}\n\n` +
        'See .env.example for every variable and how to generate the secrets.',
    );
  }
  return parsed.data;
}

export const env = load();

/** Sign-in method availability, derived once so the UI and providers agree. */
export const authFlags = {
  googleEnabled: Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET),
  resendEnabled: Boolean(env.AUTH_RESEND_KEY),
} as const;
