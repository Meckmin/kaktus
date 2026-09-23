import 'server-only';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deliveryMode, isUsableResendKey, readResendKey } from './resend-config';

/**
 * Magic-link delivery.
 *
 * Auth.js's built-in Resend provider calls the Resend API unconditionally. With
 * no key — the normal state on a fresh local checkout — that is a 401 and a
 * dead sign-in flow, which blocks *every* seeded account at once.
 *
 * So delivery is decided here, before anything is instantiated:
 *
 *   usable key + not development  →  send via Resend's REST API
 *   otherwise                     →  print the link and write .auth-link.txt
 *
 * The fallback is not a mock that pretends to send. It prints the real
 * verification URL, which is a working credential — sign-in genuinely completes
 * locally with no third-party account at all.
 */

export { deliveryMode, isUsableResendKey, readResendKey };

export const AUTH_LINK_FILE = '.auth-link.txt';

export interface VerificationRequest {
  identifier: string;
  url: string;
  expires?: Date;
  from?: string;
}

/**
 * Prints the sign-in link and appends it to `.auth-link.txt`.
 *
 * The file matters more than the console line: Next's dev server output is
 * noisy and a link scrolls away in seconds, while `tail -f .auth-link.txt`
 * gives a reliable place to grab it from.
 */
export async function deliverLocally(request: VerificationRequest): Promise<void> {
  // A sign-in link is a bearer credential. Writing them to a file on a
  // production server would be handing out working sessions, so this refuses
  // rather than trusting that it is never reached.
  if (process.env.NODE_ENV === 'production' && process.env.AUTH_ALLOW_LOCAL_LINKS !== '1') {
    throw new Error(
      'Refusing to write sign-in links to disk in production. ' +
        'Configure AUTH_RESEND_KEY with a valid Resend key.',
    );
  }

  const line = [
    '',
    '┌─ Kaktüs Koçluk — giriş bağlantısı ' + '─'.repeat(32),
    `│  ${request.identifier}`,
    '│',
    `│  ${request.url}`,
    '│',
    request.expires
      ? `│  geçerlilik: ${request.expires.toLocaleString('tr-TR')}`
      : '│  geçerlilik: 24 saat',
    '│  (e-posta gönderilmedi — geliştirme modunda bağlantı burada gösterilir)',
    '└' + '─'.repeat(66),
    '',
  ].join('\n');

  console.log(line);

  try {
    await appendFile(
      join(process.cwd(), AUTH_LINK_FILE),
      `${new Date().toISOString()}\t${request.identifier}\t${request.url}\n`,
      'utf8',
    );
  } catch (error) {
    // Losing the file is survivable — the link is already on the console.
    // Failing sign-in because a log file could not be written is not.
    console.warn(`[auth] could not write ${AUTH_LINK_FILE}:`, error);
  }
}

/**
 * Sends via Resend's REST API directly.
 *
 * No SDK: it is one HTTP call, and going direct means the client is never
 * constructed on a path where the key might be missing. It also lets the email
 * be written in Turkish — Auth.js's default template is English, which is a
 * jarring thing to receive from a Turkish product at the exact moment someone
 * is deciding whether to trust it.
 */
export async function deliverByResend(request: VerificationRequest): Promise<void> {
  const key = readResendKey();
  if (!isUsableResendKey(key)) {
    throw new Error('deliverByResend called without a usable Resend key');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: request.from ?? 'Kaktüs Koçluk <merhaba@kaktuskocluk.com>',
      to: [request.identifier],
      subject: 'Kaktüs Koçluk giriş bağlantın',
      text: turkishText(request.url),
      html: turkishHtml(request.url),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend rejected the request (${response.status}): ${detail.slice(0, 300)}`);
  }
}

/** Entry point handed to Auth.js. */
export async function sendVerificationRequest(request: VerificationRequest): Promise<void> {
  if (deliveryMode() === 'local') {
    await deliverLocally(request);
    return;
  }

  try {
    await deliverByResend(request);
  } catch (error) {
    // A provider outage should not silently swallow the sign-in. Outside
    // production we fall back to the console so work continues; in production
    // it must surface, because the user is waiting for an email that is not
    // coming and needs to see an error rather than a "check your inbox" lie.
    if (process.env.NODE_ENV === 'production') throw error;
    console.error('[auth] Resend failed, falling back to local link:', error);
    await deliverLocally(request);
  }
}

function turkishText(url: string): string {
  return [
    'Kaktüs Koçluk hesabına giriş yapmak için bağlantıya tıkla:',
    '',
    url,
    '',
    'Bağlantı 24 saat geçerli ve yalnızca bir kez kullanılabilir.',
    'Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.',
  ].join('\n');
}

function turkishHtml(url: string): string {
  return `<!doctype html>
<html lang="tr"><body style="margin:0;padding:32px;background:#E9ECE6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#12211C">
  <div style="max-width:480px;margin:0 auto;background:#F5F7F3;border-radius:16px;padding:32px">
    <p style="margin:0 0 24px;font-size:18px;font-weight:600">Kaktüs Koçluk</p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6">Giriş yapmak için aşağıdaki butona tıkla.</p>
    <a href="${url}" style="display:inline-block;background:#1E6B4B;color:#F5F7F3;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:500">Giriş yap</a>
    <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#5C6B63">Bağlantı 24 saat geçerli ve yalnızca bir kez kullanılabilir. Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.</p>
  </div>
</body></html>`;
}
