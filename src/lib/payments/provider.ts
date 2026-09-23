/**
 * Payment provider abstraction.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DESIGN CORRECTION vs. the original escrow sketch
 * ─────────────────────────────────────────────────────────────────────────────
 * The first version of this interface assumed we would capture funds, hold them
 * ourselves, and later instruct a payout. Reading Iyzico's marketplace contract
 * changes that in two ways that ripple through the whole money layer:
 *
 * 1. **Iyzico is the escrow agent, not us.** In the marketplace model funds are
 *    held by Iyzico after capture and released to the sub-merchant only when we
 *    call `/payment/iyzipos/item/approve`. Approving *is* the escrow release.
 *    We never touch the money, which is exactly what we want: holding customer
 *    funds in our own account would likely make us a payment institution under
 *    Turkish law 6493, with the licensing burden that implies.
 *
 * 2. **The unit of release is the basket item, not the payment.** Approve and
 *    refund both operate on a `paymentTransactionId` — one per basket item —
 *    not on the payment as a whole. Since our unit of release is the milestone,
 *    **we send one basket item per milestone** and record each returned
 *    `paymentTransactionId` on its milestone. Releasing milestone 2 is then
 *    approving item 2. Had we sent a single basket line for the whole
 *    engagement, per-milestone release would have been impossible without
 *    partial refunds and manual reconciliation.
 *
 * Consequence for the payout worker: under this model Iyzico settles to the
 * coach's sub-merchant account directly. Our `Payout` rows become a
 * reconciliation record of what Iyzico is settling, not an instruction we
 * issue. `runPayoutBatch` is therefore disabled for the Iyzico provider; see
 * the comment in jobs/workers.ts.
 */

import { env } from '@/lib/env';

export type Currency = 'TRY';

// ─────────────────────────────────────────────────────────────────────────────
// Sub-merchant onboarding
// ─────────────────────────────────────────────────────────────────────────────

export interface SubmerchantInput {
  coachProfileId: string;
  /** Our own id for the sub-merchant; Iyzico echoes it back on payments. */
  externalId: string;
  type: 'PERSONAL' | 'PRIVATE_COMPANY' | 'LIMITED_COMPANY';
  name: string;
  email: string;
  gsmNumber: string;
  address: string;
  /** TCKN for PERSONAL, VKN otherwise. */
  identityNumber: string;
  legalCompanyTitle?: string;
  taxOffice?: string;
  iban: string;
  currency: Currency;
}

export interface SubmerchantResult {
  submerchantKey: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout
// ─────────────────────────────────────────────────────────────────────────────

/** One basket line per milestone. See the design note above. */
export interface EscrowBasketItem {
  /** Our milestone id. Comes back as `itemTransactions[].itemId`. */
  id: string;
  name: string;
  category: string;
  priceMinor: number;
  /** Amount owed to the coach for this milestone, net of our commission. */
  subMerchantPriceMinor: number;
}

export interface CheckoutInitInput {
  /** Our idempotency key; also sent as Iyzico's conversationId. */
  conversationId: string;
  offerId: string;
  basketId: string;
  totalMinor: number;
  currency: Currency;
  submerchantKey: string;
  items: EscrowBasketItem[];
  buyer: {
    id: string;
    name: string;
    surname: string;
    email: string;
    identityNumber: string;
    gsmNumber?: string;
    ip: string;
    city: string;
    country: string;
    address: string;
    zipCode?: string;
  };
  callbackUrl: string;
  enabledInstallments?: number[];
}

export type CheckoutInitResult =
  | {
      status: 'INITIALIZED';
      token: string;
      /** Script tag to inject; renders Iyzico's hosted form. */
      checkoutFormContent: string;
      paymentPageUrl?: string;
      tokenExpireTime?: number;
    }
  | { status: 'FAILED'; errorCode?: string; message: string };

export interface ItemTransaction {
  /** Our milestone id, echoed back. */
  itemId: string;
  /** The handle for approve and refund. Persist this on the milestone. */
  paymentTransactionId: string;
  priceMinor: number;
  paidPriceMinor: number;
  subMerchantPriceMinor: number;
  /** 0 = fraud check, -1 = rejected, 1 = awaiting our approval, 2 = approved. */
  transactionStatus: number;
}

export type CheckoutRetrieveResult =
  | {
      status: 'CAPTURED';
      paymentId: string;
      conversationId: string;
      basketId: string;
      priceMinor: number;
      paidPriceMinor: number;
      currency: string;
      /** 1 = approved, 0 = under review, -1 = rejected. */
      fraudStatus: number;
      itemTransactions: ItemTransaction[];
      signatureVerified: boolean;
    }
  | { status: 'PENDING'; paymentStatus: string; conversationId?: string }
  | { status: 'FAILED'; errorCode?: string; message: string; conversationId?: string };

// ─────────────────────────────────────────────────────────────────────────────
// Release and refund
// ─────────────────────────────────────────────────────────────────────────────

export interface ApproveItemInput {
  paymentTransactionId: string;
  conversationId: string;
}

export interface RefundItemInput {
  paymentTransactionId: string;
  priceMinor: number;
  currency: Currency;
  conversationId: string;
  ip: string;
}

export type ProviderActionResult =
  | { ok: true; providerRef?: string }
  | { ok: false; errorCode?: string; message: string; retryable: boolean };

export interface PaymentProvider {
  readonly name: string;
  createSubmerchant(input: SubmerchantInput): Promise<SubmerchantResult>;
  initializeCheckout(input: CheckoutInitInput): Promise<CheckoutInitResult>;
  /** Idempotent; safe to call repeatedly for the same token. */
  retrieveCheckout(token: string): Promise<CheckoutRetrieveResult>;
  /** Releases one milestone's funds to the coach. */
  approveItem(input: ApproveItemInput): Promise<ProviderActionResult>;
  refundItem(input: RefundItemInput): Promise<ProviderActionResult>;
  verifyWebhook(rawBody: string, headers: Record<string, string>): boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock provider — tests, seeds, local development
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic in-memory provider.
 *
 * Models the parts of Iyzico's behaviour that our code actually depends on:
 * tokens, per-item transaction ids, approve-before-payout, and refund only on
 * unapproved items. It does NOT model 3DS, fraud review, or their retry
 * semantics — see LOCAL_PAYMENTS.md for what still needs sandbox testing.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  private readonly sessions = new Map<
    string,
    { input: CheckoutInitInput; paymentId: string; items: ItemTransaction[] }
  >();
  private readonly approved = new Set<string>();
  private readonly refunded = new Map<string, number>();

