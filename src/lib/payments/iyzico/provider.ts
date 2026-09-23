import { IyzicoClient, IyzicoError, type IyzicoConfig, type IyzicoResponse } from './client';
import {
  SIGNATURE_PARAM_ORDER,
  verifyResponseSignature,
  verifyWebhookSignature,
  type IyzicoWebhookPayload,
} from './signature';
import { iyzicoAmountToMinor, minorToIyzicoAmount } from './money';
import type {
  ApproveItemInput,
  CheckoutInitInput,
  CheckoutInitResult,
  CheckoutRetrieveResult,
  ItemTransaction,
  PaymentProvider,
  ProviderActionResult,
  RefundItemInput,
  SubmerchantInput,
  SubmerchantResult,
} from '../provider';

const PATHS = {
  submerchantCreate: '/onboarding/submerchant',
  checkoutInitialize: '/payment/iyzipos/checkoutform/initialize/auth/ecom',
  checkoutRetrieve: '/payment/iyzipos/checkoutform/auth/ecom/detail',
  itemApprove: '/payment/iyzipos/item/approve',
  itemDisapprove: '/payment/iyzipos/item/disapprove',
  refund: '/payment/refund',
} as const;

/**
 * Iyzico Marketplace adapter, Checkout Form flow.
 *
 * Checkout Form over raw 3DS on purpose: Iyzico hosts the card fields, so card
 * data never reaches our servers and PCI scope collapses to SAQ-A. It also
 * handles 3DS, instalments, and bank-specific quirks that would otherwise be
 * ours to maintain. The cost is a redirect and a token round-trip, which the
 * offer flow absorbs easily.
 */
export class IyzicoPaymentProvider implements PaymentProvider {
  readonly name = 'iyzico';
  private readonly client: IyzicoClient;

  constructor(private readonly config: IyzicoConfig) {
    this.client = new IyzicoClient(config);
  }

  async createSubmerchant(input: SubmerchantInput): Promise<SubmerchantResult> {
    const body: Record<string, unknown> = {
      locale: 'tr',
      conversationId: input.externalId,
      subMerchantExternalId: input.externalId,
      subMerchantType: input.type,
      address: input.address,
      email: input.email,
      gsmNumber: input.gsmNumber,
      name: input.name,
      iban: input.iban,
      currency: input.currency,
    };

    // Iyzico requires different identity fields per sub-merchant type, and
    // sends an unhelpful generic error if you send the wrong one.
    if (input.type === 'PERSONAL') {
      body.identityNumber = input.identityNumber; // TCKN
      body.contactName = input.name.split(' ')[0];
      body.contactSurname = input.name.split(' ').slice(1).join(' ') || input.name;
    } else {
      body.taxNumber = input.identityNumber; // VKN
      body.taxOffice = input.taxOffice;
      body.legalCompanyTitle = input.legalCompanyTitle ?? input.name;
    }

    const { data } = await this.client.post(PATHS.submerchantCreate, body);
    if (data.status !== 'success') {
      throw new IyzicoError(
        `Sub-merchant creation failed: ${data.errorMessage ?? 'unknown'}`,
        'API',
        data.errorCode,
        200,
        data,
      );
    }

    const key = data.subMerchantKey as string | undefined;
    if (!key) {
      throw new IyzicoError('Sub-merchant response had no key', 'MALFORMED', undefined, 200, data);
    }
    return { submerchantKey: key };
  }

