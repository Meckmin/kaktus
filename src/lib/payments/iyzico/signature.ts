import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizeAmountForSignature } from './money';

/**
 * Iyzico cryptography: request authorisation and every flavour of signature
 * verification.
 *
 * Three separate mechanisms, easy to confuse, and confusing them means either
 * failing every request or — worse — accepting forged payment notifications:
 *
 *  1. **Request auth** (`Authorization: IYZWSv2 …`) — proves *we* are us.
 *  2. **Response signature** (`signature` field) — proves the API response we
 *     just received was not tampered with in transit.
 *  3. **Webhook signature** (`X-IYZ-SIGNATURE-V3` header) — proves an inbound
 *     server-to-server notification actually came from Iyzico.
 *
 * All three are HMAC-SHA256 with the merchant secret key, but the message
 * construction differs for each, and (2) and (3) differ again by endpoint.
 *
 * Verified against Iyzico's published worked example; see tests/iyzico.test.ts.
 * SHA1 auth (`IYZWS`) was retired in 2024 and is deliberately not implemented.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Request authorisation
// ─────────────────────────────────────────────────────────────────────────────

export function generateRandomKey(): string {
  return `${Date.now()}${randomBytes(4).readUInt32BE(0)}`;
}

/**
 * Builds the `Authorization` header value.
 *
 *   signature = HMACSHA256(randomKey + uriPath + requestBody, secretKey)  [hex]
 *   header    = "IYZWSv2 " + base64("apiKey:…&randomKey:…&signature:…")
 *
 * `uriPath` is the path only — no host, no query string. `requestBody` must be
 * the exact bytes that get sent: serialising the object once for the signature
 * and again for the request is the classic way to produce a signature that does
 * not match its own body, so callers pass one string and send that same string.
 */
export function buildAuthorizationHeader(args: {
  apiKey: string;
  secretKey: string;
  randomKey: string;
  uriPath: string;
  requestBody: string;
}): string {
  const payload = args.randomKey + args.uriPath + args.requestBody;
  const signature = createHmac('sha256', args.secretKey).update(payload, 'utf8').digest('hex');
  const authorization = `apiKey:${args.apiKey}&randomKey:${args.randomKey}&signature:${signature}`;
  return `IYZWSv2 ${Buffer.from(authorization, 'utf8').toString('base64')}`;
}

