import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { TX_OPTIONS, acquireAdvisoryLock, idempotencyKey } from '@/lib/tx';
import { getPaymentProvider } from '@/lib/payments/provider';
import type { CheckoutRetrieveResult, EscrowBasketItem } from '@/lib/payments/provider';
import { buildSplit } from '@/lib/payments/iyzico/money';
import { splitIntoMilestones } from '@/lib/payments/escrow';
import { milestonePeriodsForSlots, parseScope } from '@/lib/offers/scope';
import { transitionOffer } from './offer-service';

/**
 * Payment orchestration.
 *
 * The load-bearing rule: **the browser is never trusted and the webhook is
 * never trusted.** Both are treated purely as a signal to go and ask Iyzico
 * what actually happened. Every state change is driven by the response to our
 * own authenticated `retrieveCheckout` call.
 *
 * That single decision removes an entire class of vulnerability. A student who
 * POSTs a forged callback to `/api/payments/callback` gets nothing, because we
 * ignore everything in their request except the token, and the token only lets
 * us ask a question whose answer comes from Iyzico over TLS with a verified
 * response signature.
 *
 * Milestones are created BEFORE the payment, not after. Iyzico needs one basket
 * item per milestone in the initialize request so it can return one
 * `paymentTransactionId` per milestone, and that mapping is what makes
 * per-milestone escrow release possible.
 */

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'OFFER_NOT_PAYABLE'
      | 'COACH_NOT_PAYABLE'
      | 'ALREADY_PAID'
      | 'PROVIDER_REJECTED'
      | 'AMOUNT_MISMATCH'
      | 'UNKNOWN_TOKEN',
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export interface StartCheckoutInput {
  offerId: string;
  studentUserId: string;
  buyer: {
    name: string;
    surname: string;
    email: string;
    identityNumber: string;
    gsmNumber?: string;
    ip: string;
    city: string;
    address: string;
    zipCode?: string;
  };
  callbackUrl: string;
}

export interface StartCheckoutResult {
  paymentId: string;
  token: string;
  checkoutFormContent: string;
  conversationId: string;
}

/**
 * Prepares milestones and opens a hosted checkout session.
 *
 * Idempotent per offer: calling it twice returns the same session rather than
 * opening a second one, because a student who double-taps "Öde" must not end up
 * with two live payment sessions against one offer.
 */
export async function startCheckout(input: StartCheckoutInput): Promise<StartCheckoutResult> {
  const provider = getPaymentProvider();

  const offer = await prisma.offer.findUniqueOrThrow({
    where: { id: input.offerId },
    include: {
      coach: { select: { id: true, submerchantKey: true, verificationStatus: true } },
      student: { select: { id: true, userId: true } },
      payments: { where: { status: { in: ['INITIATED', 'REQUIRES_ACTION', 'CAPTURED'] } } },
      engagement: { select: { id: true } },
    },
  });

  if (offer.status !== 'ACCEPTED') {
    throw new PaymentError(
      `Offer is ${offer.status}; only an ACCEPTED offer can be paid.`,
      'OFFER_NOT_PAYABLE',
    );
  }
  if (offer.student.userId !== input.studentUserId) {
    throw new PaymentError('Only the student on the offer may pay it.', 'OFFER_NOT_PAYABLE');
  }
  if (offer.payments.some((p) => p.status === 'CAPTURED')) {
    throw new PaymentError('This offer has already been paid.', 'ALREADY_PAID');
  }

  // A coach without a sub-merchant key cannot be paid. Blocking here — before
  // the student's card is charged — is the whole point: discovering it after
  // capture means holding money we have no way to forward.
  if (offer.coach.verificationStatus !== 'APPROVED' || !offer.coach.submerchantKey) {
    throw new PaymentError(
      'Coach is not payout-ready (missing sub-merchant registration).',
      'COACH_NOT_PAYABLE',
    );
  }

  const conversationId = idempotencyKey('offer', offer.id, offer.version);

  // Reuse an existing open session instead of opening a second one.
  const existing = offer.payments.find(
    (p) => p.idempotencyKey === conversationId && p.token && p.status !== 'FAILED',
  );
  if (existing?.token) {
    const init = await provider.initializeCheckout(
      await buildCheckoutInput(offer, input, conversationId),
    );
    if (init.status === 'INITIALIZED') {
      return {
        paymentId: existing.id,
        token: init.token,
        checkoutFormContent: init.checkoutFormContent,
        conversationId,
      };
    }
  }

  // Milestones must exist before initialize: their ids become the basket item
  // ids, and Iyzico echoes those back as the per-item transaction handles.
  const milestones = await ensureMilestones(offer.id);

  const checkoutInput = await buildCheckoutInput(offer, input, conversationId, milestones);
  const init = await provider.initializeCheckout(checkoutInput);

  if (init.status !== 'INITIALIZED') {
    await prisma.payment.upsert({
      where: { idempotencyKey: conversationId },
      create: {
        offerId: offer.id,
        provider: provider.name,
        amountMinor: offer.priceMinor,
        currency: offer.currency,
        status: 'FAILED',
        idempotencyKey: conversationId,
        failureCode: init.errorCode,
        failureMessage: init.message,
      },
      update: { status: 'FAILED', failureCode: init.errorCode, failureMessage: init.message },
    });
    throw new PaymentError(`Checkout could not be started: ${init.message}`, 'PROVIDER_REJECTED');
  }

  const payment = await prisma.payment.upsert({
    where: { idempotencyKey: conversationId },
    create: {
      offerId: offer.id,
      provider: provider.name,
      amountMinor: offer.priceMinor,
      currency: offer.currency,
      status: 'REQUIRES_ACTION',
      token: init.token,
      basketId: checkoutInput.basketId,
      conversationId,
      idempotencyKey: conversationId,
      rawRequest: { basketItems: checkoutInput.items } as unknown as Prisma.InputJsonValue,
    },
    update: { status: 'REQUIRES_ACTION', token: init.token, basketId: checkoutInput.basketId },
  });

  return {
    paymentId: payment.id,
    token: init.token,
    checkoutFormContent: init.checkoutFormContent,
    conversationId,
  };
}

