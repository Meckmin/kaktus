import { describe, expect, it } from 'vitest';
import { signWebhookPayload, type IyzicoWebhookPayload } from '@/lib/payments/iyzico/signature';

// provider.ts pulls in lib/env, which validates at import time and always wants
// a database URL. This suite never touches the database, so a placeholder does.
process.env.DATABASE_URL ??= 'postgresql://unused@localhost:5432/unused';
process.env.DIRECT_DATABASE_URL ??= process.env.DATABASE_URL;
const { MockPaymentProvider } = await import('@/lib/payments/provider');

// Must match scripts/simulate-payment.mjs's default when IYZICO_SECRET_KEY is unset.
const SECRET = process.env.IYZICO_SECRET_KEY ?? 'sandbox-test-secret-key';

const payload = {
  paymentConversationId: 'offer:test-offer:1',
  merchantId: '123456',
  token: 'mock_token_offer:test-offer:1',
  status: 'SUCCESS',
  iyziReferenceCode: 'ref-1',
  iyziEventType: 'CHECKOUT_FORM_AUTH',
  iyziEventTime: 1,
  iyziPaymentId: 24185078,
} as unknown as IyzicoWebhookPayload;

describe('MockPaymentProvider.verifyWebhook', () => {
  const provider = new MockPaymentProvider();
  const body = JSON.stringify(payload);

  it('accepts a webhook signed the way Iyzico signs it', () => {
    const signature = signWebhookPayload(payload, SECRET);
    expect(provider.verifyWebhook(body, { 'x-iyz-signature-v3': signature })).toBe(true);
  });

  it('rejects a forged signature', () => {
    expect(provider.verifyWebhook(body, { 'x-iyz-signature-v3': 'deadbeef'.repeat(8) })).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(provider.verifyWebhook(body, {})).toBe(false);
  });

  it('rejects a body altered after signing', () => {
    const signature = signWebhookPayload(payload, SECRET);
    const altered = JSON.stringify({ ...payload, status: 'FAILURE' });
    expect(provider.verifyWebhook(altered, { 'x-iyz-signature-v3': signature })).toBe(false);
  });
});

describe('MockPaymentProvider shared state', () => {
  it('lets a second instance retrieve a checkout the first one initialized', async () => {
    // Next gives server actions and route handlers separate module instances;
    // the webhook must still find the session "Ödemeyi yap" created.
    const conversationId = `offer:shared-${Date.now()}:1`;
    const init = await new MockPaymentProvider().initializeCheckout({
      conversationId,
      basketId: 'basket-1',
      totalMinor: 1000,
      currency: 'TRY',
      items: [{ id: 'm0', priceMinor: 1000, subMerchantPriceMinor: 820 }],
    } as never);
    expect(init.status).toBe('INITIALIZED');
    if (init.status !== 'INITIALIZED') return;

    const retrieved = await new MockPaymentProvider().retrieveCheckout(init.token);
    expect(retrieved.status).toBe('CAPTURED');
  });
});
