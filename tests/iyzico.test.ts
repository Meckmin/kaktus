import { describe, expect, it } from 'vitest';
import {
  buildAuthorizationHeader,
  computeResponseSignature,
  safeEqualHex,
  signWebhookPayload,
  verifyResponseSignature,
  verifyWebhookSignature,
  SIGNATURE_PARAM_ORDER,
} from '@/lib/payments/iyzico/signature';
import {
  buildSplit,
  iyzicoAmountToMinor,
  minorToIyzicoAmount,
  normalizeAmountForSignature,
} from '@/lib/payments/iyzico/money';

/**
 * These tests are the reason we can hand-roll the Iyzico auth instead of taking
 * their SDK. The response-signature case reproduces the worked example from
 * Iyzico's own documentation byte for byte — if our HMAC construction ever
 * drifts, this fails before anything reaches a bank.
 */

describe('response signature — Iyzico published vector', () => {
  // From docs.iyzico.com "Response Signature Validation", /payment/auth sample.
  const secretKey = 'sandbox-qaIiLIxhjMgx3LSKIVvp6j17NunHOFtD';
  const expected = '836c3a6c8db86c81043f2ca74edb13518b54a813f454f8dd762f0dd658610173';

  it('reproduces the documented signature exactly', () => {
    const signature = computeResponseSignature(
      ['22416032', 'TRY', 'basketId', 'conversationId', '10.5', '10.5'],
      secretKey,
    );
    expect(signature).toBe(expected);
  });

  it('validates a response object using the endpoint parameter order', () => {
    const response = {
      paymentId: '22416032',
      currency: 'TRY',
      basketId: 'basketId',
      conversationId: 'conversationId',
      paidPrice: 10.5,
      price: 10.5,
      signature: expected,
    };
    const result = verifyResponseSignature({
      order: SIGNATURE_PARAM_ORDER.nonThreeDsAuth,
      response,
      secretKey,
    });
    expect(result).toMatchObject({ present: true, valid: true });
  });

  it('rejects a response whose amount was altered in transit', () => {
    const tampered = {
      paymentId: '22416032',
      currency: 'TRY',
      basketId: 'basketId',
      conversationId: 'conversationId',
      paidPrice: 1.5, // attacker lowers the amount
      price: 10.5,
      signature: expected,
    };
    expect(
      verifyResponseSignature({
        order: SIGNATURE_PARAM_ORDER.nonThreeDsAuth,
        response: tampered,
        secretKey,
      }).valid,
    ).toBe(false);
  });

  it('reports an absent signature as not-present rather than invalid', () => {
    const result = verifyResponseSignature({
      order: SIGNATURE_PARAM_ORDER.nonThreeDsAuth,
      response: { paymentId: '1' },
      secretKey,
    });
    expect(result).toEqual({ present: false, valid: false });
  });

  it('uses a different parameter order per endpoint', () => {
    // A silent copy-paste of the wrong order is the likeliest failure here.
    expect(SIGNATURE_PARAM_ORDER.checkoutFormInitialize).toEqual(['conversationId', 'token']);
    expect(SIGNATURE_PARAM_ORDER.checkoutFormRetrieve[0]).toBe('paymentStatus');
    expect(SIGNATURE_PARAM_ORDER.refund).toEqual([
      'paymentId',
      'price',
      'currency',
      'conversationId',
    ]);
  });
});

describe('trailing-zero normalisation', () => {
  it('matches every case in the documented table', () => {
    const table: Array<[string, string]> = [
      ['10', '10'],
      ['10.0', '10'],
      ['10.5', '10.5'],
      ['10.50', '10.5'],
      ['10.510', '10.51'],
      ['10.5105', '10.5105'],
      ['10.51050', '10.5105'],
    ];
    for (const [input, want] of table) {
      expect(normalizeAmountForSignature(input)).toBe(want);
    }
  });

  it('agrees whether applied to raw text or a JSON-parsed number', () => {
    // Iyzico sends `price` as a JSON number, so "4000.00" arrives as 4000.
    // Signature validation only works because normalisation collapses both to
    // the same string. If this ever diverges, every signature check breaks.
    for (const raw of ['10.0', '10.50', '10.51050', '4000.00', '0.0']) {
      const parsed = (JSON.parse(`{"p":${raw}}`) as { p: number }).p;
      expect(normalizeAmountForSignature(parsed)).toBe(normalizeAmountForSignature(raw));
    }
  });
});

