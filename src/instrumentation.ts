/**
 * Runs once, before the server accepts its first request — Next.js's hook for
 * exactly this: fail loudly at boot, not on whichever request first happens to
 * need a missing secret.
 *
 * Before this file existed, `@/lib/env` was only ever imported by the cron
 * route — so a production deploy missing `AUTH_SECRET` or
 * `FIELD_ENCRYPTION_KEY` would start up clean and serve traffic right up until
 * someone tried to sign in or a coach tried to submit payout details, at which
 * point it failed in the worst possible place: mid-request, for a real user.
 *
 * Same reasoning applies to the KMS-backed field encryption key: unwrapping it
 * is one network call, so it happens once here and is cached for the life of
 * the process — not on the first request that happens to touch an encrypted
 * field, and not once per request either.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('@/lib/env');

    const { kmsConfigured, resolveFieldEncryptionKeyFromKms } = await import('@/lib/crypto/kms');
    if (kmsConfigured()) {
      const { setFieldEncryptionKey } = await import('@/lib/crypto/field');
      setFieldEncryptionKey(await resolveFieldEncryptionKeyFromKms());
    }
  }
}
