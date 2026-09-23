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
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('@/lib/env');
  }
}
