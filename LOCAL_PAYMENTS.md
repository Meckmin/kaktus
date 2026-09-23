# Simulating payments locally

No Iyzico account, no merchant credentials, no ngrok. The mock provider models
the parts of Iyzico's behaviour our code depends on, and the simulator signs
webhooks with real HMAC so the **production signature-verification path is what
gets exercised** — not a bypass.

---

## Setup

```bash
cp .env.example .env
```

```bash
# .env — the only two lines that matter for this
PAYMENT_PROVIDER="mock"
IYZICO_SECRET_KEY="sandbox-test-secret-key"   # any string; both sides use it
```

```bash
npm run db:deploy && npm run dev
```

`PAYMENT_PROVIDER=mock` swaps the transport only. Routes, service layer, FSM,
ledger, and webhook signature checking are all the real code.

---

## Step 1 — Get an offer to ACCEPTED

Payment is only legal from `ACCEPTED`; the service rejects anything else.

```bash
npx tsx scripts/seed-demo.ts   # or drive the UI
```

You need three things to exist:

| Requirement | Why it blocks payment |
|---|---|
| Offer in `ACCEPTED` | `startCheckout` throws `OFFER_NOT_PAYABLE` otherwise |
| Coach `verificationStatus = APPROVED` | unverified coaches cannot be paid |
| Coach `submerchantKey` set | **the most common local blocker** — without it we'd capture money we cannot forward, so we refuse before charging |

The mock provider returns `mock_sub_<coachProfileId>` from `createSubmerchant`,
so for local work you can set the key directly:

```sql
UPDATE "CoachProfile"
SET "submerchantKey" = 'mock_sub_' || id, "verificationStatus" = 'APPROVED'
WHERE "submerchantKey" IS NULL;
```

## Step 2 — Start the checkout

```ts
const session = await startCheckout({
  offerId: '<offer-id>',
  studentUserId: '<student-user-id>',
  buyer: {
    name: 'Mert', surname: 'Kaya', email: 'mert@example.com',
    identityNumber: '11111111111',       // sandbox TCKN
    gsmNumber: '+905551112233',
    ip: '127.0.0.1', city: 'İstanbul',
    address: 'Kadıköy, İstanbul',
  },
  callbackUrl: 'http://localhost:3000/api/payments/callback',
});
```

Returns a token shaped `mock_token_offer:<offerId>:<version>`. Copy it.

At this point, verify the milestone mapping is set up — this is the thing that
makes per-milestone release possible at all:

```sql
SELECT index, "amountMinor", status, "providerTransactionId"
FROM "Milestone" m
JOIN "Engagement" e ON e.id = m."engagementId"
WHERE e."offerId" = '<offer-id>' ORDER BY index;
```

Four rows, `providerTransactionId` still `NULL`. It gets filled at capture.

## Step 3 — Simulate the payment

**Browser callback** (what happens when the student finishes on the hosted form):

```bash
node scripts/simulate-payment.mjs callback --token 'mock_token_offer:<offerId>:1'
# → HTTP 303  Location: http://localhost:3000/odeme/basarili?teklif=<offerId>
```

**Webhook** (server-to-server, signed):

```bash
node scripts/simulate-payment.mjs webhook --token 'mock_token_offer:<offerId>:1'
# → HTTP 200  {"ok":true,"outcome":"CAPTURED"}
```

Either alone is sufficient. Running both proves they converge instead of
double-posting, which is the point of routing everything through
`reconcileCheckout`.

### Mock payload reference

What `simulate-payment.mjs webhook` sends — the HPP (Checkout Form) shape:

```json
{
  "paymentConversationId": "offer:cm4x8p2q10001:1",
  "merchantId": "123456",
  "token": "mock_token_offer:cm4x8p2q10001:1",
  "status": "SUCCESS",
  "iyziReferenceCode": "sim-1788423113993-a3f9c2",
  "iyziEventType": "CHECKOUT_FORM_AUTH",
  "iyziEventTime": 1788423113993,
  "iyziPaymentId": 24185078
}
```

Header:

```
X-IYZ-SIGNATURE-V3: <hex>
```

where the signature is

```
HMAC_SHA256(
  key     = secretKey,
  message = secretKey + iyziEventType + iyziPaymentId + token
            + paymentConversationId + status
)
```

Yes, the secret key appears both as the HMAC key and as the first element of the
message. That is Iyzico's spec, not a typo.