/** Convenience: the full header set for an authenticated request. */
export function buildAuthHeaders(args: {
  apiKey: string;
  secretKey: string;
  uriPath: string;
  requestBody: string;
  randomKey?: string;
}): Record<string, string> {
  const randomKey = args.randomKey ?? generateRandomKey();
  return {
    Authorization: buildAuthorizationHeader({ ...args, randomKey }),
    'x-iyzi-rnd': randomKey,
    'Content-Type': 'application/json',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 & 3. Signature verification
// ─────────────────────────────────────────────────────────────────────────────

/** Constant-time compare. A plain `===` on a signature leaks timing. */
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Response signature: HMAC over the endpoint's ordered parameters joined by ":".
 * Amount-bearing parameters must be trailing-zero normalised first.
 */
export function computeResponseSignature(
  params: Array<string | number>,
  secretKey: string,
): string {
  const data = params.map((p) => String(p ?? '')).join(':');
  return createHmac('sha256', secretKey).update(data, 'utf8').digest('hex');
}

/**
 * Parameter orders, per endpoint, from Iyzico's response-signature spec.
 *
 * These are not interchangeable and there is no way to derive one from another.
 * A wrong order produces a mismatch indistinguishable from an attack, so they
 * are centralised here next to the endpoint each belongs to.
 */
export const SIGNATURE_PARAM_ORDER = {
  checkoutFormInitialize: ['conversationId', 'token'],
  checkoutFormRetrieve: [
    'paymentStatus',
    'paymentId',
    'currency',
    'basketId',
    'conversationId',
    'paidPrice',
    'price',
    'token',
  ],
  threeDsInitialize: ['paymentId', 'conversationId'],
  threeDsAuth: ['paymentId', 'currency', 'basketId', 'conversationId', 'paidPrice', 'price'],
  nonThreeDsAuth: ['paymentId', 'currency', 'basketId', 'conversationId', 'paidPrice', 'price'],
  callbackRedirect: ['conversationData', 'conversationId', 'mdStatus', 'paymentId', 'status'],
  refund: ['paymentId', 'price', 'currency', 'conversationId'],
} as const;

const AMOUNT_FIELDS = new Set(['price', 'paidPrice']);

/**
 * Verifies the `signature` on an Iyzico API response.
 *
 * Returns `present: false` rather than throwing when no signature is included:
 * sandbox accounts without the feature enabled omit it entirely, and a hard
 * throw would make local development impossible. The caller decides whether an
 * unsigned response is acceptable — and in production it is not, which is what
 * `requireSignature` in the provider config enforces.
 */
export function verifyResponseSignature(args: {
  order: readonly string[];
  response: Record<string, unknown>;
  secretKey: string;
}): { present: boolean; valid: boolean; expected?: string } {
  const provided = args.response.signature;
  if (typeof provided !== 'string' || provided.length === 0) {
    return { present: false, valid: false };
  }

  const params = args.order.map((field) => {
    const value = args.response[field];
    if (value == null) return '';
    return AMOUNT_FIELDS.has(field)
      ? normalizeAmountForSignature(value as string | number)
      : String(value);
  });

  const expected = computeResponseSignature(params, args.secretKey);
  return { present: true, valid: safeEqualHex(expected, provided), expected };
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook (X-IYZ-SIGNATURE-V3)
// ─────────────────────────────────────────────────────────────────────────────

export interface DirectWebhookPayload {
  paymentConversationId: string;
  merchantId?: string | number;
  paymentId: string | number;
  status: string;
  iyziReferenceCode: string;
  iyziEventType: string;
  iyziEventTime: number;
  iyziPaymentId?: string | number;
}

export interface HppWebhookPayload {
  paymentConversationId: string;
  merchantId?: string | number;
  token: string;
  status: string;
  iyziReferenceCode: string;
  iyziEventType: string;
  iyziEventTime: number;
  iyziPaymentId: string | number;
}

export type IyzicoWebhookPayload = DirectWebhookPayload | HppWebhookPayload;

export function isHppWebhook(payload: IyzicoWebhookPayload): payload is HppWebhookPayload {
  return typeof (payload as HppWebhookPayload).token === 'string';
}

function webhookMessage(p: IyzicoWebhookPayload, secretKey: string): string {
  // Note the unusual construction: the secret key appears BOTH as the HMAC key
  // and as the first element of the message. That is what Iyzico specifies —
  // it looks like a mistake and is not.
  return isHppWebhook(p)
    ? secretKey + p.iyziEventType + p.iyziPaymentId + p.token + p.paymentConversationId + p.status
    : secretKey +
        p.iyziEventType +
        (p as DirectWebhookPayload).paymentId +
        p.paymentConversationId +
        p.status;
}

/**
 * Validates `X-IYZ-SIGNATURE-V3`.
 *
 *   Direct: secretKey + iyziEventType + paymentId + paymentConversationId + status
 *   HPP:    secretKey + iyziEventType + iyziPaymentId + token + paymentConversationId + status
 *
 * Checkout Form notifications use the HPP shape.
 */
export function verifyWebhookSignature(args: {
  payload: IyzicoWebhookPayload;
  signature: string | null | undefined;
  secretKey: string;
}): boolean {
  if (!args.signature) return false;
  const expected = createHmac('sha256', args.secretKey)
    .update(webhookMessage(args.payload, args.secretKey), 'utf8')
    .digest('hex');
  return safeEqualHex(expected, args.signature);
}

/** Exposed for the local simulation script, which must sign fake webhooks. */
export function signWebhookPayload(payload: IyzicoWebhookPayload, secretKey: string): string {
  return createHmac('sha256', secretKey)
    .update(webhookMessage(payload, secretKey), 'utf8')
    .digest('hex');
}