  async createSubmerchant(input: SubmerchantInput): Promise<SubmerchantResult> {
    return { submerchantKey: `mock_sub_${input.coachProfileId}` };
  }

  async initializeCheckout(input: CheckoutInitInput): Promise<CheckoutInitResult> {
    const sum = input.items.reduce((a, i) => a + i.priceMinor, 0);
    if (sum !== input.totalMinor) {
      // Iyzico rejects this too; failing here keeps the bug local.
      return {
        status: 'FAILED',
        errorCode: 'MOCK_BASKET_MISMATCH',
        message: `Basket items sum to ${sum}, expected ${input.totalMinor}`,
      };
    }

    const token = `mock_token_${input.conversationId}`;
    const paymentId = `mock_pay_${input.conversationId.slice(-12)}`;

    if (!this.sessions.has(token)) {
      this.sessions.set(token, {
        input,
        paymentId,
        items: input.items.map((item, index) => ({
          itemId: item.id,
          paymentTransactionId: `mock_ptx_${paymentId}_${index}`,
          priceMinor: item.priceMinor,
          paidPriceMinor: item.priceMinor,
          subMerchantPriceMinor: item.subMerchantPriceMinor,
          transactionStatus: 1,
        })),
      });
    }

    return {
      status: 'INITIALIZED',
      token,
      checkoutFormContent: `<script>/* mock checkout form for ${token} */</script>`,
      tokenExpireTime: 1800,
    };
  }

  async retrieveCheckout(token: string): Promise<CheckoutRetrieveResult> {
    const session = this.sessions.get(token);
    if (!session) {
      return { status: 'FAILED', errorCode: 'MOCK_UNKNOWN_TOKEN', message: 'No such token' };
    }
    return {
      status: 'CAPTURED',
      paymentId: session.paymentId,
      conversationId: session.input.conversationId,
      basketId: session.input.basketId,
      priceMinor: session.input.totalMinor,
      paidPriceMinor: session.input.totalMinor,
      currency: session.input.currency,
      fraudStatus: 1,
      itemTransactions: session.items,
      signatureVerified: true,
    };
  }

  async approveItem(input: ApproveItemInput): Promise<ProviderActionResult> {
    this.approved.add(input.paymentTransactionId);
    return { ok: true, providerRef: `mock_approve_${input.paymentTransactionId}` };
  }

  async refundItem(input: RefundItemInput): Promise<ProviderActionResult> {
    if (this.approved.has(input.paymentTransactionId)) {
      // Matches Iyzico: approved funds have left the pool and cannot be
      // refunded through this path. Our design never refunds a released
      // milestone, so hitting this in a test is a real bug, not mock noise.
      return {
        ok: false,
        errorCode: 'MOCK_ALREADY_APPROVED',
        message: 'Cannot refund an approved item',
        retryable: false,
      };
    }
    const already = this.refunded.get(input.paymentTransactionId) ?? 0;
    this.refunded.set(input.paymentTransactionId, already + input.priceMinor);
    return { ok: true, providerRef: `mock_refund_${input.paymentTransactionId}` };
  }

  verifyWebhook(): boolean {
    return true;
  }

  /** Test helper. */
  isApproved(paymentTransactionId: string): boolean {
    return this.approved.has(paymentTransactionId);
  }
}

let cached: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;

  if (env.PAYMENT_PROVIDER === 'iyzico') {
    // Imported lazily so the mock path never pulls in the Iyzico client, and so
    // a missing credential cannot break tests that do not touch payments.
    const { IyzicoPaymentProvider } = require('./iyzico/provider') as typeof import('./iyzico/provider');
    cached = new IyzicoPaymentProvider({
      apiKey: requireEnv('IYZICO_API_KEY', env.IYZICO_API_KEY),
      secretKey: requireEnv('IYZICO_SECRET_KEY', env.IYZICO_SECRET_KEY),
      baseUrl: env.IYZICO_BASE_URL,
      requireSignature: env.NODE_ENV === 'production',
    });
    return cached;
  }

  cached = new MockPaymentProvider();
  return cached;
}

/** Test seam. */
export function setPaymentProvider(provider: PaymentProvider | null): void {
  cached = provider;
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