describe('request authorisation header', () => {
  it('is deterministic for a fixed random key', () => {
    const args = {
      apiKey: 'sandbox-apikey',
      secretKey: 'sandbox-secret',
      randomKey: '123456789',
      uriPath: '/payment/bin/check',
      requestBody: '{"locale":"tr"}',
    };
    expect(buildAuthorizationHeader(args)).toBe(buildAuthorizationHeader(args));
  });

  it('produces a decodable IYZWSv2 payload naming the api key and random key', () => {
    const header = buildAuthorizationHeader({
      apiKey: 'sandbox-apikey',
      secretKey: 'sandbox-secret',
      randomKey: '123456789',
      uriPath: '/payment/bin/check',
      requestBody: '{}',
    });
    expect(header.startsWith('IYZWSv2 ')).toBe(true);
    const decoded = Buffer.from(header.slice('IYZWSv2 '.length), 'base64').toString('utf8');
    expect(decoded).toContain('apiKey:sandbox-apikey');
    expect(decoded).toContain('randomKey:123456789');
    expect(decoded).toMatch(/&signature:[0-9a-f]{64}$/);
  });

  it('changes when the body changes — the signature covers the payload', () => {
    const base = {
      apiKey: 'k',
      secretKey: 's',
      randomKey: 'r',
      uriPath: '/payment/auth',
    };
    const a = buildAuthorizationHeader({ ...base, requestBody: '{"price":"10.0"}' });
    const b = buildAuthorizationHeader({ ...base, requestBody: '{"price":"10000.0"}' });
    expect(a).not.toBe(b);
  });

  it('changes when the path changes', () => {
    const base = { apiKey: 'k', secretKey: 's', randomKey: 'r', requestBody: '{}' };
    expect(buildAuthorizationHeader({ ...base, uriPath: '/payment/auth' })).not.toBe(
      buildAuthorizationHeader({ ...base, uriPath: '/payment/refund' }),
    );
  });
});

describe('webhook signature (X-IYZ-SIGNATURE-V3)', () => {
  const secretKey = 'sandbox-webhook-secret';

  const hpp = {
    paymentConversationId: 'offer:abc:1',
    token: 'tok_123',
    status: 'SUCCESS',
    iyziReferenceCode: 'ref-1',
    iyziEventType: 'CHECKOUT_FORM_AUTH',
    iyziEventTime: 1_700_000_000_000,
    iyziPaymentId: 24065106,
  };

  it('accepts a correctly signed Checkout Form notification', () => {
    const signature = signWebhookPayload(hpp, secretKey);
    expect(verifyWebhookSignature({ payload: hpp, signature, secretKey })).toBe(true);
  });

  it('rejects a forged signature', () => {
    expect(
      verifyWebhookSignature({ payload: hpp, signature: 'a'.repeat(64), secretKey }),
    ).toBe(false);
  });

  it('rejects a missing signature rather than defaulting to trust', () => {
    expect(verifyWebhookSignature({ payload: hpp, signature: null, secretKey })).toBe(false);
    expect(verifyWebhookSignature({ payload: hpp, signature: '', secretKey })).toBe(false);
  });

  it('rejects a payload whose status was flipped after signing', () => {
    const signature = signWebhookPayload(hpp, secretKey);
    const tampered = { ...hpp, status: 'SUCCESS_' };
    expect(verifyWebhookSignature({ payload: tampered, signature, secretKey })).toBe(false);
  });

  it('rejects a signature computed with a different secret', () => {
    const signature = signWebhookPayload(hpp, 'someone-elses-secret');
    expect(verifyWebhookSignature({ payload: hpp, signature, secretKey })).toBe(false);
  });

  it('distinguishes the Direct format from the HPP format', () => {
    const direct = {
      paymentConversationId: 'offer:abc:1',
      paymentId: 24065106,
      status: 'SUCCESS',
      iyziReferenceCode: 'ref-2',
      iyziEventType: 'THREE_DS_AUTH',
      iyziEventTime: 1_700_000_000_000,
    };
    const directSig = signWebhookPayload(direct, secretKey);
    expect(verifyWebhookSignature({ payload: direct, signature: directSig, secretKey })).toBe(true);
    // An HPP signature must not validate a Direct payload.
    expect(
      verifyWebhookSignature({ payload: direct, signature: signWebhookPayload(hpp, secretKey), secretKey }),
    ).toBe(false);
  });
});

