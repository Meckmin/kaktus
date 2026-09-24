import { describe, expect, it } from 'vitest';
import { buyerDetailsSchema, normalizeTrMobile } from '@/lib/payments/buyer';

describe('normalizeTrMobile', () => {
  it('accepts the ways people actually type a Turkish mobile number', () => {
    for (const raw of ['05551112233', '0555 111 22 33', '5551112233', '+90 555 111 22 33', '(0555) 111-2233']) {
      expect(normalizeTrMobile(raw)).toBe('+905551112233');
    }
  });

  it('rejects landlines and short numbers', () => {
    expect(normalizeTrMobile('02121112233')).toBeNull();
    expect(normalizeTrMobile('555111')).toBeNull();
  });
});

describe('buyerDetailsSchema', () => {
  const valid = {
    name: 'Ayşe',
    surname: 'Yılmaz',
    identityNumber: '12345678950', // checksum-valid dummy
    gsmNumber: '0555 111 22 33',
    city: 'İstanbul',
    address: 'Test Mah. Deneme Sok. No:1',
  };

  it('normalizes the phone on the way through', () => {
    const parsed = buyerDetailsSchema.parse(valid);
    expect(parsed.gsmNumber).toBe('+905551112233');
  });

  it('rejects a TCKN that fails the checksum', () => {
    const result = buyerDetailsSchema.safeParse({ ...valid, identityNumber: '12345678901' });
    expect(result.success).toBe(false);
  });

  it('rejects the old hardcoded placeholder', () => {
    // 11111111111 fails the TCKN checksum — the sandbox placeholder can't slip back in.
    expect(buyerDetailsSchema.safeParse({ ...valid, identityNumber: '11111111111' }).success).toBe(false);
  });
});
