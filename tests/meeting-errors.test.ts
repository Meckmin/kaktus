import { describe, expect, it } from 'vitest';
import { describeFatal } from '@/lib/meetings/errors';

describe('Daily fatal errors, in Turkish', () => {
  it('blames our account, not the Wi-Fi, for account problems', () => {
    const message = describeFatal({ errorMsg: 'account-missing-payment-method' });
    expect(message).toContain('bizden kaynaklı');
    expect(message).not.toContain('İnternet');
  });

  it('maps the typed errors', () => {
    expect(describeFatal({ errorMsg: '', error: { type: 'exp-token', msg: '' } })).toContain('süresi doldu');
    expect(describeFatal({ errorMsg: '', error: { type: 'nbf-room', msg: '' } })).toContain('henüz açılmadı');
    expect(describeFatal({ errorMsg: '', error: { type: 'ejected', msg: '' } })).toBe('Görüşmeden çıkarıldın.');
    expect(describeFatal({ errorMsg: '', error: { type: 'connection-error', msg: '' } })).toContain('İnternet');
  });

  it('falls back to a neutral retry message for anything else', () => {
    expect(describeFatal({ errorMsg: 'something-new' })).toContain('tekrar dene');
  });
});
