import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getPaymentProvider } from '@/lib/payments/provider';
import { isHppWebhook, type IyzicoWebhookPayload } from '@/lib/payments/iyzico/signature';
import { reconcileCheckout } from '@/server/services/payment-service';

/**
 * Iyzico webhook receiver.
 *
 * Contract we have to live with: Iyzico redelivers every 15 minutes until it
 * receives a 2xx, then gives up after 3 attempts. Two things follow.
 *
 * **Return 2xx for anything we have durably recorded.** A 500 on a payment we
 * already processed just buys two more redeliveries of the same event. We
 * return 200 once the event is persisted, and do the work behind that.
 *
 * **But never return 2xx for something we failed to record.** Those three
 * retries are the only safety net between a dropped notification and a student
 * whose money is in escrow with nothing to show for it. If persistence fails,
 * we return 500 and let Iyzico try again.
 *
 * Replay protection is a unique index on `iyziReferenceCode`, not application
 * logic. Two workers receiving the same redelivery simultaneously both attempt
 * the insert; exactly one succeeds and the other gets a constraint violation it
 * can safely treat as "already handled".
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // needs node:crypto for HMAC

const PROCESSABLE_EVENTS = new Set([
  'CHECKOUT_FORM_AUTH',
  'THREE_DS_AUTH',
  'THREE_DS_CALLBACK',
  'API_AUTH',
  'PAYMENT_API',
]);

export async function POST(request: NextRequest) {
  // Read the raw body BEFORE parsing. The signature covers specific fields
  // rather than the whole body here, but reading raw first keeps this handler
  // correct if that ever changes, and lets us persist exactly what arrived.
  const rawBody = await request.text();

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  let payload: IyzicoWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as IyzicoWebhookPayload;
  } catch {
    // Malformed body will never become valid on retry.
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const provider = getPaymentProvider();
  const signatureOk = provider.verifyWebhook(rawBody, headers);

  // A bad signature is either an attack or a misconfiguration. Either way,
  // return 401 and record nothing: writing attacker-supplied rows to the
  // dedup table would let someone poison it and suppress the real
  // notification for that reference code.
  if (!signatureOk) {
    console.warn('[webhook] rejected: signature mismatch', {
      referenceCode: payload.iyziReferenceCode,
      eventType: payload.iyziEventType,
    });
    return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 401 });
  }

  if (!payload.iyziReferenceCode) {
    return NextResponse.json({ ok: false, error: 'missing_reference' }, { status: 400 });
  }

  // Durable record first, work second.
  let isNew = true;
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: provider.name,
        referenceCode: payload.iyziReferenceCode,
        eventType: payload.iyziEventType ?? 'UNKNOWN',
        status: payload.status ?? 'UNKNOWN',
        conversationId: payload.paymentConversationId,
        providerRef: String(payload.iyziPaymentId ?? ''),
        payload: payload as unknown as Prisma.InputJsonValue,
        signatureOk: true,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      isNew = false; // duplicate delivery
    } else {
      console.error('[webhook] failed to persist event', error);
      // Ask for a retry: we have not recorded this and cannot process it.
      return NextResponse.json({ ok: false, error: 'persist_failed' }, { status: 500 });
    }
  }

  if (!isNew) {
    return NextResponse.json({ ok: true, deduplicated: true });
  }

  if (!PROCESSABLE_EVENTS.has(payload.iyziEventType) || payload.status !== 'SUCCESS') {
    // Recorded for the audit trail, deliberately not acted on. Failures are
    // discovered through reconciliation, not through trusting a status string.
    await markProcessed(payload.iyziReferenceCode, null);
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const token = isHppWebhook(payload) ? payload.token : null;
    if (!token) {
      // Direct-format events carry no token. We do not have a lookup path from
      // paymentId alone in the Checkout Form flow, so record and let the
      // reconciliation sweep pick it up by conversationId.
      await markProcessed(payload.iyziReferenceCode, 'no_token_direct_format');
      return NextResponse.json({ ok: true, deferred: true });
    }

    const result = await reconcileCheckout(token);
    await markProcessed(payload.iyziReferenceCode, null);

    return NextResponse.json({ ok: true, outcome: result.outcome });
  } catch (error) {
    console.error('[webhook] processing failed', {
      referenceCode: payload.iyziReferenceCode,
      error,
    });
    await recordFailure(payload.iyziReferenceCode, String(error));

    // The event IS recorded, so a retry will be deduplicated and will not
    // re-run this. Return 200 and let the reconciliation sweep finish the job
    // rather than burning our three redeliveries on an error that is ours.
    return NextResponse.json({ ok: true, deferred: true });
  }
}

async function markProcessed(referenceCode: string, note: string | null) {
  await prisma.webhookEvent
    .update({
      where: { referenceCode },
      data: { processedAt: new Date(), processError: note, attempts: { increment: 1 } },
    })
    .catch(() => undefined);
}

async function recordFailure(referenceCode: string, message: string) {
  await prisma.webhookEvent
    .update({
      where: { referenceCode },
      data: { processError: message.slice(0, 500), attempts: { increment: 1 } },
    })
    .catch(() => undefined);
}