describe('constant-time comparison', () => {
  it('matches identical strings and rejects everything else', () => {
    expect(safeEqualHex('abc123', 'abc123')).toBe(true);
    expect(safeEqualHex('abc123', 'abc124')).toBe(false);
    expect(safeEqualHex('abc', 'abcdef')).toBe(false);
    expect(safeEqualHex('', '')).toBe(true);
  });
});

describe('money conversion', () => {
  it('round-trips minor units through the wire format', () => {
    for (const minor of [1, 99, 100, 12_345, 400_000, 999_999, 100_000_000]) {
      expect(iyzicoAmountToMinor(minorToIyzicoAmount(minor))).toBe(minor);
    }
  });

  it('formats kuruş correctly, including the leading-zero case', () => {
    expect(minorToIyzicoAmount(400_000)).toBe('4000.0');
    expect(minorToIyzicoAmount(400_055)).toBe('4000.55');
    expect(minorToIyzicoAmount(400_005)).toBe('4000.05'); // not "4000.5"
    expect(minorToIyzicoAmount(5)).toBe('0.05');
  });

  it('rejects non-integer minor units instead of silently truncating', () => {
    expect(() => minorToIyzicoAmount(10.5)).toThrow();
    expect(() => minorToIyzicoAmount(-100)).toThrow();
  });

  it('does not lose a kuruş to float representation', () => {
    // 40.55 is 40.549999999999997 in IEEE 754; truncation would give 4054.
    expect(iyzicoAmountToMinor(40.55)).toBe(4055);
    expect(iyzicoAmountToMinor('1.1')).toBe(110);
    expect(iyzicoAmountToMinor(0.07)).toBe(7);
  });
});

describe('basket split', () => {
  it('produces item prices summing exactly to the basket total', () => {
    const milestones = [100_001, 100_000, 100_000, 99_999];
    const total = milestones.reduce((a, b) => a + b, 0);
    const items = buildSplit({ totalMinor: total, commissionBps: 1800, milestoneAmountsMinor: milestones });
    expect(items.reduce((a, i) => a + i.priceMinor, 0)).toBe(total);
  });

  it('never lets the coach net exceed the gross', () => {
    const items = buildSplit({
      totalMinor: 400_000,
      commissionBps: 1800,
      milestoneAmountsMinor: [100_000, 100_000, 100_000, 100_000],
    });
    for (const item of items) {
      expect(item.subMerchantPriceMinor).toBeLessThanOrEqual(item.priceMinor);
    }
    const net = items.reduce((a, i) => a + i.subMerchantPriceMinor, 0);
    expect(net).toBe(400_000 - 72_000); // 18% commission
  });

  it('rejects milestone amounts that do not reconcile to the total', () => {
    expect(() =>
      buildSplit({ totalMinor: 400_000, commissionBps: 1800, milestoneAmountsMinor: [100_000, 100_000] }),
    ).toThrow(/sum to 200000/);
  });

  it('handles zero commission', () => {
    const items = buildSplit({
      totalMinor: 1000,
      commissionBps: 0,
      milestoneAmountsMinor: [500, 500],
    });
    expect(items.every((i) => i.subMerchantPriceMinor === i.priceMinor)).toBe(true);
  });
});