`node scripts/simulate-payment.mjs sign --token …` prints the payload, the
signature, and a ready-to-paste curl command.

## Step 4 — Verify what actually happened

```sql
-- Offer moved, escrow posted, milestones mapped
SELECT status FROM "Offer" WHERE id = '<offer-id>';                    -- PAID_IN_ESCROW
SELECT status, "providerRef" FROM "Payment" WHERE "offerId" = '<offer-id>';  -- CAPTURED

SELECT account, direction, SUM("amountMinor")
FROM "LedgerEntry" WHERE "engagementId" = '<engagement-id>'
GROUP BY 1,2;   -- PSP_RECEIVABLE debit + PLATFORM_ESCROW credit, equal

SELECT index, "providerTransactionId" FROM "Milestone" m
JOIN "Engagement" e ON e.id = m."engagementId"
WHERE e."offerId" = '<offer-id>' ORDER BY index;   -- all four now populated

SELECT COUNT(*) FROM "Booking" WHERE "engagementId" = '<engagement-id>';
SELECT status, COUNT(*) FROM "SlotHold" WHERE "offerId" = '<offer-id>' GROUP BY 1;  -- CONVERTED
```

## Step 5 — Drive a milestone release end to end

```sql
UPDATE "Milestone" SET status = 'PENDING_CONFIRMATION',
  "autoReleaseAt" = now() - interval '1 minute'
WHERE id = '<milestone-0-id>';
```

```ts
await runFrequentJobs();
```

Then confirm the split and the provider approval:

```sql
SELECT account, SUM(CASE WHEN direction='CREDIT' THEN "amountMinor" ELSE -"amountMinor" END)
FROM "LedgerEntry" WHERE "milestoneId" = '<milestone-0-id>' GROUP BY 1;
-- COACH_PAYABLE 82%, PLATFORM_REVENUE 18%, PLATFORM_ESCROW negative by the gross

SELECT status, "providerApprovedAt" FROM "Milestone" WHERE id = '<milestone-0-id>';
-- RELEASED, and providerApprovedAt set by approveReleasedMilestones
```

---

## Security checks worth running before you trust any of this

**Forged webhook must be rejected:**

```bash
node scripts/simulate-payment.mjs webhook --token '<token>' --tamper
# → HTTP 401  {"ok":false,"error":"invalid_signature"}
# ✓ Forged signature rejected, as it must be.
```

**Replay must be deduplicated:**

```bash
node scripts/simulate-payment.mjs replay --token '<token>'
# first  → HTTP 200  {"ok":true,"outcome":"CAPTURED"}
# second → HTTP 200  {"ok":true,"deduplicated":true}
```

Then confirm the money did not move twice:

```sql
SELECT COUNT(*) FROM "LedgerEntry"
WHERE "engagementId" = '<id>' AND account = 'PLATFORM_ESCROW';  -- exactly 1
```

**Forged callback must gain nothing.** Post a made-up token to the callback with
whatever fields you like. Nothing in that body is read except `token`, and an
unknown token yields a redirect to the error page with no database write.

---

## What this does NOT prove

The mock is honest about its limits. Before taking real money, sandbox-test:

- **3DS.** The mock captures instantly. Real cards bounce through a bank page
  and come back `CALLBACK_THREEDS`, then `SUCCESS`. The `PENDING` branch of
  `reconcileCheckout` is untested locally.
- **Iyzico's retry semantics.** Real redelivery is every 15 minutes, three
  attempts, and stops on any 2xx. Our dedup is designed for that but has only
  been exercised against a simulator that fires on demand.
- **Fraud review** (`fraudStatus: 0`). Funds capture but sit under review. We
  currently treat capture as final regardless — decide the policy before launch.
- **Timeouts mid-charge.** The single most dangerous real-world case: the charge
  may or may not have happened. `TIMEOUT_RECOVERY_NOTE` in `client.ts` states the
  rule (never retry; call `retrieveCheckout`), but the mock cannot produce it.
- **Sub-merchant onboarding.** Iyzico validates IBAN and TCKN/VKN and rejects
  mismatches with generic errors. Budget real time for this.
- **Settlement timing and blockage.** Approving releases funds into Iyzico's
  payout pipeline, not into the coach's bank account that instant. Our
  `COACH_PAYABLE` is our books; actual arrival follows Iyzico's blockage rules.

Sandbox test cards: <https://docs.iyzico.com/en/add-ons/test-cards>
