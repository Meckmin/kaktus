import { promises as dns } from 'node:dns';
import { isReservedTestAddress } from '@/lib/mail-config';
import { isDisposableEmail, isValidEmail, normalizeEmail, suggestEmail } from '@/lib/email-address';

/**
 * The server-side gate before a sign-in link is sent: the address must be well
 * formed, not a throwaway inbox, and on a domain that accepts mail.
 *
 * The DNS lookup fails open. A slow or broken resolver must not lock people
 * out; the check exists to catch "gmial.com", not to be a second point of
 * failure for sign-in.
 */

export type EmailCheck =
  | { ok: true; email: string }
  | { ok: false; message: string; suggestion?: string };

export interface Resolver {
  resolveMx(domain: string): Promise<Array<{ exchange: string; priority: number }>>;
  resolve4(domain: string): Promise<string[]>;
}

const LOOKUP_TIMEOUT_MS = 3_000;
const CACHE_MS = 60 * 60_000;
const cache = new Map<string, { accepts: boolean; at: number }>();

const NO_SUCH = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), LOOKUP_TIMEOUT_MS),
    ),
  ]);
}

/** True when the domain accepts mail, false when DNS says it can't, true when unsure. */
export async function domainAcceptsMail(domain: string, resolver: Resolver = dns): Promise<boolean> {
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.accepts;

  let accepts = true;
  try {
    const records = await withTimeout(resolver.resolveMx(domain));
    // RFC 7505 "null MX" (a single "." exchange) says: this domain takes no mail.
    accepts = records.some((r) => r.exchange && r.exchange !== '.');
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (!NO_SUCH.has(code)) return true; // resolver trouble — don't cache, don't block
    // No MX record: SMTP falls back to the domain's A record (RFC 5321 §5.1).
    try {
      accepts = (await withTimeout(resolver.resolve4(domain))).length > 0;
    } catch (fallbackError) {
      const fallbackCode = (fallbackError as { code?: string }).code ?? '';
      if (!NO_SUCH.has(fallbackCode)) return true;
      accepts = false;
    }
  }

  cache.set(domain, { accepts, at: Date.now() });
  return accepts;
}

export async function checkSignInEmail(raw: string, resolver: Resolver = dns): Promise<EmailCheck> {
  const email = normalizeEmail(raw);
  if (!isValidEmail(email)) {
    return { ok: false, message: 'Geçerli bir e-posta adresi yaz (ör. elif@gmail.com).' };
  }
  if (isDisposableEmail(email)) {
    return {
      ok: false,
      message: 'Geçici e-posta adresleriyle hesap açılamıyor. Sürekli kullandığın adresini yaz.',
    };
  }
  // Seed and test accounts: never real, and handled locally outside production.
  if (process.env.NODE_ENV !== 'production' && isReservedTestAddress(email)) return { ok: true, email };

  if (!(await domainAcceptsMail(email.split('@')[1], resolver))) {
    const suggestion = suggestEmail(email) ?? undefined;
    return {
      ok: false,
      message: suggestion
        ? 'Bu adrese e-posta gidemiyor. Yazımı kontrol et.'
        : 'Bu adresin alan adı e-posta almıyor. Yazımı kontrol et.',
      suggestion,
    };
  }
  return { ok: true, email };
}