  async initializeCheckout(input: CheckoutInitInput): Promise<CheckoutInitResult> {
    const basketSum = input.items.reduce((a, i) => a + i.priceMinor, 0);
    if (basketSum !== input.totalMinor) {
      // Iyzico rejects this with a generic error; catching it here gives a
      // message that actually names the problem.
      throw new Error(
        `Basket items sum to ${basketSum} but total is ${input.totalMinor}. ` +
          'Iyzico requires price === Σ basketItems[].price exactly.',
      );
    }

    const body = {
      locale: 'tr',
      conversationId: input.conversationId,
      price: minorToIyzicoAmount(input.totalMinor),
      paidPrice: minorToIyzicoAmount(input.totalMinor),
      currency: input.currency,
      basketId: input.basketId,
      paymentGroup: 'PRODUCT',
      callbackUrl: input.callbackUrl,
      ...(input.enabledInstallments?.length
        ? { enabledInstallments: input.enabledInstallments }
        : {}),
      buyer: {
        id: input.buyer.id,
        name: input.buyer.name,
        surname: input.buyer.surname,
        identityNumber: input.buyer.identityNumber,
        email: input.buyer.email,
        gsmNumber: input.buyer.gsmNumber,
        registrationAddress: input.buyer.address,
        city: input.buyer.city,
        country: input.buyer.country,
        zipCode: input.buyer.zipCode,
        ip: input.buyer.ip,
      },
      // Coaching is a service: VIRTUAL items, so no shipping address is
      // required. Sending a shipping address for virtual goods is a common
      // source of confusing validation errors.
      billingAddress: {
        contactName: `${input.buyer.name} ${input.buyer.surname}`,
        city: input.buyer.city,
        country: input.buyer.country,
        address: input.buyer.address,
        zipCode: input.buyer.zipCode,
      },
      basketItems: input.items.map((item) => ({
        id: item.id,
        name: item.name,
        category1: item.category,
        itemType: 'VIRTUAL',
        price: minorToIyzicoAmount(item.priceMinor),
        subMerchantKey: input.submerchantKey,
        subMerchantPrice: minorToIyzicoAmount(item.subMerchantPriceMinor),
      })),
    };

    const { data } = await this.client.post(PATHS.checkoutInitialize, body);

    if (data.status !== 'success') {
      return {
        status: 'FAILED',
        errorCode: data.errorCode,
        message: data.errorMessage ?? 'Checkout initialisation failed',
      };
    }

    this.assertSignature(SIGNATURE_PARAM_ORDER.checkoutFormInitialize, data, 'checkout initialize');

    return {
      status: 'INITIALIZED',
      token: data.token as string,
      checkoutFormContent: data.checkoutFormContent as string,
      paymentPageUrl: data.paymentPageUrl as string | undefined,
      tokenExpireTime: data.tokenExpireTime as number | undefined,
    };
  }

  /**
   * Reads the true outcome of a checkout session.
   *
   * This is the authoritative source, not the browser callback and not the
   * webhook. Both of those merely *tell us to look*; neither is trusted to
   * carry the amount or the status, because a browser POST is attacker-
   * controlled and a webhook can arrive out of order.
   */
  async retrieveCheckout(token: string): Promise<CheckoutRetrieveResult> {
    const { data } = await this.client.post(PATHS.checkoutRetrieve, {
      locale: 'tr',
      token,
    });

    if (data.status !== 'success') {
      return {
        status: 'FAILED',
        errorCode: data.errorCode,
        message: data.errorMessage ?? 'Checkout retrieve failed',
        conversationId: data.conversationId,
      };
    }

    const paymentStatus = String(data.paymentStatus ?? '');
    if (paymentStatus !== 'SUCCESS') {
      // INIT_THREEDS / CALLBACK_THREEDS / PENDING_CREDIT etc. The user has not
      // finished, or the payment failed at the bank. Neither is our error.
      return {
        status: paymentStatus === 'FAILURE' ? 'FAILED' : 'PENDING',
        paymentStatus,
        message: (data.errorMessage as string) ?? paymentStatus,
        conversationId: data.conversationId,
      } as CheckoutRetrieveResult;
    }

    const signature = verifyResponseSignature({
      order: SIGNATURE_PARAM_ORDER.checkoutFormRetrieve,
      response: data,
      secretKey: this.config.secretKey,
    });
    this.assertSignature(SIGNATURE_PARAM_ORDER.checkoutFormRetrieve, data, 'checkout retrieve');

    const itemTransactions = parseItemTransactions(data);
    if (itemTransactions.length === 0) {
      throw new IyzicoError(
        'Captured payment returned no itemTransactions; cannot map milestones',
        'MALFORMED',
        undefined,
        200,
        data,
      );
    }

    return {
      status: 'CAPTURED',
      paymentId: String(data.paymentId),
      conversationId: String(data.conversationId ?? ''),
      basketId: String(data.basketId ?? ''),
      priceMinor: iyzicoAmountToMinor(data.price as number),
      paidPriceMinor: iyzicoAmountToMinor(data.paidPrice as number),
      currency: String(data.currency ?? 'TRY'),
      fraudStatus: Number(data.fraudStatus ?? 1),
      itemTransactions,
      signatureVerified: signature.valid,
    };
  }

