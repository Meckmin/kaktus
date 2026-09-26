import { isUsableResendKey, readResendKey } from './mail-config';

/**
 * Sends one message through Resend. Callers decide *whether*
 * to send (`deliveryMode` in mail-config.ts) and what a failure means; this
 * only knows how. Throws on any provider error.
 */

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const DEFAULT_FROM = 'Kaktüs Koçluk <merhaba@kaktuskocluk.com>';

/**
 * Resend's REST API directly — one HTTP call, so no SDK, and no client is ever
 * constructed on a path where the key might be missing.
 */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  const key = readResendKey();
  if (!isUsableResendKey(key)) throw new Error('Resend is not configured (AUTH_RESEND_KEY)');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM?.trim() || DEFAULT_FROM,
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend rejected the request (${response.status}): ${detail.slice(0, 300)}`);
  }
}
