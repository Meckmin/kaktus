'use server';

import { headers } from 'next/headers';
import { signIn } from '@/lib/auth';
import { enforceRateLimit, RateLimitError } from '@/lib/rate-limit';
import { checkSignInEmail } from '@/server/services/email-check';

/**
 * Sends a magic sign-in link.
 *
 * Goes through the server rather than next-auth/react's client `signIn`, for
 * two reasons. The address gets checked first (typos, throwaway inboxes,
 * domains that take no mail). And a failed send becomes a real error on the
 * form: the client helper returned the same "we sent it" either way, so a
 * student could wait for an email that was never going to come.
 *
 * Rate-limited per address and per IP: every call sends a real email, which
 * makes an open endpoint a way to flood someone's inbox — and Gmail's SMTP
 * allowance is ~500 a day for the whole site.
 */

export type SignInLinkResult = { ok: true } | { ok: false; message: string; suggestion?: string };

const TEN_MINUTES = 10 * 60_000;
const SEND_FAILED =
  'Giriş bağlantısını şu an gönderemedik. Birkaç dakika sonra tekrar dene ya da Google ile devam et.';

/** Only same-site paths: an open redirect on the sign-in link would be a phishing kit. */
function safeCallback(url: unknown): string {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || url.includes('\\')) {
    return '/panel';
  }
  return url;
}

function waitMessage(error: RateLimitError): string {
  const minutes = Math.max(1, Math.ceil(error.retryAfterMs / 60_000));
  return `Çok sık bağlantı istendi. ${minutes} dakika sonra tekrar dene; önceki e-postalar da gelen kutunda olabilir.`;
}

export async function requestSignInLink(rawEmail: string, callbackUrl: string): Promise<SignInLinkResult> {
  if (typeof rawEmail !== 'string') return { ok: false, message: 'Geçerli bir e-posta adresi yaz.' };

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() || headerList.get('x-real-ip') || 'unknown';

  try {
    await enforceRateLimit(`signin-ip:${ip}`, 10, TEN_MINUTES);
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, message: waitMessage(error) };
    throw error;
  }

  const check = await checkSignInEmail(rawEmail);
  if (!check.ok) return check;

  try {
    await enforceRateLimit(`signin-email:${check.email}`, 3, TEN_MINUTES);
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, message: waitMessage(error) };
    throw error;
  }

  try {
    // Auth.js doesn't throw when delivery fails; it answers with a redirect to
    // its error page. Success is the redirect to verify-request ("check your
    // email"), which the configured page may or may not have replaced.
    const next = await signIn('resend', {
      email: check.email,
      redirectTo: safeCallback(callbackUrl),
      redirect: false,
    });
    const sent =
      typeof next === 'string' &&
      (next.includes('/api/auth/verify-request') || next.includes('/giris/eposta-gonderildi')) &&
      !next.includes('error=');
    if (!sent) {
      console.error('[auth] sign-in link not sent', { to: check.email, next });
      return { ok: false, message: SEND_FAILED };
    }
    return { ok: true };
  } catch (error) {
    console.error('[auth] sign-in link failed', { to: check.email, error });
    return { ok: false, message: SEND_FAILED };
  }
}