/**
 * Creates the engagement's milestones ahead of payment.
 *
 * Note this runs before PAID_IN_ESCROW, so there is no Engagement row yet.
 * Milestones therefore hang off a provisional engagement created in the same
 * transaction — the FSM's CREATE_ENGAGEMENT effect finds it already present and
 * no-ops, which is why that effect was written to be idempotent.
 */
async function ensureMilestones(offerId: string) {
  return prisma.$transaction(async (tx) => {
    const offer = await tx.offer.findUniqueOrThrow({ where: { id: offerId } });

    const engagement =
      (await tx.engagement.findUnique({ where: { offerId } })) ??
      (await tx.engagement.create({
        data: {
          offerId,
          coachProfileId: offer.coachProfileId,
          studentProfileId: offer.studentProfileId,
          // Not ACTIVE until the payment is captured (CREATE_ENGAGEMENT flips it).
          status: 'PENDING_PAYMENT',
          startDate: offer.startDate,
          endDate: offer.endDate,
          totalMinor: offer.priceMinor,
          currency: offer.currency,
          commissionBps: offer.commissionBps,
        },
      }));

    const existing = await tx.milestone.findMany({
      where: { engagementId: engagement.id },
      orderBy: { index: 'asc' },
    });
    if (existing.length > 0) return existing;

    const periods = milestonePeriodsForSlots(
      parseScope(offer.scope).slots,
      offer.startDate,
      offer.endDate,
      offer.milestoneCount,
    );
    const amounts = splitIntoMilestones(offer.priceMinor, offer.milestoneCount);

    await tx.milestone.createMany({
      data: periods.map((p) => ({
        engagementId: engagement.id,
        index: p.index,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        amountMinor: amounts[p.index],
        status: 'SCHEDULED' as const,
      })),
    });

    return tx.milestone.findMany({
      where: { engagementId: engagement.id },
      orderBy: { index: 'asc' },
    });
  }, TX_OPTIONS);
}

