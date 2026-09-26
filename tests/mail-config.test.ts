import { afterEach, describe, expect, it } from 'vitest';
import { deliveryMode, isReservedTestAddress, mailProvider, readSmtpSettings } from '@/lib/mail-config';
import { smtpFrom } from '@/lib/mail-transport';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

function clearMailEnv() {
  for (const key of ['EMAIL_PROVIDER', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'EMAIL_FROM', 'AUTH_RESEND_KEY', 'RESEND_API_KEY']) {
    delete process.env[key];
  }
}

const gmail = () => {
  process.env.SMTP_HOST = 'smtp.gmail.com';
  process.env.SMTP_USER = 'kaktus.kocluk@gmail.com';
  process.env.SMTP_PASS = 'abcd efgh ijkl mnop';
};

describe('deliveryMode under test', () => {
  it('never sends real mail from a test run, even with a usable key and AUTH_FORCE_EMAIL', () => {
    process.env.AUTH_RESEND_KEY = 're_live_looking_key_123456';
    process.env.AUTH_FORCE_EMAIL = '1';
    gmail();
    expect(deliveryMode()).toBe('local');
  });
});

describe('mail provider selection', () => {
  it('prefers SMTP when configured, since it works without a domain', () => {
    clearMailEnv();
    expect(mailProvider()).toBeNull();
    process.env.AUTH_RESEND_KEY = 're_live_looking_key_123456';
    expect(mailProvider()).toBe('resend');
    gmail();
    expect(mailProvider()).toBe('smtp');
    process.env.EMAIL_PROVIDER = 'resend';
    expect(mailProvider()).toBe('resend');
  });

  it('refuses an explicit provider that is not actually configured', () => {
    clearMailEnv();
    process.env.EMAIL_PROVIDER = 'smtp';
    process.env.AUTH_RESEND_KEY = 're_live_looking_key_123456';
    expect(mailProvider()).toBeNull();
  });

  it('reads a Gmail app password pasted with its spaces, on implicit TLS by default', () => {
    clearMailEnv();
    gmail();
    expect(readSmtpSettings()).toEqual({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      user: 'kaktus.kocluk@gmail.com',
      pass: 'abcdefghijklmnop',
    });
    process.env.SMTP_PORT = '587';
    expect(readSmtpSettings()?.secure).toBe(false);
  });

  it('keeps seed addresses off the wire', () => {
    expect(isReservedTestAddress('koc.e2e@test.kaktus.dev')).toBe(true);
    expect(isReservedTestAddress('a@shop.test')).toBe(true);
    expect(isReservedTestAddress('a@example.com')).toBe(true);
    expect(isReservedTestAddress('a@gmail.com')).toBe(false);
  });
});

describe('SMTP sender', () => {
  it('sends as the signed-in account, keeping the display name when EMAIL_FROM matches it', () => {
    clearMailEnv();
    expect(smtpFrom('kaktus.kocluk@gmail.com')).toBe('Kaktüs Koçluk <kaktus.kocluk@gmail.com>');
    process.env.EMAIL_FROM = 'Kaktüs Koçluk <onboarding@resend.dev>';
    expect(smtpFrom('kaktus.kocluk@gmail.com')).toBe('Kaktüs Koçluk <kaktus.kocluk@gmail.com>');
    process.env.EMAIL_FROM = 'Kaktüs <Kaktus.Kocluk@gmail.com>';
    expect(smtpFrom('kaktus.kocluk@gmail.com')).toBe('Kaktüs <Kaktus.Kocluk@gmail.com>');
    process.env.SMTP_FROM = 'Kaktüs Koçluk <merhaba@kaktuskocluk.com>';
    expect(smtpFrom('kaktus.kocluk@gmail.com')).toBe('Kaktüs Koçluk <merhaba@kaktuskocluk.com>');
  });
});
