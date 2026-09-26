import { afterEach, describe, expect, it } from 'vitest';
import { deliveryMode, isReservedTestAddress } from '@/lib/mail-config';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('deliveryMode under test', () => {
  it('never sends real mail from a test run, even with a usable key and AUTH_FORCE_EMAIL', () => {
    process.env.AUTH_RESEND_KEY = 're_live_looking_key_123456';
    process.env.AUTH_FORCE_EMAIL = '1';
    expect(deliveryMode()).toBe('local');
  });
});

describe('reserved test addresses', () => {
  it('keeps seed addresses off the wire', () => {
    expect(isReservedTestAddress('koc.e2e@test.kaktus.dev')).toBe(true);
    expect(isReservedTestAddress('a@shop.test')).toBe(true);
    expect(isReservedTestAddress('a@example.com')).toBe(true);
    expect(isReservedTestAddress('a@gmail.com')).toBe(false);
  });
});