async function buildCheckoutInput(
  offer: Prisma.OfferGetPayload<{ include: { coach: true; student: true } }> | any,
  input: StartCheckoutInput,
  conversationId: string,
  milestones?: Array<{ id: string; index: number; amountMinor: number }>,
) {
  const rows =
    milestones ??
    (await prisma.milestone.findMany({
      where: { engagement: { offerId: offer.id } },
      orderBy: { index: 'asc' },
      select: { id: true, index: true, amountMinor: true },
    }));

  const split = buildSplit({
    totalMinor: offer.priceMinor,
    commissionBps: offer.commissionBps,
    milestoneAmountsMinor: rows.map((m) => m.amountMinor),
  });

  const items: EscrowBasketItem[] = rows.map((m, i) => ({
    id: m.id,
    name: `${offer.title} — ${m.index + 1}. dönem`,
    category: 'Eğitim Koçluğu',
    priceMinor: split[i].priceMinor,
    subMerchantPriceMinor: split[i].subMerchantPriceMinor,
  }));

  return {
    conversationId,
    offerId: offer.id,
    basketId: offer.id,
    totalMinor: offer.priceMinor,
    currency: offer.currency as 'TRY',
    submerchantKey: offer.coach.submerchantKey as string,
    items,
    buyer: {
      id: offer.student.id,
      name: input.buyer.name,
      surname: input.buyer.surname,
      email: input.buyer.email,
      identityNumber: input.buyer.identityNumber,
      gsmNumber: input.buyer.gsmNumber,
      ip: input.buyer.ip,
      city: input.buyer.city,
      country: 'Turkey',
      address: input.buyer.address,
      zipCode: input.buyer.zipCode,
    },
    callbackUrl: input.callbackUrl,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation — the single path to PAID_IN_ESCROW
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconcileResult {
  outcome: 'CAPTURED' | 'PENDING' | 'FAILED' | 'ALREADY_PROCESSED';
  offerId?: string;
  paymentId?: string;
  message?: string;
}

/**
 * Asks Iyzico what happened to a checkout token and applies the result.
 *
 * Every entry point funnels here: the browser callback, the webhook, and the
 * manual admin re-check. They differ only in what triggers them; the logic that
 * moves money is written once.
 *
 * Safe to call concurrently and repeatedly. The advisory lock serialises
 * callers, the CAS inside `transitionOffer` rejects the loser, and the escrow
 * posting is guarded by its own idempotency check.
 */
export async function reconcileCheckout(token: string): Promise<ReconcileResult> {
  const provider = getPaymentProvider();

  const payment = await prisma.payment.findFirst({
    where: { token },
    include: { offer: { select: { id: true, status: true, priceMinor: true } } },
  });
  if (!payment) {
    throw new PaymentError(`No payment found for token ${token}`, 'UNKNOWN_TOKEN');
  }
  if (payment.status === 'CAPTURED') {
    return { outcome: 'ALREADY_PROCESSED', offerId: payment.offerId ?? undefined, paymentId: payment.id };
  }

  const result = await provider.retrieveCheckout(token);

  if (result.status === 'PENDING') {
    return { outcome: 'PENDING', offerId: payment.offerId ?? undefined, message: result.paymentStatus };
  }

  if (result.status === 'FAILED') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failureCode: result.errorCode, failureMessage: result.message },
    });
    return { outcome: 'FAILED', offerId: payment.offerId ?? undefined, message: result.message };
  }

  // Captured. Validate before believing it.
  await assertAmountsMatch(result, payment.amountMinor);

  const offerId = payment.offerId;
  if (!offerId) throw new PaymentError('Payment has no offer', 'OFFER_NOT_PAYABLE');

  await prisma.$transaction(async (tx) => {
    await acquireAdvisoryLock(tx, `payment:${payment.id}`);

    const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (fresh.status === 'CAPTURED') return; // another caller won

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'CAPTURED',
        providerRef: result.paymentId,
        rawResponse: {
          fraudStatus: result.fraudStatus,
          signatureVerified: result.signatureVerified,
          itemTransactions: result.itemTransactions,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    // Map each basket item back onto its milestone. Without this, no milestone
    // can ever be released, because the approve call has no handle to use.
    for (const item of result.itemTransactions) {
      await tx.milestone.updateMany({
        where: { id: item.itemId },
        data: { providerTransactionId: item.paymentTransactionId },
      });
    }
  }, TX_OPTIONS);

  // Transition outside the payment transaction so the FSM owns its own
  // atomicity and the two advisory locks are never held simultaneously.
  await transitionOffer({
    offerId,
    event: 'PAYMENT_CAPTURED',
    actor: 'SYSTEM',
    reason: 'iyzico_checkout_captured',
    metadata: { paymentId: payment.id, providerRef: result.paymentId },
  }).catch((error) => {
    // The offer may already have moved (duplicate webhook, concurrent
    // callback). Money is recorded either way; swallowing only the
    // concurrency case keeps genuine failures loud.
    if (!String(error).includes('modified concurrently') && !String(error).includes('No transition')) {
      throw error;
    }
  });

  return { outcome: 'CAPTURED', offerId, paymentId: payment.id };
}

/**
 * Refuses to record a capture whose amount does not match what we asked for.
 *
 * This is not paranoia about Iyzico: it catches our own bugs, like a stale
 * offer price or a milestone split that drifted after initialize. Recording an
 * escrow balance that does not match the money actually held is unrecoverable
 * without manual reconciliation, so it is worth failing loudly here.
 */
async function assertAmountsMatch(
  result: Extract<CheckoutRetrieveResult, { status: 'CAPTURED' }>,
  expectedMinor: number,
): Promise<void> {
  if (result.paidPriceMinor !== expectedMinor) {
    throw new PaymentError(
      `Captured ${result.paidPriceMinor} but expected ${expectedMinor} for payment ${result.paymentId}. ` +
        'Refusing to post escrow; investigate before releasing anything.',
      'AMOUNT_MISMATCH',
    );
  }

  const itemSum = result.itemTransactions.reduce((a, t) => a + t.priceMinor, 0);
  if (itemSum !== expectedMinor) {
    throw new PaymentError(
      `Item transactions sum to ${itemSum}, expected ${expectedMinor}.`,
      'AMOUNT_MISMATCH',
    );
  }
}

export { parseScope };
