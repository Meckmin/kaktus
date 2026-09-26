import nodemailer, { type Transporter } from 'nodemailer';
import { isUsableResendKey, readResendKey, readSmtpSettings, type MailProvider } from './mail-config';

/**
 * Sends one message through the configured provider. Callers decide *whether*
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

function addressOf(from: string): string {
  return (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
}

/**
 * Gmail (and most SMTP hosts) only send as the signed-in account: any other
 * From is rewritten or rejected. So over SMTP the sender is SMTP_FROM, or
 * EMAIL_FROM when it names that same account, or the account itself.
 */
export function smtpFrom(user: string): string {
  if (process.env.SMTP_FROM?.trim()) return process.env.SMTP_FROM.trim();
  const configured = process.env.EMAIL_FROM?.trim();
  if (configured && addressOf(configured) === user.toLowerCase()) return configured;
  return `Kaktüs Koçluk <${user}>`;
}

let transporter: Transporter | null = null;

function smtpTransport(): Transporter {
  const settings = readSmtpSettings();
  if (!settings) throw new Error('SMTP is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS)');
  transporter ??= nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: !settings.secure,
    auth: { user: settings.user, pass: settings.pass },
    // A sign-in request waits on this; don't let a hung server hang it.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

async function sendBySmtp(mail: OutgoingMail): Promise<void> {
  const settings = readSmtpSettings();
  if (!settings) throw new Error('SMTP is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS)');
  await smtpTransport().sendMail({
    from: smtpFrom(settings.user),
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
}

/**
 * Resend's REST API directly — one HTTP call, so no SDK, and no client is ever
 * constructed on a path where the key might be missing.
 */
async function sendByResend(mail: OutgoingMail): Promise<void> {
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

export async function sendMail(provider: MailProvider, mail: OutgoingMail): Promise<void> {
  if (provider === 'smtp') return sendBySmtp(mail);
  return sendByResend(mail);
}
