import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deliveryMode, isUsableResendKey, readResendKey } from './resend-config';

/**
 * Generic transactional email delivery — offer/payment/dispute notifications,
 * as opposed to `magic-link.ts` which is specifically the sign-in credential.
 *
 * Shares the same Resend-or-local decision (`deliveryMode`) so the whole app
 * has one answer to "does this environment actually send mail", but the
 * failure contract is different on purpose: a sign-in link that fails to send
 * blocks the one thing the user is waiting for, so `magic-link.ts` throws in
 * production. A notification email is always a side effect of a transition
 * that has *already succeeded* — "your offer was accepted" is true whether or
 * not the email arrives — so this never throws. A provider outage should
 * produce a log line, not a failed offer acceptance.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export const NOTIFICATIONS_LOG_FILE = '.notifications-log.txt';

async function deliverLocally(message: EmailMessage): Promise<void> {
  console.log(
    `\n┌─ Kaktüs Koçluk — bildirim ${'─'.repeat(34)}\n` +
      `│  ${message.to}\n│  ${message.subject}\n│\n` +
      `│  ${message.text.split('\n').join('\n│  ')}\n` +
      `│  (e-posta gönderilmedi — geliştirme modunda burada gösterilir)\n` +
      `└${'─'.repeat(66)}\n`,
  );

  try {
    await appendFile(
      join(process.cwd(), NOTIFICATIONS_LOG_FILE),
      `${new Date().toISOString()}\t${message.to}\t${message.subject}\n`,
      'utf8',
    );
  } catch (error) {
    console.warn(`[notify] could not write ${NOTIFICATIONS_LOG_FILE}:`, error);
  }
}

async function deliverByResend(message: EmailMessage): Promise<void> {
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
      from: 'Kaktüs Koçluk <merhaba@kaktuskocluk.com>',
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend rejected the request (${response.status}): ${detail.slice(0, 300)}`);
  }
}

/** Best-effort. Never throws — see the module doc for why. */
export async function sendEmail(message: EmailMessage): Promise<void> {
  try {
    if (deliveryMode() === 'local') {
      await deliverLocally(message);
      return;
    }
    await deliverByResend(message);
  } catch (error) {
    console.error('[notify] delivery failed', { to: message.to, subject: message.subject, error });
  }
}

/** Shared envelope so every notification looks like it belongs to the product. */
export function emailHtml(heading: string, bodyText: string, ctaUrl?: string, ctaLabel?: string): string {
  const paragraphs = bodyText
    .split('\n')
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6">${line}</p>`)
    .join('');
  const cta =
    ctaUrl && ctaLabel
      ? `<a href="${ctaUrl}" style="display:inline-block;margin-top:8px;background:#1E6B4B;color:#F5F7F3;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:500">${ctaLabel}</a>`
      : '';
  return `<!doctype html>
<html lang="tr"><body style="margin:0;padding:32px;background:#E9ECE6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#12211C">
  <div style="max-width:480px;margin:0 auto;background:#F5F7F3;border-radius:16px;padding:32px">
    <p style="margin:0 0 24px;font-size:18px;font-weight:600">${heading}</p>
    ${paragraphs}
    ${cta}
  </div>
</body></html>`;
}
