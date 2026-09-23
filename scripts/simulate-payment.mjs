#!/usr/bin/env node
/**
 * Local payment simulator.
 *
 * Exercises the real callback and webhook routes — including real signature
 * verification — without any Iyzico credentials. It signs payloads with
 * IYZICO_SECRET_KEY exactly as Iyzico would, so the code path under test is the
 * production one, not a bypass.
 *
 *   node scripts/simulate-payment.mjs webhook --token mock_token_offer:abc:1
 *   node scripts/simulate-payment.mjs webhook --token … --tamper
 *   node scripts/simulate-payment.mjs callback --token …
 *   node scripts/simulate-payment.mjs replay --token …
 *   node scripts/simulate-payment.mjs sign --token …    # print only
 */

import { createHmac } from 'node:crypto';

const args = process.argv.slice(2);
const command = args[0] ?? 'help';

const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const BASE_URL = flag('base', process.env.APP_URL ?? 'http://localhost:3000');
const SECRET = flag('secret', process.env.IYZICO_SECRET_KEY ?? 'sandbox-test-secret-key');
const TOKEN = flag('token');
const CONVERSATION_ID = flag('conversation', TOKEN ? TOKEN.replace(/^mock_token_/, '') : 'offer:unknown:1');
const PAYMENT_ID = flag('paymentId', String(24_000_000 + Math.floor(Math.random() * 999_999)));
const STATUS = flag('status', 'SUCCESS');

function hppPayload() {
  return {
    paymentConversationId: CONVERSATION_ID,
    merchantId: '123456',
    token: TOKEN,
    status: STATUS,
    iyziReferenceCode: flag('ref', `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    iyziEventType: 'CHECKOUT_FORM_AUTH',
    iyziEventTime: Date.now(),
    iyziPaymentId: Number(PAYMENT_ID),
  };
}

/** HPP: secretKey + iyziEventType + iyziPaymentId + token + paymentConversationId + status */
function signHpp(p, secret) {
  const message =
    secret + p.iyziEventType + p.iyziPaymentId + p.token + p.paymentConversationId + p.status;
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

async function postWebhook(payload, signature) {
  const res = await fetch(`${BASE_URL}/api/webhooks/iyzico`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-IYZ-SIGNATURE-V3': signature,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  return { status: res.status, body };
}

function requireToken() {
  if (!TOKEN) {
    console.error('Missing --token. Start a checkout first and copy the token from the response.');
    process.exit(1);
  }
}

switch (command) {
  case 'sign': {
    requireToken();
    const payload = hppPayload();
    const signature = signHpp(payload, SECRET);
    console.log('Payload:\n' + JSON.stringify(payload, null, 2));
    console.log('\nX-IYZ-SIGNATURE-V3: ' + signature);
    console.log('\ncurl:\n');
    console.log(
      `curl -sS -X POST ${BASE_URL}/api/webhooks/iyzico \\\n` +
        `  -H 'Content-Type: application/json' \\\n` +
        `  -H 'X-IYZ-SIGNATURE-V3: ${signature}' \\\n` +
        `  -d '${JSON.stringify(payload)}'`,
    );
    break;
  }

  case 'webhook': {
    requireToken();
    const payload = hppPayload();
    const signature = has('tamper') ? 'deadbeef'.repeat(8) : signHpp(payload, SECRET);
    const result = await postWebhook(payload, signature);
    console.log(`→ HTTP ${result.status}  ${result.body}`);
    if (has('tamper')) {
      console.log(
        result.status === 401
          ? '✓ Forged signature rejected, as it must be.'
          : `✗ SECURITY BUG: a forged signature returned ${result.status}, expected 401.`,
      );
    }
    break;
  }

  case 'replay': {
    requireToken();
    const payload = hppPayload();
    const signature = signHpp(payload, SECRET);
    const first = await postWebhook(payload, signature);
    const second = await postWebhook(payload, signature);
    console.log(`first  → HTTP ${first.status}  ${first.body}`);
    console.log(`second → HTTP ${second.status}  ${second.body}`);
    const deduped = second.body.includes('deduplicated');
    console.log(
      deduped
        ? '✓ Redelivery deduplicated on iyziReferenceCode.'
        : '✗ Replay was NOT deduplicated — check the WebhookEvent unique index.',
    );
    break;
  }

  case 'callback': {
    requireToken();
    const res = await fetch(`${BASE_URL}/api/payments/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: TOKEN }).toString(),
      redirect: 'manual',
    });
    console.log(`→ HTTP ${res.status}  Location: ${res.headers.get('location')}`);
    break;
  }

  default:
    console.log(`Local payment simulator

  sign      Print a signed webhook payload and a ready-to-paste curl command
  webhook   POST a signed webhook  (add --tamper to verify forgeries are rejected)
  replay    POST the same webhook twice to prove replay dedup works
  callback  POST the browser callback

Flags: --token (required) --base --secret --status --paymentId --ref --conversation`);
}
