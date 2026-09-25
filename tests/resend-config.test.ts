import { afterEach, describe, expect, it } from 'vitest';
import { deliveryMode } from '@/lib/resend-config';

describe('deliveryMode under test', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('never sends real mail from a test run, even with a usable key and AUTH_FORCE_EMAIL', () => {
    process.env.AUTH_RESEND_KEY = 're_live_looking_key_123456';
    process.env.AUTH_FORCE_EMAIL = '1';
    expect(deliveryMode()).toBe('local');
  });
});