  /** Releases one milestone. This call IS the escrow release. */
  async approveItem(input: ApproveItemInput): Promise<ProviderActionResult> {
    return this.action(PATHS.itemApprove, {
      locale: 'tr',
      conversationId: input.conversationId,
      paymentTransactionId: input.paymentTransactionId,
    });
  }

  async refundItem(input: RefundItemInput): Promise<ProviderActionResult> {
    return this.action(PATHS.refund, {
      locale: 'tr',
      conversationId: input.conversationId,
      paymentTransactionId: input.paymentTransactionId,
      price: minorToIyzicoAmount(input.priceMinor),
      currency: input.currency,
      ip: input.ip,
    });
  }

  private async action(
    path: string,
    body: Record<string, unknown>,
  ): Promise<ProviderActionResult> {
    try {
      const { data } = await this.client.post(path, body);
      if (data.status === 'success') {
        return { ok: true, providerRef: String(data.paymentTransactionId ?? data.paymentId ?? '') };
      }
      return {
        ok: false,
        errorCode: data.errorCode,
        message: data.errorMessage ?? 'Request failed',
        // Iyzico marks some failures explicitly retryable; everything else is
        // a business rejection that will fail identically forever.
        retryable: data.retryable === true,
      };
    } catch (error) {
      if (error instanceof IyzicoError) {
        return { ok: false, errorCode: error.errorCode, message: error.message, retryable: error.retryable };
      }
      throw error;
    }
  }

  verifyWebhook(rawBody: string, headers: Record<string, string>): boolean {
    const signature =
      headers['x-iyz-signature-v3'] ??
      headers['X-IYZ-SIGNATURE-V3'] ??
      headers['x-iyz-signature-v3'.toUpperCase()];

    let payload: IyzicoWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as IyzicoWebhookPayload;
    } catch {
      return false;
    }

    return verifyWebhookSignature({
      payload,
      signature,
      secretKey: this.config.secretKey,
    });
  }

  /**
   * In production an unsigned or mis-signed response is refused. In sandbox the
   * signature feature may not be enabled on the account, so an absent signature
   * is tolerated — but a *present and wrong* one is always fatal, in every
   * environment, because that is the shape of an actual attack.
   */
  private assertSignature(
    order: readonly string[],
    data: IyzicoResponse,
    label: string,
  ): void {
    const result = verifyResponseSignature({
      order,
      response: data,
      secretKey: this.config.secretKey,
    });

    if (result.present && !result.valid) {
      throw new IyzicoError(
        `Response signature mismatch on ${label} — refusing to trust this response`,
        'SIGNATURE',
        undefined,
        200,
      );
    }
    if (!result.present && this.config.requireSignature) {
      throw new IyzicoError(
        `Response signature missing on ${label} and requireSignature is enabled`,
        'SIGNATURE',
        undefined,
        200,
      );
    }
  }
}

function parseItemTransactions(data: IyzicoResponse): ItemTransaction[] {
  const raw = data.itemTransactions;
  if (!Array.isArray(raw)) return [];
  return raw.map((t: Record<string, unknown>) => ({
    itemId: String(t.itemId),
    paymentTransactionId: String(t.paymentTransactionId),
    priceMinor: iyzicoAmountToMinor(t.price as number),
    paidPriceMinor: iyzicoAmountToMinor(t.paidPrice as number),
    subMerchantPriceMinor: iyzicoAmountToMinor((t.subMerchantPrice ?? 0) as number),
    transactionStatus: Number(t.transactionStatus ?? 1),
  }));
}
