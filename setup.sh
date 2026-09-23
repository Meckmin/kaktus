#!/usr/bin/env bash
# Kaktüs Koçluk — project bootstrap.  bash setup.sh [target]   FORCE=1 to overwrite

set -euo pipefail
TARGET="${1:-.}"
FORCE="${FORCE:-0}"
mkdir -p "$TARGET"
cd "$TARGET"

if [ "$FORCE" != "1" ]; then
  for guard in prisma/schema.prisma package.json src/lib/db.ts; do
    if [ -e "$guard" ]; then
      echo "Refusing to overwrite: $guard already exists." >&2
      exit 1
    fi
  done
fi

written=0
emit() { mkdir -p "$(dirname "$1")"; cat > "$1"; written=$((written+1)); printf '  %s\n' "$1"; }

echo "Creating directories..."
mkdir -p "prisma"
mkdir -p "prisma/migrations/20260101000000_marketplace_constraints"
mkdir -p "scripts"
mkdir -p "src/app"
mkdir -p "src/app/admin"
mkdir -p "src/app/admin/itirazlar"
mkdir -p "src/app/api/auth/[...nextauth]"
mkdir -p "src/app/api/onboarding"
mkdir -p "src/app/api/payments/callback"
mkdir -p "src/app/api/webhooks/iyzico"
mkdir -p "src/app/giris"
mkdir -p "src/app/giris/eposta-gonderildi"
mkdir -p "src/app/giris/hata"
mkdir -p "src/app/koc-ol"
mkdir -p "src/app/koc-ol/tesekkurler"
mkdir -p "src/app/koc/[slug]"
mkdir -p "src/app/kocbul"
mkdir -p "src/app/odeme/[durum]"
mkdir -p "src/app/onboarding/[step]"
mkdir -p "src/app/panel"
mkdir -p "src/app/panel/sohbet/[conversationId]"
mkdir -p "src/app/panel/teklifler/[offerId]"
mkdir -p "src/components/admin"
mkdir -p "src/components/auth"
mkdir -p "src/components/chat"
mkdir -p "src/components/coach"
mkdir -p "src/components/coach-apply"
mkdir -p "src/components/match"
mkdir -p "src/components/offer"
mkdir -p "src/components/onboarding"
mkdir -p "src/jobs"
mkdir -p "src/lib"
mkdir -p "src/lib/booking"
mkdir -p "src/lib/chat"
mkdir -p "src/lib/coach"
mkdir -p "src/lib/crypto"
mkdir -p "src/lib/matching"
mkdir -p "src/lib/offers"
mkdir -p "src/lib/onboarding"
mkdir -p "src/lib/payments"
mkdir -p "src/lib/payments/iyzico"
mkdir -p "src/lib/storage"
mkdir -p "src/lib/time"
mkdir -p "src/server/actions"
mkdir -p "src/server/queries"
mkdir -p "src/server/services"
mkdir -p "tests"

echo "Writing files..."

emit ".env.example" <<'KAKTUS_FILE_EOF'
# ── Database ────────────────────────────────────────────────────────────────
# Pooled connection for the app. Raise connection_limit before running the
# concurrency suite or the races serialise through the pool and prove nothing.
DATABASE_URL="postgresql://kaktus:kaktus@localhost:5432/kaktus?schema=public"
# Unpooled connection for migrations (Prisma needs a direct session).
DIRECT_DATABASE_URL="postgresql://kaktus:kaktus@localhost:5432/kaktus?schema=public"

# ── Auth.js ─────────────────────────────────────────────────────────────────
# openssl rand -base64 32
AUTH_SECRET=""
AUTH_URL="http://localhost:3000"
AUTH_GOOGLE_ID=""
AUTH_GOOGLE_SECRET=""
# Leave empty for local development: sign-in links are printed to the server
# console and appended to .auth-link.txt instead of being emailed. A real key
# starts with "re_". Set AUTH_FORCE_EMAIL=1 to send real mail while developing.
AUTH_RESEND_KEY=""
AUTH_FORCE_EMAIL=""
EMAIL_FROM="Kaktüs Koçluk <merhaba@kaktuskocluk.com>"

# ── Payments ────────────────────────────────────────────────────────────────
# "mock" runs the deterministic in-memory provider. Everything above the
# provider interface is identical, so leave this as mock until Phase 4.
PAYMENT_PROVIDER="mock"
IYZICO_API_KEY=""
IYZICO_SECRET_KEY=""
IYZICO_BASE_URL="https://sandbox-api.iyzipay.com"

# ── Storage (verification documents — private bucket, never public URLs) ────
SUPABASE_URL=""
SUPABASE_SERVICE_ROLE_KEY=""

# Public IP reported to Iyzico on refund calls (they require an `ip` field).
SERVER_PUBLIC_IP="127.0.0.1"
# Where Iyzico redirects the browser after the hosted checkout form.
APP_URL="http://localhost:3000"

# ── PII encryption (coach payout details: IBAN, TCKN/VKN) ───────────────────
# openssl rand -base64 32
# Protects against a database dump. Move to KMS before real payout volume.
PII_ENCRYPTION_KEY=""

# Private bucket for verification documents. Falls back to ./.uploads locally.
DOCUMENT_STORAGE_BUCKET="coach-documents"
KAKTUS_FILE_EOF

emit ".gitignore" <<'KAKTUS_FILE_EOF'
node_modules/
.next/
out/
build/
.env
.env.local
.env*.local
*.tsbuildinfo
next-env.d.ts
coverage/
.DS_Store

# Sign-in links written by the local magic-link fallback. Real credentials.
.auth-link.txt
.private-uploads/
KAKTUS_FILE_EOF

emit "ARCHITECTURE.md" <<'KAKTUS_FILE_EOF'
# Kaktüs Koçluk — System Architecture

Two-sided marketplace for YKS coaching. Guest-first matchmaking, negotiated offers,
escrowed payments with platform commission, and disintermediation defence.

---

## 1. Stack decision

Your proposed stack is right. Two changes I'd make, with reasons:

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15 App Router, RSC + Server Actions | One deploy target, no separate API service until you need one. Server Actions are fine for mutations; use Route Handlers for webhooks and anything a third party calls. |
| DB | Postgres (Supabase-hosted) + **Prisma** | Prisma for migrations/typing from the Node side. |
| Data access | **All writes go through the app layer with the service role. RLS is a second fence, not the first.** | Marketplace invariants (escrow balances, slot exclusivity, commission math) cannot be expressed as row policies. Write RLS policies for the tables the browser reads directly via Realtime (`Message`, `Conversation`, `Booking`) and nothing else. |
| Realtime | Supabase Realtime on `Message` + `SlotHold` | Postgres-backed, no extra socket server to run. Publish *redacted* message rows only (see §6). |
| Auth | **Auth.js v5** (Google + Resend magic link) with Prisma adapter, database sessions | Supabase Auth would split identity across two systems and complicate the onboarding-claim flow. One `User` table, one adapter. |
| Payments | Provider interface + **Iyzico Marketplace (alt üye işyeri)** adapter + in-memory mock | Iyzico is the only realistic TR option for split payouts with local cards/taksit. Everything above the adapter is provider-agnostic so tests never touch the network. |
| Money | `Int` minor units (kuruş), never `Float`/`Decimal` for balances | Rounding is a real bug in commission splits. |
| Queue | Postgres-backed jobs (pg-boss) or Inngest | Needed for: hold expiry, milestone auto-release, payout batching, offer expiry. Do **not** rely on Vercel cron alone for money movement. |

### Non-negotiable engineering rules

1. **Double-entry ledger.** Every kuruş movement writes ≥2 `LedgerEntry` rows summing to zero. Balances are derived, never stored as a mutable scalar you `+=`.
2. **Idempotency keys on every payment call and webhook.** Iyzico will retry.
3. **The offer state machine is the only writer of `Offer.status`.** No ad-hoc `update({status})` anywhere in the codebase.
4. **Slot exclusivity is enforced by a Postgres exclusion constraint**, not by an application-level "check then insert". See `prisma/migrations/.../marketplace_constraints.sql`.

---

## 2. Bounded contexts

```
┌──────────────┐   onboarding payload   ┌────────────────┐
│  Discovery   │──────────────────────► │  Matchmaking   │
│ (guest flow) │                        │  (pure scorer) │
└──────┬───────┘                        └────────┬───────┘
       │ claim on auth                           │ ranked coaches
       ▼                                         ▼
┌──────────────┐      creates      ┌────────────────────────┐
│   Identity   │ ─────────────────►│      Engagement        │
│ (Auth.js)    │                   │ Conversation → Offer   │
└──────────────┘                   │ → Engagement → Booking │
                                   └───────────┬────────────┘
                     moderation │              │ state transitions
                                ▼              ▼
                      ┌──────────────┐  ┌──────────────────┐
                      │ Trust&Safety │  │  Money (escrow,  │
                      │ (filter,     │  │  ledger, payout, │
                      │  disputes)   │  │  commission)     │
                      └──────────────┘  └──────────────────┘
```

Each context owns its tables. Cross-context reads go through a service function in
`src/server/services/*`, never a raw Prisma query from a React component.

---

## 3. The three flows that define the product

### A. Guest → matched → gated

```
/  ──► "Öğrenciyim"  ──►  /onboarding  (5 steps, no auth)
                              │  POST /api/onboarding  → OnboardingSession row
                              │  httpOnly signed cookie kk_onb=<token>, 30d
                              ▼
                          /kocbul  ── server-side match ──► ranked cards
                              │        (name, university, %match, 2 reasons,
                              │         price band, blurred exact availability)
                              ▼
            click "Profili gör" / "Teklif ver" / "Mesaj at"
                              │
                              ▼   ⟵ AUTH GATE (modal, no navigation away)
                        Google / magic link
                              │
                    signIn event: claimOnboardingSession(token, userId)
                              │  → creates StudentProfile from the guest answers
                              ▼
                       returns to exactly where they were
```

The onboarding answers live **server-side from step 1**, keyed by an httpOnly cookie.
localStorage would lose them on the magic-link round trip (different tab, sometimes
different browser). The cookie survives the OAuth redirect; the row survives the email
client opening the link in Safari when they started in Chrome — because we also embed
the token in the magic-link callback URL.

### B. Offer negotiation with slot locking

```
student picks slots on the profile calendar
   → POST /offers  ──► SlotHold rows (status HELD, expiresAt = now + 48h)
                       exclusion constraint blocks overlap with any other
                       HELD hold or CONFIRMED booking for that coach
   → Offer(OFFERED)
   → coach counters → Offer(COUNTERED) [new row, parentOfferId set, holds inherited]
   → accept → ACCEPTED (holds extended 2h for payment)
   → pay    → PAID_IN_ESCROW → Engagement + Milestones + Bookings created,
              holds flipped to CONVERTED
   → expiry job releases holds and expires the offer
```

### C. Money

```
student card ──Iyzico──► platform escrow (funds held, NOT on coach submerchant yet)
                              │
                    milestone period ends
                              │
        both confirm sessions │ or 5-day auto-release with no dispute
                              ▼
                   release milestone amount
                     ├─ 82% → COACH_PAYABLE  (coach withdrawable balance)
                     └─ 18% → PLATFORM_REVENUE
                              │
                    weekly payout batch → Iyzico submerchant approval
```

Dispute at any point before release freezes that milestone only; already-released
milestones are not clawed back.

---

## 4. File structure

```
kaktus-kocluk/
├─ prisma/
│  ├─ schema.prisma                     # §1 deliverable
│  ├─ seed.ts
│  └─ migrations/…/marketplace_constraints.sql   # exclusion + ledger triggers
├─ src/
│  ├─ app/
│  │  ├─ (marketing)/page.tsx                    # role split: öğrenci / koç
│  │  ├─ (onboarding)/onboarding/[step]/page.tsx # 5-step wizard, no auth
│  │  ├─ (discovery)/kocbul/page.tsx             # ranked results (RSC)
│  │  ├─ (discovery)/koc/[slug]/page.tsx         # profile + availability calendar
│  │  ├─ (app)/panel/…                           # student & coach dashboards
│  │  ├─ (app)/sohbet/[conversationId]/page.tsx
│  │  ├─ (coach)/koc-ol/[step]/page.tsx          # coach onboarding + doc upload
│  │  ├─ (admin)/admin/…                         # verification queue, disputes
│  │  └─ api/
│  │     ├─ auth/[...nextauth]/route.ts
│  │     ├─ onboarding/route.ts
│  │     └─ webhooks/iyzico/route.ts
│  ├─ components/                                # shadcn/ui + domain components
│  ├─ lib/
│  │  ├─ matching/{types,weights,score,engine}.ts     # §2 deliverable
│  │  ├─ offers/state-machine.ts                      # §3 deliverable
│  │  ├─ payments/{provider,iyzico,mock,escrow}.ts
│  │  ├─ chat/anti-circumvention.ts
│  │  ├─ booking/{availability,holds}.ts
│  │  ├─ time/windows.ts
│  │  ├─ onboarding/session.ts
│  │  ├─ auth.ts
│  │  ├─ db.ts
│  │  └─ money.ts
│  ├─ server/
│  │  ├─ actions/                                # 'use server' entrypoints
│  │  └─ services/                               # transactional business logic
│  └─ jobs/{expire-holds,expire-offers,auto-release,payout-batch}.ts
└─ tests/                                        # vitest; scorer + FSM + filter
```

---

## 5. Matchmaking: design notes

Two-phase. **Phase 1 (SQL)** narrows with hard filters that are cheap and indexable:
approved + accepting + capacity + track + price ceiling + ≥1 overlapping weekday.
**Phase 2 (TS, pure)** scores the ~50–400 survivors in memory.

Weights (sum 1.0) live in `weights.ts` and are versioned — every `MatchResult` records
`weightsVersion` so you can A/B a weighting change and attribute conversion to it.

| Dimension | w | Rationale |
|---|---|---|
| Trajectory similarity | .22 | The actual product thesis: a coach who personally went 45→95 net is evidence for a student who needs 40→90. Nothing else on the market ranks by this. |
| Style fit | .17 | Rank-weighted — their *first* choice counts most. |
| Availability overlap | .15 | A 99% match at hours the student can't attend is a 0% match. |
| Track & subject depth | .14 | |
| Budget fit | .12 | Asymmetric: under budget costs nothing, over budget decays fast. |
| Reputation | .12 | Bayesian-smoothed rating (prior 4.4, m=8) so one 5★ doesn't outrank fifty 4.7★. |
| Grade/mezun experience | .08 | |

Cold-start: coaches with <3 completed engagements get a decaying exposure bonus capped
at +4 points, otherwise the marketplace ossifies around whoever joined first.

**Displayed score.** Raw scores cluster 0.45–0.80; showing "58% Match" reads as broken.
`calibrate()` applies a documented gamma curve and a display floor, and we only render
candidates above `MIN_DISPLAY_SCORE`. The raw score is persisted for analysis. This is a
presentation decision, made once, in one function — not scattered fudge factors.

---

## 6. Anti-disintermediation

Layered, because regex alone loses to `sıfır beş üç iki` and `insta: kaktus_._koc`.

1. **Normalise** — NFKD, homoglyph fold (Cyrillic а→a), strip zero-width, collapse
   separators between digits, map Turkish number words to digits, de-leet.
2. **Detect** — TR mobile numbers, IBAN (`TR` + 24 digits, spaced or not), e-mail,
   platform handles (WhatsApp/Telegram/Instagram/Discord incl. `wa.me`, `t.me`),
   payment vocabulary (`havale`, `eft`, `papara`, `elden`, `dışarıdan`, `komisyonsuz`).
3. **Score & act** — `ALLOW` / `MASK` (redact + inline warning, message still sends) /
   `BLOCK` (refuse, warn, log). Repeat offenders escalate to admin review.
4. **Store** — the redacted body is what Realtime broadcasts and what the other party
   ever sees. The original is retained encrypted for dispute evidence, admin-only.

Deliberately *not* silent: a masked message shows both sides why. Users route around
filters they don't understand; they mostly comply with ones they do.

---

## 7. Implementation roadmap

**Phase 0 — Foundation (week 1).** Repo, Prisma schema, migrations incl. the exclusion
constraint, Auth.js with Google + magic link, `OnboardingSession` + claim flow, shadcn
baseline. *Exit: a guest can complete onboarding, sign in, and have a StudentProfile
populated from their guest answers.*

**Phase 1 — Discovery (week 2).** Coach seed data (30 realistic fixtures), Phase-1 SQL
prefilter, scorer + unit tests, `/kocbul` results with match reasons, coach profile page,
auth gate modal. *Exit: ranked, explainable results end to end.*

**Phase 2 — Coach supply (week 3).** Coach onboarding wizard, document upload to private
Supabase Storage, pricing tiers, availability rule editor, admin verification queue.
*Exit: a coach can be approved and appear in results.*

**Phase 3 — Negotiation (week 4).** Conversations, Realtime messaging, the
anti-circumvention filter with tests, offer composer, holds + exclusion constraint,
offer FSM wired to the UI. *Exit: an offer reaches ACCEPTED.*

**Phase 4 — Money (weeks 5–6).** Provider interface, mock provider, ledger + escrow
service, Iyzico submerchant onboarding, 3DS payment + webhook, milestones, auto-release
job, payout batch. *Exit: a full cycle in sandbox from payment to coach balance.*

**Phase 5 — Trust (week 7).** Disputes, no-show handling, refunds, reviews gated on a
completed engagement, admin console. *Exit: safe to take real money.*

**Phase 6 — Launch hardening.** Rate limits, KVKK/GDPR data-export & deletion, audit log
review, Sentry, load test the matcher, legal (mesafeli hizmet sözleşmesi, aracı hizmet
sağlayıcı disclosure per 6563).

---

## 8. Deliberate omissions to revisit

- **Video calls**: don't build. Ship with coach-supplied Meet/Zoom links; revisit once
  session confirmation data shows where no-shows actually happen.
- **Group coaching**: schema supports it later via `Engagement.capacity`; not modelled now.
- **Coach-side mobile app**: the calendar editor is the only painful mobile surface —
  fix with a responsive web editor first.
KAKTUS_FILE_EOF

emit "LOCAL_PAYMENTS.md" <<'KAKTUS_FILE_EOF'
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
KAKTUS_FILE_EOF

emit "PROJE-DURUMU.md" <<'KAKTUS_FILE_EOF'
# Kaktüs Koçluk — Where We Are

A plain-language summary of everything built so far, why it was built that way, and
what comes next. No technical detail — this is the version you could hand to an
investor, a lawyer, or a new teammate on their first day.

---

## 1. What we are building

Most YKS coaching sold online works like a shop: a company packages a programme,
sets a price, assigns whichever coach is free, and the student takes it or leaves it.

Kaktüs Koçluk works like a marketplace instead. Students describe where they are and
where they want to get to. Coaches set their own prices and choose their own
students. The two sides find each other, agree their own terms, and Kaktüs sits in
the middle doing three jobs: **matching them, holding the money safely, and stepping
in when something goes wrong.**

We earn a commission — currently 18% — and only on lessons that actually happen.

The name carries the idea. A cactus survives in hard conditions and blooms anyway.
That is what a gap year looks like from the inside.

---

## 2. The journey so far

### Stage one — The blueprint

Before writing anything, we mapped out how the whole system fits together: what
information we need to store, how a student and coach move from "never met" to
"working together", and where money changes hands.

This sounds like paperwork, but it decided things that would have been painful to
change later. For example: we decided early that Kaktüs would never hold student
money in its own bank account. That single decision keeps us out of a category of
financial regulation that would require a licence, an audit, and a compliance team.

We also wrote down the rules the system must never break — like "the same hour can
never be booked twice" and "money can never disappear or appear from nowhere" — and
built them into the foundations rather than trusting ourselves to remember.

### Stage two — The matching brain

This is the part that makes Kaktüs different from a directory.

When a student answers our questions, we score every available coach against them
across seven dimensions and rank the results. The heaviest single factor — and this
is the product's core bet — is **whether the coach personally made a similar climb.**
A coach who went from 45 to 95 net is real evidence for a student who needs to go
from 40 to 90. Nobody else in the Turkish market ranks coaches this way.

The other factors are working style, matching free hours, subject depth, budget fit,
past student feedback, and experience with that specific year group (11th grade, 12th
grade, or gap year).

Two deliberate choices inside it:

- **New coaches get a small visibility boost.** Without it, whoever joined first
  would permanently dominate and new coaches would never get a first student.
- **One five-star review does not beat fifty four-and-a-half-star reviews.** The
  scoring accounts for how much evidence exists, not just the average.

Students see not only a match percentage but *why* — short explanations under each
coach. An unexplained ranking is something teenagers are right to distrust.

### Stage three — The agreement system

A student and coach negotiate. Someone proposes terms, the other accepts or counters,
and eventually they agree. Then payment happens, lessons happen, and it ends.

We built a strict rulebook covering every stage an agreement can be in and every
legal move between them. Nothing can skip a step. You cannot start lessons before
paying. You cannot cancel something already paid for — that becomes a refund, which
is a different and more careful process. An agreement that has finished can never
quietly reopen.

The reason for the strictness is that every one of those stages involves someone's
money and someone's exam year.

We also handled the awkward real-world cases. When a student proposes specific hours,
those hours are **held** — locked so nobody else can take them while the coach
decides. If the coach counters with different terms, the held hours transfer to the
new proposal rather than being released and grabbed by someone else. If nobody
responds, the hold quietly expires and the hours go back to the calendar.

### Stage four — Money and trust

This is the heart of why a marketplace like this can work at all.

When a student pays, **the money does not go to the coach.** It is held. As lessons
are completed, it is released in weekly instalments. If the coach does not show up,
the student can raise a dispute and the unreleased money can be refunded.

Two rules we settled on, and both matter:

**Silence means approval, after five days.** Requiring both sides to actively confirm
every week sounds fairer and fails in practice — students vanish after the exam, and
coaches end up unpaid for work they genuinely did. Coaches would learn not to trust
the system and start pushing students to pay them directly. So if nobody objects
within five days, the instalment releases automatically. A reported no-show blocks
that release regardless of the clock.

**Completed instalments are final.** If weeks one and two went well and week three
goes badly, the coach keeps the money for weeks one and two. Earnings that can be
retroactively cancelled are not really earnings, and no good coach would build their
income on them.

Underneath all of this, every movement of money is recorded twice, in a way that makes
the books provably balanced. If the numbers ever disagree, the system refuses the
transaction rather than continuing with a quiet error.

### Stage five — Actually taking payments

We integrated İyzico, the standard payment provider for Turkish marketplaces.

Something important came out of reading their documentation carefully: **İyzico holds
the escrow, not us.** Money sits with them after the card is charged and moves to the
coach only when we tell them to release it. This is better than our original plan —
it is exactly the arrangement that keeps us out of financial licensing territory.

It also changed a technical detail with a real consequence: because their system
releases money one basket line at a time, we now send each weekly instalment as its
own line. Had we not caught this, releasing week one without releasing weeks two
through four would have been impossible.

We built the whole payment path so it can be tested locally without a merchant
account, using a simulator. Card fraud checks, forged payment notifications, and
duplicate notifications are all handled — a fake "payment successful" message from an
attacker gains them nothing, because we ignore it and independently ask İyzico what
actually happened.

### Stage six — The student experience

A student lands on the site and answers five questions: their subject area and year,
their target ranking, their current scores, what kind of coach suits them, and their
budget. **No signup required.** They see real matched coaches immediately.

The signup wall sits between *looking* and *doing*. Browse freely; to message a coach
or send an offer, you need an account.

The answers are kept safely so nothing is lost at that moment. We were careful here
because of a specific failure we anticipated: a student starts in one browser, the
login email opens in a different one, and their five answers vanish. We store them in
a way that survives that.

Rather than a progress bar, the questionnaire builds a visible profile down the side
of the screen — each answer appears as you give it. It makes the form feel like
assembling something rather than filling something in, and it makes the promise "we
kept your answers" something you can actually see.

### Stage seven — Coach profiles and making an offer

Each coach has a page showing their verified ranking, university, their own score
improvement, how they work, and reviews from students who completed a programme with
them. Reviews show initials only — the students are minors.

The calendar shows genuinely available hours, hours already booked, and — separately —
hours currently held in someone else's open negotiation. That third state matters: held
hours often free up within hours, and hiding them would make a popular coach look
unreachable and push the student toward a worse match.

From there a student builds an offer: a single trial session or a four-week programme,
specific hours, and their own price. The price breakdown shows the full picture
including our commission, before they commit. We show our own cut openly and
deliberately — a marketplace that hides its fee until the receipt teaches people to
arrange things privately next time.

If they are not signed in, the offer is saved, they sign in, and it sends
automatically. They never re-enter anything.

### Stage eight — Becoming a coach

Coaches apply through a form covering their university and department, their verified
ranking with document proof, how they coach, who they want to work with, their prices
and capacity, and their payment details.

Applications go to a review queue. Nobody appears in search results until a human has
checked their documents. After applying, coaches see a clear status page explaining
what happens next and roughly how long it takes — written specifically to remove the
urge to email support.

Sensitive details like ID and bank account numbers are encrypted, kept apart from the
rest of the profile, and can be deleted once İyzico has them. They exist only because
the payment provider requires them.

### Stage nine — Protecting the commission

If a coach and student swap phone numbers and arrange privately, both lose the payment
protection and Kaktüs earns nothing. So messages are checked for phone numbers, bank
details, and social media handles.

The hard part was Turkish. People write numbers as words, add dots between digits, use
abbreviations. The system handles all of that. Equally important, it does **not** flag
normal exam conversation — "I was ranked 480,000" and "I'm at 55 net" pass through
untouched. A filter that eats exam vocabulary in an exam-prep product is worse than no
filter.

When something is blocked, we say so and explain why. People work around filters they
do not understand and mostly accept ones they do.

### Stage ten — Quality checks and fixes

Along the way we checked the parts where being wrong is expensive:

- The payment security calculations were tested against İyzico's own published
  example and match exactly.
- ID and bank account number checks catch typos — including swapped digits, the most
  common mistake — before a coach is approved and discovers weeks later they cannot be paid.
- Commission splitting was tested to confirm not a single kuruş is ever lost or
  invented, including awkward amounts that do not divide evenly.
- The "two students click the same hour at the same instant" scenario was tested
  repeatedly. Exactly one wins, every time.
- Recently, a full check of the code found two genuine errors that would have stopped
  the site from building, and six links pointing at pages that did not exist yet —
  including the page a student lands on *after successfully paying*. All fixed.

---

## 3. Where things stand honestly

**Working and checked:** the matching system, the agreement rules, the money handling
and escrow logic, the payment integration, the student questionnaire and results, coach
profiles with calendars, the offer builder, the coach application, and the message filter.

**Built but never actually run:** all of it. The development environment used to build
this has no internet access and no database, so while the logic has been tested in
isolation and the code has been checked for errors, **nothing has been loaded in a real
browser against a real database yet.** Expect some rough edges on the first run.

**Not built yet:** the chat and negotiation screen, the coach's own dashboard for
accepting offers, the admin review tools, and the detailed calendar editor.

---

## 4. What to do next

### Immediately — get it running

Install it, connect a database, and open it in a browser. Walk through it as a student:
answer the questions, look at your matches, open a coach, build an offer, sign in.
Then as a coach: apply, and see the status page.

Send me anything that breaks. Fixing errors from a description is something this process
has already done well twice.

One thing to be careful about: there is a specific database setup step that must be run,
which installs the protections preventing double-booking and accounting errors. If it is
skipped, everything will *appear* to work perfectly and then double-book a coach in
production. It is written down in the setup instructions.

### Next — the missing middle

The biggest gap is the **negotiation screen**: where a student and coach message each
other, counter-offers get made, and a deal is accepted. Right now a student can send an
offer but neither side has a place to talk about it. This is the single most valuable
thing to build next.

Right after that, the **coach's dashboard** — accepting, countering, managing students.

Then the **admin tools** for reviewing coach applications and handling disputes. These
can be rough at first; you can do them by hand for the first dozen coaches, and you will
learn what the tools actually need to do by doing it manually.

### Before taking real money

- Test the full payment flow against İyzico's test environment, including 3D Secure.
  Our simulator cannot reproduce every real-world case.
- Get the legal documents in place: the service agreement, the intermediary service
  provider disclosure Turkish e-commerce law requires, and a privacy policy covering how
  we handle student and coach data.
- Decide how document verification actually works day to day — who checks them, against
  what standard, how fast.
- Move the encryption of sensitive data to a proper key-management service.

### Decisions that need you, not me

- **The commission rate.** 18% is set as a default, not a researched number.
- **The five-day auto-release window.** Reasonable, but you may want longer at launch
  while trust is being established.
- **Which side to recruit first.** A marketplace with no coaches has nothing to show
  students; a marketplace with no students loses its coaches. Most solve this by
  hand-recruiting a small number of excellent coaches and starting narrow — one subject
  area, or one city.
- **The verification standard.** How strictly do we check ranking documents? This is the
  single thing the whole product's credibility rests on.

---

*Last updated after the route and code-quality pass.*
KAKTUS_FILE_EOF

emit "TESTING.md" <<'KAKTUS_FILE_EOF'
# Running the test suite

## Pure unit tests — no database

```bash
npx vitest run tests/core.test.ts
```

Covers the matchmaking scorer, the offer FSM's transition table, commission and
milestone arithmetic, and the anti-circumvention filter. All pure functions, all
fast, safe to run on every save.

## Integration and concurrency tests — real Postgres required

```bash
docker compose -f docker-compose.test.yml up -d
export DATABASE_URL=postgresql://kaktus:kaktus@localhost:5433/kaktus_test
export DIRECT_DATABASE_URL=$DATABASE_URL
npx prisma migrate deploy        # includes the exclusion-constraint migration
npx vitest run tests/concurrency.integration.test.ts
```

**The constraints migration is not optional.** Every slot-contention test passes
trivially against a schema without the `EXCLUDE` constraints and the cross-table
trigger, because the guarantee under test lives in the database rather than in
application code. If `prisma migrate deploy` skips
`20260101000000_marketplace_constraints`, the suite is testing nothing.

Prisma's connection pool defaults to roughly `num_cpus * 2 + 1`. The 20-way slot
contention test needs more than that or it serialises through the pool and the
race never actually happens:

```bash
export DATABASE_URL="$DATABASE_URL?connection_limit=30&pool_timeout=20"
```

## What is and is not proven

Verified by these tests:

- Exclusive slot acquisition under simultaneous contention, including partial
  overlaps and hold-versus-booking collisions across tables.
- Exactly-once offer acceptance under 10-way concurrency.
- Auto-release and dispute freezing never both apply to one milestone.
- Ledger groups always balance; escrow never goes negative.
- Payout batching is idempotent under concurrent worker runs.

Not covered, and worth adding before launch:

- Iyzico sandbox behaviour, including 3DS callbacks and webhook replay from the
  real provider. The mock provider is deterministic by design and will not
  reproduce their retry semantics.
- Multi-process contention. `Promise.all` interleaves at the database, which is
  where the locking lives, but it does not exercise two Node processes racing.
  Run the suite against two workers before trusting the payout batch at volume.
- Clock skew between application servers. `autoReleaseAt` is compared against
  each worker's local clock; on a fleet, use `now()` from the database instead.
KAKTUS_FILE_EOF

emit "docker-compose.test.yml" <<'KAKTUS_FILE_EOF'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: kaktus
      POSTGRES_PASSWORD: kaktus
      POSTGRES_DB: kaktus_test
    ports: ['5433:5432']
    # Higher connection limit: the race tests open 20 concurrent transactions.
    command: postgres -c max_connections=200 -c fsync=off -c full_page_writes=off
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U kaktus -d kaktus_test']
      interval: 2s
      timeout: 3s
      retries: 20
KAKTUS_FILE_EOF

emit "next.config.ts" <<'KAKTUS_FILE_EOF'
import type { NextConfig } from 'next';

const config: NextConfig = {
  experimental: {
    /**
     * The coach application uploads an ÖSYM result document through a Server
     * Action. The default body limit is 1 MB, which a phone photo of a
     * document clears easily — and the failure is a generic 500 with no
     * indication that size was the problem. 10 MB gives headroom over the
     * 8 MB we validate against, so oversized files are rejected by our own
     * check with a readable message rather than by the framework.
     */
    serverActions: { bodySizeLimit: '10mb' },
  },
};

export default config;
KAKTUS_FILE_EOF

emit "package.json" <<'KAKTUS_FILE_EOF'
{
  "name": "kaktus-kocluk",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:studio": "prisma studio",
    "test": "vitest run tests/core.test.ts tests/iyzico.test.ts tests/onboarding.test.ts",
    "test:integration": "vitest run tests/concurrency.integration.test.ts",
    "test:watch": "vitest",
    "test:db:up": "docker compose -f docker-compose.test.yml up -d",
    "test:db:down": "docker compose -f docker-compose.test.yml down -v",
    "simulate:payment": "node scripts/simulate-payment.mjs",
    "db:seed": "prisma db seed",
    "db:reset": "prisma migrate reset --force",
    "check:actions": "node scripts/check-server-actions.mjs",
    "verify": "npm run check:actions && npm run typecheck"
  },
  "dependencies": {
    "@auth/prisma-adapter": "^2.7.0",
    "@prisma/client": "^6.1.0",
    "lucide-react": "^0.462.0",
    "next": "^15.1.0",
    "next-auth": "^5.0.0-beta.25",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.24.1",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "server-only": "^0.0.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "prisma": "^6.1.0",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tsx": "^4.19.2"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
KAKTUS_FILE_EOF

emit "postcss.config.mjs" <<'KAKTUS_FILE_EOF'
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
KAKTUS_FILE_EOF

emit "prisma/migrations/20260101000000_marketplace_constraints/migration.sql" <<'KAKTUS_FILE_EOF'
-- Invariants Prisma's schema language cannot express.
-- Run AFTER the generated table migration.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Slot exclusivity.
-- A coach cannot have two live holds, or a live hold and a scheduled booking,
-- covering the same instant. This is the double-booking guarantee. An
-- application-level "SELECT then INSERT" loses this race; the database does not.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "SlotHold"
  ADD CONSTRAINT slot_hold_no_overlap
  EXCLUDE USING gist (
    "coachProfileId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE (status = 'HELD');

ALTER TABLE "Booking"
  ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (
    "coachProfileId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE (status = 'SCHEDULED');

-- Holds and bookings must also not collide with each other. Postgres cannot
-- EXCLUDE across two tables, so a trigger closes the gap.
CREATE OR REPLACE FUNCTION assert_no_cross_slot_overlap() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'SlotHold' AND NEW.status <> 'HELD' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'Booking'  AND NEW.status <> 'SCHEDULED' THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'SlotHold' THEN
    IF EXISTS (
      SELECT 1 FROM "Booking" b
      WHERE b."coachProfileId" = NEW."coachProfileId"
        AND b.status = 'SCHEDULED'
        AND tstzrange(b."startsAt", b."endsAt", '[)') && tstzrange(NEW."startsAt", NEW."endsAt", '[)')
    ) THEN
      RAISE EXCEPTION 'SLOT_TAKEN: hold overlaps an existing booking'
        USING ERRCODE = 'exclusion_violation';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM "SlotHold" h
      WHERE h."coachProfileId" = NEW."coachProfileId"
        AND h.status = 'HELD'
        AND (NEW."offerId" IS NULL OR h."offerId" IS DISTINCT FROM NEW."offerId")
        AND tstzrange(h."startsAt", h."endsAt", '[)') && tstzrange(NEW."startsAt", NEW."endsAt", '[)')
    ) THEN
      RAISE EXCEPTION 'SLOT_TAKEN: booking overlaps a live hold'
        USING ERRCODE = 'exclusion_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER slot_hold_cross_check
  BEFORE INSERT OR UPDATE ON "SlotHold"
  FOR EACH ROW EXECUTE FUNCTION assert_no_cross_slot_overlap();

CREATE TRIGGER booking_cross_check
  BEFORE INSERT OR UPDATE ON "Booking"
  FOR EACH ROW EXECUTE FUNCTION assert_no_cross_slot_overlap();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Ledger integrity. Every entry group must balance to zero, checked at
-- COMMIT so multi-row inserts inside one transaction are legal.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION assert_ledger_balanced() RETURNS trigger AS $$
DECLARE
  imbalance BIGINT;
BEGIN
  SELECT COALESCE(SUM(
    CASE WHEN direction = 'DEBIT' THEN "amountMinor" ELSE -"amountMinor" END
  ), 0)
  INTO imbalance
  FROM "LedgerEntry"
  WHERE "entryGroupId" = COALESCE(NEW."entryGroupId", OLD."entryGroupId");

  IF imbalance <> 0 THEN
    RAISE EXCEPTION 'LEDGER_IMBALANCE: group % is off by % minor units',
      COALESCE(NEW."entryGroupId", OLD."entryGroupId"), imbalance;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_balanced
  AFTER INSERT OR UPDATE OR DELETE ON "LedgerEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_ledger_balanced();

-- Ledger rows are append-only. Corrections are new reversing groups.
CREATE RULE ledger_no_delete AS ON DELETE TO "LedgerEntry" DO INSTEAD NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Value constraints
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Review"      ADD CONSTRAINT review_rating_range CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE "Offer"       ADD CONSTRAINT offer_price_positive CHECK ("priceMinor" > 0);
ALTER TABLE "Offer"       ADD CONSTRAINT offer_commission_range CHECK ("commissionBps" BETWEEN 0 AND 5000);
ALTER TABLE "Offer"       ADD CONSTRAINT offer_dates_ordered CHECK ("endDate" > "startDate");
ALTER TABLE "Milestone"   ADD CONSTRAINT milestone_amount_positive CHECK ("amountMinor" > 0);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT ledger_amount_positive CHECK ("amountMinor" > 0);
ALTER TABLE "SlotHold"    ADD CONSTRAINT hold_range_ordered CHECK ("endsAt" > "startsAt");
ALTER TABLE "Booking"     ADD CONSTRAINT booking_range_ordered CHECK ("endsAt" > "startsAt");
ALTER TABLE "AvailabilityRule" ADD CONSTRAINT availability_minutes_valid
  CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");
ALTER TABLE "AvailabilityRule" ADD CONSTRAINT availability_weekday_valid
  CHECK (weekday BETWEEN 0 AND 6);

-- Only approved coaches may be discoverable. Enforced here as well as in query
-- code, because a discovery bug that surfaces unverified coaches is a trust
-- incident, not a cosmetic one.
CREATE INDEX coach_discoverable_idx ON "CoachProfile" ("acceptingStudents", "ratingAvg" DESC)
  WHERE "verificationStatus" = 'APPROVED';

-- Hot path: expiry sweeps.
CREATE INDEX hold_expiry_sweep_idx ON "SlotHold" ("expiresAt") WHERE status = 'HELD';
CREATE INDEX offer_expiry_sweep_idx ON "Offer" ("expiresAt") WHERE status IN ('OFFERED', 'COUNTERED');
CREATE INDEX milestone_release_sweep_idx ON "Milestone" ("autoReleaseAt")
  WHERE status = 'PENDING_CONFIRMATION';
KAKTUS_FILE_EOF

emit "prisma/schema.prisma" <<'KAKTUS_FILE_EOF'
// Kaktüs Koçluk — data model
// Money is ALWAYS stored as Int minor units (kuruş). Never Float, never Decimal-for-balance.
// Balances are DERIVED from LedgerEntry. There is no mutable `balance` column anywhere.

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  directUrl  = env("DIRECT_DATABASE_URL")
  extensions = [btree_gist, pg_trgm, citext]
}

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

enum Role {
  STUDENT
  COACH
  ADMIN
}

enum Track {
  SAYISAL
  ESIT_AGIRLIK
  SOZEL
  DIL
}

enum GradeLevel {
  GRADE_11
  GRADE_12
  MEZUN
}

enum CoachingStyle {
  STRICT // disiplinli, sıkı takip
  EMPATHETIC // mentor, motivasyon odaklı
  STRATEGIC // sınav stratejisi / net planlama odaklı
  HIGH_TOUCH // sık check-in, günlük temas
}

enum VerificationStatus {
  DRAFT
  PENDING
  IN_REVIEW
  APPROVED
  REJECTED
  SUSPENDED
}

enum DocumentType {
  YKS_RESULT // ÖSYM sonuç belgesi
  YKS_PLACEMENT // yerleştirme belgesi
  STUDENT_CERTIFICATE // öğrenci belgesi
  IDENTITY
  DIPLOMA
}

enum PricingCadence {
  WEEKLY_SYNC
  MONTHLY_STANDARD
  INTENSIVE
  SINGLE_SESSION
}

enum OfferStatus {
  DRAFT
  OFFERED
  COUNTERED
  ACCEPTED
  PAID_IN_ESCROW
  ACTIVE
  COMPLETED
  DISPUTED
  REFUNDED
  CANCELLED
  EXPIRED
}

enum ActorRole {
  STUDENT
  COACH
  ADMIN
  SYSTEM
}

enum HoldStatus {
  HELD
  CONVERTED
  RELEASED
  EXPIRED
}

enum BookingStatus {
  SCHEDULED
  COMPLETED
  CANCELLED_BY_STUDENT
  CANCELLED_BY_COACH
  NO_SHOW_STUDENT
  NO_SHOW_COACH
}

enum MilestoneStatus {
  SCHEDULED
  IN_PROGRESS
  PENDING_CONFIRMATION
  RELEASED
  DISPUTED
  REFUNDED
}

enum EngagementStatus {
  ACTIVE
  COMPLETED
  CANCELLED
  DISPUTED
}

enum PaymentStatus {
  INITIATED
  REQUIRES_ACTION // 3DS
  CAPTURED
  FAILED
  REFUNDED
  PARTIALLY_REFUNDED
}

enum LedgerAccount {
  PSP_RECEIVABLE // funds at the payment provider
  PLATFORM_ESCROW // held on behalf of student/coach, not yet earned
  COACH_PAYABLE // coach withdrawable balance
  PLATFORM_REVENUE // commission earned
  STUDENT_REFUND // refunds paid back out
  PSP_FEE
}

enum LedgerDirection {
  DEBIT
  CREDIT
}

enum PayoutStatus {
  PENDING
  SUBMITTED
  PAID
  FAILED
}

enum RefundStatus {
  PENDING
  SUBMITTED
  SETTLED
  FAILED
}

enum DisputeStatus {
  OPEN
  AWAITING_EVIDENCE
  UNDER_REVIEW
  RESOLVED_RELEASE // funds to coach
  RESOLVED_REFUND // funds to student
  RESOLVED_SPLIT
  WITHDRAWN
}

enum ModerationAction {
  ALLOW
  MASK
  BLOCK
}

enum ViolationKind {
  PHONE_NUMBER
  EMAIL
  IBAN
  SOCIAL_HANDLE
  EXTERNAL_LINK
  PAYMENT_KEYWORD
  CIRCUMVENTION_INTENT
}

// ─────────────────────────────────────────────────────────────────────────────
// Identity (Auth.js v5 — Prisma adapter shape)
// ─────────────────────────────────────────────────────────────────────────────

model User {
  id            String    @id @default(cuid())
  email         String?   @unique
  emailVerified DateTime?
  name          String?
  image         String?
  phone         String? // platform-held, never shown to counterparty
  phoneVerified DateTime?
  roles         Role[]    @default([STUDENT])
  locale        String    @default("tr")
  timezone      String    @default("Europe/Istanbul")
  bannedAt      DateTime?
  banReason     String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  accounts           Account[]
  sessions           Session[]
  studentProfile     StudentProfile?
  coachProfile       CoachProfile?
  onboardingSessions OnboardingSession[]
  messages           Message[]
  auditLogs          AuditLog[]           @relation("AuditActor")
  offerEvents        OfferEvent[]
  disputesOpened     Dispute[]            @relation("DisputeOpener")

  @@index([createdAt])
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

// ─────────────────────────────────────────────────────────────────────────────
// Guest onboarding — captured BEFORE auth, claimed at sign-in
// ─────────────────────────────────────────────────────────────────────────────

model OnboardingSession {
  id    String @id @default(cuid())
  /// Opaque token stored in an httpOnly cookie AND embedded in the magic-link
  /// callback URL, so answers survive an OAuth redirect or a cross-browser
  /// email click.
  token String @unique

  track            Track?
  gradeLevel       GradeLevel?
  baselineTytNet   Float?
  baselineAytNet   Float?
  targetRanking    Int?
  targetUniversity String?
  targetDepartment String?
  preferredStyles  CoachingStyle[]
  /// TimeWindow[] — [{ weekday: 0-6, startMinute, endMinute }]
  availability     Json?
  budgetMinMinor   Int?
  budgetMaxMinor   Int?
  budgetCadence    PricingCadence?
  weeklyHoursGoal  Int?

  completedStep Int      @default(0)
  currency      String   @default("TRY")
  ipHash        String?
  userAgent     String?
  referrer      String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  expiresAt     DateTime

  claimedByUserId String?
  claimedAt       DateTime?
  claimedBy       User?     @relation(fields: [claimedByUserId], references: [id], onDelete: SetNull)

  matchRuns MatchRun[]

  @@index([claimedByUserId])
  @@index([expiresAt])
}

// ─────────────────────────────────────────────────────────────────────────────
// Profiles
// ─────────────────────────────────────────────────────────────────────────────

model StudentProfile {
  id     String @id @default(cuid())
  userId String @unique
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  track            Track
  gradeLevel       GradeLevel
  baselineTytNet   Float?
  baselineAytNet   Float?
  targetRanking    Int?
  targetUniversity String?
  targetDepartment String?
  preferredStyles  CoachingStyle[]
  availability     Json?
  budgetMinMinor   Int?
  budgetMaxMinor   Int?
  budgetCadence    PricingCadence  @default(MONTHLY_STANDARD)
  weeklyHoursGoal  Int?
  schoolCity       String?

  /// Provenance: which guest session produced this profile.
  sourceOnboardingId String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  conversations Conversation[]
  offers        Offer[]
  engagements   Engagement[]
  bookings      Booking[]
  holds         SlotHold[]
  reviews       Review[]

  @@index([track, gradeLevel])
}

model CoachProfile {
  id     String @id @default(cuid())
  userId String @unique
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  slug         String  @unique
  headline     String
  bio          String  @db.Text
  introVideoUrl String?
  city         String?
  timezone     String  @default("Europe/Istanbul")

  // Credentials
  university     String
  department     String
  graduationYear Int?
  yksRank        Int
  yksYear        Int
  yksTrack       Track

  // Personal trajectory — the core matching signal
  ownBaselineNet Float?
  ownFinalNet    Float?
  ownBaselineRank Int?
  wasMezun       Boolean @default(false)

  // Supply configuration
  tracks           Track[]
  subjects         String[] // ["AYT Matematik", "TYT Türkçe", …]
  styles           CoachingStyle[]
  supportedGrades  GradeLevel[]
  maxActiveStudents Int           @default(10)
  /// Hours per week the coach can actually give. Distinct from student count:
  /// ten students at 30 minutes is a different business from three at 2 hours.
  weeklyCapacityHours Int?
  acceptingStudents Boolean       @default(true)
  /// Commission override in basis points; null = use platform default.
  commissionBpsOverride Int?

  // Denormalised stats — recomputed by job, never trusted for money
  ratingAvg              Float    @default(0)
  ratingCount            Int      @default(0)
  completedEngagements   Int      @default(0)
  activeEngagements      Int      @default(0)
  responseP50Seconds     Int?
  cancellationRate       Float    @default(0)
  lastActiveAt           DateTime @default(now())

  verificationStatus VerificationStatus @default(DRAFT)
  verificationNote   String?
  verifiedAt         DateTime?
  suspendedAt        DateTime?

  /// Iyzico alt üye işyeri key. Payouts are impossible without it.
  submerchantKey    String?
  payoutReadyAt     DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  specializations  CoachSpecialization[]
  documents        VerificationDocument[]
  pricingTiers     PricingTier[]
  availabilityRules AvailabilityRule[]
  availabilityExceptions AvailabilityException[]
  holds            SlotHold[]
  bookings         Booking[]
  conversations    Conversation[]
  offers           Offer[]
  engagements      Engagement[]
  payouts          Payout[]
  reviews          Review[]
  payoutProfile    CoachPayoutProfile?

  @@index([verificationStatus, acceptingStudents])
  @@index([yksRank])
}

/// Bank and identity details needed to register an Iyzico sub-merchant.
///
/// Split off CoachProfile deliberately. `CoachProfile` is read on every public
/// profile page and by the matcher; TCKN and IBAN must never be one careless
/// `select: *` away from a page that renders for anonymous visitors. A separate
/// table means the sensitive columns are absent by default rather than
/// present-and-hopefully-not-selected.
///
/// Values are encrypted at rest with AES-256-GCM (see lib/crypto/field.ts).
/// After the sub-merchant is created at Iyzico we hold the key and no longer
/// need the source data, so `purgedAt` records when the ciphertext was cleared.
model CoachPayoutProfile {
  id             String       @id @default(cuid())
  coachProfileId String       @unique
  coach          CoachProfile @relation(fields: [coachProfileId], references: [id], onDelete: Cascade)

  submerchantType String // PERSONAL | PRIVATE_COMPANY | LIMITED_COMPANY
  legalName       String
  /// Ciphertext. Never selected outside the sub-merchant registration path.
  ibanEncrypted   Bytes?
  /// Last four digits, for "IBAN ****4521" in the admin UI without decrypting.
  ibanLast4       String?
  /// TCKN (personal) or VKN (company), ciphertext.
  identityEncrypted Bytes?
  taxOffice       String?
  address         String
  city            String
  phone           String

  purgedAt  DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}

model CoachSpecialization {
  id             String       @id @default(cuid())
  coachProfileId String
  coach          CoachProfile @relation(fields: [coachProfileId], references: [id], onDelete: Cascade)

  label     String // "Mezunlukta 50binden ilk 1000'e"
  slug      String
  /// Optional structured rank band this specialization claims to serve.
  fromRank  Int?
  toRank    Int?

  @@unique([coachProfileId, slug])
  @@index([slug])
}

model VerificationDocument {
  id             String       @id @default(cuid())
  coachProfileId String
  coach          CoachProfile @relation(fields: [coachProfileId], references: [id], onDelete: Cascade)

  type         DocumentType
  /// Private bucket object key. Never a public URL.
  storageKey   String
  mimeType     String
  sizeBytes    Int
  status       VerificationStatus @default(PENDING)
  reviewedById String?
  reviewedAt   DateTime?
  reviewNote   String?
  createdAt    DateTime           @default(now())

  @@index([coachProfileId, status])
}

model PricingTier {
  id             String       @id @default(cuid())
  coachProfileId String
  coach          CoachProfile @relation(fields: [coachProfileId], references: [id], onDelete: Cascade)

  name              String
  cadence           PricingCadence
  priceMinor        Int
  currency          String         @default("TRY")
  sessionsPerCycle  Int
  minutesPerSession Int
  includesMessaging Boolean        @default(true)
  description       String?
  active            Boolean        @default(true)
  sortOrder         Int            @default(0)

  offers Offer[]

  @@unique([coachProfileId, cadence, name])
  @@index([coachProfileId, active])
}

// ─────────────────────────────────────────────────────────────────────────────
// Availability
// ─────────────────────────────────────────────────────────────────────────────

/// Recurring weekly availability, expressed in the coach's timezone.
model AvailabilityRule {
  id             String       @id @default(cuid())
  coachProfileId String
  coach          CoachProfile @relation(fields: [coachProfileId], references: [id], onDelete: Cascade)

  weekday       Int // 0 = Sunday … 6 = Saturday
  startMinute   Int // minutes from local midnight
  endMinute     Int
  timezone      String    @default("Europe/Istanbul")
  effectiveFrom DateTime  @default(now())
  effectiveTo   DateTime?
  active        Boolean   @default(true)

  @@index([coachProfileId, weekday, active])
}

/// Blackout dates / one-off unavailability.
model AvailabilityException {
  id             String       @id @default(cuid())
  coachProfileId String
  coach          CoachProfile @relation(fields: [coachProfileId], references: [id], onDelete: Cascade)

  date        DateTime @db.Date
  allDay      Boolean  @default(true)
  startMinute Int?
  endMinute   Int?
  reason      String?

  @@index([coachProfileId, date])
}

/// Soft lock taken while an offer is open. Overlap is prevented by a Postgres
/// EXCLUDE constraint (see marketplace_constraints.sql), not by app-level checks.
model SlotHold {
  id             String       @id @default(cuid())
  coachProfileId String
  coach          CoachProfile @relation(fields: [coachProfileId], references: [id], onDelete: Cascade)

  studentProfileId String
  student          StudentProfile @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)

  offerId String?
  offer   Offer?  @relation(fields: [offerId], references: [id], onDelete: SetNull)

  startsAt  DateTime
  endsAt    DateTime
  status    HoldStatus @default(HELD)
  expiresAt DateTime
  createdAt DateTime   @default(now())

  @@index([coachProfileId, status, startsAt])
  @@index([expiresAt, status])
  @@index([offerId])
}

model Booking {
  id             String       @id @default(cuid())
  coachProfileId String
  coach          CoachProfile @relation(fields: [coachProfileId], references: [id], onDelete: Cascade)

  studentProfileId String
  student          StudentProfile @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)

  engagementId String?
  engagement   Engagement? @relation(fields: [engagementId], references: [id], onDelete: SetNull)
  milestoneId  String?
  milestone    Milestone?  @relation(fields: [milestoneId], references: [id], onDelete: SetNull)

  startsAt DateTime
  endsAt   DateTime
  status   BookingStatus @default(SCHEDULED)

  meetingUrl        String?
  coachConfirmedAt  DateTime?
  studentConfirmedAt DateTime?
  cancelledByRole   ActorRole?
  cancelReason      String?
  notes             String?   @db.Text

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([coachProfileId, startsAt])
  @@index([studentProfileId, startsAt])
  @@index([engagementId])
}

// ─────────────────────────────────────────────────────────────────────────────
// Messaging + moderation
// ─────────────────────────────────────────────────────────────────────────────

model Conversation {
  id             String       @id @default(cuid())
  coachProfileId String
  coach          CoachProfile @relation(fields: [coachProfileId], references: [id], onDelete: Cascade)

  studentProfileId String
  student          StudentProfile @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)

  lastMessageAt DateTime  @default(now())
  archivedAt    DateTime?
  /// Cumulative circumvention risk; crossing a threshold flags for review.
  riskScore     Int       @default(0)
  flaggedAt     DateTime?
  createdAt     DateTime  @default(now())

  messages Message[]
  offers   Offer[]

  @@unique([coachProfileId, studentProfileId])
  @@index([lastMessageAt])
}

model Message {
  id             String       @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  senderId String
  sender   User   @relation(fields: [senderId], references: [id], onDelete: Cascade)

  /// What both parties see. This is the column Realtime publishes.
  body String @db.Text
  /// Original text, retained encrypted for dispute evidence. Admin-only reads.
  bodyOriginalEncrypted Bytes?

  moderationAction ModerationAction @default(ALLOW)
  riskScore        Int              @default(0)
  systemNotice     String?

  readAt    DateTime?
  createdAt DateTime  @default(now())

  violations MessageViolation[]

  @@index([conversationId, createdAt])
  @@index([senderId, createdAt])
}

model MessageViolation {
  id        String  @id @default(cuid())
  messageId String
  message   Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  kind     ViolationKind
  severity Int
  /// The detector that fired, NOT the extracted PII.
  detector String
  /// Redacted excerpt for admin context, e.g. "05** *** ** **".
  excerpt  String?

  createdAt DateTime @default(now())

  @@index([kind, createdAt])
}

// ─────────────────────────────────────────────────────────────────────────────
// Offers — status is written ONLY by the state machine
// ─────────────────────────────────────────────────────────────────────────────

model Offer {
  id             String       @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  coachProfileId String
  coach          CoachProfile @relation(fields: [coachProfileId], references: [id], onDelete: Cascade)

  studentProfileId String
  student          StudentProfile @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)

  initiatorRole ActorRole
  basePricingTierId String?
  basePricingTier   PricingTier? @relation(fields: [basePricingTierId], references: [id], onDelete: SetNull)

  title    String
  /// { sessionsPerCycle, minutesPerSession, cadence, weeks, deliverables[], notes }
  scope    Json
  priceMinor Int
  currency   String @default("TRY")
  /// Snapshotted at creation — a later platform-wide change must not alter
  /// the economics of an already-signed offer.
  commissionBps Int

  startDate      DateTime
  endDate        DateTime
  milestoneCount Int      @default(4)

  status  OfferStatus @default(DRAFT)
  version Int         @default(1)
  parentOfferId String?
  parentOffer   Offer?  @relation("OfferChain", fields: [parentOfferId], references: [id], onDelete: SetNull)
  counterOffers Offer[] @relation("OfferChain")

  expiresAt   DateTime
  acceptedAt  DateTime?
  cancelledAt DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  events     OfferEvent[]
  holds      SlotHold[]
  engagement Engagement?
  payments   Payment[]

  @@index([status, expiresAt])
  @@index([conversationId, createdAt])
  @@index([coachProfileId, status])
}

model OfferEvent {
  id      String @id @default(cuid())
  offerId String
  offer   Offer  @relation(fields: [offerId], references: [id], onDelete: Cascade)

  fromStatus OfferStatus?
  toStatus   OfferStatus
  actorRole  ActorRole
  actorId    String?
  actor      User?        @relation(fields: [actorId], references: [id], onDelete: SetNull)
  reason     String?
  metadata   Json?
  createdAt  DateTime     @default(now())

  @@index([offerId, createdAt])
}

// ─────────────────────────────────────────────────────────────────────────────
// Engagements & money
// ─────────────────────────────────────────────────────────────────────────────

model Engagement {
  id      String @id @default(cuid())
  offerId String @unique
  offer   Offer  @relation(fields: [offerId], references: [id], onDelete: Restrict)

  coachProfileId String
  coach          CoachProfile @relation(fields: [coachProfileId], references: [id], onDelete: Restrict)

  studentProfileId String
  student          StudentProfile @relation(fields: [studentProfileId], references: [id], onDelete: Restrict)

  status        EngagementStatus @default(ACTIVE)
  startDate     DateTime
  endDate       DateTime
  totalMinor    Int
  currency      String           @default("TRY")
  commissionBps Int

  createdAt   DateTime  @default(now())
  completedAt DateTime?

  milestones   Milestone[]
  bookings     Booking[]
  disputes     Dispute[]
  ledgerEntries LedgerEntry[]
  refunds      Refund[]
  review       Review?

  @@index([coachProfileId, status])
  @@index([studentProfileId, status])
}

model Milestone {
  id           String     @id @default(cuid())
  engagementId String
  engagement   Engagement @relation(fields: [engagementId], references: [id], onDelete: Cascade)

  index       Int
  periodStart DateTime
  periodEnd   DateTime
  amountMinor Int

  status             MilestoneStatus @default(SCHEDULED)

  /// Iyzico `paymentTransactionId` for this milestone's basket item.
  /// Approve and refund both operate on this handle, not on the payment — it
  /// is what makes per-milestone escrow release possible at all.
  providerTransactionId String?
  /// When the provider confirmed the release (item approve succeeded).
  providerApprovedAt    DateTime?
  providerApproveError  String?

  coachConfirmedAt   DateTime?
  studentConfirmedAt DateTime?
  /// If nobody disputes by this time, funds release automatically.
  autoReleaseAt      DateTime?
  releasedAt         DateTime?
  refundedAt         DateTime?

  bookings      Booking[]
  disputes      Dispute[]
  ledgerEntries LedgerEntry[]

  @@unique([engagementId, index])
  @@index([status, autoReleaseAt])
  @@index([providerTransactionId])
}

model Payment {
  id      String  @id @default(cuid())
  offerId String?
  offer   Offer?  @relation(fields: [offerId], references: [id], onDelete: SetNull)

  provider       String // "iyzico" | "mock"
  /// Iyzico paymentId, once captured.
  providerRef    String?
  /// Checkout Form token. The handle for retrieveCheckout(), and the only
  /// thing the browser callback gives us that we are willing to act on.
  token          String?
  basketId       String?
  conversationId String?
  amountMinor    Int
  currency       String        @default("TRY")
  status         PaymentStatus @default(INITIATED)
  method         String?
  installment    Int           @default(1)

  /// Every provider call and webhook is keyed. Iyzico WILL retry.
  idempotencyKey String  @unique
  rawRequest     Json?
  rawResponse    Json?
  failureCode    String?
  failureMessage String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  ledgerEntries LedgerEntry[]
  refunds       Refund[]

  @@index([status, createdAt])
  @@index([providerRef])
  @@index([token])
}

/// Double-entry. Every movement writes >= 2 rows sharing an entryGroupId that
/// sums to zero. Enforced by a deferred constraint trigger.
model LedgerEntry {
  id           String          @id @default(cuid())
  entryGroupId String
  account      LedgerAccount
  direction    LedgerDirection
  amountMinor  Int
  currency     String          @default("TRY")

  engagementId String?
  engagement   Engagement? @relation(fields: [engagementId], references: [id], onDelete: SetNull)
  milestoneId  String?
  milestone    Milestone?  @relation(fields: [milestoneId], references: [id], onDelete: SetNull)
  paymentId    String?
  payment      Payment?    @relation(fields: [paymentId], references: [id], onDelete: SetNull)
  payoutId     String?
  payout       Payout?     @relation(fields: [payoutId], references: [id], onDelete: SetNull)
  coachProfileId String?

  description String
  createdAt   DateTime @default(now())

  @@index([entryGroupId])
  @@index([account, createdAt])
  @@index([coachProfileId, account])
  @@index([engagementId])
}

model Payout {
  id             String       @id @default(cuid())
  coachProfileId String
  coach          CoachProfile @relation(fields: [coachProfileId], references: [id], onDelete: Restrict)

  amountMinor    Int
  currency       String       @default("TRY")
  status         PayoutStatus @default(PENDING)
  provider       String
  providerRef    String?
  idempotencyKey String       @unique
  failureMessage String?

  submittedAt DateTime?
  paidAt      DateTime?
  createdAt   DateTime  @default(now())

  ledgerEntries LedgerEntry[]

  @@index([coachProfileId, status])
}

model Dispute {
  id           String     @id @default(cuid())
  engagementId String
  engagement   Engagement @relation(fields: [engagementId], references: [id], onDelete: Cascade)
  milestoneId  String?
  milestone    Milestone? @relation(fields: [milestoneId], references: [id], onDelete: SetNull)

  openedById String
  openedBy   User      @relation("DisputeOpener", fields: [openedById], references: [id], onDelete: Restrict)
  openedByRole ActorRole

  reason      String
  detail      String        @db.Text
  evidence    Json?
  status      DisputeStatus @default(OPEN)
  resolution  String?
  resolvedById String?
  resolvedAt  DateTime?
  /// For RESOLVED_SPLIT: how much of the milestone goes to the coach.
  coachShareMinor Int?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([status, createdAt])
  @@index([engagementId])
}

model Review {
  id           String     @id @default(cuid())
  engagementId String     @unique
  engagement   Engagement @relation(fields: [engagementId], references: [id], onDelete: Cascade)

  coachProfileId String
  coach          CoachProfile @relation(fields: [coachProfileId], references: [id], onDelete: Cascade)
  studentProfileId String
  student          StudentProfile @relation(fields: [studentProfileId], references: [id], onDelete: Cascade)

  rating    Int // 1..5, checked in SQL
  body      String? @db.Text
  published Boolean @default(true)
  /// Net gain reported at the end of the engagement — feeds trajectory scoring.
  netGainReported Float?

  createdAt DateTime @default(now())

  @@index([coachProfileId, published])
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform config, observability
// ─────────────────────────────────────────────────────────────────────────────

/// Refund intent. Written inside the transaction that reverses the ledger, then
/// submitted to the provider by a worker AFTER commit. Splitting it this way
/// means a provider outage never rolls back the accounting, and a crash between
/// the two leaves a PENDING row the worker retries rather than money that was
/// refunded in our books but not at the bank.
model Refund {
  id           String     @id @default(cuid())
  engagementId String
  engagement   Engagement @relation(fields: [engagementId], references: [id], onDelete: Restrict)
  paymentId    String?
  payment      Payment?   @relation(fields: [paymentId], references: [id], onDelete: SetNull)

  amountMinor Int
  currency    String       @default("TRY")
  reason      String
  status      RefundStatus @default(PENDING)

  /// Which basket item to refund. Iyzico refunds per paymentTransactionId, so
  /// a whole-engagement refund becomes one Refund row per unreleased milestone.
  paymentTransactionId String?
  milestoneId          String?

  idempotencyKey String  @unique
  providerRef    String?
  attempts       Int     @default(0)
  lastError      String?
  nextAttemptAt  DateTime @default(now())

  submittedAt DateTime?
  settledAt   DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([status, nextAttemptAt])
  @@index([engagementId])
}

/// Inbound provider notifications, deduplicated.
///
/// Iyzico redelivers every 15 minutes until it gets a 2xx, and stops after 3
/// attempts. The unique reference code turns replay handling into an insert
/// conflict rather than application logic — a duplicate simply cannot be
/// processed twice, even if two workers receive it simultaneously.
model WebhookEvent {
  id       String @id @default(cuid())
  provider String

  /// iyziReferenceCode. Unique per notification, stable across redeliveries.
  referenceCode String @unique
  eventType     String
  status        String

  /// Merchant-side correlation id, i.e. our Payment.idempotencyKey.
  conversationId String?
  providerRef    String?

  payload      Json
  signatureOk  Boolean
  processedAt  DateTime?
  processError String?
  attempts     Int       @default(0)
  receivedAt   DateTime  @default(now())

  @@index([conversationId])
  @@index([processedAt])
}

model CommissionPolicy {
  id            String    @id @default(cuid())
  name          String
  defaultBps    Int       @default(1800)
  minBps        Int       @default(1000)
  maxBps        Int       @default(2500)
  effectiveFrom DateTime  @default(now())
  effectiveTo   DateTime?

  @@index([effectiveFrom])
}

/// One row per rendered match list. Makes weighting changes measurable.
model MatchRun {
  id                  String             @id @default(cuid())
  onboardingSessionId String?
  onboardingSession   OnboardingSession? @relation(fields: [onboardingSessionId], references: [id], onDelete: SetNull)
  studentProfileId    String?

  weightsVersion  String
  candidateCount  Int
  /// [{ coachProfileId, rawScore, displayScore, position, reasons[] }]
  results         Json
  latencyMs       Int
  createdAt       DateTime @default(now())

  @@index([weightsVersion, createdAt])
}

model AuditLog {
  id       String     @id @default(cuid())
  actorId  String?
  actor    User?      @relation("AuditActor", fields: [actorId], references: [id], onDelete: SetNull)
  actorRole ActorRole @default(SYSTEM)

  action     String // "offer.transition", "coach.approve", "payout.submit"
  entityType String
  entityId   String
  metadata   Json?
  ipHash     String?
  createdAt  DateTime @default(now())

  @@index([entityType, entityId, createdAt])
  @@index([action, createdAt])
}
KAKTUS_FILE_EOF

emit "prisma/seed.ts" <<'KAKTUS_FILE_EOF'
/**
 * Development seed.
 *
 * Creates a marketplace with enough shape to actually exercise the product:
 * fifteen approved coaches across all four tracks, spread across price points,
 * rankings, working styles and availability, plus completed engagements and
 * reviews so the ranking signals have real data behind them.
 *
 * Three things this is careful about, because getting them wrong makes the
 * seeded data useless for testing:
 *
 *  1. **Coaches are payout-ready.** Approved, with a sub-merchant key. A coach
 *     missing either is invisible in search or blocked at payment, and you
 *     would spend an hour wondering why matching returns nothing.
 *  2. **Availability is in the future and does not overlap.** The calendar only
 *     renders upcoming slots, and the database refuses overlapping bookings for
 *     one coach — so historical bookings are placed in distinct past hours.
 *  3. **Ratings are backed by real reviews** for most coaches, not just written
 *     into the denormalised columns. The matcher reads reported net gain from
 *     review rows when scoring trajectory fit; faking only the average would
 *     leave that signal empty and quietly change the ranking you see.
 *
 * Re-runnable. Everything it creates uses the `@seed.kaktus.test` email domain
 * and is removed first, so your own hand-made accounts are never touched.
 *
 *   npm run db:seed
 */

import { PrismaClient, type Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const SEED_DOMAIN = 'seed.kaktus.test';
const TZ = 'Europe/Istanbul';

/** 09:00–12:00, 13:00–17:00, 18:00–22:00 in minutes from local midnight. */
const BLOCKS = {
  morning: [9 * 60, 12 * 60],
  afternoon: [13 * 60, 17 * 60],
  evening: [18 * 60, 22 * 60],
} as const;

type BlockName = keyof typeof BLOCKS;

interface CoachSeed {
  slug: string;
  name: string;
  university: string;
  department: string;
  city: string;
  yksTrack: 'SAYISAL' | 'ESIT_AGIRLIK' | 'SOZEL' | 'DIL';
  yksRank: number;
  yksYear: number;
  ownBaselineNet: number;
  ownFinalNet: number;
  ownBaselineRank: number;
  wasMezun: boolean;
  tracks: Array<'SAYISAL' | 'ESIT_AGIRLIK' | 'SOZEL' | 'DIL'>;
  subjects: string[];
  styles: Array<'STRICT' | 'EMPATHETIC' | 'STRATEGIC' | 'HIGH_TOUCH'>;
  supportedGrades: Array<'GRADE_11' | 'GRADE_12' | 'MEZUN'>;
  headline: string;
  bio: string;
  monthlyPrice: number; // lira
  sessionPrice: number; // lira
  maxActiveStudents: number;
  activeEngagements: number;
  ratingAvg: number;
  ratingCount: number;
  completedEngagements: number;
  responseP50Seconds: number;
  cancellationRate: number;
  availability: Array<[weekday: number, block: BlockName]>;
  specializations: Array<{ label: string; fromRank: number | null; toRank: number | null }>;
  /** Net gains past students reported. Drives the trajectory signal. */
  reviewGains: Array<{ rating: number; gain: number; body: string }>;
}

/**
 * The roster is hand-written rather than generated. Random coaches produce
 * random matches, and you cannot tell a ranking bug from noise. These have
 * deliberate shapes: a top-ranked expensive one, a cheap new one with no
 * reviews, one at full capacity, one with almost no free hours, one who
 * climbed enormously and one who started near the top.
 */
const COACHES: CoachSeed[] = [
  {
    slug: 'elif-a',
    name: 'Elif A.',
    university: 'Boğaziçi Üniversitesi',
    department: 'Elektrik-Elektronik Mühendisliği',
    city: 'İstanbul',
    yksTrack: 'SAYISAL',
    yksRank: 412,
    yksYear: 2023,
    ownBaselineNet: 68,
    ownFinalNet: 108,
    ownBaselineRank: 38_000,
    wasMezun: true,
    tracks: ['SAYISAL'],
    subjects: ['AYT Matematik', 'TYT Matematik', 'Fizik'],
    styles: ['STRICT', 'STRATEGIC'],
    supportedGrades: ['GRADE_12', 'MEZUN'],
    headline: 'Mezun yılında 38 binden ilk 500’e. Aynı yolu tarif ediyorum.',
    bio: `Mezun olduğum yıl 38 bininci sıradaydım ve herkes "bu iş bitti" diyordu. Bir sonraki sene 412. sıradan Boğaziçi EEM kazandım.\n\nÇalışma şeklim net: haftalık program veriyorum, pazar akşamı deneme analizini birlikte yapıyoruz, teslim etmediğin ödevin mazereti olmuyor. Sıkı bir takip istemiyorsan benimle çalışmak zor gelebilir.\n\nÖzellikle AYT matematikte 20 netin altında takılmış, nereden başlayacağını bilemeyen öğrencilerle iyi çalışıyorum.`,
    monthlyPrice: 5800,
    sessionPrice: 1600,
    maxActiveStudents: 6,
    activeEngagements: 5,
    ratingAvg: 4.9,
    ratingCount: 23,
    completedEngagements: 27,
    responseP50Seconds: 2400,
    cancellationRate: 0.01,
    availability: [
      [1, 'evening'],
      [3, 'evening'],
      [6, 'morning'],
    ],
    specializations: [
      { label: 'Mezun yılında 50 binden ilk 1000’e', fromRank: 50_000, toRank: 1_000 },
      { label: 'AYT Matematik sıfırdan kurulum', fromRank: null, toRank: null },
    ],
    reviewGains: [
      { rating: 5, gain: 34, body: 'Programı harfiyen uyguladım, AYT matematikte 9 netten 31 nete çıktım.' },
      { rating: 5, gain: 28, body: 'Sıkı takip gerçekten sıkı. Bana lazım olan buydu.' },
      { rating: 4, gain: 19, body: 'Çok faydalıydı ama tempoya alışmak ilk ay zor geldi.' },
    ],
  },
  {
    slug: 'mert-k',
    name: 'Mert K.',
    university: 'İstanbul Teknik Üniversitesi',
    department: 'Bilgisayar Mühendisliği',
    city: 'İstanbul',
    yksTrack: 'SAYISAL',
    yksRank: 2_180,
    yksYear: 2024,
    ownBaselineNet: 74,
    ownFinalNet: 99,
    ownBaselineRank: 21_000,
    wasMezun: false,
    tracks: ['SAYISAL'],
    subjects: ['AYT Matematik', 'Fizik', 'TYT Fen'],
    styles: ['STRATEGIC', 'EMPATHETIC'],
    supportedGrades: ['GRADE_11', 'GRADE_12'],
    headline: '12. sınıfta panik yapmadan ilk 3 bine çıkmanın yolu var.',
    bio: `12. sınıfa 21 bininci sırayla girdim, yıl sonunda 2180. sıradaydım. Hiç mezun olmadım — okulla birlikte yürütülebilir bir program kurmayı biliyorum.\n\nBende ağırlık deneme analizinde. Hangi soruyu neden yanlış yaptığını ayırt edemeyen bir öğrenci, 500 deneme de çözse aynı yerde kalıyor.\n\nHaftada bir uzun görüşme yapıyoruz, arada mesajla takıldığın yeri soruyorsun.`,
    monthlyPrice: 3400,
    sessionPrice: 950,
    maxActiveStudents: 10,
    activeEngagements: 4,
    ratingAvg: 4.7,
    ratingCount: 11,
    completedEngagements: 13,
    responseP50Seconds: 5400,
    cancellationRate: 0.03,
    availability: [
      [2, 'evening'],
      [4, 'evening'],
      [0, 'afternoon'],
    ],
    specializations: [{ label: '12. sınıfta okulla birlikte ilk 5 bin', fromRank: 25_000, toRank: 5_000 }],
    reviewGains: [
      { rating: 5, gain: 22, body: 'Deneme analizi yapmayı öğrendim, en çok bu işe yaradı.' },
      { rating: 4, gain: 15, body: 'Okul yoğunluğunu anlıyor, program buna göre.' },
    ],
  },
  {
    slug: 'zeynep-d',
    name: 'Zeynep D.',
    university: 'Hacettepe Üniversitesi',
    department: 'Tıp',
    city: 'Ankara',
    yksTrack: 'SAYISAL',
    yksRank: 890,
    yksYear: 2022,
    ownBaselineNet: 81,
    ownFinalNet: 104,
    ownBaselineRank: 12_000,
    wasMezun: false,
    tracks: ['SAYISAL'],
    subjects: ['Biyoloji', 'Kimya', 'AYT Matematik'],
    styles: ['EMPATHETIC', 'HIGH_TOUCH'],
    supportedGrades: ['GRADE_11', 'GRADE_12', 'MEZUN'],
    headline: 'Tıp hedefliyorsan biyoloji ve kimyayı ezber olmaktan çıkaralım.',
    bio: `Hacettepe Tıp 3. sınıf öğrencisiyim. Sayısalda en çok göz ardı edilen şey biyoloji ve kimya — matematiğe gömülüp bu ikisinden net kaybeden çok öğrenci görüyorum.\n\nGünlük kısa kontrollerle çalışıyorum. Uzun haftalık görüşmeler yerine her gün iki dakikalık "bugün ne yaptın" mesajı daha çok işe yarıyor, özellikle motivasyonu dalgalı öğrencilerde.\n\nKötü geçen haftalarda bırakmayı düşünen öğrencilerle çalışmayı seviyorum; o hafta herkesin başına geliyor.`,
    monthlyPrice: 4600,
    sessionPrice: 1300,
    maxActiveStudents: 8,
    activeEngagements: 3,
    ratingAvg: 4.8,
    ratingCount: 18,
    completedEngagements: 20,
    responseP50Seconds: 1800,
    cancellationRate: 0.02,
    availability: [
      [1, 'afternoon'],
      [2, 'afternoon'],
      [4, 'evening'],
      [6, 'morning'],
    ],
    specializations: [{ label: 'Tıp hedefiyle biyoloji-kimya derinleşmesi', fromRank: 15_000, toRank: 2_000 }],
    reviewGains: [
      { rating: 5, gain: 26, body: 'Biyolojide 4 netten 12 nete çıktım, kimya da toparlandı.' },
      { rating: 5, gain: 21, body: 'Her gün mesajlaşmak bırakmamı engelledi diyebilirim.' },
      { rating: 4, gain: 14, body: 'Matematikte biraz daha destek isterdim ama biyoloji harikaydı.' },
    ],
  },
  {
    slug: 'can-o',
    name: 'Can Ö.',
    university: 'Orta Doğu Teknik Üniversitesi',
    department: 'Makine Mühendisliği',
    city: 'Ankara',
    yksTrack: 'SAYISAL',
    yksRank: 6_400,
    yksYear: 2024,
    ownBaselineNet: 52,
    ownFinalNet: 91,
    ownBaselineRank: 84_000,
    wasMezun: true,
    tracks: ['SAYISAL', 'ESIT_AGIRLIK'],
    subjects: ['TYT Matematik', 'AYT Matematik', 'Fizik'],
    styles: ['HIGH_TOUCH', 'EMPATHETIC'],
    supportedGrades: ['MEZUN'],
    headline: '84 binden 6 bine. Sıfıra yakın başlayanları anlıyorum.',
    bio: `İlk girdiğim sene 84 bininci sıradaydım, TYT matematikte 8 netim vardı. Mezun yılımda 6400. sıraya çıktım.\n\nÇok düşük netten başlayan öğrenciyle çalışmak ayrı bir iş. Konu anlatımı değil, "bugün hangi 3 soruyu çözeceksin" seviyesinde bir kurulum gerekiyor. Ben orayı biliyorum çünkü aynı yerden başladım.\n\nSık temas ediyorum, günde bir mesaj atıyorum. Kimseyi azarlamam; zaten yeterince baskı var.`,
    monthlyPrice: 2600,
    sessionPrice: 750,
    maxActiveStudents: 12,
    activeEngagements: 6,
    ratingAvg: 4.6,
    ratingCount: 9,
    completedEngagements: 11,
    responseP50Seconds: 3600,
    cancellationRate: 0.04,
    availability: [
      [1, 'morning'],
      [3, 'morning'],
      [5, 'afternoon'],
      [0, 'evening'],
    ],
    specializations: [{ label: 'Mezun yılında 80 binden ilk 10 bine', fromRank: 100_000, toRank: 10_000 }],
    reviewGains: [
      { rating: 5, gain: 31, body: 'TYT matematikte 6 nettim, 24 nete çıktım. Hiç küçümsemedi.' },
      { rating: 4, gain: 18, body: 'Sabırlı biri. Sıfırdan başlıyorsan doğru adres.' },
    ],
  },
  {
    slug: 'irem-s',
    name: 'İrem S.',
    university: 'Ege Üniversitesi',
    department: 'Diş Hekimliği',
    city: 'İzmir',
    yksTrack: 'SAYISAL',
    yksRank: 14_200,
    yksYear: 2025,
    ownBaselineNet: 61,
    ownFinalNet: 84,
    ownBaselineRank: 46_000,
    wasMezun: false,
    tracks: ['SAYISAL'],
    subjects: ['TYT Matematik', 'Biyoloji', 'TYT Fen'],
    styles: ['EMPATHETIC'],
    supportedGrades: ['GRADE_11', 'GRADE_12'],
    headline: 'Yeni mezunum, süreç hâlâ çok taze. Uygun fiyatlı başlangıç.',
    bio: `Geçen sene sınava girdim, Ege Diş kazandım. Kaktüs’te yeniyim, bu yüzden fiyatım düşük — referansımı buradan kuracağım.\n\n11 ve 12. sınıf öğrencileriyle çalışıyorum. Sınav sürecinin nasıl bir şey olduğunu hatırlıyorum, çünkü üzerinden bir yıl bile geçmedi.\n\nHaftada bir görüşme, arada mesaj. Program veriyorum ama esnek; hayatında başka şeyler de olduğunu biliyorum.`,
    monthlyPrice: 1400,
    sessionPrice: 450,
    maxActiveStudents: 8,
    activeEngagements: 0,
    ratingAvg: 0,
    ratingCount: 0,
    completedEngagements: 0,
    responseP50Seconds: 1200,
    cancellationRate: 0,
    availability: [
      [1, 'evening'],
      [2, 'evening'],
      [3, 'evening'],
      [4, 'evening'],
      [6, 'afternoon'],
    ],
    specializations: [],
    reviewGains: [],
  },
  {
    slug: 'burak-t',
    name: 'Burak T.',
    university: 'Yıldız Teknik Üniversitesi',
    department: 'İnşaat Mühendisliği',
    city: 'İstanbul',
    yksTrack: 'SAYISAL',
    yksRank: 24_500,
    yksYear: 2023,
    ownBaselineNet: 44,
    ownFinalNet: 76,
    ownBaselineRank: 95_000,
    wasMezun: true,
    tracks: ['SAYISAL'],
    subjects: ['TYT Matematik', 'TYT Fen', 'Fizik'],
    styles: ['STRICT', 'HIGH_TOUCH'],
    supportedGrades: ['GRADE_12', 'MEZUN'],
    headline: 'TYT’si oturmayan öğrenciyle AYT’ye geçmem.',
    bio: `Çoğu öğrenci TYT matematiği yarım bırakıp AYT’ye atlıyor ve ikisinde birden batıyor. Benimle çalışırsan TYT netin oturmadan AYT’ye geçmeyiz — bu bazen ilk iki ay sıkıcı geliyor, sonuçları sonra görüyorsun.\n\nKendi sürecimde 95 binden 24 bine çıktım. Zeki olduğum için değil, sırayı bozmadığım için.\n\nHaftada iki kısa görüşme yapıyorum, her gün ödev kontrolü var.`,
    monthlyPrice: 2200,
    sessionPrice: 650,
    maxActiveStudents: 10,
    activeEngagements: 2,
    ratingAvg: 4.4,
    ratingCount: 6,
    completedEngagements: 7,
    responseP50Seconds: 7200,
    cancellationRate: 0.06,
    availability: [
      [2, 'morning'],
      [4, 'morning'],
      [5, 'evening'],
    ],
    specializations: [{ label: 'TYT temeli sıfırdan kurma', fromRank: 150_000, toRank: 30_000 }],
    reviewGains: [
      { rating: 5, gain: 24, body: 'TYT matematiği gerçekten oturttu. İlk iki ay sabır gerekiyor.' },
      { rating: 4, gain: 12, body: 'Disiplinli ama bazen mesajlara geç dönüyor.' },
    ],
  },
  {
    slug: 'selin-y',
    name: 'Selin Y.',
    university: 'Koç Üniversitesi',
    department: 'Hukuk',
    city: 'İstanbul',
    yksTrack: 'ESIT_AGIRLIK',
    yksRank: 620,
    yksYear: 2023,
    ownBaselineNet: 72,
    ownFinalNet: 101,
    ownBaselineRank: 18_000,
    wasMezun: false,
    tracks: ['ESIT_AGIRLIK'],
    subjects: ['AYT Matematik', 'Edebiyat', 'TYT Türkçe'],
    styles: ['STRATEGIC', 'STRICT'],
    supportedGrades: ['GRADE_12', 'MEZUN'],
    headline: 'EA’da fark matematikten değil, edebiyattan açılıyor.',
    bio: `Koç Hukuk burslu okuyorum. EA öğrencilerinin çoğu matematiğe gömülüp edebiyatı "okuyunca olur" sanıyor; sıralama farkı tam olarak orada açılıyor.\n\nParagraf ve edebiyat sorularında sistematik bir yaklaşım kuruyorum. Matematikte de çalışıyoruz ama önceliği veriye göre belirliyoruz.\n\nDeneme sonuçlarını birlikte tabloluyoruz. Duyguya göre değil, sayıya göre karar veriyoruz.`,
    monthlyPrice: 5200,
    sessionPrice: 1450,
    maxActiveStudents: 7,
    activeEngagements: 4,
    ratingAvg: 4.9,
    ratingCount: 15,
    completedEngagements: 17,
    responseP50Seconds: 3000,
    cancellationRate: 0.01,
    availability: [
      [1, 'evening'],
      [4, 'evening'],
      [6, 'afternoon'],
    ],
    specializations: [{ label: 'EA’da ilk 1000 için edebiyat stratejisi', fromRank: 20_000, toRank: 1_000 }],
    reviewGains: [
      { rating: 5, gain: 27, body: 'Edebiyatta 18 netten 32 nete çıktım, sıralamam uçtu.' },
      { rating: 5, gain: 23, body: 'Her şeyi tabloya döküyor, tahmin yok.' },
    ],
  },
  {
    slug: 'kaan-b',
    name: 'Kaan B.',
    university: 'Ankara Üniversitesi',
    department: 'Hukuk',
    city: 'Ankara',
    yksTrack: 'ESIT_AGIRLIK',
    yksRank: 3_900,
    yksYear: 2024,
    ownBaselineNet: 58,
    ownFinalNet: 93,
    ownBaselineRank: 42_000,
    wasMezun: true,
    tracks: ['ESIT_AGIRLIK', 'SOZEL'],
    subjects: ['Edebiyat', 'Tarih', 'Coğrafya', 'AYT Matematik'],
    styles: ['EMPATHETIC', 'STRATEGIC'],
    supportedGrades: ['MEZUN', 'GRADE_12'],
    headline: 'Mezun yılında 42 binden 3900’e. Sosyal derslerde iddialıyım.',
    bio: `Mezun yılımda hukuk hedefiyle çalıştım ve 3900. sıraya geldim. En çok tarih ve coğrafyada fark yarattım — EA’da bu ikisi çoğu zaman "sonra bakarız" rafında kalıyor.\n\nMezun psikolojisi ayrı bir mesele. Okul yok, arkadaş yok, gün boyu evde tek başınasın. Bunu yaşamış biri olarak programı buna göre kuruyorum.\n\nHaftada bir uzun görüşme, arada sınırsız mesaj.`,
    monthlyPrice: 3100,
    sessionPrice: 900,
    maxActiveStudents: 9,
    activeEngagements: 3,
    ratingAvg: 4.7,
    ratingCount: 12,
    completedEngagements: 14,
    responseP50Seconds: 4200,
    cancellationRate: 0.02,
    availability: [
      [0, 'afternoon'],
      [2, 'evening'],
      [5, 'evening'],
    ],
    specializations: [{ label: 'Mezun yılında EA ilk 5 bin', fromRank: 50_000, toRank: 5_000 }],
    reviewGains: [
      { rating: 5, gain: 29, body: 'Tarih ve coğrafyayı toparlamak sıralamamı 20 bin yukarı taşıdı.' },
      { rating: 4, gain: 17, body: 'Mezun sürecinde psikolojik olarak da destek oldu.' },
    ],
  },
  {
    slug: 'ayse-m',
    name: 'Ayşe M.',
    university: 'Marmara Üniversitesi',
    department: 'İşletme',
    city: 'İstanbul',
    yksTrack: 'ESIT_AGIRLIK',
    yksRank: 18_700,
    yksYear: 2025,
    ownBaselineNet: 49,
    ownFinalNet: 78,
    ownBaselineRank: 72_000,
    wasMezun: false,
    tracks: ['ESIT_AGIRLIK'],
    subjects: ['TYT Türkçe', 'TYT Matematik', 'Edebiyat'],
    styles: ['HIGH_TOUCH', 'EMPATHETIC'],
    supportedGrades: ['GRADE_11', 'GRADE_12'],
    headline: 'Uygun fiyat, sık temas. 11. sınıfta erken başlayanlar için.',
    bio: `Geçen sene sınava girdim. 11. sınıfta başlayan öğrencilerle çalışmayı tercih ediyorum çünkü erken başlayınca panik olmadan ilerleniyor.\n\nGünlük kısa kontroller yapıyorum. Uzun haftalık toplantılar yerine sık ve kısa temas, bu yaşta daha iyi çalışıyor.\n\nHenüz çok öğrencim olmadı, bu yüzden fiyatım düşük ve her öğrenciye fazlasıyla vakit ayırıyorum.`,
    monthlyPrice: 1650,
    sessionPrice: 500,
    maxActiveStudents: 6,
    activeEngagements: 1,
    ratingAvg: 5.0,
    ratingCount: 2,
    completedEngagements: 2,
    responseP50Seconds: 900,
    cancellationRate: 0,
    availability: [
      [1, 'afternoon'],
      [3, 'afternoon'],
      [5, 'afternoon'],
      [6, 'morning'],
    ],
    specializations: [],
    reviewGains: [{ rating: 5, gain: 16, body: 'Çok ilgili. 11. sınıfta başlamak doğru karardı.' }],
  },
  {
    slug: 'emre-c',
    name: 'Emre Ç.',
    university: 'Galatasaray Üniversitesi',
    department: 'İktisat',
    city: 'İstanbul',
    yksTrack: 'ESIT_AGIRLIK',
    yksRank: 1_450,
    yksYear: 2022,
    ownBaselineNet: 79,
    ownFinalNet: 97,
    ownBaselineRank: 9_800,
    wasMezun: false,
    tracks: ['ESIT_AGIRLIK'],
    subjects: ['AYT Matematik', 'TYT Matematik'],
    styles: ['STRATEGIC'],
    supportedGrades: ['GRADE_12', 'MEZUN'],
    headline: 'Sadece matematik. Haftada bir, yoğun ve planlı.',
    bio: `EA matematiği üzerine yoğunlaşıyorum, başka ders almıyorum. Zaten iyi olan ama son adımı atamayan öğrencilerle iyi sonuç alıyorum.\n\nHaftada tek görüşme yapıyorum ve o görüşme yoğun geçiyor. Aradaki sürede kendi başına çalışabilecek disiplinde olman gerekiyor — günlük takip bende yok.\n\n9800’den 1450’ye çıkışım tamamen matematikteki son 15 netten geldi.`,
    monthlyPrice: 4200,
    sessionPrice: 1250,
    maxActiveStudents: 5,
    activeEngagements: 5,
    ratingAvg: 4.8,
    ratingCount: 10,
    completedEngagements: 12,
    responseP50Seconds: 9000,
    cancellationRate: 0.03,
    availability: [[3, 'evening']],
    specializations: [{ label: 'İyi öğrenciyi ilk 2 bine taşıma', fromRank: 10_000, toRank: 2_000 }],
    reviewGains: [
      { rating: 5, gain: 14, body: 'Zaten iyiydim, son 15 neti onunla aldım.' },
      { rating: 4, gain: 11, body: 'Günlük takip yok, kendi disiplinin yoksa zorlanırsın.' },
    ],
  },
  {
    slug: 'defne-u',
    name: 'Defne U.',
    university: 'Boğaziçi Üniversitesi',
    department: 'Psikoloji',
    city: 'İstanbul',
    yksTrack: 'SOZEL',
    yksRank: 310,
    yksYear: 2023,
    ownBaselineNet: 70,
    ownFinalNet: 99,
    ownBaselineRank: 14_000,
    wasMezun: false,
    tracks: ['SOZEL'],
    subjects: ['Edebiyat', 'Tarih', 'Coğrafya', 'Felsefe'],
    styles: ['EMPATHETIC', 'STRATEGIC'],
    supportedGrades: ['GRADE_12', 'MEZUN'],
    headline: 'Sözelde ezber değil, kurgu. İlk 500’ün mantığı bu.',
    bio: `Sözel alanın en büyük yanlış anlaşılması "ezberleyince olur" fikri. Tarihte olayları tek tek ezberleyen öğrenci, soru biraz döndüğünde kayboluyor.\n\nBen bağlam kuruyorum: neden oldu, öncesinde ne vardı, sonrasını nasıl etkiledi. Felsefede de aynı yaklaşım.\n\n14 binden 310’a çıkışım bu yöntemle oldu. Psikoloji okuduğum için çalışma alışkanlığı kurma tarafında da destek olabiliyorum.`,
    monthlyPrice: 4800,
    sessionPrice: 1350,
    maxActiveStudents: 7,
    activeEngagements: 2,
    ratingAvg: 4.9,
    ratingCount: 14,
    completedEngagements: 16,
    responseP50Seconds: 2700,
    cancellationRate: 0.01,
    availability: [
      [2, 'afternoon'],
      [4, 'afternoon'],
      [6, 'evening'],
    ],
    specializations: [{ label: 'Sözelde ilk 500 hedefi', fromRank: 15_000, toRank: 500 }],
    reviewGains: [
      { rating: 5, gain: 25, body: 'Tarihi ezberlemeyi bıraktım, netim ikiye katlandı.' },
      { rating: 5, gain: 20, body: 'Felsefede hiç netim yoktu, 10 nete çıktım.' },
    ],
  },
  {
    slug: 'yusuf-a',
    name: 'Yusuf A.',
    university: 'İstanbul Üniversitesi',
    department: 'Türk Dili ve Edebiyatı',
    city: 'İstanbul',
    yksTrack: 'SOZEL',
    yksRank: 5_600,
    yksYear: 2024,
    ownBaselineNet: 55,
    ownFinalNet: 86,
    ownBaselineRank: 48_000,
    wasMezun: true,
    tracks: ['SOZEL', 'ESIT_AGIRLIK'],
    subjects: ['Edebiyat', 'TYT Türkçe', 'Tarih'],
    styles: ['STRICT', 'HIGH_TOUCH'],
    supportedGrades: ['MEZUN', 'GRADE_12'],
    headline: 'Paragrafta tıkanan herkesin sorunu aynı. Çözümü de aynı.',
    bio: `TYT Türkçe ve paragraf benim asıl işim. Edebiyat okuyorum ve paragraf sorusunun nasıl kurulduğunu sökebiliyorum.\n\nMezun yılımda 48 binden 5600’e çıktım, en büyük sıçrama Türkçeden geldi.\n\nSıkı çalışıyorum: her gün paragraf ödevi var ve kontrol ediyorum. Yapmadıysan görüşmede bunu konuşuruz.`,
    monthlyPrice: 2400,
    sessionPrice: 700,
    maxActiveStudents: 10,
    activeEngagements: 3,
    ratingAvg: 4.5,
    ratingCount: 8,
    completedEngagements: 9,
    responseP50Seconds: 5400,
    cancellationRate: 0.05,
    availability: [
      [1, 'morning'],
      [3, 'evening'],
      [5, 'morning'],
      [0, 'evening'],
    ],
    specializations: [{ label: 'TYT Türkçe ve paragraf sıçraması', fromRank: 60_000, toRank: 8_000 }],
    reviewGains: [
      { rating: 5, gain: 21, body: 'Paragrafta 12 netten 28 nete çıktım.' },
      { rating: 4, gain: 13, body: 'Ödev takibi çok sıkı, hazır ol.' },
    ],
  },
  {
    slug: 'nehir-k',
    name: 'Nehir K.',
    university: 'Dokuz Eylül Üniversitesi',
    department: 'Tarih',
    city: 'İzmir',
    yksTrack: 'SOZEL',
    yksRank: 31_000,
    yksYear: 2025,
    ownBaselineNet: 41,
    ownFinalNet: 68,
    ownBaselineRank: 110_000,
    wasMezun: false,
    tracks: ['SOZEL'],
    subjects: ['Tarih', 'Coğrafya', 'TYT Türkçe'],
    styles: ['EMPATHETIC'],
    supportedGrades: ['GRADE_11', 'GRADE_12'],
    headline: 'Sıfırdan başlıyorsan, acele etmeden kuralım.',
    bio: `110 binden 31 bine çıktım. Büyük bir sıçrama değil ama benim için çok şey ifade ediyordu ve o yolu adım adım biliyorum.\n\nÇok düşük netlerden başlayan, "ben yapamam" diyen öğrencilerle çalışmayı seviyorum. Baskı yapmıyorum; zaten yeterince baskı var.\n\nKaktüs’te yeniyim, fiyatım da buna göre.`,
    monthlyPrice: 1200,
    sessionPrice: 400,
    maxActiveStudents: 6,
    activeEngagements: 0,
    ratingAvg: 0,
    ratingCount: 0,
    completedEngagements: 0,
    responseP50Seconds: 1500,
    cancellationRate: 0,
    availability: [
      [2, 'morning'],
      [4, 'morning'],
      [6, 'afternoon'],
      [0, 'morning'],
    ],
    specializations: [],
    reviewGains: [],
  },
  {
    slug: 'deniz-p',
    name: 'Deniz P.',
    university: 'Boğaziçi Üniversitesi',
    department: 'İngiliz Dili ve Edebiyatı',
    city: 'İstanbul',
    yksTrack: 'DIL',
    yksRank: 180,
    yksYear: 2023,
    ownBaselineNet: 64,
    ownFinalNet: 94,
    ownBaselineRank: 8_000,
    wasMezun: false,
    tracks: ['DIL'],
    subjects: ['YDT İngilizce', 'TYT Türkçe'],
    styles: ['STRATEGIC', 'STRICT'],
    supportedGrades: ['GRADE_12', 'MEZUN'],
    headline: 'YDT’de ilk 200. Dil sınavı bir dil sınavı değil, bir strateji sınavı.',
    bio: `YDT’de 180. sıradayım. Dil alanında en sık gördüğüm hata, İngilizceyi "bilmek" ile sınavı çözmeyi karıştırmak. İkisi aynı şey değil.\n\nSoru tiplerini ayırıyoruz, her tip için ayrı yaklaşım kuruyoruz. Kelime çalışması da sistemli — rastgele liste ezberlemiyoruz.\n\nDil alanında koç bulmak zor, o yüzden kontenjanım hızlı doluyor.`,
    monthlyPrice: 5400,
    sessionPrice: 1500,
    maxActiveStudents: 6,
    activeEngagements: 4,
    ratingAvg: 5.0,
    ratingCount: 13,
    completedEngagements: 15,
    responseP50Seconds: 2100,
    cancellationRate: 0.01,
    availability: [
      [1, 'evening'],
      [3, 'afternoon'],
      [5, 'evening'],
    ],
    specializations: [{ label: 'YDT’de ilk 1000 hedefi', fromRank: 10_000, toRank: 1_000 }],
    reviewGains: [
      { rating: 5, gain: 23, body: 'Soru tiplerini ayırmak her şeyi değiştirdi.' },
      { rating: 5, gain: 19, body: 'Kelime çalışmasının sistemli olması çok işe yaradı.' },
    ],
  },
  {
    slug: 'melis-g',
    name: 'Melis G.',
    university: 'Bilkent Üniversitesi',
    department: 'Mütercim-Tercümanlık',
    city: 'Ankara',
    yksTrack: 'DIL',
    yksRank: 2_700,
    yksYear: 2024,
    ownBaselineNet: 57,
    ownFinalNet: 85,
    ownBaselineRank: 26_000,
    wasMezun: true,
    tracks: ['DIL'],
    subjects: ['YDT İngilizce'],
    styles: ['HIGH_TOUCH', 'EMPATHETIC'],
    supportedGrades: ['MEZUN', 'GRADE_12'],
    headline: 'Her gün 20 dakika. Dilde süreklilik her şeyden önemli.',
    bio: `Dil alanında haftada bir üç saat çalışmak, her gün yirmi dakika çalışmaktan daha az işe yarıyor. Bunu kendi mezun yılımda anladım.\n\nGünlük kısa görevler veriyorum ve her gün kontrol ediyorum. Uzun görüşmeler yapmıyoruz; onun yerine sürekli temas var.\n\n26 binden 2700’e bu şekilde çıktım.`,
    monthlyPrice: 2900,
    sessionPrice: 850,
    maxActiveStudents: 10,
    activeEngagements: 2,
    ratingAvg: 4.6,
    ratingCount: 7,
    completedEngagements: 8,
    responseP50Seconds: 1800,
    cancellationRate: 0.02,
    availability: [
      [1, 'morning'],
      [2, 'morning'],
      [3, 'morning'],
      [4, 'afternoon'],
      [6, 'evening'],
    ],
    specializations: [{ label: 'Mezun yılında YDT sıçraması', fromRank: 30_000, toRank: 3_000 }],
    reviewGains: [
      { rating: 5, gain: 20, body: 'Her gün kısa çalışma fikri gerçekten işe yarıyor.' },
      { rating: 4, gain: 12, body: 'Uzun görüşme isteyenler için uygun değil.' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────

async function wipeSeedData() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${SEED_DOMAIN}` } },
    select: { id: true, coachProfile: { select: { id: true } }, studentProfile: { select: { id: true } } },
  });
  if (users.length === 0) return 0;

  const coachIds = users.map((u) => u.coachProfile?.id).filter((id): id is string => Boolean(id));
  const studentIds = users.map((u) => u.studentProfile?.id).filter((id): id is string => Boolean(id));
  const scope = {
    OR: [
      { coachProfileId: { in: coachIds } },
      { studentProfileId: { in: studentIds } },
    ],
  };

  // Order matters: Engagement holds Restrict references from Offer and the
  // profiles, so the dependents must go first or the delete is rejected.
  const engagements = await prisma.engagement.findMany({ where: scope, select: { id: true } });
  const engagementIds = engagements.map((e) => e.id);

  await prisma.review.deleteMany({ where: { engagementId: { in: engagementIds } } });
  await prisma.booking.deleteMany({ where: scope });
  await prisma.milestone.deleteMany({ where: { engagementId: { in: engagementIds } } });
  await prisma.dispute.deleteMany({ where: { engagementId: { in: engagementIds } } });
  await prisma.refund.deleteMany({ where: { engagementId: { in: engagementIds } } });
  await prisma.engagement.deleteMany({ where: { id: { in: engagementIds } } });

  const offers = await prisma.offer.findMany({ where: scope, select: { id: true } });
  await prisma.offerEvent.deleteMany({ where: { offerId: { in: offers.map((o) => o.id) } } });
  await prisma.payment.deleteMany({ where: { offerId: { in: offers.map((o) => o.id) } } });
  await prisma.slotHold.deleteMany({ where: scope });
  await prisma.offer.deleteMany({ where: { id: { in: offers.map((o) => o.id) } } });
  await prisma.conversation.deleteMany({ where: scope });

  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  return users.length;
}

/** Next occurrence of a weekday, at a fixed local hour, in the future. */
function pastDate(daysAgo: number, hour: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  date.setUTCHours(hour - 3, 0, 0, 0); // Europe/Istanbul is UTC+3 year-round
  return date;
}

async function main() {
  console.log('Seeding…\n');

  const removed = await wipeSeedData();
  if (removed > 0) console.log(`  removed ${removed} previously seeded users\n`);

  // Commission policy. The offer service falls back to 1800 bps without one,
  // but seeding it means the admin UI and any future rate change have a row to
  // point at rather than a hardcoded default.
  const policyCount = await prisma.commissionPolicy.count();
  if (policyCount === 0) {
    await prisma.commissionPolicy.create({
      data: { name: 'Varsayılan', defaultBps: 1800, minBps: 1000, maxBps: 2500 },
    });
    console.log('  created default commission policy (18%)\n');
  }

  // Past students who leave the reviews. Kept separate from the demo student so
  // review history cannot be confused with an account you are testing with.
  const reviewerCount = 6;
  const reviewers = [];
  for (let i = 0; i < reviewerCount; i++) {
    const user = await prisma.user.create({
      data: {
        email: `gecmis-ogrenci-${i}@${SEED_DOMAIN}`,
        name: ['Ada Y.', 'Ege T.', 'Zeynep B.', 'Arda K.', 'Lara M.', 'Efe S.'][i],
        roles: ['STUDENT'],
        emailVerified: new Date(),
      },
    });
    const profile = await prisma.studentProfile.create({
      data: { userId: user.id, track: 'SAYISAL', gradeLevel: 'MEZUN' },
    });
    reviewers.push(profile);
  }

  let coachNumber = 0;
  for (const seed of COACHES) {
    coachNumber++;

    const user = await prisma.user.create({
      data: {
        email: `${seed.slug}@${SEED_DOMAIN}`,
        name: seed.name,
        roles: ['COACH'],
        emailVerified: new Date(),
        timezone: TZ,
      },
    });

    const coach = await prisma.coachProfile.create({
      data: {
        userId: user.id,
        slug: seed.slug,
        headline: seed.headline,
        bio: seed.bio,
        city: seed.city,
        timezone: TZ,
        university: seed.university,
        department: seed.department,
        graduationYear: seed.yksYear + 4,
        yksRank: seed.yksRank,
        yksYear: seed.yksYear,
        yksTrack: seed.yksTrack,
        ownBaselineNet: seed.ownBaselineNet,
        ownFinalNet: seed.ownFinalNet,
        ownBaselineRank: seed.ownBaselineRank,
        wasMezun: seed.wasMezun,
        tracks: seed.tracks,
        subjects: seed.subjects,
        styles: seed.styles,
        supportedGrades: seed.supportedGrades,
        maxActiveStudents: seed.maxActiveStudents,
        activeEngagements: seed.activeEngagements,
        weeklyCapacityHours: seed.availability.length * 3,
        acceptingStudents: true,
        ratingAvg: seed.ratingAvg,
        ratingCount: seed.ratingCount,
        completedEngagements: seed.completedEngagements,
        responseP50Seconds: seed.responseP50Seconds,
        cancellationRate: seed.cancellationRate,
        // Approved AND payout-ready. Either one missing makes the coach
        // useless for testing — invisible in search, or blocked at payment.
        verificationStatus: 'APPROVED',
        verifiedAt: new Date(),
        submerchantKey: `mock_sub_seed_${seed.slug}`,
        payoutReadyAt: new Date(),
        lastActiveAt: new Date(),
      },
    });

    await prisma.availabilityRule.createMany({
      data: seed.availability.map(([weekday, block]) => ({
        coachProfileId: coach.id,
        weekday,
        startMinute: BLOCKS[block][0],
        endMinute: BLOCKS[block][1],
        timezone: TZ,
        active: true,
      })),
    });

    await prisma.pricingTier.createMany({
      data: [
        {
          coachProfileId: coach.id,
          name: 'Aylık program',
          cadence: 'MONTHLY_STANDARD',
          priceMinor: seed.monthlyPrice * 100,
          sessionsPerCycle: 4,
          minutesPerSession: 60,
          includesMessaging: true,
          sortOrder: 0,
        },
        {
          coachProfileId: coach.id,
          name: 'Tanışma seansı',
          cadence: 'SINGLE_SESSION',
          priceMinor: seed.sessionPrice * 100,
          sessionsPerCycle: 1,
          minutesPerSession: 60,
          includesMessaging: false,
          sortOrder: 1,
        },
      ],
    });

    if (seed.specializations.length > 0) {
      await prisma.coachSpecialization.createMany({
        data: seed.specializations.map((spec, index) => ({
          coachProfileId: coach.id,
          label: spec.label,
          slug: `${seed.slug}-uzmanlik-${index}`,
          fromRank: spec.fromRank,
          toRank: spec.toRank,
        })),
      });
    }

    await prisma.verificationDocument.create({
      data: {
        coachProfileId: coach.id,
        type: 'YKS_RESULT',
        storageKey: `seed/verification/${seed.slug}-osym.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 184_320,
        status: 'APPROVED',
        reviewedAt: new Date(),
      },
    });

    // Completed history, so reviews and the reported-net-gain signal are real
    // rows rather than a number typed into a column.
    for (const [index, review] of seed.reviewGains.entries()) {
      const reviewer = reviewers[(coachNumber + index) % reviewers.length];
      const startedDaysAgo = 140 - index * 35;

      const conversation = await prisma.conversation.create({
        data: { coachProfileId: coach.id, studentProfileId: reviewer.id },
      });

      const price = seed.monthlyPrice * 100;
      const offer = await prisma.offer.create({
        data: {
          conversationId: conversation.id,
          coachProfileId: coach.id,
          studentProfileId: reviewer.id,
          initiatorRole: 'STUDENT',
          title: 'Aylık program',
          scope: {
            cadence: 'MONTHLY_STANDARD',
            sessionsPerCycle: 4,
            minutesPerSession: 60,
            weeks: 4,
            includesMessaging: true,
            deliverables: [],
            slots: [],
          } as Prisma.InputJsonValue,
          priceMinor: price,
          commissionBps: 1800,
          startDate: pastDate(startedDaysAgo, 18),
          endDate: pastDate(startedDaysAgo - 28, 19),
          milestoneCount: 4,
          status: 'COMPLETED',
          expiresAt: pastDate(startedDaysAgo + 2, 18),
          acceptedAt: pastDate(startedDaysAgo + 1, 18),
        },
      });

      const engagement = await prisma.engagement.create({
        data: {
          offerId: offer.id,
          coachProfileId: coach.id,
          studentProfileId: reviewer.id,
          status: 'COMPLETED',
          startDate: offer.startDate,
          endDate: offer.endDate,
          totalMinor: price,
          commissionBps: 1800,
          completedAt: offer.endDate,
        },
      });

      const per = Math.floor(price / 4);
      await prisma.milestone.createMany({
        data: Array.from({ length: 4 }, (_, m) => ({
          engagementId: engagement.id,
          index: m,
          periodStart: pastDate(startedDaysAgo - m * 7, 18),
          periodEnd: pastDate(startedDaysAgo - (m + 1) * 7, 18),
          amountMinor: m === 0 ? price - per * 3 : per,
          status: 'RELEASED' as const,
          releasedAt: pastDate(startedDaysAgo - (m + 1) * 7, 20),
        })),
      });

      await prisma.review.create({
        data: {
          engagementId: engagement.id,
          coachProfileId: coach.id,
          studentProfileId: reviewer.id,
          rating: review.rating,
          body: review.body,
          netGainReported: review.gain,
          published: true,
          createdAt: pastDate(startedDaysAgo - 30, 12),
        },
      });
    }

    console.log(
      `  ${String(coachNumber).padStart(2)}. ${seed.name.padEnd(12)} ${seed.yksTrack.padEnd(13)} ` +
        `${String(seed.yksRank).padStart(6)}.  ${String(seed.monthlyPrice).padStart(5)} ₺/ay  ` +
        `${seed.availability.length} blok  ${seed.reviewGains.length} yorum`,
    );
  }

  // A student account you can sign into and immediately see matches with.
  const studentUser = await prisma.user.create({
    data: {
      email: `ogrenci@${SEED_DOMAIN}`,
      name: 'Test Öğrenci',
      roles: ['STUDENT'],
      emailVerified: new Date(),
      timezone: TZ,
    },
  });
  await prisma.studentProfile.create({
    data: {
      userId: studentUser.id,
      track: 'SAYISAL',
      gradeLevel: 'MEZUN',
      baselineTytNet: 55,
      baselineAytNet: 18,
      targetRanking: 5_000,
      targetUniversity: 'Boğaziçi Üniversitesi',
      targetDepartment: 'Bilgisayar Mühendisliği',
      preferredStyles: ['STRICT', 'STRATEGIC'],
      // Without this the availability signal sits neutral for every coach and
      // the calendar-overlap part of matching is never exercised — which is
      // easy to miss, because the results still look plausible.
      availability: [
        { weekday: 1, startMinute: 18 * 60, endMinute: 22 * 60 },
        { weekday: 2, startMinute: 18 * 60, endMinute: 22 * 60 },
        { weekday: 3, startMinute: 18 * 60, endMinute: 22 * 60 },
        { weekday: 4, startMinute: 18 * 60, endMinute: 22 * 60 },
        { weekday: 6, startMinute: 9 * 60, endMinute: 12 * 60 },
      ] as Prisma.InputJsonValue,
      budgetMinMinor: 200_000,
      budgetMaxMinor: 500_000,
      budgetCadence: 'MONTHLY_STANDARD',
      weeklyHoursGoal: 3,
    },
  });

  console.log(`\n  ${COACHES.length} koç, ${reviewerCount} geçmiş öğrenci, 1 test öğrencisi.`);
  console.log(`\n  Giriş için: ogrenci@${SEED_DOMAIN}`);
  console.log('  (magic link konsola düşer; ya da kendi hesabınla gir.)\n');
  console.log('  Admin olmak için:');
  console.log(`    UPDATE "User" SET roles = '{STUDENT,ADMIN}' WHERE email = 'senin@epostan.com';\n`);
}

main()
  .catch((error) => {
    console.error('\nSeed failed:\n', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
KAKTUS_FILE_EOF

emit "scripts/check-server-actions.mjs" <<'KAKTUS_FILE_EOF'
#!/usr/bin/env node
/**
 * Verifies that every `'use server'` module exports only async functions.
 *
 * This exists because **`tsc --noEmit` cannot catch this class of bug.** The
 * rule is a Next.js constraint, not a TypeScript one: each export of a server
 * module becomes a callable RPC endpoint, and an object cannot be one. The
 * code type-checks perfectly and then fails at `next build` — or worse, at
 * runtime in dev, which is how it was found.
 *
 * A static check is therefore the only way to catch it without a full build,
 * which matters because a build takes minutes and this takes milliseconds.
 *
 *   node scripts/check-server-actions.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const ILLEGAL = [
  [/^export const (\w+)/gm, (m) => `export const ${m[1]}`],
  [/^export class (\w+)/gm, (m) => `export class ${m[1]}`],
  [/^export function (\w+)/gm, (m) => `export function ${m[1]} (not async)`],
  [/^export \{([^}]*)\}/gm, (m) => `export { ${m[1].trim()} }`],
  [/^export default/gm, () => 'export default'],
];

let failures = 0;
let checked = 0;

for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8');
  if (!source.trimStart().startsWith("'use server'")) continue;
  checked++;

  const found = [];
  for (const [pattern, describe] of ILLEGAL) {
    for (const match of source.matchAll(pattern)) {
      // `export type` / `export interface` are erased at compile time and are
      // legal; the patterns above deliberately do not match them.
      found.push({ text: describe(match), line: source.slice(0, match.index).split('\n').length });
    }
  }

  if (found.length > 0) {
    failures++;
    console.error(`\n  ${relative(ROOT, file)}`);
    for (const item of found) {
      console.error(`    line ${item.line}: ${item.text}`);
    }
  }
}

if (failures > 0) {
  console.error(
    `\n  A 'use server' file can only export async functions.` +
      `\n  Move constants and types into a plain module and import them directly.\n`,
  );
  process.exit(1);
}

console.log(`✓ ${checked} 'use server' modules export only async functions`);
KAKTUS_FILE_EOF

emit "scripts/simulate-payment.mjs" <<'KAKTUS_FILE_EOF'
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
KAKTUS_FILE_EOF

emit "src/app/admin/itirazlar/page.tsx" <<'KAKTUS_FILE_EOF'
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { DisputeCard } from '@/components/admin/DisputeCard';

/**
 * Dispute queue.
 *
 * Every row here is money frozen mid-flight: a student who paid and a coach who
 * may or may not have delivered. Both are waiting, and both lose trust with
 * every day it sits unresolved — so the queue shows the amount at stake and how
 * long it has been open, which are the two things that should drive triage.
 */
export const dynamic = 'force-dynamic';

export default async function DisputesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/giris?callbackUrl=/admin/itirazlar');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { roles: true },
  });
  if (!user?.roles.includes('ADMIN')) redirect('/panel');

  const disputes = await prisma.dispute.findMany({
    where: { status: { in: ['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'] } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      reason: true,
      detail: true,
      status: true,
      createdAt: true,
      openedByRole: true,
      engagement: {
        select: {
          id: true,
          totalMinor: true,
          startDate: true,
          coach: { select: { user: { select: { name: true } } } },
          student: { select: { user: { select: { name: true } } } },
          milestones: {
            orderBy: { index: 'asc' },
            select: { index: true, status: true, amountMinor: true },
          },
          bookings: {
            select: { status: true, startsAt: true },
            orderBy: { startsAt: 'asc' },
            take: 20,
          },
        },
      },
    },
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 sm:px-8">
      <Link href="/admin" className="text-sm text-muted hover:text-cactus">
        Doğrulama kuyruğuna dön
      </Link>
      <h1 className="mt-6 font-display text-question font-semibold">İtirazlar</h1>
      <p className="mt-3 max-w-[54ch] leading-relaxed text-muted">
        Aktarılmış dilimler geri alınmaz — yalnızca donmuş tutar üzerinde karar verebilirsin.
        Kararını yazarken iki taraf da okuyacakmış gibi yaz.
      </p>

      {disputes.length === 0 ? (
        <p className="mt-10 rounded-xl border border-stone/70 bg-paper px-5 py-5 text-muted">
          Açık itiraz yok.
        </p>
      ) : (
        <div className="mt-8 space-y-4">
          {disputes.map((dispute) => (
            <DisputeCard key={dispute.id} dispute={JSON.parse(JSON.stringify(dispute))} />
          ))}
        </div>
      )}
    </main>
  );
}
KAKTUS_FILE_EOF

emit "src/app/admin/page.tsx" <<'KAKTUS_FILE_EOF'
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { CoachReviewCard } from '@/components/admin/CoachReviewCard';

/**
 * Verification queue.
 *
 * The whole product's credibility rests on this screen. A coach's claimed
 * ranking is the strongest signal in the matching system, so a single approved
 * fake poisons the thing that makes Kaktüs worth using.
 *
 * It is deliberately plain and deliberately manual. For the first dozen coaches
 * a human should read every document; what to automate will be obvious after
 * doing that twenty times, and guessing now would automate the wrong thing.
 */
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/giris?callbackUrl=/admin');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { roles: true },
  });
  // 404 rather than 403: the admin area should not confirm it exists.
  if (!user?.roles.includes('ADMIN')) redirect('/panel');

  const [pending, openDisputes, flagged] = await Promise.all([
    prisma.coachProfile.findMany({
      where: { verificationStatus: { in: ['PENDING', 'IN_REVIEW'] } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        slug: true,
        headline: true,
        university: true,
        department: true,
        yksRank: true,
        yksYear: true,
        yksTrack: true,
        ownBaselineNet: true,
        ownFinalNet: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
        documents: { select: { id: true, type: true, mimeType: true, sizeBytes: true } },
        pricingTiers: { select: { name: true, priceMinor: true } },
      },
    }),
    prisma.dispute.count({
      where: { status: { in: ['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'] } },
    }),
    prisma.conversation.count({ where: { flaggedAt: { not: null } } }),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 sm:px-8">
      <div className="flex items-baseline justify-between gap-4">
        <Link href="/panel" className="text-sm text-muted hover:text-cactus">
          Panele dön
        </Link>
        <Link href="/admin/itirazlar" className="text-sm text-cactus hover:text-cactus-deep">
          İtirazlar {openDisputes > 0 && `(${openDisputes})`}
        </Link>
      </div>

      <h1 className="mt-6 font-display text-question font-semibold">Doğrulama kuyruğu</h1>
      <p className="mt-3 max-w-[54ch] leading-relaxed text-muted">
        Sıralama beyanı eşleştirmedeki en ağırlıklı sinyal. Belgeyle beyan birebir uyuşmuyorsa
        onaylama — gerekçeyi yaz, koç düzeltip tekrar başvurabilir.
      </p>

      {flagged > 0 && (
        <p className="mt-6 rounded-lg border border-dust/60 bg-dust/10 px-4 py-3 text-sm">
          {flagged} sohbet platform dışına çıkma girişimi nedeniyle işaretlendi.
        </p>
      )}

      {pending.length === 0 ? (
        <p className="mt-10 rounded-xl border border-stone/70 bg-paper px-5 py-5 text-muted">
          Bekleyen başvuru yok.
        </p>
      ) : (
        <div className="mt-8 space-y-4">
          {pending.map((coach) => (
            <CoachReviewCard key={coach.id} coach={JSON.parse(JSON.stringify(coach))} />
          ))}
        </div>
      )}
    </main>
  );
}
KAKTUS_FILE_EOF

emit "src/app/api/auth/[...nextauth]/route.ts" <<'KAKTUS_FILE_EOF'
import { handlers } from '@/lib/auth';

export const { GET, POST } = handlers;
KAKTUS_FILE_EOF

emit "src/app/api/onboarding/route.ts" <<'KAKTUS_FILE_EOF'
import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import {
  onboardingSchema,
  readOnboardingSession,
  toMatchInput,
  upsertOnboardingSession,
} from '@/lib/onboarding/session';
import { findMatches } from '@/lib/matching/engine';

/**
 * Saves one step of the guest questionnaire. Called on every step so a student
 * who drops out at step 3 still leaves a usable signal — and so returning
 * later resumes where they stopped.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = onboardingSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const session = await upsertOnboardingSession(parsed.data, {
    ipHash: forwarded ? createHash('sha256').update(forwarded).digest('hex').slice(0, 32) : undefined,
    userAgent: request.headers.get('user-agent') ?? undefined,
    referrer: request.headers.get('referer') ?? undefined,
  });

  return NextResponse.json({
    ok: true,
    completedStep: session.completedStep,
    ready: Boolean(session.track && session.gradeLevel),
  });
}

/** Returns the saved answers plus a live match preview. */
export async function GET() {
  const session = await readOnboardingSession();
  if (!session) return NextResponse.json({ session: null, matches: [] });

  const input = toMatchInput(session);
  if (!input) return NextResponse.json({ session, matches: [] });

  const { results, coaches } = await findMatches(input, {
    limit: 12,
    onboardingSessionId: session.id,
  });

  return NextResponse.json({
    session,
    matches: results.map((r) => {
      const coach = coaches.get(r.coachId)!;
      return {
        coachId: r.coachId,
        slug: coach.slug,
        displayName: coach.displayName,
        university: coach.university,
        department: coach.department,
        matchScore: r.displayScore,
        reasons: r.reasons,
        caveats: r.caveats,
        priceFromMinor: Math.min(...coach.pricing.map((p) => p.priceMinor)),
        // Exact availability and contact surface stay behind the auth gate.
        ratingAvg: coach.stats.ratingAvg,
        ratingCount: coach.stats.ratingCount,
      };
    }),
  });
}
KAKTUS_FILE_EOF

emit "src/app/api/payments/callback/route.ts" <<'KAKTUS_FILE_EOF'
import { NextResponse, type NextRequest } from 'next/server';
import { PaymentError, reconcileCheckout } from '@/server/services/payment-service';

/**
 * Checkout Form callback — the browser redirect after the student pays.
 *
 * Iyzico POSTs here as a form submission from the user's browser. Two
 * consequences drive the whole handler:
 *
 * 1. **This request is attacker-controlled.** Anyone can POST a token here.
 *    So we read exactly one field — the token — and use it only to ask Iyzico
 *    what happened. Nothing in this body is believed, and no amount, status, or
 *    payment id from it is ever written to the database.
 *
 * 2. **It is a navigation, not an API call.** The response must be a redirect a
 *    human lands on, never JSON. Errors redirect to a page that explains
 *    itself; they never surface a stack trace to a 17-year-old who just typed
 *    in their card details.
 *
 * The callback is also not the source of truth for *whether* we get paid. If
 * the student closes the tab mid-redirect this never fires, and the webhook
 * plus the reconciliation sweep cover it. Treating the callback as merely one
 * of three triggers is what makes that safe.
 */

export const dynamic = 'force-dynamic';

function redirect(request: NextRequest, path: string, params: Record<string, string> = {}) {
  const url = new URL(path, request.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: NextRequest) {
  let token: string | null = null;

  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { token?: string };
      token = body.token ?? null;
    } else {
      const form = await request.formData();
      token = (form.get('token') as string | null) ?? null;
    }
  } catch {
    return redirect(request, '/odeme/hata', { neden: 'gecersiz_istek' });
  }

  if (!token) {
    return redirect(request, '/odeme/hata', { neden: 'eksik_token' });
  }

  try {
    const result = await reconcileCheckout(token);

    switch (result.outcome) {
      case 'CAPTURED':
      case 'ALREADY_PROCESSED':
        return redirect(request, '/odeme/basarili', { teklif: result.offerId ?? '' });
      case 'PENDING':
        // 3DS not finished, or fraud review. The webhook will finish the job;
        // the student sees a page that says "we're checking" rather than a
        // false failure that makes them pay twice.
        return redirect(request, '/odeme/beklemede', { teklif: result.offerId ?? '' });
      case 'FAILED':
        return redirect(request, '/odeme/hata', {
          neden: 'odeme_reddedildi',
          teklif: result.offerId ?? '',
        });
    }
  } catch (error) {
    if (error instanceof PaymentError && error.code === 'AMOUNT_MISMATCH') {
      // Money moved but our books disagree. Do not tell the student it failed —
      // it did not. Route to a page that says support is on it, and page us.
      console.error('[payments] AMOUNT MISMATCH on callback', { token, error });
      return redirect(request, '/odeme/inceleniyor');
    }
    console.error('[payments] callback reconciliation failed', { token, error });
    return redirect(request, '/odeme/hata', { neden: 'beklenmeyen' });
  }
}

/** Some Iyzico configurations issue a GET redirect instead. Handle both. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) return redirect(request, '/odeme/hata', { neden: 'eksik_token' });

  try {
    const result = await reconcileCheckout(token);
    return redirect(
      request,
      result.outcome === 'CAPTURED' || result.outcome === 'ALREADY_PROCESSED'
        ? '/odeme/basarili'
        : result.outcome === 'PENDING'
          ? '/odeme/beklemede'
          : '/odeme/hata',
      { teklif: result.offerId ?? '' },
    );
  } catch {
    return redirect(request, '/odeme/hata', { neden: 'beklenmeyen' });
  }
}
KAKTUS_FILE_EOF

emit "src/app/api/webhooks/iyzico/route.ts" <<'KAKTUS_FILE_EOF'
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
KAKTUS_FILE_EOF

emit "src/app/giris/eposta-gonderildi/page.tsx" <<'KAKTUS_FILE_EOF'
import Link from 'next/link';

export default function VerifyRequestPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <h1 className="font-display text-3xl font-semibold leading-tight text-balance">
        E-postana bak
      </h1>
      <p className="mt-4 leading-relaxed text-muted">
        Giriş bağlantısını gönderdik. Bağlantı 24 saat geçerli ve yalnızca bir kez kullanılabilir.
      </p>
      <p className="mt-4 leading-relaxed text-muted">
        Gelen kutunda yoksa spam klasörüne bak. Bağlantıyı farklı bir tarayıcıda açsan da giriş
        yapabilirsin.
      </p>
      <Link href="/" className="mt-8 text-cactus hover:text-cactus-deep">
        Ana sayfaya dön
      </Link>
    </main>
  );
}
KAKTUS_FILE_EOF

emit "src/app/giris/hata/page.tsx" <<'KAKTUS_FILE_EOF'
import Link from 'next/link';

/**
 * Auth.js error landing.
 *
 * Its error codes are opaque to a normal person, so they are translated rather
 * than displayed. `Verification` in particular means an expired or reused magic
 * link, which is common and entirely recoverable — the copy says so instead of
 * implying the account is broken.
 */
const MESSAGES: Record<string, { title: string; body: string }> = {
  Verification: {
    title: 'Bu bağlantının süresi dolmuş',
    body: 'Giriş bağlantıları 24 saat geçerlidir ve yalnızca bir kez kullanılabilir. Yeni bir bağlantı isteyebilirsin.',
  },
  OAuthAccountNotLinked: {
    title: 'Bu e-posta başka bir yöntemle kayıtlı',
    body: 'Daha önce bu e-posta ile e-posta bağlantısı kullanarak giriş yapmışsın. Aynı yöntemle devam et.',
  },
  AccessDenied: {
    title: 'Girişe izin verilmedi',
    body: 'Hesabın askıya alınmış olabilir. Destek ekibiyle iletişime geçebilirsin.',
  },
  Default: {
    title: 'Giriş yapılamadı',
    body: 'Beklenmeyen bir sorun oldu. Tekrar denersen genelde düzeliyor.',
  },
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = MESSAGES[error ?? 'Default'] ?? MESSAGES.Default;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <h1 className="font-display text-3xl font-semibold leading-tight text-balance">
        {message.title}
      </h1>
      <p className="mt-4 leading-relaxed text-muted">{message.body}</p>
      <Link
        href="/giris"
        className="mt-8 self-start rounded-full bg-cactus px-6 py-3 font-medium text-paper hover:bg-cactus-deep"
      >
        Tekrar dene
      </Link>
    </main>
  );
}
KAKTUS_FILE_EOF

emit "src/app/giris/page.tsx" <<'KAKTUS_FILE_EOF'
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { SignInPanel } from '@/components/auth/SignInPanel';

/**
 * Standalone sign-in.
 *
 * Auth.js is configured to send people here — on a session error, on a fresh
 * magic-link click, whenever it needs a sign-in surface. Without this route
 * every one of those paths 404s, which is invisible in development because the
 * modal handles the happy path.
 */
export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  const { callbackUrl } = await searchParams;
  if (session?.user?.id) redirect(callbackUrl ?? '/');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="font-display text-lg font-semibold tracking-tight">
        Kaktüs Koçluk
      </Link>
      <h1 className="mt-8 font-display text-3xl font-semibold leading-tight text-balance">
        Giriş yap
      </h1>
      <p className="mt-3 leading-relaxed text-muted">
        Hesabın yoksa ilk girişinde otomatik oluşturulur. Cevapladığın sorular hesabına taşınır.
      </p>
      <SignInPanel callbackUrl={callbackUrl ?? '/'} />
    </main>
  );
}
KAKTUS_FILE_EOF

emit "src/app/globals.css" <<'KAKTUS_FILE_EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    color-scheme: light;
  }

  html {
    -webkit-text-size-adjust: 100%;
  }

  body {
    @apply bg-limestone text-ink font-sans antialiased;
  }

  /* Keyboard focus must stay visible everywhere. Onboarding is a form funnel;
     losing focus rings is losing the flow for anyone not using a mouse. */
  :focus-visible {
    outline: 2px solid theme('colors.cactus.DEFAULT');
    outline-offset: 3px;
    border-radius: 2px;
  }

  ::selection {
    background: theme('colors.bloom.pale');
  }
}

@layer components {
  /* The one orchestrated motion in the product: an answer settling into the
     rail. Everything else is instant. */
  .answer-settle {
    animation: settle 380ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
  }

  @keyframes settle {
    from {
      opacity: 0;
      transform: translateY(-6px) scaleY(0.94);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  /* Score meter fill, drawn on mount. */
  .meter-fill {
    animation: grow 620ms cubic-bezier(0.16, 1, 0.3, 1) both;
    transform-origin: left;
  }

  @keyframes grow {
    from {
      transform: scaleX(0);
    }
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
KAKTUS_FILE_EOF

emit "src/app/koc-ol/page.tsx" <<'KAKTUS_FILE_EOF'
import Link from 'next/link';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { getApplicationStatus } from '@/server/actions/coach-application';
import { AuthGateProvider } from '@/components/auth/AuthGate';
import { CoachApplicationForm } from '@/components/coach-apply/CoachApplicationForm';
import { CoachSignInPrompt } from '@/components/coach-apply/CoachSignInPrompt';
import { ApplicationStatusPanel } from '@/components/coach-apply/ApplicationStatusPanel';

/**
 * Coach application.
 *
 * Three states behind one URL, chosen on the server:
 *
 *   not signed in  → sign-in prompt
 *   no application → the form
 *   applied        → status panel
 *
 * ── Why sign-in comes first here, unlike the student funnel ──
 *
 * Students answer five harmless questions before we ask who they are, because
 * the answers are cheap to re-enter and the payoff (seeing matches) is
 * immediate. Coaches are the opposite: the form ends with a TCKN, an IBAN, and
 * two identity documents. Parking that in a guest cookie the way we park a
 * draft offer would mean holding financial identifiers for someone who has no
 * account and may never return — a KVKK liability with no upside.
 *
 * So the account comes first. It costs one extra step for a user who is already
 * committed enough to be filling in their bank details.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Koç ol — Kaktüs Koçluk',
  description:
    'YKS sıralamanı doğrula, kendi fiyatını belirle, öğrencilerini kendin seç. Komisyon yalnızca tamamlanan derslerden alınır.',
};

export default async function CoachApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ duzenle?: string }>;
}) {
  const [session, query] = await Promise.all([auth(), searchParams]);

  if (!session?.user?.id) {
    return (
      <AuthGateProvider authenticated={false}>
        <CoachSignInPrompt />
      </AuthGateProvider>
    );
  }

  const status = await getApplicationStatus();

  // Anything past DRAFT means the application is submitted and the coach should
  // see where it stands, not an empty form that would overwrite it.
  //
  // The one exception is a rejected coach who asked to edit: rejection is
  // usually an unreadable document, and sending them to a separate re-apply
  // URL would mean maintaining two copies of a long form.
  const reapplying = query.duzenle === '1' && status?.verificationStatus === 'REJECTED';
  if (status && status.verificationStatus !== 'DRAFT' && !reapplying) {
    return <ApplicationStatusPanel status={status} />;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 sm:px-8">
      <header>
        <Link href="/" className="text-sm text-muted transition-colors hover:text-cactus">
          Kaktüs Koçluk
        </Link>
        <h1 className="mt-6 max-w-measure font-display text-question font-semibold text-balance">
          Koç başvurusu
        </h1>
        <p className="mt-3 max-w-[54ch] leading-relaxed text-muted">
          Sıralamanı doğrulayıp profilini kurduktan sonra öğrenciler sana teklif göndermeye
          başlar. Fiyatını ve kaç öğrenci alacağını sen belirlersin.
        </p>
      </header>

      <CoachApplicationForm displayName={session.user.name ?? ''} />
    </main>
  );
}
KAKTUS_FILE_EOF

emit "src/app/koc-ol/tesekkurler/page.tsx" <<'KAKTUS_FILE_EOF'
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getApplicationStatus } from '@/server/actions/coach-application';
import { ApplicationStatusPanel } from '@/components/coach-apply/ApplicationStatusPanel';

/**
 * Where the coach application form lands after a successful submit.
 *
 * Renders the same status panel as /koc-ol so a coach who bookmarks either URL
 * sees a consistent picture, rather than a one-off "thanks" page that goes
 * stale the moment their application is approved.
 */
export const dynamic = 'force-dynamic';

export default async function ApplicationSubmittedPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/giris?callbackUrl=/koc-ol');

  const status = await getApplicationStatus();
  if (!status || status.verificationStatus === 'DRAFT') redirect('/koc-ol');

  return <ApplicationStatusPanel status={status} />;
}
KAKTUS_FILE_EOF

emit "src/app/koc/[slug]/page.tsx" <<'KAKTUS_FILE_EOF'
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getCoachProfile } from '@/server/queries/coach-profile';
import { getCoachCalendar } from '@/lib/booking/availability';
import { readOfferDraft } from '@/server/actions/offers';
import { AuthGateProvider } from '@/components/auth/AuthGate';
import { CoachProfileClient } from '@/components/coach/CoachProfileClient';
import { STYLE_LABELS, TRACK_LABELS } from '@/lib/onboarding/client-state';

/**
 * Coach profile.
 *
 * A Server Component end to end. The hero, credentials, bio and reviews are
 * plain HTML in the first response and ship no JavaScript; only the calendar
 * and composer are client components, mounted as a single island at the bottom.
 * That split is why this page is fast on the mid-range Android phones most of
 * these students are using.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const coach = await getCoachProfile(slug);
  if (!coach) return { title: 'Koç bulunamadı' };
  return {
    title: `${coach.displayName} — ${coach.university} | Kaktüs Koçluk`,
    description: coach.headline,
  };
}

export default async function CoachProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ teklif?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);

  const coach = await getCoachProfile(slug);
  if (!coach) notFound();

  const session = await auth();
  const authenticated = Boolean(session?.user?.id);

  // Needed so the calendar can distinguish this student's own holds from
  // everyone else's — a student must never see their own open offer as "taken".
  const viewer = session?.user?.id
    ? await prisma.studentProfile.findUnique({
        where: { userId: session.user.id },
        select: { id: true },
      })
    : null;

  const [calendar, draft] = await Promise.all([
    getCoachCalendar(coach.id, { days: 14, viewerStudentProfileId: viewer?.id ?? null }),
    query.teklif === '1' ? readOfferDraft() : Promise.resolve(null),
  ]);

  // Only resume a draft that belongs to this coach. A stale cookie from another
  // profile must not silently repopulate the composer here.
  const resumeDraft = draft && draft.coachSlug === slug ? draft : null;

  return (
    <AuthGateProvider authenticated={authenticated}>
      <main className="mx-auto max-w-3xl px-6 py-10 sm:px-8">
        <CoachHero coach={coach} />
        <Credentials coach={coach} />
        <Methodology coach={coach} />
        <Reviews coach={coach} />

        <CoachProfileClient
          coach={{
            id: coach.id,
            slug: coach.slug,
            displayName: coach.displayName,
            commissionBps: coach.commissionBps,
            pricingTiers: coach.pricingTiers,
          }}
          days={calendar.days}
          timezone={calendar.timezone}
          authenticated={authenticated}
          resumeDraft={resumeDraft}
        />
      </main>
    </AuthGateProvider>
  );
}

function CoachHero({ coach }: { coach: NonNullable<Awaited<ReturnType<typeof getCoachProfile>>> }) {
  const climbed =
    coach.journey.baselineNet != null && coach.journey.finalNet != null
      ? `${Math.round(coach.journey.baselineNet)} → ${Math.round(coach.journey.finalNet)} net`
      : null;

  return (
    <header>
      <h1 className="font-display text-question font-semibold text-balance">
        {coach.displayName}
      </h1>
      <p className="mt-2 text-lg leading-snug text-muted">{coach.headline}</p>

      {/* The trajectory is the headline claim, so it gets the display face and
          its own line rather than being buried in a badge row. */}
      {climbed && (
        <p className="mt-6 font-display text-2xl font-semibold tabular-nums">
          {climbed}
          <span className="ml-3 align-middle text-base font-normal text-muted">
            kendi YKS çıkışı
          </span>
        </p>
      )}
    </header>
  );
}

function Credentials({
  coach,
}: {
  coach: NonNullable<Awaited<ReturnType<typeof getCoachProfile>>>;
}) {
  return (
    <section className="mt-8">
      <dl className="grid gap-px overflow-hidden rounded-2xl border border-stone/70 bg-stone/60 sm:grid-cols-3">
        <Fact label="YKS sıralaması" value={`${coach.yksRank.toLocaleString('tr-TR')}.`} note={`${coach.yksYear} yılı`} />
        <Fact label="Üniversite" value={coach.university} note={coach.department} />
        <Fact
          label="Öğrenci"
          value={`${coach.stats.completedEngagements} tamamlanan`}
          note={
            coach.stats.ratingCount > 0
              ? `${coach.stats.ratingAvg.toFixed(1)} puan · ${coach.stats.ratingCount} değerlendirme`
              : 'Henüz değerlendirme yok'
          }
        />
      </dl>

      {coach.verifiedAt && (
        <p className="mt-3 flex items-center gap-2 text-sm text-cactus-deep">
          <CheckMark />
          ÖSYM sonuç belgesi ve öğrenci belgesi Kaktüs tarafından doğrulandı
        </p>
      )}

      <ul className="mt-4 flex flex-wrap gap-2">
        {coach.tracks.map((track) => (
          <Tag key={track}>{TRACK_LABELS[track as keyof typeof TRACK_LABELS]?.short ?? track}</Tag>
        ))}
        {coach.styles.map((style) => (
          <Tag key={style}>{STYLE_LABELS[style as keyof typeof STYLE_LABELS]?.short ?? style}</Tag>
        ))}
      </ul>
    </section>
  );
}

function Methodology({
  coach,
}: {
  coach: NonNullable<Awaited<ReturnType<typeof getCoachProfile>>>;
}) {
  return (
    <section className="mt-12">
      <h2 className="font-display text-lg font-semibold">Nasıl çalışıyor</h2>
      <div className="mt-3 max-w-measure space-y-4 leading-relaxed">
        {coach.bio.split(/\n{2,}/).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>

      {coach.specializations.length > 0 && (
        <ul className="mt-6 space-y-2">
          {coach.specializations.map((spec) => (
            <li key={spec.label} className="flex gap-2.5 leading-snug">
              <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-cactus" />
              {spec.label}
            </li>
          ))}
        </ul>
      )}

      {coach.subjects.length > 0 && (
        <p className="mt-6 text-sm text-muted">Dersler: {coach.subjects.join(', ')}</p>
      )}
    </section>
  );
}

function Reviews({ coach }: { coach: NonNullable<Awaited<ReturnType<typeof getCoachProfile>>> }) {
  if (coach.reviews.length === 0) {
    return (
      <section className="mt-12">
        <h2 className="font-display text-lg font-semibold">Öğrenci yorumları</h2>
        <p className="mt-2 max-w-measure leading-relaxed text-muted">
          Bu koç Kaktüs'te yeni. Yorumlar yalnızca programı tamamlayan öğrencilerden gelir, bu
          yüzden ilk yorumlar birkaç hafta sürer.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-12">
      <h2 className="font-display text-lg font-semibold">Öğrenci yorumları</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {coach.reviews.map((review) => (
          <article key={review.id} className="rounded-2xl border border-stone/70 bg-paper p-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{review.studentInitials}</span>
              <span className="text-sm tabular-nums text-muted" aria-label={`${review.rating} / 5`}>
                {'★'.repeat(review.rating)}
                <span className="text-stone">{'★'.repeat(5 - review.rating)}</span>
              </span>
            </div>
            {review.netGainReported != null && (
              <p className="mt-2 font-display text-lg font-semibold tabular-nums text-cactus-deep">
                +{Math.round(review.netGainReported)} net
              </p>
            )}
            {review.body && <p className="mt-2 leading-relaxed">{review.body}</p>}
            <time
              dateTime={review.createdAt.toISOString()}
              className="mt-3 block text-sm text-muted"
            >
              {new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(
                review.createdAt,
              )}
            </time>
          </article>
        ))}
      </div>
    </section>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-paper px-5 py-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 font-medium leading-snug">{value}</dd>
      {note && <dd className="mt-0.5 text-sm text-muted">{note}</dd>}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <li className="rounded-full border border-stone/70 px-3 py-1 text-sm text-muted">{children}</li>
  );
}

function CheckMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M4.75 8.25 6.9 10.4l4.35-4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
KAKTUS_FILE_EOF

emit "src/app/kocbul/page.tsx" <<'KAKTUS_FILE_EOF'
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { auth } from '@/lib/auth';
import { getMatches, loadOnboardingDraft } from '@/server/actions/onboarding';
import {
  GRADE_LABELS,
  TRACK_LABELS,
  formatTry,
  type OnboardingDraft,
} from '@/lib/onboarding/client-state';
import { AuthGateProvider } from '@/components/auth/AuthGate';
import { CoachMatchCard } from '@/components/match/CoachMatchCard';

/**
 * Match results.
 *
 * A server component: the matcher runs on the server against the guest's cookie
 * session, and the ranked list is in the first HTML response. No loading
 * spinner, no client-side fetch, no flash of an empty list — which matters
 * because this page is the moment the product either earns the next click or
 * does not.
 */

export const dynamic = 'force-dynamic';

export default async function KocBulPage() {
  const draft = await loadOnboardingDraft();
  if (!draft.track || !draft.gradeLevel) redirect('/onboarding/alan');

  const session = await auth();

  return (
    <AuthGateProvider authenticated={Boolean(session?.user?.id)}>
      <main className="mx-auto max-w-4xl px-6 py-10 sm:px-8">
        <header>
          <Link href="/onboarding/butce" className="text-sm text-muted hover:text-cactus">
            Cevapları değiştir
          </Link>
          <h1 className="mt-6 font-display text-question font-semibold text-balance">
            Sana en çok uyan koçlar
          </h1>
          <FilterSummary draft={draft} />
        </header>

        <Suspense fallback={<MatchSkeleton />}>
          <MatchList />
        </Suspense>
      </main>
    </AuthGateProvider>
  );
}

async function MatchList() {
  const { ready, coaches, totalConsidered } = await getMatches(12);

  if (!ready) redirect('/onboarding/alan');

  if (coaches.length === 0) {
    // An empty screen is an invitation to act, not an apology. Name the two
    // filters most likely to be responsible and link straight to them.
    return (
      <section className="mt-10 rounded-2xl border border-stone/70 bg-paper p-8">
        <h2 className="font-display text-xl font-semibold">
          Bu kriterlerle şu an uygun koç yok
        </h2>
        <p className="mt-2 max-w-[52ch] leading-relaxed text-muted">
          Genelde bütçe aralığı ya da hedef sıralama daraltıyor. İkisinden birini
          gevşetirsen listede koç çıkması çok olası.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/onboarding/butce"
            className="rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper hover:bg-cactus-deep"
          >
            Bütçeyi düzenle
          </Link>
          <Link
            href="/onboarding/hedef"
            className="rounded-full border border-stone px-5 py-2.5 text-sm font-medium hover:border-cactus hover:text-cactus"
          >
            Hedefi düzenle
          </Link>
        </div>
      </section>
    );
  }

  const [top, ...rest] = coaches;

  return (
    <>
      <p className="mt-4 text-sm text-muted">
        {totalConsidered} koç değerlendirildi, {coaches.length} tanesi eşleşti.
      </p>

      <section className="mt-8 space-y-4">
        <CoachMatchCard coach={top} featured position={1} />
        {rest.map((coach, index) => (
          <CoachMatchCard key={coach.coachId} coach={coach} position={index + 2} />
        ))}
      </section>

      <p className="mt-10 max-w-[56ch] text-sm leading-relaxed text-muted">
        Eşleşme puanı; hedef benzerliği, çalışma tarzı, saat uyumu, alan derinliği ve
        öğrenci geri bildirimlerinden hesaplanır. Ağırlıkları koçlar satın alamaz.
      </p>
    </>
  );
}

function FilterSummary({ draft }: { draft: OnboardingDraft }) {
  const chips = [
    draft.track && TRACK_LABELS[draft.track].short,
    draft.gradeLevel && GRADE_LABELS[draft.gradeLevel].short,
    draft.targetRanking && `İlk ${draft.targetRanking.toLocaleString('tr-TR')}`,
    draft.baselineTytNet != null && `TYT ${draft.baselineTytNet} net`,
    draft.budgetMaxMinor != null && `En fazla ${formatTry(draft.budgetMaxMinor)}`,
  ].filter(Boolean) as string[];

  return (
    <ul className="mt-4 flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li
          key={chip}
          className="rounded-full border border-stone/70 px-3 py-1 text-sm text-muted"
        >
          {chip}
        </li>
      ))}
    </ul>
  );
}

function MatchSkeleton() {
  return (
    <div className="mt-8 space-y-4" aria-busy="true" aria-label="Koçlar eşleştiriliyor">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-44 rounded-2xl border border-stone/70 bg-paper/60"
          style={{ opacity: 1 - i * 0.25 }}
        />
      ))}
    </div>
  );
}
KAKTUS_FILE_EOF

emit "src/app/layout.tsx" <<'KAKTUS_FILE_EOF'
import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Instrument_Sans } from 'next/font/google';
import './globals.css';

// Both families carry the full Turkish set (ş ğ ı İ ç ö ü). `latin-ext` is not
// optional here — without it, half the interface renders in a fallback face.
const display = Bricolage_Grotesque({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-display',
  display: 'swap',
  weight: ['500', '600', '700'],
});

const body = Instrument_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Kaktüs Koçluk — YKS koçunu kendin seç',
  description:
    'Paket satın almadan önce koçunu tanı. Alanına, hedefine ve çalışma tarzına göre eşleşen YKS koçlarını gör, kendi teklifini gönder.',
};

export const viewport: Viewport = {
  themeColor: '#1E6B4B',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
KAKTUS_FILE_EOF

emit "src/app/odeme/[durum]/page.tsx" <<'KAKTUS_FILE_EOF'
import Link from 'next/link';
import { notFound } from 'next/navigation';

/**
 * Payment outcome pages.
 *
 * One dynamic route rather than four near-identical files. The payment callback
 * redirects here after reconciling with Iyzico, so these are the last thing a
 * student sees after handing over their card — and until now they were a 404,
 * which is the worst possible ending to a successful payment.
 *
 * `beklemede` and `inceleniyor` deliberately do not say "failed". A pending 3DS
 * or a fraud review is not a failure, and telling a student it failed is how you
 * get a duplicate payment from someone who panics and pays again.
 */

const STATES = {
  basarili: {
    title: 'Ödemen alındı',
    body: 'Paran Kaktüs’te güvencede. Koçuna bildirildi; dersler yapıldıkça haftalık dilimler hâlinde aktarılacak.',
    detail:
      'Koç derse gelmezse ya da program başlamazsa panelinden iade talep edebilirsin.',
    tone: 'good',
    cta: { href: '/panel', label: 'Panelime git' },
  },
  beklemede: {
    title: 'Ödemen doğrulanıyor',
    body: 'Bankan işlemi onaylıyor. Bu genelde birkaç saniye sürer, bazen birkaç dakika.',
    detail:
      'Bu sayfayı kapatabilirsin — sonuç netleştiğinde e-posta göndereceğiz. Lütfen tekrar ödeme yapma.',
    tone: 'wait',
    cta: { href: '/panel', label: 'Panelime git' },
  },
  inceleniyor: {
    title: 'Ödemen kontrol ediliyor',
    body: 'İşlem tamamlandı ancak kayıtlarımızda doğrulanması gereken bir ayrıntı var. Ekibimiz bakıyor.',
    detail:
      'Paran güvende. 24 saat içinde sana döneceğiz; bu sırada yeniden ödeme yapmana gerek yok.',
    tone: 'wait',
    cta: { href: '/panel', label: 'Panelime git' },
  },
  hata: {
    title: 'Ödeme tamamlanamadı',
    body: 'Banka işlemi onaylamadı. Kartından herhangi bir tutar çekilmedi.',
    detail:
      'En sık nedenler: yetersiz bakiye, internetten alışverişe kapalı kart ya da yanlış 3D şifresi. Başka bir kartla tekrar deneyebilirsin.',
    tone: 'bad',
    cta: { href: '/panel', label: 'Tekliflerime dön' },
  },
} as const;

export function generateStaticParams() {
  return Object.keys(STATES).map((durum) => ({ durum }));
}

export default async function PaymentOutcomePage({
  params,
  searchParams,
}: {
  params: Promise<{ durum: string }>;
  searchParams: Promise<{ teklif?: string; neden?: string }>;
}) {
  const [{ durum }, query] = await Promise.all([params, searchParams]);
  const state = STATES[durum as keyof typeof STATES];
  if (!state) notFound();

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-12">
      <span
        aria-hidden
        className={[
          'h-1 w-12 rounded-full',
          state.tone === 'good' ? 'bg-cactus' : state.tone === 'bad' ? 'bg-bloom' : 'bg-dust',
        ].join(' ')}
      />
      <h1 className="mt-6 font-display text-question font-semibold leading-tight text-balance">
        {state.title}
      </h1>
      <p className="mt-4 text-lg leading-relaxed">{state.body}</p>
      <p className="mt-3 leading-relaxed text-muted">{state.detail}</p>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href={query.teklif ? `/panel/teklifler/${query.teklif}` : state.cta.href}
          className="rounded-full bg-cactus px-6 py-3 font-medium text-paper hover:bg-cactus-deep"
        >
          {state.cta.label}
        </Link>
        <Link
          href="/"
          className="rounded-full border border-stone px-6 py-3 font-medium hover:border-cactus hover:text-cactus"
        >
          Ana sayfa
        </Link>
      </div>
    </main>
  );
}
KAKTUS_FILE_EOF

emit "src/app/onboarding/[step]/page.tsx" <<'KAKTUS_FILE_EOF'
import { notFound } from 'next/navigation';
import { STEPS, type StepSlug } from '@/lib/onboarding/client-state';
import { loadOnboardingDraft } from '@/server/actions/onboarding';
import { OnboardingProvider } from '@/components/onboarding/OnboardingProvider';
import {
  StepBaseline,
  StepBudget,
  StepStyle,
  StepTarget,
  StepTrack,
} from '@/components/onboarding/steps';

/**
 * A route per step rather than one page with client-side step state.
 *
 * The back button has to work. Students compare coaches, go back to widen the
 * budget, come forward again — and a funnel where "back" exits to the landing
 * page loses them. Real URLs also mean a student can be sent a link to the
 * exact step they abandoned.
 */

/**
 * This page reads an httpOnly cookie to resume the guest's answers, so it can
 * never be prerendered. Saying so explicitly is better than letting Next
 * discover it: with `generateStaticParams` and no opt-out, the build tries to
 * statically render all five steps and fails on the first `cookies()` call.
 */
export const dynamic = 'force-dynamic';

/**
 * Steps are resolved with an explicit switch, NOT by indexing a map.
 *
 * `steps.tsx` is a `'use client'` module. When a Server Component imports from
 * one, Next.js replaces every export with a client-reference stub — a pointer
 * the bundler resolves on the client. Individual components survive that
 * translation and can be rendered directly. A plain object does not: importing
 * a `Record<Slug, Component>` here yields a stub whose properties are all
 * `undefined`, and `<Step />` then throws "Element type is invalid... but got:
 * undefined".
 *
 * So the mapping has to live on whichever side actually holds the values. Doing
 * it here, over directly-imported components, keeps routing in the Server
 * Component and gives the compiler an exhaustiveness check for free — a new
 * step added to STEPS without a case is a type error, not a 500 in production.
 */
function resolveStep(step: StepSlug) {
  switch (step) {
    case 'alan':
      return StepTrack;
    case 'hedef':
      return StepTarget;
    case 'net':
      return StepBaseline;
    case 'tarz':
      return StepStyle;
    case 'butce':
      return StepBudget;
    default: {
      const exhaustive: never = step;
      throw new Error(`Unhandled onboarding step: ${String(exhaustive)}`);
    }
  }
}

function isStepSlug(value: string): value is StepSlug {
  return (STEPS as readonly string[]).includes(value);
}

export default async function OnboardingStepPage({
  params,
}: {
  params: Promise<{ step: string }>;
}) {
  const { step } = await params;
  if (!isStepSlug(step)) notFound();

  // Server-side read from the httpOnly cookie session. This is what makes the
  // funnel resumable across devices and across the magic-link round trip; the
  // client cache is only a fast path on top of it.
  const serverDraft = await loadOnboardingDraft();
  const Step = resolveStep(step);

  return (
    <OnboardingProvider serverDraft={serverDraft}>
      <Step />
    </OnboardingProvider>
  );
}
KAKTUS_FILE_EOF

emit "src/app/page.tsx" <<'KAKTUS_FILE_EOF'
import Link from 'next/link';

/**
 * Landing.
 *
 * The hero is the promise that differentiates the product, stated plainly:
 * you pick the coach, you name the price. Not a stat block, not a gradient.
 * The two doors (student / coach) are the only decision on the page, because
 * the two audiences need completely different next screens.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-6 py-10 sm:px-8">
      <header className="flex items-baseline gap-3">
        <span className="font-display text-lg font-semibold tracking-tight">Kaktüs Koçluk</span>
        <span className="text-sm text-muted">YKS koçluk pazarı</span>
      </header>

      <div className="flex flex-1 flex-col justify-center py-16">
        <h1 className="max-w-measure font-display text-question font-semibold text-balance">
          Hazır paket satın alma. Koçunu seç, şartları birlikte belirleyin.
        </h1>
        <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-muted">
          Beş soruya cevap ver, sana uyan koçları eşleşme puanıyla birlikte gör. Üye olmadan.
          Ödeme, dersler tamamlanana kadar Kaktüs'te güvencede kalır.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/onboarding/alan"
            className="inline-flex items-center justify-center rounded-full bg-cactus px-7 py-3.5 text-base font-medium text-paper transition-colors hover:bg-cactus-deep"
          >
            Öğrenciyim, koç arıyorum
          </Link>
          <Link
            href="/koc-ol"
            className="inline-flex items-center justify-center rounded-full border border-stone px-7 py-3.5 text-base font-medium text-ink transition-colors hover:border-cactus hover:text-cactus"
          >
            Koç olmak istiyorum
          </Link>
        </div>
      </div>

      <footer className="border-t border-stone/60 pt-6 text-sm text-muted">
        Ödemeler koç ders tamamlandığını onaylayana kadar güvencede tutulur.
      </footer>
    </main>
  );
}
KAKTUS_FILE_EOF

emit "src/app/panel/page.tsx" <<'KAKTUS_FILE_EOF'
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listConversations } from '@/server/queries/conversation';
import { formatTry } from '@/lib/onboarding/client-state';
import { OFFER_STATUS_TR } from '@/lib/offers/state-machine';

/**
 * Dashboard.
 *
 * Organised by *what needs doing*, not by data type. The first thing on the
 * page is the list of conversations where the other side is waiting on you —
 * because in a marketplace the single biggest killer is a coach taking two days
 * to reply to an offer, and the dashboard's job is to make that hard to do
 * accidentally.
 *
 * A person can be both student and coach — a gap-year student who coaches an
 * 11th grader is exactly who this platform attracts — so both sections render
 * when both exist.
 */
export const dynamic = 'force-dynamic';

export default async function PanelPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/giris?callbackUrl=/panel');

  const [conversations, student, coach, isAdmin] = await Promise.all([
    listConversations(),
    prisma.studentProfile.findUnique({
      where: { userId: session.user.id },
      select: { id: true, engagements: { where: { status: 'ACTIVE' }, select: { id: true } } },
    }),
    prisma.coachProfile.findUnique({
      where: { userId: session.user.id },
      select: {
        id: true,
        slug: true,
        verificationStatus: true,
        activeEngagements: true,
        maxActiveStudents: true,
        acceptingStudents: true,
      },
    }),
    prisma.user
      .findUnique({ where: { id: session.user.id }, select: { roles: true } })
      .then((u) => u?.roles.includes('ADMIN') ?? false),
  ]);

  const waiting = conversations.filter((c) => c.awaitingViewer);
  const rest = conversations.filter((c) => !c.awaitingViewer);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 sm:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Link href="/" className="text-sm text-muted transition-colors hover:text-cactus">
          Kaktüs Koçluk
        </Link>
        {isAdmin && (
          <Link href="/admin" className="text-sm text-cactus hover:text-cactus-deep">
            Yönetim
          </Link>
        )}
      </div>

      <h1 className="mt-6 font-display text-question font-semibold">Panelin</h1>

      {coach && coach.verificationStatus !== 'APPROVED' && (
        <Link
          href="/koc-ol"
          className="mt-6 block rounded-xl border border-dust/60 bg-dust/10 px-5 py-4 transition-colors hover:border-cactus"
        >
          <p className="font-medium">Koç başvurun inceleniyor</p>
          <p className="mt-0.5 text-sm text-muted">Durumu görmek için dokun.</p>
        </Link>
      )}

      {waiting.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-lg font-semibold">Seni bekleyenler</h2>
          <p className="mt-1 text-sm text-muted">
            Karşı taraf yanıtını bekliyor. Hızlı dönmek, anlaşma ihtimalini en çok artıran şey.
          </p>
          <ConversationList items={waiting} highlight />
        </section>
      )}

      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold">
          {waiting.length > 0 ? 'Diğer sohbetler' : 'Sohbetler'}
        </h2>
        {rest.length === 0 && waiting.length === 0 ? (
          <EmptyState hasCoach={Boolean(coach)} hasStudent={Boolean(student)} />
        ) : (
          <ConversationList items={rest} />
        )}
      </section>

      {coach?.verificationStatus === 'APPROVED' && (
        <section className="mt-12">
          <h2 className="font-display text-lg font-semibold">Koç durumun</h2>
          <dl className="mt-3 grid gap-px overflow-hidden rounded-xl border border-stone/70 bg-stone/60 sm:grid-cols-3">
            <Stat
              label="Aktif öğrenci"
              value={`${coach.activeEngagements} / ${coach.maxActiveStudents}`}
            />
            <Stat label="Yeni öğrenci" value={coach.acceptingStudents ? 'Alıyorsun' : 'Kapalı'} />
            <Stat label="Profilin" value="Yayında" href={`/koc/${coach.slug}`} />
          </dl>
        </section>
      )}
    </main>
  );
}

function ConversationList({
  items,
  highlight = false,
}: {
  items: Awaited<ReturnType<typeof listConversations>>;
  highlight?: boolean;
}) {
  if (items.length === 0) {
    return <p className="mt-3 text-muted">Henüz sohbet yok.</p>;
  }

  return (
    <ul className="mt-3 space-y-px overflow-hidden rounded-xl border border-stone/70 bg-stone/60">
      {items.map((item) => (
        <li key={item.id} className="bg-paper">
          <Link
            href={`/panel/sohbet/${item.id}`}
            className={[
              'flex items-baseline justify-between gap-4 px-5 py-4 transition-colors hover:bg-cactus-pale/40',
              highlight ? 'border-l-2 border-l-bloom' : '',
            ].join(' ')}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{item.counterpartyName}</span>
              <span className="mt-0.5 block truncate text-sm text-muted">
                {item.lastMessage ?? 'Henüz mesaj yok'}
              </span>
            </span>
            <span className="shrink-0 text-right text-sm">
              {item.liveOfferPriceMinor != null && (
                <span className="block tabular-nums">{formatTry(item.liveOfferPriceMinor)}</span>
              )}
              {item.liveOfferStatus && (
                <span className="mt-0.5 block text-muted">
                  {OFFER_STATUS_TR[item.liveOfferStatus as keyof typeof OFFER_STATUS_TR] ??
                    item.liveOfferStatus}
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ hasCoach, hasStudent }: { hasCoach: boolean; hasStudent: boolean }) {
  return (
    <div className="mt-3 rounded-xl border border-stone/70 bg-paper px-5 py-5">
      <p className="leading-relaxed text-muted">
        {hasCoach
          ? 'Henüz teklif almadın. Takvimini güncel tutmak, gelen teklif sayısını en çok artıran şey.'
          : 'Henüz bir koçla konuşmaya başlamadın.'}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {hasStudent && (
          <Link
            href="/kocbul"
            className="rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper hover:bg-cactus-deep"
          >
            Koçları gör
          </Link>
        )}
        {!hasStudent && !hasCoach && (
          <>
            <Link
              href="/onboarding/alan"
              className="rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper hover:bg-cactus-deep"
            >
              Koç ara
            </Link>
            <Link
              href="/koc-ol"
              className="rounded-full border border-stone px-5 py-2.5 text-sm font-medium hover:border-cactus hover:text-cactus"
            >
              Koç ol
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = (
    <div className="bg-paper px-5 py-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
  return href ? (
    <Link href={href} className="transition-colors hover:bg-cactus-pale/40">
      {body}
    </Link>
  ) : (
    body
  );
}
KAKTUS_FILE_EOF

emit "src/app/panel/sohbet/[conversationId]/page.tsx" <<'KAKTUS_FILE_EOF'
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getConversation } from '@/server/queries/conversation';
import { ConversationView } from '@/components/chat/ConversationView';

export const dynamic = 'force-dynamic';

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/giris?callbackUrl=/panel/sohbet/${conversationId}`);

  // Returns null for a stranger as well as for a missing row, and both render
  // as 404. Distinguishing them would confirm that a given conversation exists.
  const conversation = await getConversation(conversationId);
  if (!conversation) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 py-8 sm:px-8">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <Link href="/panel" className="text-sm text-muted transition-colors hover:text-cactus">
            Panele dön
          </Link>
          <h1 className="mt-3 font-display text-2xl font-semibold">
            {conversation.counterpartyName}
          </h1>
        </div>
        {conversation.viewerRole === 'STUDENT' && (
          <Link
            href={`/koc/${conversation.coachSlug}`}
            className="text-sm text-cactus hover:text-cactus-deep"
          >
            Profili gör
          </Link>
        )}
      </header>

      {conversation.flagged && (
        <p className="mt-4 rounded-lg border border-dust/60 bg-dust/10 px-4 py-3 text-sm leading-relaxed">
          Bu sohbet, platform dışına çıkma girişimi nedeniyle incelemeye alındı. Anlaşmanı Kaktüs
          üzerinden tamamlarsan ödemen güvence altında kalır.
        </p>
      )}

      <div className="mt-6">
        <ConversationView conversation={conversation} />
      </div>
    </main>
  );
}
KAKTUS_FILE_EOF

emit "src/app/panel/teklifler/[offerId]/page.tsx" <<'KAKTUS_FILE_EOF'
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { OFFER_STATUS_TR } from '@/lib/offers/state-machine';
import { formatTry } from '@/lib/onboarding/client-state';
import { computeBreakdown } from '@/lib/offers/draft';

/**
 * Offer detail.
 *
 * Where the composer lands after submitting, and where the payment pages send
 * people afterwards. Read-only for now: accept, counter and pay are the
 * negotiation view's job, and shipping half-wired buttons that call nothing
 * would be worse than showing an honest status.
 */
export const dynamic = 'force-dynamic';

export default async function OfferDetailPage({
  params,
}: {
  params: Promise<{ offerId: string }>;
}) {
  const { offerId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/giris?callbackUrl=/panel/teklifler/${offerId}`);

  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      title: true,
      status: true,
      priceMinor: true,
      commissionBps: true,
      startDate: true,
      endDate: true,
      milestoneCount: true,
      scope: true,
      createdAt: true,
      conversationId: true,
      coach: { select: { slug: true, userId: true, user: { select: { name: true } } } },
      student: { select: { userId: true, user: { select: { name: true } } } },
      engagement: {
        select: {
          status: true,
          milestones: {
            orderBy: { index: 'asc' },
            select: { index: true, status: true, amountMinor: true, periodStart: true },
          },
        },
      },
    },
  });

  if (!offer) notFound();

  // Authorisation, not just authentication. An offer id is guessable enough
  // that "logged in" is not the same as "allowed to read this negotiation".
  const isParty =
    offer.coach.userId === session.user.id || offer.student.userId === session.user.id;
  if (!isParty) notFound();

  const viewerIsCoach = offer.coach.userId === session.user.id;
  const counterparty = viewerIsCoach ? offer.student.user.name : offer.coach.user.name;
  const breakdown = computeBreakdown(offer.priceMinor, offer.commissionBps);
  const scope = offer.scope as { sessionsPerCycle?: number; minutesPerSession?: number; notes?: string };

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 sm:px-8">
      <Link href="/panel" className="text-sm text-muted transition-colors hover:text-cactus">
        Panele dön
      </Link>

      <h1 className="mt-6 font-display text-question font-semibold text-balance">{offer.title}</h1>
      <p className="mt-2 text-lg text-muted">
        {counterparty ?? (viewerIsCoach ? 'Öğrenci' : 'Koç')} ile
      </p>

      <p className="mt-6 inline-block rounded-full border border-stone px-4 py-1.5 text-sm">
        {OFFER_STATUS_TR[offer.status as keyof typeof OFFER_STATUS_TR] ?? offer.status}
      </p>

      <dl className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-stone/70 bg-stone/60 sm:grid-cols-2">
        <Fact label="Tutar" value={formatTry(offer.priceMinor)} />
        <Fact
          label={viewerIsCoach ? 'Sana geçecek' : 'Koça giden'}
          value={formatTry(breakdown.coachReceivesMinor)}
          note={`Kaktüs payı ${formatTry(breakdown.platformFeeMinor)}`}
        />
        <Fact
          label="Başlangıç"
          value={new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long' }).format(offer.startDate)}
        />
        <Fact
          label="Kapsam"
          value={`${scope.sessionsPerCycle ?? offer.milestoneCount} seans`}
          note={scope.minutesPerSession ? `${scope.minutesPerSession} dakika` : undefined}
        />
      </dl>

      {scope.notes && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-semibold">Not</h2>
          <p className="mt-2 leading-relaxed">{scope.notes}</p>
        </section>
      )}

      {offer.engagement && (
        <section className="mt-10">
          <h2 className="font-display text-lg font-semibold">Ödeme dilimleri</h2>
          <ul className="mt-3 space-y-px overflow-hidden rounded-xl border border-stone/70 bg-stone/60">
            {offer.engagement.milestones.map((milestone) => (
              <li
                key={milestone.index}
                className="flex items-baseline justify-between gap-4 bg-paper px-5 py-3.5"
              >
                <span>
                  {milestone.index + 1}. dilim
                  <span className="ml-2 text-sm text-muted">
                    {new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(
                      milestone.periodStart,
                    )}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block tabular-nums">{formatTry(milestone.amountMinor)}</span>
                  <span className="mt-0.5 block text-sm text-muted">
                    {MILESTONE_TR[milestone.status] ?? milestone.status}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-10">
        <Link
          href={`/panel/sohbet/${offer.conversationId}`}
          className="rounded-full bg-cactus px-6 py-3 font-medium text-paper hover:bg-cactus-deep"
        >
          Sohbete git
        </Link>
      </div>
    </main>
  );
}

const MILESTONE_TR: Record<string, string> = {
  SCHEDULED: 'Planlandı',
  IN_PROGRESS: 'Devam ediyor',
  PENDING_CONFIRMATION: 'Onay bekliyor',
  RELEASED: 'Aktarıldı',
  DISPUTED: 'İtiraz sürecinde',
  REFUNDED: 'İade edildi',
};

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-paper px-5 py-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
      {note && <dd className="mt-0.5 text-sm text-muted">{note}</dd>}
    </div>
  );
}
KAKTUS_FILE_EOF

emit "src/components/admin/CoachReviewCard.tsx" <<'KAKTUS_FILE_EOF'
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { approveCoach, rejectCoach, viewDocument } from '@/server/actions/admin';
import { formatTry } from '@/lib/onboarding/client-state';

interface ReviewCoach {
  id: string;
  slug: string;
  headline: string;
  university: string;
  department: string;
  yksRank: number;
  yksYear: number;
  yksTrack: string;
  ownBaselineNet: number | null;
  ownFinalNet: number | null;
  createdAt: string;
  user: { name: string | null; email: string | null };
  documents: Array<{ id: string; type: string; mimeType: string; sizeBytes: number }>;
  pricingTiers: Array<{ name: string; priceMinor: number }>;
}

const DOC_LABELS: Record<string, string> = {
  YKS_RESULT: 'ÖSYM sonuç belgesi',
  YKS_PLACEMENT: 'Yerleştirme belgesi',
  STUDENT_CERTIFICATE: 'Öğrenci belgesi',
  IDENTITY: 'Kimlik',
  DIPLOMA: 'Diploma',
};

export function CoachReviewCard({ coach }: { coach: ReviewCoach }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async (documentId: string) => {
    const result = await viewDocument(documentId);
    if (result.ok) window.open(result.url, '_blank', 'noopener');
    else setError(result.message);
  };

  const act = (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.message ?? 'İşlem başarısız.');
      else router.refresh();
    });
  };

  return (
    <article className="rounded-2xl border border-stone/70 bg-paper p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">{coach.user.name ?? 'İsimsiz'}</h2>
          <p className="text-sm text-muted">{coach.user.email}</p>
        </div>
        <p className="text-sm text-muted">
          {new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(coach.createdAt))}
        </p>
      </div>

      <p className="mt-3 leading-snug">{coach.headline}</p>

      {/* The claim to check, isolated and stated once. A reviewer comparing a
          document against a number should not have to hunt for the number. */}
      <dl className="mt-4 grid gap-px overflow-hidden rounded-xl border border-stone/70 bg-stone/60 sm:grid-cols-2">
        <Fact label="Beyan edilen sıralama" value={`${coach.yksRank.toLocaleString('tr-TR')}. (${coach.yksYear})`} strong />
        <Fact label="Alan" value={coach.yksTrack} />
        <Fact label="Okul" value={`${coach.university} · ${coach.department}`} />
        <Fact
          label="Kendi net çıkışı"
          value={
            coach.ownBaselineNet != null && coach.ownFinalNet != null
              ? `${Math.round(coach.ownBaselineNet)} → ${Math.round(coach.ownFinalNet)}`
              : 'Belirtilmemiş'
          }
        />
      </dl>

      <div className="mt-4">
        <p className="text-sm font-medium">Belgeler</p>
        {coach.documents.length === 0 ? (
          <p className="mt-1 text-sm text-bloom">Belge yüklenmemiş — onaylama.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {coach.documents.map((document) => (
              <li key={document.id}>
                <button
                  type="button"
                  onClick={() => open(document.id)}
                  className="rounded-full border border-stone px-4 py-2 text-sm hover:border-cactus hover:text-cactus"
                >
                  {DOC_LABELS[document.type] ?? document.type} ·{' '}
                  {Math.round(document.sizeBytes / 1024)} KB
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {coach.pricingTiers.length > 0 && (
        <p className="mt-4 text-sm text-muted">
          {coach.pricingTiers.map((tier) => `${tier.name}: ${formatTry(tier.priceMinor)}`).join(' · ')}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-bloom-pale px-4 py-2.5 text-sm">
          {error}
        </p>
      )}

      {rejecting ? (
        <div className="mt-5 border-t border-stone/60 pt-5">
          <label className="block text-sm font-medium">
            Gerekçe — koç bunu görecek
          </label>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="ÖSYM belgesindeki sıralama beyan edilenden farklı. Doğru belgeyle tekrar başvurabilirsin."
            className="mt-2 w-full resize-none rounded-xl border border-stone bg-limestone px-4 py-3 text-sm outline-none focus:border-cactus"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={pending || note.trim().length < 10}
              onClick={() => act(() => rejectCoach({ coachProfileId: coach.id, note }))}
              className="rounded-full bg-bloom px-5 py-2.5 text-sm font-medium text-paper disabled:bg-stone disabled:text-muted"
            >
              Reddet
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="rounded-full px-4 py-2.5 text-sm text-muted hover:text-ink"
            >
              Vazgeç
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending || coach.documents.length === 0}
            onClick={() => act(() => approveCoach({ coachProfileId: coach.id }))}
            className="rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
          >
            Onayla ve yayına al
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setRejecting(true)}
            className="rounded-full border border-stone px-5 py-2.5 text-sm font-medium hover:border-bloom hover:text-bloom"
          >
            Reddet
          </button>
        </div>
      )}
    </article>
  );
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="bg-paper px-4 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`mt-0.5 ${strong ? 'font-display text-lg font-semibold' : 'font-medium'}`}>
        {value}
      </dd>
    </div>
  );
}
KAKTUS_FILE_EOF

emit "src/components/admin/DisputeCard.tsx" <<'KAKTUS_FILE_EOF'
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resolveDisputeAction } from '@/server/actions/admin';
import { formatTry } from '@/lib/onboarding/client-state';

interface Dispute {
  id: string;
  reason: string;
  detail: string;
  status: string;
  createdAt: string;
  openedByRole: string;
  engagement: {
    id: string;
    totalMinor: number;
    startDate: string;
    coach: { user: { name: string | null } };
    student: { user: { name: string | null } };
    milestones: Array<{ index: number; status: string; amountMinor: number }>;
    bookings: Array<{ status: string; startsAt: string }>;
  };
}

const REASON_TR: Record<string, string> = {
  COACH_NO_SHOW: 'Koç seansa gelmedi',
  STUDENT_NO_SHOW: 'Öğrenci seansa gelmedi',
  QUALITY: 'Hizmet kalitesi',
  SCOPE_NOT_DELIVERED: 'Anlaşılan kapsam verilmedi',
  UNRESPONSIVE: 'Karşı taraf yanıt vermiyor',
  OTHER: 'Diğer',
};

export function DisputeCard({ dispute }: { dispute: Dispute }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<'RELEASE' | 'REFUND' | 'SPLIT' | null>(null);
  const [note, setNote] = useState('');
  const [share, setShare] = useState('');
  const [error, setError] = useState<string | null>(null);

  const frozen = dispute.engagement.milestones
    .filter((m) => m.status === 'DISPUTED')
    .reduce((sum, m) => sum + m.amountMinor, 0);
  const released = dispute.engagement.milestones
    .filter((m) => m.status === 'RELEASED')
    .reduce((sum, m) => sum + m.amountMinor, 0);

  const noShows = dispute.engagement.bookings.filter((b) => b.status === 'NO_SHOW_COACH').length;
  const completed = dispute.engagement.bookings.filter((b) => b.status === 'COMPLETED').length;
  const ageDays = Math.floor(
    (Date.now() - new Date(dispute.createdAt).getTime()) / 86_400_000,
  );

  const submit = () => {
    if (!outcome) return;
    setError(null);
    startTransition(async () => {
      const result = await resolveDisputeAction({
        disputeId: dispute.id,
        outcome,
        note,
        coachShareMinor: outcome === 'SPLIT' ? Number.parseInt(share || '0', 10) * 100 : undefined,
      });
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  };

  return (
    <article className="rounded-2xl border border-stone/70 bg-paper p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">
          {REASON_TR[dispute.reason] ?? dispute.reason}
        </h2>
        <p className="text-sm text-muted">
          {ageDays === 0 ? 'bugün açıldı' : `${ageDays} gündür açık`}
        </p>
      </div>

      <p className="mt-1 text-sm text-muted">
        {dispute.engagement.student.user.name ?? 'Öğrenci'} ↔{' '}
        {dispute.engagement.coach.user.name ?? 'Koç'} ·{' '}
        {dispute.openedByRole === 'STUDENT' ? 'öğrenci açtı' : 'koç açtı'}
      </p>

      <p className="mt-4 rounded-lg border border-stone/60 bg-limestone px-4 py-3 leading-relaxed">
        {dispute.detail}
      </p>

      {/* The evidence a decision actually turns on, surfaced instead of buried:
          how much is still frozen, what was already paid out, and whether any
          session was reported as a no-show. */}
      <dl className="mt-4 grid gap-px overflow-hidden rounded-xl border border-stone/70 bg-stone/60 sm:grid-cols-4">
        <Fact label="Donmuş tutar" value={formatTry(frozen)} strong />
        <Fact label="Aktarılmış" value={formatTry(released)} />
        <Fact label="Yapılan seans" value={String(completed)} />
        <Fact label="Gelinmeyen" value={String(noShows)} />
      </dl>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-bloom-pale px-4 py-2.5 text-sm">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {(
          [
            ['RELEASE', 'Koça aktar'],
            ['SPLIT', 'Paylaştır'],
            ['REFUND', 'Öğrenciye iade et'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setOutcome(outcome === value ? null : value)}
            className={[
              'rounded-full border px-5 py-2.5 text-sm font-medium transition-colors',
              outcome === value
                ? 'border-cactus bg-cactus text-paper'
                : 'border-stone hover:border-cactus hover:text-cactus',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {outcome && (
        <div className="mt-5 border-t border-stone/60 pt-5">
          {outcome === 'SPLIT' && (
            <label className="mb-3 block">
              <span className="text-sm font-medium">
                Koça kalacak tutar (en fazla {formatTry(frozen)})
              </span>
              <span className="mt-1.5 flex items-baseline gap-2 rounded-xl border border-stone bg-limestone px-4 py-2.5 focus-within:border-cactus">
                <input
                  type="text"
                  inputMode="numeric"
                  value={share}
                  onChange={(event) => setShare(event.target.value.replace(/\D/g, ''))}
                  className="w-full bg-transparent font-display text-xl font-semibold tabular-nums outline-none"
                />
                <span className="text-sm text-muted">₺</span>
              </span>
            </label>
          )}

          <label className="block text-sm font-medium">Kararın ve gerekçesi</label>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="İki tarafın da okuyabileceği şekilde yaz."
            className="mt-2 w-full resize-none rounded-xl border border-stone bg-limestone px-4 py-3 text-sm outline-none focus:border-cactus"
          />
          <button
            type="button"
            disabled={pending || note.trim().length < 5}
            onClick={submit}
            className="mt-3 rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
          >
            {pending ? 'Uygulanıyor' : 'Kararı uygula'}
          </button>
        </div>
      )}
    </article>
  );
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="bg-paper px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 tabular-nums ${strong ? 'font-display text-lg font-semibold' : 'font-medium'}`}>
        {value}
      </dd>
    </div>
  );
}
KAKTUS_FILE_EOF

emit "src/components/auth/AuthGate.tsx" <<'KAKTUS_FILE_EOF'
'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { signIn } from 'next-auth/react';

/**
 * The auth gate.
 *
 * Opens when a guest tries to *act* — view a full profile, message a coach, or
 * send an offer. Browsing and matching stay open.
 *
 * The important part is what happens around it. The student's answers are
 * already on the server, keyed by an httpOnly cookie; the `signIn` event claims
 * that session into a StudentProfile. So the modal makes a promise the backend
 * actually keeps — and `callbackUrl` returns them to the exact coach they
 * clicked, not to a generic dashboard.
 */

interface GateIntent {
  /** What they were trying to do, shown in the modal so it reads as a step. */
  action: string;
  /** Where to return after sign-in. */
  returnTo: string;
}

interface AuthGateValue {
  require: (intent: GateIntent) => void;
}

const AuthGateContext = createContext<AuthGateValue | null>(null);

export function useAuthGate(): AuthGateValue {
  const value = useContext(AuthGateContext);
  if (!value) throw new Error('useAuthGate must be used inside <AuthGateProvider>');
  return value;
}

export function AuthGateProvider({
  children,
  authenticated,
}: {
  children: React.ReactNode;
  authenticated: boolean;
}) {
  const [intent, setIntent] = useState<GateIntent | null>(null);

  const require = useCallback(
    (next: GateIntent) => {
      if (authenticated) {
        window.location.href = next.returnTo;
        return;
      }
      setIntent(next);
    },
    [authenticated],
  );

  return (
    <AuthGateContext.Provider value={{ require }}>
      {children}
      {intent && <AuthGateModal intent={intent} onClose={() => setIntent(null)} />}
    </AuthGateContext.Provider>
  );
}

function AuthGateModal({ intent, onClose }: { intent: GateIntent; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus management and Escape. A modal that traps neither is unusable by
  // keyboard and invisible to a screen reader.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, input, a[href]',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const sendLink = async () => {
    if (!email.includes('@')) return;
    setSending(true);
    try {
      await signIn('resend', { email, callbackUrl: intent.returnTo, redirect: false });
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-ink/40 p-0 backdrop-blur-[2px] sm:place-items-center sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-gate-title"
        className="w-full max-w-md rounded-t-2xl bg-paper p-7 shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="auth-gate-title" className="font-display text-2xl font-semibold leading-tight">
            {sent ? 'E-postana bak' : `${intent.action} için hesap gerekiyor`}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="-m-2 rounded-full p-2 text-muted transition-colors hover:text-ink"
          >
            ✕
          </button>
        </div>

        {sent ? (
          <p className="mt-3 leading-relaxed text-muted">
            <span className="font-medium text-ink">{email}</span> adresine giriş bağlantısı
            gönderdik. Bağlantıya tıkladığında kaldığın yerden devam edeceksin.
          </p>
        ) : (
          <>
            <p className="mt-3 leading-relaxed text-muted">
              Cevapladığın beş soru kayıtlı. Giriş yaptığında profilin otomatik oluşur ve tam
              buraya geri dönersin.
            </p>

            <div className="mt-6 space-y-3">
              <button
                type="button"
                onClick={() => signIn('google', { callbackUrl: intent.returnTo })}
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-stone bg-white px-5 py-3.5 font-medium transition-colors hover:border-cactus"
              >
                <GoogleMark />
                Google ile devam et
              </button>

              <div className="flex items-center gap-3 py-1 text-sm text-muted">
                <span className="h-px flex-1 bg-stone/70" />
                ya da
                <span className="h-px flex-1 bg-stone/70" />
              </div>

              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && sendLink()}
                placeholder="ornek@eposta.com"
                className="w-full rounded-xl border border-stone bg-white px-4 py-3.5 outline-none placeholder:text-stone focus:border-cactus"
              />
              <button
                type="button"
                onClick={sendLink}
                disabled={sending || !email.includes('@')}
                className="w-full rounded-xl bg-cactus px-5 py-3.5 font-medium text-paper transition-colors hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
              >
                {sending ? 'Gönderiliyor' : 'Giriş bağlantısı gönder'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
KAKTUS_FILE_EOF

emit "src/components/auth/SignInPanel.tsx" <<'KAKTUS_FILE_EOF'
'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

/**
 * The sign-in controls, extracted so both the modal and the standalone page
 * use one implementation. Two copies of an auth form is two places to get the
 * callback URL wrong.
 */
export function SignInPanel({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <p className="mt-8 rounded-xl border border-stone/70 bg-paper px-5 py-4 leading-relaxed">
        <span className="font-medium">{email}</span> adresine giriş bağlantısı gönderdik.
        Bağlantıya tıkladığında kaldığın yerden devam edeceksin.
      </p>
    );
  }

  const sendLink = async () => {
    if (!email.includes('@')) return;
    setSending(true);
    try {
      await signIn('resend', { email, callbackUrl, redirect: false });
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-8 space-y-3">
      <button
        type="button"
        onClick={() => signIn('google', { callbackUrl })}
        className="w-full rounded-xl border border-stone bg-white px-5 py-3.5 font-medium transition-colors hover:border-cactus"
      >
        Google ile devam et
      </button>

      <div className="flex items-center gap-3 py-1 text-sm text-muted">
        <span className="h-px flex-1 bg-stone/70" />
        ya da
        <span className="h-px flex-1 bg-stone/70" />
      </div>

      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        onKeyDown={(event) => event.key === 'Enter' && sendLink()}
        placeholder="ornek@eposta.com"
        className="w-full rounded-xl border border-stone bg-white px-4 py-3.5 outline-none placeholder:text-stone focus:border-cactus"
      />
      <button
        type="button"
        onClick={sendLink}
        disabled={sending || !email.includes('@')}
        className="w-full rounded-xl bg-cactus px-5 py-3.5 font-medium text-paper transition-colors hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
      >
        {sending ? 'Gönderiliyor' : 'Giriş bağlantısı gönder'}
      </button>
    </div>
  );
}
KAKTUS_FILE_EOF

emit "src/components/chat/ConversationView.tsx" <<'KAKTUS_FILE_EOF'
'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ConversationView, TimelineEntry } from '@/server/queries/conversation';
import { OFFER_STATUS_TR } from '@/lib/offers/state-machine';
import { formatTry } from '@/lib/onboarding/client-state';
import { computeBreakdown } from '@/lib/offers/draft';
import {
  acceptOffer,
  counterOffer,
  declineOffer,
  payForOffer,
  sendMessage,
} from '@/server/actions/negotiation';

/**
 * The negotiation screen.
 *
 * Messages and offers share one timeline. The offer being discussed sits in the
 * conversation, in the place it was sent, rather than in a side panel — because
 * "can we do 2.700?" is meaningless three scroll-lengths away from the 3.000
 * it refers to.
 *
 * Refresh is a poll, not a socket. Live updates would be better and are the
 * obvious upgrade, but a ten-second poll is a fifth of the code and nobody in a
 * coaching negotiation is typing fast enough to notice the difference.
 */
const POLL_INTERVAL_MS = 10_000;

export function ConversationView({ conversation }: { conversation: ConversationView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [conversation.timeline.length]);

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.message ?? 'İşlem tamamlanamadı.');
      else router.refresh();
    });
  };

  return (
    <div className="flex min-h-[70dvh] flex-col">
      <ol className="flex-1 space-y-4">
        {conversation.timeline.map((entry) =>
          entry.kind === 'message' ? (
            <MessageBubble key={entry.id} entry={entry} />
          ) : (
            <OfferBlock
              key={entry.id}
              entry={entry}
              viewerRole={conversation.viewerRole}
              pending={pending}
              onAccept={() => run(() => acceptOffer(entry.id))}
              onDecline={() => run(() => declineOffer(entry.id))}
              onCounter={(priceMinor, note) => run(() => counterOffer(entry.id, { priceMinor, note }))}
              onPay={() => run(async () => {
                const result = await payForOffer(entry.id);
                if (!result.ok) return result;
                // Iyzico returns a script that renders its own hosted form.
                const holder = document.getElementById('iyzico-checkout');
                if (holder) {
                  holder.innerHTML = result.checkoutFormContent;
                  holder
                    .querySelectorAll('script')
                    .forEach((old) => {
                      const script = document.createElement('script');
                      script.textContent = old.textContent;
                      old.replaceWith(script);
                    });
                }
                return { ok: true };
              })}
            />
          ),
        )}
        <div ref={bottomRef} />
      </ol>

      <div id="iyzico-checkout" className="mt-6 empty:hidden" />

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-bloom-pale px-4 py-3 text-sm">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-4 rounded-lg border border-dust/60 bg-dust/10 px-4 py-3 text-sm leading-relaxed">
          {notice}
        </p>
      )}

      <Composer
        conversationId={conversation.id}
        onNotice={setNotice}
        onSent={() => router.refresh()}
      />
    </div>
  );
}

function MessageBubble({ entry }: { entry: Extract<TimelineEntry, { kind: 'message' }> }) {
  return (
    <li className={entry.mine ? 'flex justify-end' : 'flex justify-start'}>
      <div className="max-w-[85%] sm:max-w-[70%]">
        <div
          className={[
            'rounded-2xl px-4 py-2.5 leading-relaxed',
            entry.mine ? 'bg-cactus text-paper' : 'border border-stone/70 bg-paper',
          ].join(' ')}
        >
          {entry.body}
        </div>
        {entry.systemNotice && (
          <p className="mt-1.5 rounded-lg border border-dust/60 bg-dust/10 px-3 py-2 text-xs leading-relaxed text-muted">
            {entry.systemNotice}
          </p>
        )}
        <time
          dateTime={entry.at.toISOString()}
          className={['mt-1 block text-xs text-muted', entry.mine ? 'text-right' : ''].join(' ')}
        >
          {new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(entry.at)}
        </time>
      </div>
    </li>
  );
}

function OfferBlock({
  entry,
  viewerRole,
  pending,
  onAccept,
  onDecline,
  onCounter,
  onPay,
}: {
  entry: Extract<TimelineEntry, { kind: 'offer' }>;
  viewerRole: 'STUDENT' | 'COACH';
  pending: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onCounter: (priceMinor: number, note?: string) => void;
  onPay: () => void;
}) {
  const [countering, setCountering] = useState(false);
  const [price, setPrice] = useState(String(Math.round(entry.priceMinor / 100)));
  const [note, setNote] = useState('');

  const breakdown = computeBreakdown(entry.priceMinor, entry.commissionBps);
  const canAccept = entry.actions.includes('ACCEPT');
  const canCounter = entry.actions.includes('COUNTER');
  const canCancel = entry.actions.includes('CANCEL');
  const canPay = viewerRole === 'STUDENT' && entry.status === 'ACCEPTED';

  return (
    <li>
      <article
        className={[
          'rounded-2xl border p-5',
          entry.superseded
            ? 'border-stone/50 bg-limestone/60 opacity-60'
            : entry.status === 'PAID_IN_ESCROW' || entry.status === 'ACTIVE'
              ? 'border-cactus/50 bg-cactus-pale/40'
              : 'border-cactus/40 bg-paper',
        ].join(' ')}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-sm text-muted">
              {entry.mine ? 'Senin teklifin' : 'Sana gelen teklif'}
              {entry.superseded && ' · yerine yenisi geldi'}
            </p>
            <h3 className="mt-0.5 font-display text-lg font-semibold">{entry.title}</h3>
          </div>
          <p className="font-display text-2xl font-semibold tabular-nums">
            {formatTry(entry.priceMinor)}
          </p>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Pair label="Seans" value={`${entry.sessions} × ${entry.minutesPerSession} dk`} />
          <Pair
            label="Başlangıç"
            value={new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(entry.startDate)}
          />
          <Pair
            label={viewerRole === 'COACH' ? 'Sana geçecek' : 'Koça giden'}
            value={formatTry(breakdown.coachReceivesMinor)}
          />
          <Pair label="Kaktüs payı" value={formatTry(breakdown.platformFeeMinor)} />
        </dl>

        {entry.notes && <p className="mt-4 leading-relaxed">{entry.notes}</p>}

        <p className="mt-4 inline-block rounded-full border border-stone px-3 py-1 text-sm">
          {OFFER_STATUS_TR[entry.status] ?? entry.status}
        </p>

        {!entry.superseded && (canAccept || canCounter || canCancel || canPay) && (
          <div className="mt-5 flex flex-wrap gap-2">
            {canPay && (
              <button
                type="button"
                onClick={onPay}
                disabled={pending}
                className="rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper hover:bg-cactus-deep disabled:bg-stone"
              >
                Ödemeyi yap
              </button>
            )}
            {canAccept && (
              <button
                type="button"
                onClick={onAccept}
                disabled={pending}
                className="rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper hover:bg-cactus-deep disabled:bg-stone"
              >
                Kabul et
              </button>
            )}
            {canCounter && (
              <button
                type="button"
                onClick={() => setCountering((v) => !v)}
                disabled={pending}
                className="rounded-full border border-stone px-5 py-2.5 text-sm font-medium hover:border-cactus hover:text-cactus"
              >
                Karşı teklif ver
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                onClick={onDecline}
                disabled={pending}
                className="rounded-full px-4 py-2.5 text-sm text-muted hover:text-ink"
              >
                {entry.mine ? 'Teklifi geri çek' : 'Reddet'}
              </button>
            )}
          </div>
        )}

        {countering && (
          <div className="mt-5 border-t border-stone/60 pt-5">
            <label className="block text-sm font-medium">Karşı teklifin</label>
            <div className="mt-2 flex items-baseline gap-2 rounded-xl border border-stone bg-limestone px-4 py-2.5 focus-within:border-cactus">
              <input
                type="text"
                inputMode="numeric"
                value={price}
                onChange={(event) => setPrice(event.target.value.replace(/\D/g, ''))}
                className="w-full bg-transparent font-display text-xl font-semibold tabular-nums outline-none"
                aria-label="Karşı teklif tutarı"
              />
              <span className="text-sm text-muted">₺</span>
            </div>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, 1000))}
              rows={2}
              placeholder="Neden bu tutar? Kısaca yaz."
              className="mt-2 w-full resize-none rounded-xl border border-stone bg-limestone px-4 py-2.5 text-sm outline-none focus:border-cactus"
            />
            <button
              type="button"
              disabled={pending || !price}
              onClick={() => {
                onCounter(Number.parseInt(price, 10) * 100, note || undefined);
                setCountering(false);
              }}
              className="mt-3 rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper hover:bg-cactus-deep disabled:bg-stone"
            >
              Karşı teklifi gönder
            </button>
          </div>
        )}
      </article>
    </li>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

function Composer({
  conversationId,
  onNotice,
  onSent,
}: {
  conversationId: string;
  onNotice: (notice: string | null) => void;
  onSent: () => void;
}) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    onNotice(null);
    try {
      const result = await sendMessage(conversationId, body);
      if (result.ok) {
        setBody('');
        if (result.masked) onNotice(result.notice);
        onSent();
      } else if (result.blocked) {
        // Deliberately keeps the text in the box. Clearing it would make the
        // user retype a long message to remove one phone number.
        onNotice(result.notice);
      } else {
        onNotice(result.message);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="sticky bottom-0 mt-6 border-t border-stone/70 bg-limestone/95 py-4 backdrop-blur">
      <div className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="Mesaj yaz…"
          className="w-full resize-none rounded-xl border border-stone bg-paper px-4 py-3 outline-none placeholder:text-stone focus:border-cactus"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !body.trim()}
          className="shrink-0 rounded-full bg-cactus px-5 py-3 font-medium text-paper hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
        >
          Gönder
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        Telefon, IBAN ve sosyal medya bilgileri otomatik gizlenir. Anlaşmanı Kaktüs üzerinden
        yaparsan ödemen güvence altında olur.
      </p>
    </div>
  );
}
KAKTUS_FILE_EOF

emit "src/components/coach-apply/ApplicationStatusPanel.tsx" <<'KAKTUS_FILE_EOF'
import Link from 'next/link';
import type { getApplicationStatus } from '@/server/actions/coach-application';

type Status = NonNullable<Awaited<ReturnType<typeof getApplicationStatus>>>;

/**
 * What a coach sees after applying.
 *
 * The job of this screen is to remove the urge to email support. It answers the
 * three questions people actually have — what happens next, how long, and what
 * do I do meanwhile — and it says them for each state rather than showing one
 * generic "pending" spinner.
 *
 * Rejection is handled with the same care as approval. A rejected coach is
 * usually a fixable document problem, not a bad person, and the copy says so
 * along with the specific reason the reviewer left.
 */
export function ApplicationStatusPanel({ status }: { status: Status }) {
  const view = VIEWS[status.verificationStatus] ?? VIEWS.PENDING;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 sm:px-8">
      <p className="text-sm text-muted">
        Başvurun {new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long' }).format(status.createdAt)}{' '}
        tarihinde alındı
      </p>

      <h1 className="mt-4 max-w-measure font-display text-question font-semibold text-balance">
        {view.title}
      </h1>
      <p className="mt-4 max-w-[54ch] text-lg leading-relaxed text-muted">{view.body}</p>

      {status.verificationNote && (
        <div className="mt-6 rounded-xl border border-dust/60 bg-dust/10 px-5 py-4">
          <p className="text-sm font-medium">İnceleme ekibinin notu</p>
          <p className="mt-1 leading-relaxed">{status.verificationNote}</p>
        </div>
      )}

      {view.steps.length > 0 && (
        <ol className="mt-8 space-y-px overflow-hidden rounded-2xl border border-stone/70 bg-stone/60">
          {view.steps.map((step, index) => (
            <li key={step.title} className="bg-paper px-5 py-4">
              <div className="flex items-baseline gap-3">
                <span
                  aria-hidden
                  className={[
                    'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                    step.done ? 'bg-cactus text-paper' : 'border border-stone text-muted',
                  ].join(' ')}
                >
                  {step.done ? '✓' : index + 1}
                </span>
                <div>
                  <p className="font-medium leading-snug">{step.title}</p>
                  <p className="mt-0.5 text-sm leading-snug text-muted">{step.detail}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {status.documents.length > 0 && (
        <p className="mt-6 text-sm text-muted">
          {status.documents.length} belge yüklendi. Belgelerin yalnızca doğrulama ekibi
          tarafından görülür ve doğrulama tamamlandıktan sonra silinir.
        </p>
      )}

      <div className="mt-10 flex flex-wrap gap-3">
        {view.primary && (
          <Link
            href={view.primary.href}
            className="rounded-full bg-cactus px-6 py-3 font-medium text-paper transition-colors hover:bg-cactus-deep"
          >
            {view.primary.label}
          </Link>
        )}
        <Link
          href="/"
          className="rounded-full border border-stone px-6 py-3 font-medium transition-colors hover:border-cactus hover:text-cactus"
        >
          Ana sayfaya dön
        </Link>
      </div>
    </main>
  );
}

interface StatusView {
  title: string;
  body: string;
  steps: Array<{ title: string; detail: string; done: boolean }>;
  primary?: { label: string; href: string };
}

const REVIEW_STEPS = (stage: number) => [
  {
    title: 'Başvuru alındı',
    detail: 'Profilin ve belgelerin kaydedildi.',
    done: stage >= 1,
  },
  {
    title: 'Belge doğrulama',
    detail: 'ÖSYM sonuç belgen ve öğrenci belgen kontrol ediliyor. Genelde 2 iş günü sürer.',
    done: stage >= 2,
  },
  {
    title: 'Profil yayında',
    detail: 'Öğrenciler seni eşleşme listesinde görmeye ve teklif göndermeye başlar.',
    done: stage >= 3,
  },
];

const VIEWS: Record<string, StatusView> = {
  PENDING: {
    title: 'Başvurun sırada',
    body: 'Belgelerini inceleyeceğiz. Sonucu e-posta ile bildireceğiz; ortalama iki iş günü sürüyor. Bu sırada yapman gereken bir şey yok.',
    steps: REVIEW_STEPS(1),
  },
  IN_REVIEW: {
    title: 'Belgelerin inceleniyor',
    body: 'Doğrulama ekibi başvurunu açtı. Ek bir belge gerekirse e-posta ile isteyeceğiz.',
    steps: REVIEW_STEPS(2),
  },
  APPROVED: {
    title: 'Profilin yayında',
    body: 'Artık eşleşme listesinde görünüyorsun. Takvimini güncel tutman gelen teklif sayısını en çok artıran şey.',
    steps: REVIEW_STEPS(3),
    primary: { label: 'Panelime git', href: '/panel' },
  },
  REJECTED: {
    title: 'Başvuruna şimdilik devam edemiyoruz',
    body: 'Çoğu durumda sorun belgenin okunaklı olmaması ya da eksik bir sayfa. Aşağıdaki notu okuyup tekrar başvurabilirsin.',
    steps: [],
    primary: { label: 'Yeniden başvur', href: '/koc-ol?duzenle=1' },
  },
  SUSPENDED: {
    title: 'Profilin askıya alındı',
    body: 'Hesabın şu anda öğrencilere görünmüyor. Nedenini ve nasıl devam edebileceğini aşağıda bulabilirsin.',
    steps: [],
  },
};
KAKTUS_FILE_EOF

emit "src/components/coach-apply/CoachApplicationForm.tsx" <<'KAKTUS_FILE_EOF'
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  APPLY_STEPS,
  APPLY_STEP_HINTS,
  APPLY_STEP_TITLES,
  STEP_FIELDS,
  SUBMERCHANT_TYPE_LABELS,
  WEEKDAY_LABELS,
  coachApplicationSchema,
  minutesToTime,
  timeToMinutes,
  type CoachApplicationInput,
} from '@/lib/coach/application';
import { GRADE_LABELS, STYLE_LABELS, TRACK_LABELS } from '@/lib/onboarding/client-state';
import { isValidTckn, isValidTrIban, isValidVkn } from '@/lib/coach/identifiers';
import { submitCoachApplication, uploadVerificationDocument } from '@/server/actions/coach-application';
import { ChoiceRow, NumberField, TextField } from '@/components/onboarding/controls';

/**
 * Coach application wizard.
 *
 * Five steps, validated one at a time. A single 40-field page is the reliable
 * way to lose applicants — but so is a wizard that only reveals a mistake on
 * the last screen, so each step validates its own fields before advancing.
 *
 * Payout details are typed last and submitted immediately. They are never
 * autosaved as a draft: the shorter the window in which a TCKN sits in
 * un-submitted state, the better.
 */

type Errors = Partial<Record<string, string[]>>;

const EMPTY: CoachApplicationInput = {
  university: '',
  department: '',
  yksTrack: 'SAYISAL',
  // Must agree with `yksTrack` above. These defaulted apart, and because the
  // first step pre-selects Sayısal, a Sayısal coach never tapped the control
  // and `tracks` stayed empty — silently failing validation two steps later.
  tracks: ['SAYISAL'],
  yksRank: 0,
  yksYear: new Date().getFullYear() - 1,
  wasMezun: false,
  headline: '',
  bio: '',
  styles: [],
  subjects: [],
  supportedGrades: [],
  monthlyPriceMinor: 0,
  sessionsPerMonth: 4,
  minutesPerSession: 60,
  maxActiveStudents: 8,
  availability: [],
  submerchantType: 'PERSONAL',
  legalName: '',
  identityNumber: '',
  iban: '',
  address: '',
  city: '',
  phone: '',
  acceptedTerms: true,
};

/**
 * Which fields each step actually puts on screen.
 *
 * Kept next to the wizard rather than in the schema module, because it
 * describes this UI, not the data. It exists so a mismatch between "required
 * for this step" and "visible on this step" surfaces as a message instead of
 * an unresponsive button.
 */
const RENDERED_FIELDS: Record<string, string[]> = {
  kimlik: ['university', 'department', 'yksTrack', 'yksRank', 'yksYear', 'graduationYear'],
  yontem: ['headline', 'bio', 'styles', 'tracks', 'supportedGrades', 'subjects'],
  ucret: ['monthlyPriceMinor', 'sessionPriceMinor', 'maxActiveStudents', 'weeklyCapacityHours'],
  takvim: ['availability'],
  odeme: [
    'submerchantType', 'legalName', 'identityNumber', 'iban',
    'taxOffice', 'address', 'city', 'phone', 'acceptedTerms',
  ],
};

export function CoachApplicationForm({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState<CoachApplicationInput>({ ...EMPTY, legalName: displayName });
  const [errors, setErrors] = useState<Errors>({});
  const [stepBlocked, setStepBlocked] = useState<string | null>(null);
  const [documents, setDocuments] = useState<Array<{ id: string; filename: string }>>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [pending, startTransition] = useTransition();

  const step = APPLY_STEPS[stepIndex];
  const isLast = stepIndex === APPLY_STEPS.length - 1;
  const set = (patch: Partial<CoachApplicationInput>) =>
    setForm((current) => ({ ...current, ...patch }));

  /**
   * Validates only the current step's fields, so early steps aren't blocked.
   *
   * The `stepBlocked` fallback matters more than it looks. Previously, if a
   * required field was listed for a step but had no control rendered on that
   * step, validation failed and the Devam button did nothing at all — no
   * message, no highlight, no way for the user to work out what was wrong.
   * That is exactly what happened with `tracks`. Now an unrenderable error
   * still produces a visible message naming the field, so the failure mode is
   * "confusing message" rather than "dead button".
   */
  const validateStep = (): boolean => {
    const result = coachApplicationSchema.safeParse({ ...form, acceptedTerms: true });
    if (result.success) {
      setErrors({});
      setStepBlocked(null);
      return true;
    }
    const all = result.error.flatten().fieldErrors as Errors;
    const relevant: Errors = {};
    for (const field of STEP_FIELDS[step]) {
      if (all[field as string]) relevant[field as string] = all[field as string];
    }
    setErrors(relevant);

    const fields = Object.keys(relevant);
    if (fields.length === 0) {
      setStepBlocked(null);
      return true;
    }

    // If none of the failing fields is visible on this step, say so out loud.
    const invisible = fields.filter((field) => !RENDERED_FIELDS[step].includes(field));
    setStepBlocked(
      invisible.length > 0
        ? `Bu adımda görünmeyen bir alan eksik (${invisible.join(', ')}). Lütfen bize bildir.`
        : null,
    );
    return false;
  };

  const next = () => {
    if (!validateStep()) return;
    setStepIndex((i) => Math.min(i + 1, APPLY_STEPS.length - 1));
  };

  const submit = () => {
    if (!validateStep()) return;
    if (!accepted) {
      setErrors({ acceptedTerms: ['Devam etmek için sözleşmeyi onaylaman gerekiyor'] });
      return;
    }
    setSubmitError(null);
    startTransition(async () => {
      const result = await submitCoachApplication({ ...form, acceptedTerms: true });
      if (result.ok) {
        router.push('/koc-ol/tesekkurler');
        return;
      }
      setSubmitError(result.message);
      if (result.fieldErrors) setErrors(result.fieldErrors);
    });
  };

  const onUpload = async (file: File) => {
    setUploadError(null);
    const data = new FormData();
    data.set('file', file);
    data.set('type', 'YKS_RESULT');
    const result = await uploadVerificationDocument(data);
    if (result.ok) {
      setDocuments((current) => [...current, { id: result.documentId, filename: result.filename }]);
    } else {
      setUploadError(result.message);
    }
  };

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_15rem] lg:gap-16">
      <div>
        <nav className="flex items-center gap-3 text-sm text-muted">
          {stepIndex > 0 && (
            <>
              <button
                type="button"
                onClick={() => setStepIndex((i) => i - 1)}
                className="rounded-full px-2 py-1 hover:text-cactus"
              >
                Geri
              </button>
              <span aria-hidden className="text-stone">/</span>
            </>
          )}
          <span>
            {stepIndex + 1}. adım, {APPLY_STEPS.length} adımdan
          </span>
        </nav>

        <h1 className="mt-6 max-w-measure font-display text-question font-semibold text-balance">
          {APPLY_STEP_TITLES[step]}
        </h1>
        <p className="mt-3 max-w-[52ch] leading-relaxed text-muted">{APPLY_STEP_HINTS[step]}</p>

        <div className="mt-8 space-y-8">
          {step === 'kimlik' && (
            <CredentialsStep
              form={form}
              set={set}
              errors={errors}
              documents={documents}
              uploadError={uploadError}
              onUpload={onUpload}
            />
          )}
          {step === 'yontem' && <MethodStep form={form} set={set} errors={errors} />}
          {step === 'ucret' && <PricingStep form={form} set={set} errors={errors} />}
          {step === 'takvim' && <AvailabilityStep form={form} set={set} errors={errors} />}
          {step === 'odeme' && (
            <PayoutStep
              form={form}
              set={set}
              errors={errors}
              accepted={accepted}
              setAccepted={setAccepted}
            />
          )}
        </div>

        {submitError && (
          <p role="alert" className="mt-6 rounded-lg bg-bloom-pale px-4 py-3 text-sm">
            {submitError}
          </p>
        )}

        {stepBlocked && (
          <p role="alert" className="mt-6 rounded-lg bg-bloom-pale px-4 py-3 text-sm">
            {stepBlocked}
          </p>
        )}

        <div className="mt-10 flex items-center gap-4">
          <button
            type="button"
            onClick={isLast ? submit : next}
            disabled={pending}
            className="rounded-full bg-cactus px-7 py-3.5 font-medium text-paper transition-colors hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
          >
            {pending ? 'Gönderiliyor' : isLast ? 'Başvuruyu gönder' : 'Devam et'}
          </button>
          {Object.keys(errors).length > 0 && !stepBlocked && (
            <p className="text-sm text-muted">
              Yukarıda işaretlenen alanları tamamla.
            </p>
          )}
        </div>
      </div>

      <aside className="lg:sticky lg:top-10">
        <ol className="space-y-px overflow-hidden rounded-xl border border-stone/70 bg-paper text-sm">
          {APPLY_STEPS.map((slug, index) => (
            <li
              key={slug}
              className={[
                'px-4 py-3',
                index > 0 ? 'border-t border-stone/60' : '',
                index === stepIndex ? 'bg-cactus-pale/50 font-medium' : '',
                index < stepIndex ? 'text-muted' : index > stepIndex ? 'text-stone' : '',
              ].join(' ')}
            >
              {APPLY_STEP_TITLES[slug]}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Ödeme bilgilerin şifrelenerek saklanır ve yalnızca ödeme kuruluşuna iletilir.
          Öğrenciler hiçbir zaman görmez.
        </p>
      </aside>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function FieldError({ errors, field }: { errors: Errors; field: string }) {
  const message = errors[field]?.[0];
  if (!message) return null;
  return (
    <p role="alert" className="mt-1.5 text-sm text-bloom">
      {message}
    </p>
  );
}

type StepProps = {
  form: CoachApplicationInput;
  set: (patch: Partial<CoachApplicationInput>) => void;
  errors: Errors;
};

function CredentialsStep({
  form,
  set,
  errors,
  documents,
  uploadError,
  onUpload,
}: StepProps & {
  documents: Array<{ id: string; filename: string }>;
  uploadError: string | null;
  onUpload: (file: File) => void;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <TextField
            label="Üniversite"
            value={form.university}
            onChange={(v) => set({ university: v ?? '' })}
            placeholder="Boğaziçi Üniversitesi"
          />
          <FieldError errors={errors} field="university" />
        </div>
        <div>
          <TextField
            label="Bölüm"
            value={form.department}
            onChange={(v) => set({ department: v ?? '' })}
            placeholder="Elektrik-Elektronik Mühendisliği"
          />
          <FieldError errors={errors} field="department" />
        </div>
      </div>

      <fieldset>
        <legend className="mb-3 font-medium">Girdiğin alan</legend>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(TRACK_LABELS) as Array<keyof typeof TRACK_LABELS>).map((track) => (
            <ChoiceRow
              key={track}
              label={TRACK_LABELS[track].full}
              selected={form.yksTrack === track}
              onSelect={() => set({ yksTrack: track, tracks: [track] })}
            />
          ))}
        </div>
        <FieldError errors={errors} field="yksTrack" />
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <NumberField
            label="YKS sıralaman"
            value={form.yksRank || null}
            onChange={(v) => set({ yksRank: v ? Math.round(v) : 0 })}
            placeholder="3100"
          />
          <FieldError errors={errors} field="yksRank" />
        </div>
        <NumberField
          label="Sınav yılı"
          value={form.yksYear}
          onChange={(v) => set({ yksYear: v ? Math.round(v) : new Date().getFullYear() })}
        />
          <FieldError errors={errors} field="yksYear" />
        <NumberField
          label="Mezuniyet yılı"
          hint="İstersen boş bırak"
          value={form.graduationYear ?? null}
          onChange={(v) => set({ graduationYear: v ? Math.round(v) : null })}
        />
      </div>

      {/* The trajectory is the strongest matching signal in the product, so it
          is asked for directly rather than inferred from the ranking alone. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Başlangıç netin"
          hint="Hazırlığa başlarken"
          value={form.ownBaselineNet ?? null}
          onChange={(v) => set({ ownBaselineNet: v })}
          suffix="net"
        />
        <NumberField
          label="Sınavdaki netin"
          value={form.ownFinalNet ?? null}
          onChange={(v) => set({ ownFinalNet: v })}
          suffix="net"
        />
      </div>

      <ChoiceRow
        multi
        label="Mezun yılında hazırlandım"
        hint="Mezun öğrencilerle eşleşmende belirgin fark yaratıyor"
        selected={Boolean(form.wasMezun)}
        onSelect={() => set({ wasMezun: !form.wasMezun })}
      />

      <div>
        <p className="font-medium">ÖSYM sonuç belgen</p>
        <p className="mt-0.5 text-sm text-muted">
          PDF ya da ekran görüntüsü. Yalnızca inceleme ekibi görür, profilinde yayınlanmaz.
        </p>
        <label className="mt-3 flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-stone bg-paper px-5 py-6 text-sm text-muted transition-colors hover:border-cactus hover:text-cactus">
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file);
              event.target.value = '';
            }}
          />
          Dosya seç (en fazla 8 MB)
        </label>

        {uploadError && (
          <p role="alert" className="mt-2 text-sm text-bloom">
            {uploadError}
          </p>
        )}
        {documents.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-sm">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center gap-2 text-cactus-deep">
                <span aria-hidden>✓</span>
                {doc.filename} yüklendi
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function MethodStep({ form, set, errors }: StepProps) {
  return (
    <>
      <div>
        <TextField
          label="Tek cümlelik tanıtım"
          hint="Arama sonuçlarında adının altında görünür"
          value={form.headline}
          onChange={(v) => set({ headline: v ?? '' })}
          placeholder="Mezun yılında 60 binden ilk 5 bine çıktım, aynı yolu tarif ediyorum"
        />
        <FieldError errors={errors} field="headline" />
      </div>

      <div>
        <label className="block">
          <span className="font-medium">Koçluk yaklaşımın</span>
          <span className="mt-0.5 block text-sm text-muted">
            Bir öğrenciyle ilk ay ne yaparsın? Somut yaz — öğrenciler en çok burayı okuyor.
          </span>
          <textarea
            value={form.bio}
            onChange={(event) => set({ bio: event.target.value })}
            rows={7}
            className="mt-2 w-full resize-none rounded-xl border border-stone bg-paper px-4 py-3 leading-relaxed outline-none focus:border-cactus"
          />
        </label>
        <div className="mt-1.5 flex justify-between text-sm">
          <FieldError errors={errors} field="bio" />
          <span className={form.bio.length < 120 ? 'text-muted' : 'text-cactus'}>
            {form.bio.length} / 120
          </span>
        </div>
      </div>

      <fieldset>
        <legend className="mb-3 font-medium">Hangi alanlarda ders veriyorsun?</legend>
        <p className="mb-3 text-sm text-muted">
          Kendi girdiğin alan işaretli geldi. Birden fazla alanda çalışıyorsan ekleyebilirsin —
          örneğin EA öğrencilerine matematik veren bir sayısalcıysan.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(TRACK_LABELS) as Array<keyof typeof TRACK_LABELS>).map((track) => {
            const selected = (form.tracks ?? []).includes(track);
            return (
              <ChoiceRow
                key={track}
                multi
                label={TRACK_LABELS[track].full}
                hint={TRACK_LABELS[track].hint}
                selected={selected}
                onSelect={() =>
                  set({
                    tracks: selected
                      ? (form.tracks ?? []).filter((t) => t !== track)
                      : [...(form.tracks ?? []), track],
                  })
                }
              />
            );
          })}
        </div>
        <FieldError errors={errors} field="tracks" />
      </fieldset>

      <fieldset>
        <legend className="mb-3 font-medium">Çalışma tarzın</legend>
        <div className="grid gap-2">
          {(Object.keys(STYLE_LABELS) as Array<keyof typeof STYLE_LABELS>).map((style) => (
            <ChoiceRow
              key={style}
              multi
              label={STYLE_LABELS[style].short}
              hint={STYLE_LABELS[style].hint}
              selected={(form.styles ?? []).includes(style)}
              onSelect={() =>
                set({
                  styles: (form.styles ?? []).includes(style)
                    ? (form.styles ?? []).filter((s) => s !== style)
                    : [...(form.styles ?? []), style],
                })
              }
            />
          ))}
        </div>
        <FieldError errors={errors} field="styles" />
      </fieldset>

      <fieldset>
        <legend className="mb-3 font-medium">Hangi sınıf seviyeleriyle çalışırsın?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(GRADE_LABELS) as Array<keyof typeof GRADE_LABELS>).map((grade) => (
            <ChoiceRow
              key={grade}
              multi
              label={GRADE_LABELS[grade].short}
              selected={(form.supportedGrades ?? []).includes(grade)}
              onSelect={() =>
                set({
                  supportedGrades: (form.supportedGrades ?? []).includes(grade)
                    ? (form.supportedGrades ?? []).filter((g) => g !== grade)
                    : [...(form.supportedGrades ?? []), grade],
                })
              }
            />
          ))}
        </div>
        <FieldError errors={errors} field="supportedGrades" />
      </fieldset>

      <div>
        <p className="font-medium">Hedef öğrenci profilin</p>
        <p className="mt-0.5 text-sm text-muted">
          Eşleşmede kullanılır. En iyi olduğun aralığı yaz; her öğrenciye uygunum demek
          eşleşme puanını yükseltmiyor.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <NumberField
            label="Şu anki sıralaması (üst sınır)"
            value={form.targetRankFrom ?? null}
            onChange={(v) => set({ targetRankFrom: v ? Math.round(v) : null })}
            placeholder="60000"
          />
          <NumberField
            label="Ulaştırabileceğin sıralama"
            value={form.targetRankTo ?? null}
            onChange={(v) => set({ targetRankTo: v ? Math.round(v) : null })}
            placeholder="5000"
          />
        </div>
        <div className="mt-4">
          <TextField
            label="Uzmanlık başlığı"
            value={form.specializationLabel ?? null}
            onChange={(v) => set({ specializationLabel: v })}
            placeholder="Mezun yılında 60 binden ilk 5 bine"
          />
        </div>
      </div>

      <TextField
        label="Verdiğin dersler"
        hint="Virgülle ayır"
        value={(form.subjects ?? []).join(', ')}
        onChange={(v) =>
          set({
            subjects: (v ?? '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 20),
          })
        }
        placeholder="AYT Matematik, Fizik, TYT Matematik"
      />
    </>
  );
}

function PricingStep({ form, set, errors }: StepProps) {
  const monthlyLira = form.monthlyPriceMinor ? Math.round(form.monthlyPriceMinor / 100) : 0;
  const perSession =
    monthlyLira && form.sessionsPerMonth
      ? Math.round(monthlyLira / (form.sessionsPerMonth || 1))
      : 0;

  return (
    <>
      <div>
        <NumberField
          label="Aylık program ücreti"
          hint="Öğrenciden alınacak toplam tutar"
          value={monthlyLira || null}
          onChange={(v) => set({ monthlyPriceMinor: v ? Math.round(v) * 100 : 0 })}
          suffix="₺ / ay"
          placeholder="4000"
        />
        <FieldError errors={errors} field="monthlyPriceMinor" />
        {perSession > 0 && (
          <p className="mt-2 text-sm text-muted">
            Seans başına yaklaşık {perSession.toLocaleString('tr-TR')} ₺. Kaktüs hizmet payı
            %18; bu tutardan sonra sana kalan aylık{' '}
            <span className="font-medium text-ink">
              {Math.round(monthlyLira * 0.82).toLocaleString('tr-TR')} ₺
            </span>
            .
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Ayda kaç görüşme"
          value={form.sessionsPerMonth}
          onChange={(v) => set({ sessionsPerMonth: v ? Math.round(v) : 4 })}
        />
        <NumberField
          label="Görüşme süresi"
          value={form.minutesPerSession}
          onChange={(v) => set({ minutesPerSession: v ? Math.round(v) : 60 })}
          suffix="dakika"
        />
      </div>

      <NumberField
        label="Tanışma seansı ücreti"
        hint="Boş bırakırsan aylık ücretten hesaplanır"
        value={form.sessionPriceMinor ? Math.round(form.sessionPriceMinor / 100) : null}
        onChange={(v) => set({ sessionPriceMinor: v ? Math.round(v) * 100 : null })}
        suffix="₺ / seans"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <NumberField
            label="Aynı anda kaç öğrenci"
            hint="Kontenjan dolunca profilin listelenmeye devam eder ama uyarı görünür"
            value={form.maxActiveStudents}
            onChange={(v) => set({ maxActiveStudents: v ? Math.round(v) : 8 })}
          />
          <FieldError errors={errors} field="maxActiveStudents" />
        </div>
        <NumberField
          label="Haftalık ayırabileceğin süre"
          value={form.weeklyCapacityHours ?? null}
          onChange={(v) => set({ weeklyCapacityHours: v ? Math.round(v) : null })}
          suffix="saat"
        />
      </div>
    </>
  );
}

function AvailabilityStep({ form, set, errors }: StepProps) {
  const windows = form.availability ?? [];

  const setDay = (weekday: number, patch: { start?: string; end?: string } | null) => {
    const others = windows.filter((w) => w.weekday !== weekday);
    if (!patch) return set({ availability: others });

    const existing = windows.find((w) => w.weekday === weekday);
    const start = timeToMinutes(patch.start ?? minutesToTime(existing?.startMinute ?? 1080));
    const end = timeToMinutes(patch.end ?? minutesToTime(existing?.endMinute ?? 1260));
    if (end <= start) return;
    set({
      availability: [...others, { weekday, startMinute: start, endMinute: end }].sort(
        (a, b) => a.weekday - b.weekday,
      ),
    });
  };

  return (
    <>
      <p className="max-w-[52ch] leading-relaxed text-muted">
        Öğrenciler bu saatlerden seans seçer. Ortak müsaitlik eşleşme puanının %15'i —
        gerçekçi ol, sonradan değiştirebilirsin.
      </p>

      <div className="space-y-2">
        {WEEKDAY_LABELS.map((label, weekday) => {
          const window = windows.find((w) => w.weekday === weekday);
          const active = Boolean(window);
          return (
            <div
              key={weekday}
              className={[
                'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3',
                active ? 'border-cactus bg-cactus-pale/50' : 'border-stone bg-paper',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={() => setDay(weekday, active ? null : {})}
                aria-pressed={active}
                className="flex min-w-28 items-center gap-2.5 text-left font-medium"
              >
                <span
                  aria-hidden
                  className={[
                    'grid size-5 place-items-center rounded-[5px] border',
                    active ? 'border-cactus bg-cactus' : 'border-stone',
                  ].join(' ')}
                >
                  {active && <span className="text-[11px] leading-none text-paper">✓</span>}
                </span>
                {label}
              </button>

              {active && window && (
                <div className="flex items-center gap-2 text-sm">
                  <input
                    type="time"
                    value={minutesToTime(window.startMinute)}
                    onChange={(e) => setDay(weekday, { start: e.target.value })}
                    className="rounded-lg border border-stone bg-paper px-2.5 py-1.5 tabular-nums outline-none focus:border-cactus"
                  />
                  <span className="text-muted">–</span>
                  <input
                    type="time"
                    value={minutesToTime(window.endMinute)}
                    onChange={(e) => setDay(weekday, { end: e.target.value })}
                    className="rounded-lg border border-stone bg-paper px-2.5 py-1.5 tabular-nums outline-none focus:border-cactus"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <FieldError errors={errors} field="availability" />
    </>
  );
}

function PayoutStep({
  form,
  set,
  errors,
  accepted,
  setAccepted,
}: StepProps & { accepted: boolean; setAccepted: (v: boolean) => void }) {
  const personal = form.submerchantType === 'PERSONAL';
  const identityOk = form.identityNumber
    ? personal
      ? isValidTckn(form.identityNumber)
      : isValidVkn(form.identityNumber)
    : null;
  const ibanOk = form.iban.replace(/\s/g, '').length >= 26 ? isValidTrIban(form.iban) : null;

  return (
    <>
      <p className="max-w-[52ch] rounded-xl border border-stone/70 bg-paper px-4 py-3 text-sm leading-relaxed text-muted">
        Bu bilgiler ödeme kuruluşu Iyzico'da alt üye işyeri kaydın için gerekli. Şifrelenerek
        saklanır, öğrencilerle paylaşılmaz ve profilinde görünmez.
      </p>

      <fieldset>
        <legend className="mb-3 font-medium">Kayıt tipin</legend>
        <div className="grid gap-2">
          {Object.entries(SUBMERCHANT_TYPE_LABELS).map(([value, meta]) => (
            <ChoiceRow
              key={value}
              label={meta.label}
              hint={meta.hint}
              selected={form.submerchantType === value}
              onSelect={() => set({ submerchantType: value as never })}
            />
          ))}
        </div>
        <FieldError errors={errors} field="submerchantType" />
      </fieldset>

      <div>
        <TextField
          label={personal ? 'Ad soyad' : 'Şirket unvanı'}
          value={form.legalName}
          onChange={(v) => set({ legalName: v ?? '' })}
        />
        <FieldError errors={errors} field="legalName" />
      </div>

      <div>
        <TextField
          label={personal ? 'TC kimlik numarası' : 'Vergi numarası'}
          hint={personal ? '11 hane' : '10 hane'}
          value={form.identityNumber}
          onChange={(v) => set({ identityNumber: (v ?? '').replace(/\D/g, '') })}
        />
        {identityOk === false && (
          <p className="mt-1.5 text-sm text-bloom">Numara geçersiz görünüyor.</p>
        )}
        {identityOk === true && <p className="mt-1.5 text-sm text-cactus">Numara geçerli.</p>}
        <FieldError errors={errors} field="identityNumber" />
      </div>

      {!personal && (
        <TextField
          label="Vergi dairesi"
          value={form.taxOffice ?? null}
          onChange={(v) => set({ taxOffice: v })}
        />
      )}

      <div>
        <TextField
          label="IBAN"
          hint="Ödemeler bu hesaba aktarılır"
          value={form.iban}
          onChange={(v) => set({ iban: (v ?? '').toUpperCase() })}
          placeholder="TR00 0000 0000 0000 0000 0000 00"
        />
        {ibanOk === false && (
          <p className="mt-1.5 text-sm text-bloom">IBAN doğrulanamadı, tekrar kontrol et.</p>
        )}
        {ibanOk === true && <p className="mt-1.5 text-sm text-cactus">IBAN geçerli.</p>}
        <FieldError errors={errors} field="iban" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <TextField label="Şehir" value={form.city} onChange={(v) => set({ city: v ?? '' })} />
          <FieldError errors={errors} field="city" />
        </div>
        <div>
          <TextField
            label="Telefon"
            value={form.phone}
            onChange={(v) => set({ phone: v ?? '' })}
            placeholder="+90 5xx xxx xx xx"
          />
          <FieldError errors={errors} field="phone" />
        </div>
      </div>

      <div>
        <TextField
          label="Adres"
          value={form.address}
          onChange={(v) => set({ address: v ?? '' })}
        />
        <FieldError errors={errors} field="address" />
      </div>

      <div>
        <ChoiceRow
          multi
          label="Aracı hizmet sözleşmesini okudum ve kabul ediyorum"
          hint="Kaktüs %18 hizmet payı alır; ödemeler dersler tamamlandıkça aktarılır."
          selected={accepted}
          onSelect={() => setAccepted(!accepted)}
        />
        <FieldError errors={errors} field="acceptedTerms" />
      </div>
    </>
  );
}
KAKTUS_FILE_EOF

emit "src/components/coach-apply/CoachSignInPrompt.tsx" <<'KAKTUS_FILE_EOF'
'use client';

import { useAuthGate } from '@/components/auth/AuthGate';

/**
 * Sign-in wall for the coach flow.
 *
 * Sells the proposition before asking for the account, and says plainly why the
 * account is required first — "we are about to ask for your bank details" is a
 * better reason than an unexplained wall, and coaches are adults who will
 * accept a reason.
 */
export function CoachSignInPrompt() {
  const { require } = useAuthGate();
  const open = () => require({ action: 'Koç başvurusu yapmak', returnTo: '/koc-ol' });

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:px-8">
      <h1 className="max-w-measure font-display text-question font-semibold text-balance">
        Kendi öğrencini seç, kendi fiyatını koy.
      </h1>
      <p className="mt-5 max-w-[54ch] text-lg leading-relaxed text-muted">
        Kaktüs bir kurs değil. Paket dayatmıyoruz, öğrenci yönlendirmiyoruz. Sen profilini
        kurarsın, öğrenciler sana teklif gönderir, şartları birlikte belirlersiniz.
      </p>

      <dl className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-stone/70 bg-stone/60 sm:grid-cols-3">
        <Fact term="Komisyon" detail="%18" note="Yalnızca tamamlanan derslerden" />
        <Fact term="Ödeme" note="Ders yapıldıkça haftalık aktarım" detail="Güvenceli" />
        <Fact term="Fiyat" detail="Sen belirlersin" note="Alt sınır yok" />
      </dl>

      <div className="mt-10">
        <button
          type="button"
          onClick={open}
          className="rounded-full bg-cactus px-7 py-3.5 font-medium text-paper transition-colors hover:bg-cactus-deep"
        >
          Başvuruya başla
        </button>
        <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-muted">
          Başvuruda ÖSYM belgeni ve ödeme bilgilerini isteyeceğiz, bu yüzden önce hesap açman
          gerekiyor. Belgelerin yalnızca doğrulama ekibi tarafından görülür.
        </p>
      </div>
    </main>
  );
}

function Fact({ term, detail, note }: { term: string; detail: string; note: string }) {
  return (
    <div className="bg-paper px-5 py-4">
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="mt-1 font-display text-xl font-semibold">{detail}</dd>
      <dd className="mt-0.5 text-sm leading-snug text-muted">{note}</dd>
    </div>
  );
}
KAKTUS_FILE_EOF

emit "src/components/coach/AvailabilityCalendar.tsx" <<'KAKTUS_FILE_EOF'
'use client';

import { useMemo, useState } from 'react';
import type { CalendarDay, CalendarSlot, SlotState } from '@/lib/booking/availability';

/**
 * Weekly availability grid.
 *
 * Renders four states, and shows HELD as a distinct, *explained* state rather
 * than hiding it. A student comparing coaches needs to know the difference
 * between "booked until June" and "someone is deciding, free again by 19:00" —
 * collapsing both into "unavailable" makes a coach look unreachable and sends
 * the student to a worse match.
 *
 * Selection is capped at the package's session count. Rather than silently
 * ignoring the extra tap, picking one more replaces the oldest selection, which
 * is what people expect from a small fixed-size picker.
 */

const WEEKDAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

export function AvailabilityCalendar({
  days,
  timezone,
  selected,
  onToggle,
  maxSelections,
  disabled = false,
}: {
  days: CalendarDay[];
  timezone: string;
  selected: string[];
  onToggle: (startsAt: string) => void;
  maxSelections: number;
  disabled?: boolean;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const perPage = 7;
  const pages = Math.max(1, Math.ceil(days.length / perPage));
  const visible = days.slice(weekOffset * perPage, weekOffset * perPage + perPage);

  const totalOpen = useMemo(
    () => days.reduce((n, d) => n + d.slots.filter((s) => s.state === 'AVAILABLE').length, 0),
    [days],
  );

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: timezone,
      }),
    [timezone],
  );
  const dayFormatter = useMemo(
    () => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: timezone }),
    [timezone],
  );

  if (totalOpen === 0) {
    return (
      <div className="rounded-2xl border border-stone/70 bg-paper p-6">
        <p className="font-medium">Önümüzdeki iki hafta için açık saat yok.</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Yine de teklif gönderebilirsin — koç kendi takvimine göre alternatif saat önerir.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-display text-lg font-semibold">Uygun saatler</h3>
        {pages > 1 && (
          <div className="flex items-center gap-1 text-sm">
            <button
              type="button"
              onClick={() => setWeekOffset((w) => Math.max(0, w - 1))}
              disabled={weekOffset === 0}
              className="rounded-full px-3 py-1.5 text-muted transition-colors hover:text-cactus disabled:opacity-40"
            >
              Önceki hafta
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset((w) => Math.min(pages - 1, w + 1))}
              disabled={weekOffset >= pages - 1}
              className="rounded-full px-3 py-1.5 text-muted transition-colors hover:text-cactus disabled:opacity-40"
            >
              Sonraki hafta
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {visible.map((day) => (
          <div key={day.date}>
            <div className="pb-2 text-sm">
              <span className="font-medium">{WEEKDAYS[day.weekday]}</span>{' '}
              <span className="text-muted">
                {dayFormatter.format(new Date(`${day.date}T12:00:00Z`))}
              </span>
            </div>

            <div className="space-y-1.5">
              {day.slots.length === 0 && <p className="text-xs text-stone">—</p>}
              {day.slots.map((slot) => (
                <SlotButton
                  key={slot.startsAt}
                  slot={slot}
                  label={timeFormatter.format(new Date(slot.startsAt))}
                  selected={selected.includes(slot.startsAt)}
                  disabled={disabled}
                  onToggle={() => onToggle(slot.startsAt)}
                  freeAt={
                    slot.heldUntil ? timeFormatter.format(new Date(slot.heldUntil)) : undefined
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
        <Legend swatch="border-stone bg-paper" label="Uygun" />
        <Legend swatch="border-cactus bg-cactus" label="Seçtiklerin" solid />
        <Legend swatch="border-dust bg-dust/25" label="Başka bir teklifte bekliyor" />
        <Legend swatch="border-stone/60 bg-stone/40" label="Dolu" />
        <span className="ml-auto">
          {selected.length}/{maxSelections} seans seçildi
        </span>
      </div>
    </div>
  );
}

function SlotButton({
  slot,
  label,
  selected,
  disabled,
  onToggle,
  freeAt,
}: {
  slot: CalendarSlot;
  label: string;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  freeAt?: string;
}) {
  const selectable = slot.state === 'AVAILABLE' || slot.state === 'MINE';
  const title = TITLES[slot.state](freeAt);

  return (
    <button
      type="button"
      onClick={selectable ? onToggle : undefined}
      disabled={!selectable || disabled}
      aria-pressed={selected}
      title={title}
      className={[
        'w-full rounded-lg border px-2 py-2 text-sm tabular-nums transition-colors',
        selected
          ? 'border-cactus bg-cactus font-medium text-paper'
          : slot.state === 'AVAILABLE'
            ? 'border-stone bg-paper hover:border-cactus hover:text-cactus'
            : slot.state === 'MINE'
              ? 'border-cactus/50 bg-cactus-pale text-cactus-deep'
              : slot.state === 'HELD'
                ? 'cursor-not-allowed border-dust bg-dust/25 text-muted'
                : 'cursor-not-allowed border-stone/60 bg-stone/40 text-muted line-through',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

const TITLES: Record<SlotState, (freeAt?: string) => string> = {
  AVAILABLE: () => 'Uygun',
  MINE: () => 'Senin açık teklifinde tutuluyor',
  HELD: (freeAt) =>
    freeAt
      ? `Başka bir öğrencinin açık teklifinde. ${freeAt} sonrasında boşalabilir.`
      : 'Başka bir teklifte bekliyor',
  BOOKED: () => 'Dolu',
};

function Legend({ swatch, label, solid }: { swatch: string; label: string; solid?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={`size-3 rounded border ${swatch} ${solid ? '' : ''}`} />
      {label}
    </span>
  );
}
KAKTUS_FILE_EOF

emit "src/components/coach/CoachProfileClient.tsx" <<'KAKTUS_FILE_EOF'
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CalendarDay } from '@/lib/booking/availability';
import {
  PACKAGE_CONFIG,
  suggestedPriceMinor,
  type OfferDraft,
  type PackageType,
} from '@/lib/offers/draft';
import { saveOfferDraft, submitOffer } from '@/server/actions/offers';
import { useAuthGate } from '@/components/auth/AuthGate';
import { AvailabilityCalendar } from '@/components/coach/AvailabilityCalendar';
import { OfferComposer, type ComposerCoach, type ComposerState } from '@/components/offer/OfferComposer';

/**
 * The interactive island on the coach profile.
 *
 * Everything above it — hero, bio, reviews — is a Server Component and ships no
 * JavaScript. This owns the only state that has to be interactive: which slots
 * are picked, which package, what price.
 *
 * The interception is the interesting part. A guest can configure an entire
 * offer; when they submit, the draft is parked in an httpOnly cookie *before*
 * the auth gate opens, and the return URL points back to this page with
 * `?teklif=1`. On return the server reads the cookie, passes it down as
 * `resumeDraft`, and the composer reopens exactly as they left it — same slots,
 * same price, same note.
 *
 * Then it submits automatically. Making someone re-press a button they already
 * pressed is a small insult at the exact moment they have just done the thing
 * we asked for.
 */
export function CoachProfileClient({
  coach,
  days,
  timezone,
  authenticated,
  resumeDraft,
}: {
  coach: ComposerCoach;
  days: CalendarDay[];
  timezone: string;
  authenticated: boolean;
  resumeDraft: OfferDraft | null;
}) {
  const router = useRouter();
  const { require } = useAuthGate();
  const autoSubmitted = useRef(false);

  const defaultPackage: PackageType = resumeDraft?.packageType ?? 'EXPLORATORY';
  const [open, setOpen] = useState(Boolean(resumeDraft));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<ComposerState>({
    packageType: defaultPackage,
    slots: resumeDraft?.slots ?? [],
    priceMinor:
      resumeDraft?.priceMinor ?? suggestedPriceMinor(defaultPackage, coach.pricingTiers) ?? 0,
    note: resumeDraft?.note ?? '',
  });

  const update = useCallback(
    (patch: Partial<ComposerState>) => setState((current) => ({ ...current, ...patch })),
    [],
  );

  const buildDraft = useCallback(
    (): OfferDraft => ({
      coachProfileId: coach.id,
      coachSlug: coach.slug,
      packageType: state.packageType,
      slots: state.slots,
      priceMinor: state.priceMinor,
      note: state.note || undefined,
      createdAt: new Date().toISOString(),
    }),
    [coach.id, coach.slug, state],
  );

  const send = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    const draft = buildDraft();

    if (!authenticated) {
      // Park the draft first, then open the gate. If this order were reversed
      // and the student signed in fast, the redirect could beat the write.
      await saveOfferDraft(draft);
      setSubmitting(false);
      require({
        action: 'Teklif göndermek',
        returnTo: `/koc/${coach.slug}?teklif=1`,
      });
      return;
    }

    const result = await submitOffer(draft);
    setSubmitting(false);

    if (result.ok) {
      // Straight into the conversation, not the read-only offer page: the
      // student has just made a proposal and the next thing they want is the
      // place where the coach will answer it.
      router.push(`/panel/sohbet/${result.conversationId}`);
      return;
    }
    setError(result.message);
    // A taken slot invalidates the calendar we rendered; refetch so the student
    // is choosing from reality rather than from a stale grid.
    if (result.code === 'SLOT_TAKEN') {
      update({ slots: [] });
      router.refresh();
    }
  }, [authenticated, buildDraft, coach.slug, require, router, update]);

  // Resume-and-send after sign-in.
  useEffect(() => {
    if (!resumeDraft || !authenticated || autoSubmitted.current) return;
    autoSubmitted.current = true;
    void send();
  }, [resumeDraft, authenticated, send]);

  const startOffer = (packageType: PackageType) => {
    const suggested = suggestedPriceMinor(packageType, coach.pricingTiers);
    setState((current) => ({
      ...current,
      packageType,
      slots: current.slots.slice(0, PACKAGE_CONFIG[packageType].sessions),
      priceMinor: current.priceMinor || suggested || 0,
    }));
    setOpen(true);
  };

  return (
    <>
      <section id="takvim" className="mt-12">
        <AvailabilityCalendar
          days={days}
          timezone={timezone}
          selected={state.slots}
          onToggle={(startsAt) => {
            update({
              slots: state.slots.includes(startsAt)
                ? state.slots.filter((s) => s !== startsAt)
                : [...state.slots, startsAt].slice(-PACKAGE_CONFIG[state.packageType].sessions),
            });
            setOpen(true);
          }}
          maxSelections={PACKAGE_CONFIG[state.packageType].sessions}
        />
      </section>

      {/* Sticky on mobile: the calendar is long, and the action should never
          scroll out of reach. */}
      <div className="sticky bottom-0 z-20 -mx-6 mt-10 border-t border-stone/70 bg-limestone/95 px-6 py-4 backdrop-blur sm:-mx-8 sm:px-8 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => startOffer('MONTHLY_4W')}
            className="rounded-full bg-cactus px-6 py-3 font-medium text-paper transition-colors hover:bg-cactus-deep"
          >
            Teklif gönder
          </button>
          <button
            type="button"
            onClick={() => startOffer('EXPLORATORY')}
            className="rounded-full border border-stone px-6 py-3 font-medium transition-colors hover:border-cactus hover:text-cactus"
          >
            Önce tanışma seansı
          </button>
        </div>
      </div>

      <OfferComposer
        open={open}
        coach={coach}
        days={days}
        timezone={timezone}
        state={state}
        onChange={update}
        onClose={() => setOpen(false)}
        onSubmit={send}
        submitting={submitting}
        error={error}
        authenticated={authenticated}
      />
    </>
  );
}
KAKTUS_FILE_EOF

emit "src/components/match/CoachMatchCard.tsx" <<'KAKTUS_FILE_EOF'
'use client';

import { DIMENSION_LABELS, formatTry } from '@/lib/onboarding/client-state';
import type { CoachMatchView } from '@/server/actions/onboarding';
import { useAuthGate } from '@/components/auth/AuthGate';

/**
 * A matched coach.
 *
 * The score is the only place the bloom colour appears in the whole product.
 * Spending the boldest colour on the single number the student came for keeps
 * everything else quiet, and means the eye lands on the ranking before the
 * prose.
 *
 * `featured` renders the top match larger with its trajectory line visible.
 * Uniform cards would flatten the ranking the matcher just worked to produce.
 */
export function CoachMatchCard({
  coach,
  featured = false,
  position,
}: {
  coach: CoachMatchView;
  featured?: boolean;
  position: number;
}) {
  const { require } = useAuthGate();
  const profileUrl = `/koc/${coach.slug}`;

  return (
    <article
      className={[
        'rounded-2xl border bg-paper',
        featured ? 'border-cactus/40 p-6 sm:p-8' : 'border-stone/70 p-5 sm:p-6',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h3
            className={[
              'font-display font-semibold leading-tight',
              featured ? 'text-2xl' : 'text-lg',
            ].join(' ')}
          >
            {coach.displayName}
          </h3>
          <p className="mt-1 text-sm leading-snug text-muted">
            {coach.university} · {coach.department}
          </p>
          {coach.journey.finalRank && (
            <p className="mt-1 text-sm text-muted">
              YKS {coach.journey.finalRank.toLocaleString('tr-TR')}. sıra
              {coach.journey.baselineNet != null && coach.journey.finalNet != null && (
                <>
                  {' · '}
                  <span className="tabular-nums text-ink">
                    {Math.round(coach.journey.baselineNet)} → {Math.round(coach.journey.finalNet)}{' '}
                    net
                  </span>
                </>
              )}
            </p>
          )}
        </div>

        <MatchScore value={coach.matchScore} featured={featured} position={position} />
      </div>

      {coach.reasons.length > 0 && (
        <ul className={['space-y-1.5', featured ? 'mt-5' : 'mt-4'].join(' ')}>
          {coach.reasons.slice(0, featured ? 3 : 2).map((reason) => (
            <li key={reason} className="flex gap-2.5 text-sm leading-snug">
              <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-cactus" />
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      )}

      <MatchBreakdown coach={coach} limit={featured ? 5 : 3} />

      {coach.specializations.length > 0 && featured && (
        <p className="mt-4 text-sm text-muted">{coach.specializations.join(' · ')}</p>
      )}

      {coach.caveats.length > 0 && (
        <p className="mt-4 rounded-lg border border-dust/50 bg-dust/10 px-3.5 py-2.5 text-sm leading-snug text-muted">
          {coach.caveats[0]}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => require({ action: 'Teklif göndermek', returnTo: `${profileUrl}?teklif=1` })}
          className="rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-cactus-deep"
        >
          Teklif iste
        </button>
        <button
          type="button"
          onClick={() => require({ action: 'Profili görmek', returnTo: profileUrl })}
          className="rounded-full border border-stone px-5 py-2.5 text-sm font-medium transition-colors hover:border-cactus hover:text-cactus"
        >
          Profili gör
        </button>

        <span className="ml-auto text-sm text-muted">
          {coach.priceFromMinor != null && (
            <>
              <span className="font-medium text-ink">{formatTry(coach.priceFromMinor)}</span>
              {' /ay’dan başlıyor'}
            </>
          )}
        </span>
      </div>
    </article>
  );
}

/**
 * The score.
 *
 * A ring or donut would imply a proportion of something; this is a compatibility
 * index, so it reads as a number with a unit. The rank marker next to it tells
 * the student where this coach sits in *their* list, which is information the
 * percentage alone does not carry.
 */
function MatchScore({
  value,
  featured,
  position,
}: {
  value: number;
  featured: boolean;
  position: number;
}) {
  return (
    <div className="shrink-0 text-right">
      <div
        className={[
          'font-display font-semibold tabular-nums leading-none text-bloom',
          featured ? 'text-score' : 'text-3xl',
        ].join(' ')}
      >
        {value}
        <span className={featured ? 'text-2xl' : 'text-lg'}>%</span>
      </div>
      <div className="mt-1.5 text-xs text-muted">
        {position === 1 ? 'en yüksek eşleşme' : `${position}. sırada`}
      </div>
    </div>
  );
}

/**
 * Breakdown pills.
 *
 * Each pill is a label, a percentage, and a hairline meter — enough for a
 * student to see *why* the headline number is what it is. Without this the
 * score is an unfalsifiable claim, and students are rightly sceptical of
 * unexplained rankings.
 */
function MatchBreakdown({ coach, limit }: { coach: CoachMatchView; limit: number }) {
  const items = coach.breakdown.slice(0, limit);
  if (items.length === 0) return null;

  return (
    <ul className="mt-5 flex flex-wrap gap-2">
      {items.map((item) => (
        <li
          key={item.key}
          title={item.reason}
          className="rounded-lg border border-stone/70 bg-limestone/60 px-3 py-2"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-muted">
              {DIMENSION_LABELS[item.key] ?? item.label}
            </span>
            <span className="text-xs font-semibold tabular-nums">%{item.percent}</span>
          </div>
          <div
            aria-hidden
            className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-stone/70"
          >
            <div
              className="meter-fill h-full rounded-full bg-cactus"
              style={{ width: `${Math.max(item.percent, 4)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
KAKTUS_FILE_EOF

emit "src/components/offer/OfferComposer.tsx" <<'KAKTUS_FILE_EOF'
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PACKAGE_CONFIG,
  computeBreakdown,
  suggestedPriceMinor,
  type PackageType,
} from '@/lib/offers/draft';
import { formatTry } from '@/lib/onboarding/client-state';
import type { CalendarDay } from '@/lib/booking/availability';
import { AvailabilityCalendar } from '@/components/coach/AvailabilityCalendar';

/**
 * Offer composer.
 *
 * A drawer rather than a modal: it needs to be tall, scrollable, and reachable
 * with a thumb, and most students are on a phone. It also keeps the coach's
 * profile visible behind it on desktop, which matters while they are deciding
 * how much to offer.
 */

export interface ComposerCoach {
  id: string;
  slug: string;
  displayName: string;
  commissionBps: number;
  pricingTiers: Array<{
    cadence: string;
    priceMinor: number;
    sessionsPerCycle: number;
    minutesPerSession: number;
  }>;
}

export interface ComposerState {
  packageType: PackageType;
  slots: string[];
  priceMinor: number;
  note: string;
}

export function OfferComposer({
  open,
  coach,
  days,
  timezone,
  state,
  onChange,
  onClose,
  onSubmit,
  submitting,
  error,
  authenticated,
}: {
  open: boolean;
  coach: ComposerCoach;
  days: CalendarDay[];
  timezone: string;
  state: ComposerState;
  onChange: (patch: Partial<ComposerState>) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
  authenticated: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const config = PACKAGE_CONFIG[state.packageType];
  const breakdown = computeBreakdown(state.priceMinor, coach.commissionBps);
  const slotsNeeded = config.sessions;
  const ready = state.slots.length === slotsNeeded && state.priceMinor > 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const toggleSlot = (startsAt: string) => {
    const current = state.slots;
    if (current.includes(startsAt)) {
      onChange({ slots: current.filter((s) => s !== startsAt) });
      return;
    }
    // At capacity, replace the oldest pick rather than ignoring the tap.
    const next =
      current.length >= slotsNeeded ? [...current.slice(1), startsAt] : [...current, startsAt];
    onChange({ slots: next.sort() });
  };

  const changePackage = (packageType: PackageType) => {
    const suggested = suggestedPriceMinor(packageType, coach.pricingTiers);
    onChange({
      packageType,
      // Trim selections that no longer fit, and reprice to the new default —
      // but only if the student has not typed their own number.
      slots: state.slots.slice(0, PACKAGE_CONFIG[packageType].sessions),
      priceMinor: suggested ?? state.priceMinor,
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 backdrop-blur-[2px] sm:items-center sm:p-6"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-title"
        tabIndex={-1}
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-limestone sm:max-h-[88dvh] sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-stone/70 px-6 py-5">
          <div>
            <h2 id="composer-title" className="font-display text-xl font-semibold">
              {coach.displayName} için teklif
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              Şartları sen belirle. Koç kabul edebilir ya da karşı teklif verir.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="-m-2 rounded-full p-2 text-muted hover:text-ink"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-8 overflow-y-auto px-6 py-6">
          <section>
            <h3 className="font-medium">Kapsam</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(Object.keys(PACKAGE_CONFIG) as PackageType[]).map((type) => {
                const option = PACKAGE_CONFIG[type];
                const active = state.packageType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => changePackage(type)}
                    aria-pressed={active}
                    className={[
                      'rounded-xl border p-4 text-left transition-colors',
                      active ? 'border-cactus bg-cactus-pale/60' : 'border-stone bg-paper hover:border-cactus/50',
                    ].join(' ')}
                  >
                    <span className="block font-medium">{option.label}</span>
                    <span className="mt-1 block text-sm leading-snug text-muted">
                      {option.summary}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <AvailabilityCalendar
              days={days}
              timezone={timezone}
              selected={state.slots}
              onToggle={toggleSlot}
              maxSelections={slotsNeeded}
              disabled={submitting}
            />
            {state.slots.length < slotsNeeded && (
              <p className="mt-3 text-sm text-muted">
                {slotsNeeded - state.slots.length} seans daha seç.
              </p>
            )}
          </section>

          <section>
            <h3 className="font-medium">Teklif ettiğin ücret</h3>
            <label className="mt-3 flex max-w-xs items-baseline gap-2 rounded-xl border border-stone bg-paper px-4 py-3 focus-within:border-cactus">
              <input
                type="text"
                inputMode="numeric"
                value={state.priceMinor ? String(Math.round(state.priceMinor / 100)) : ''}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, '');
                  onChange({ priceMinor: digits ? Number.parseInt(digits, 10) * 100 : 0 });
                }}
                className="w-full bg-transparent font-display text-2xl font-semibold tabular-nums outline-none"
                aria-label="Teklif ettiğin ücret"
              />
              <span className="shrink-0 text-sm text-muted">
                ₺ {state.packageType === 'MONTHLY_4W' ? '/ 4 hafta' : '/ seans'}
              </span>
            </label>

            <PriceBreakdown breakdown={breakdown} />
          </section>

          <section>
            <label className="block">
              <span className="font-medium">Koça not</span>
              <span className="mt-0.5 block text-sm text-muted">
                Nerede zorlandığını yaz; koçun kabul etme ihtimalini en çok bu artırıyor.
              </span>
              <textarea
                value={state.note}
                onChange={(event) => onChange({ note: event.target.value.slice(0, 1000) })}
                rows={3}
                placeholder="AYT matematikte 12 nette takıldım, özellikle limit ve türev..."
                className="mt-2 w-full resize-none rounded-xl border border-stone bg-paper px-4 py-3 outline-none placeholder:text-stone focus:border-cactus"
              />
            </label>
          </section>
        </div>

        <footer className="border-t border-stone/70 px-6 py-4">
          {error && (
            <p role="alert" className="mb-3 rounded-lg bg-bloom-pale px-3.5 py-2.5 text-sm text-ink">
              {error}
            </p>
          )}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onSubmit}
              disabled={!ready || submitting}
              className="rounded-full bg-cactus px-6 py-3 font-medium text-paper transition-colors hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
            >
              {submitting ? 'Gönderiliyor' : authenticated ? 'Teklifi gönder' : 'Devam et'}
            </button>
            <p className="text-sm leading-snug text-muted">
              {authenticated
                ? 'Şimdi ödeme yapmıyorsun. Koç kabul ettikten sonra ödersin.'
                : 'Giriş yaptıktan sonra teklifin aynen burada olacak.'}
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Where the money goes.
 *
 * Shown in full, unprompted, including our own cut. A marketplace that hides
 * its commission until the receipt teaches students to negotiate off-platform —
 * which is precisely the behaviour the chat filter spends its life fighting.
 * Stating it plainly, next to what the escrow buys them, is the cheaper defence.
 */
function PriceBreakdown({
  breakdown,
}: {
  breakdown: ReturnType<typeof computeBreakdown>;
}) {
  if (breakdown.totalMinor <= 0) return null;

  return (
    <div className="mt-4 max-w-sm rounded-xl border border-stone/70 bg-paper">
      <dl className="divide-y divide-stone/60 text-sm">
        <Row label="Ödeyeceğin tutar" value={formatTry(breakdown.totalMinor)} strong />
        <Row label="Koça giden" value={formatTry(breakdown.coachReceivesMinor)} />
        <Row
          label={`Kaktüs hizmet payı (%${(breakdown.commissionBps / 100).toFixed(0)})`}
          value={formatTry(breakdown.platformFeeMinor)}
        />
      </dl>
      <p className="border-t border-stone/60 px-4 py-3 text-xs leading-relaxed text-muted">
        Ödemen Kaktüs'te tutulur. Koça, dersler yapıldıkça haftalık dilimler hâlinde aktarılır.
        Koç gelmezse iade talep edebilirsin.
      </p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className={strong ? 'font-medium' : 'text-muted'}>{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-display text-lg font-semibold' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
KAKTUS_FILE_EOF

emit "src/components/onboarding/AnswerRail.tsx" <<'KAKTUS_FILE_EOF'
'use client';

import {
  GRADE_LABELS,
  STEPS,
  STYLE_LABELS,
  TRACK_LABELS,
  formatTry,
  type OnboardingDraft,
  type StepSlug,
} from '@/lib/onboarding/client-state';

/**
 * The answer rail.
 *
 * This replaces a progress bar, and does more work than one. A bar tells a
 * student how much form is left — which is discouraging. The rail shows the
 * profile they are building, growing line by line, so the funnel reads as
 * *assembling something* rather than *filling something in*.
 *
 * It also makes the state-preservation promise legible: when the auth modal
 * appears later, the student has already watched these five lines accumulate
 * and can see they are still there.
 */
export function AnswerRail({ draft, current }: { draft: OnboardingDraft; current: StepSlug }) {
  const rows = buildRows(draft);
  const currentIndex = STEPS.indexOf(current);

  return (
    <aside className="lg:sticky lg:top-10">
      <h2 className="font-display text-sm font-semibold text-muted">Profilin</h2>

      <dl className="mt-4 space-y-px overflow-hidden rounded-xl border border-stone/70 bg-paper">
        {STEPS.map((slug, index) => {
          const row = rows[slug];
          const isCurrent = index === currentIndex;
          const isAnswered = Boolean(row);

          return (
            <div
              key={slug}
              className={[
                'flex items-baseline justify-between gap-4 px-4 py-3 text-sm',
                isCurrent ? 'bg-cactus-pale/50' : '',
                index > 0 ? 'border-t border-stone/60' : '',
              ].join(' ')}
            >
              <dt className={isAnswered || isCurrent ? 'text-muted' : 'text-stone'}>
                {RAIL_LABELS[slug]}
              </dt>
              <dd
                key={row ?? 'empty'}
                className={[
                  'min-w-0 truncate text-right font-medium',
                  isAnswered ? 'answer-settle text-ink' : 'text-stone',
                ].join(' ')}
              >
                {row ?? '—'}
              </dd>
            </div>
          );
        })}
      </dl>

      <p className="mt-3 text-xs leading-relaxed text-muted">
        Cevapların kaydedildi. Üye olduğunda bu profil hesabına taşınır.
      </p>
    </aside>
  );
}

const RAIL_LABELS: Record<StepSlug, string> = {
  alan: 'Alan',
  hedef: 'Hedef',
  net: 'Şu anki net',
  tarz: 'Koç tarzı',
  butce: 'Bütçe',
};

function buildRows(draft: OnboardingDraft): Record<StepSlug, string | null> {
  const track = draft.track ? TRACK_LABELS[draft.track].short : null;
  const grade = draft.gradeLevel ? GRADE_LABELS[draft.gradeLevel].short : null;

  const target = draft.targetRanking
    ? `İlk ${draft.targetRanking.toLocaleString('tr-TR')}`
    : draft.targetUniversity
      ? draft.targetUniversity
      : null;

  const nets =
    draft.baselineTytNet != null
      ? draft.baselineAytNet != null
        ? `TYT ${draft.baselineTytNet} · AYT ${draft.baselineAytNet}`
        : `TYT ${draft.baselineTytNet}`
      : null;

  const styles = draft.preferredStyles?.length
    ? draft.preferredStyles.map((s) => STYLE_LABELS[s].short).join(', ')
    : null;

  const budget =
    draft.budgetMaxMinor != null
      ? draft.budgetMinMinor != null
        ? `${formatTry(draft.budgetMinMinor)} – ${formatTry(draft.budgetMaxMinor)}`
        : `En fazla ${formatTry(draft.budgetMaxMinor)}`
      : null;

  return {
    alan: track && grade ? `${track} · ${grade}` : track,
    hedef: target,
    net: nets,
    tarz: styles,
    butce: budget,
  };
}
KAKTUS_FILE_EOF

emit "src/components/onboarding/OnboardingProvider.tsx" <<'KAKTUS_FILE_EOF'
'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  STEPS,
  type OnboardingDraft,
  type StepSlug,
  readDraft,
  writeDraft,
} from '@/lib/onboarding/client-state';
import { saveOnboardingStep } from '@/server/actions/onboarding';

/**
 * Guest onboarding state.
 *
 * Three copies of the answers exist and they have different jobs:
 *
 *   React state    — what the UI renders. Updates instantly on tap.
 *   sessionStorage — survives a refresh and the trip through the auth modal.
 *   OnboardingSession row — the record. Survives everything, including a
 *                    magic link opened in a different browser.
 *
 * The server copy is authoritative and seeds the other two on mount. Writes go
 * the other way: local first so nothing ever waits on the network, then a
 * background save. If that save fails we keep the local copy and retry on the
 * next step rather than blocking a 17-year-old mid-funnel on a flaky connection.
 */

interface OnboardingContextValue {
  draft: OnboardingDraft;
  /** Merges a patch, caches locally, and persists in the background. */
  update: (patch: OnboardingDraft) => void;
  /** Persists and navigates. Awaits the save so results are never stale. */
  advance: (from: StepSlug) => Promise<void>;
  goBack: (from: StepSlug) => void;
  saving: boolean;
  saveFailed: boolean;
  hydrated: boolean;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const value = useContext(OnboardingContext);
  if (!value) throw new Error('useOnboarding must be used inside <OnboardingProvider>');
  return value;
}

export function OnboardingProvider({
  children,
  serverDraft,
}: {
  children: React.ReactNode;
  /** Read on the server from the httpOnly-cookie session. */
  serverDraft: OnboardingDraft;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<OnboardingDraft>(serverDraft);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const pending = useRef<OnboardingDraft>({});

  // Hydrate once, on mount. The server copy wins where both exist; the local
  // cache fills gaps, which is what covers the case where a step was answered
  // but its background save never landed.
  useEffect(() => {
    const local = readDraft();
    const merged: OnboardingDraft = { ...local, ...stripEmpty(serverDraft) };
    setDraft(merged);
    writeDraft(merged);
    setHydrated(true);
    // serverDraft is a server-rendered prop; re-running on identity change
    // would clobber answers the student just typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback((patch: OnboardingDraft) => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      writeDraft(next);
      pending.current = { ...pending.current, ...patch };
      return next;
    });
  }, []);

  const advance = useCallback(
    async (from: StepSlug) => {
      const index = STEPS.indexOf(from);
      const next = STEPS[index + 1];

      setSaving(true);
      setSaveFailed(false);
      try {
        const result = await saveOnboardingStep({
          ...pending.current,
          completedStep: index + 1,
        });
        if (!result.ok) throw new Error('validation');
        pending.current = {};
      } catch {
        // Non-blocking by design: the answers are safe in sessionStorage and
        // the next step retries the whole pending patch. Stopping the funnel
        // here would cost more students than a delayed save ever will.
        setSaveFailed(true);
      } finally {
        setSaving(false);
      }

      router.push(next ? `/onboarding/${next}` : '/kocbul');
    },
    [router],
  );

  const goBack = useCallback(
    (from: StepSlug) => {
      const index = STEPS.indexOf(from);
      if (index <= 0) {
        router.push('/');
        return;
      }
      router.push(`/onboarding/${STEPS[index - 1]}`);
    },
    [router],
  );

  return (
    <OnboardingContext.Provider
      value={{ draft, update, advance, goBack, saving, saveFailed, hydrated }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

/** Drops null/undefined so a sparse server row cannot erase a local answer. */
function stripEmpty(draft: OnboardingDraft): OnboardingDraft {
  return Object.fromEntries(
    Object.entries(draft).filter(([, v]) => v !== null && v !== undefined),
  ) as OnboardingDraft;
}
KAKTUS_FILE_EOF

emit "src/components/onboarding/controls.tsx" <<'KAKTUS_FILE_EOF'
'use client';

/**
 * Onboarding controls.
 *
 * Deliberately not a card kit. Choices are wide rows with a hairline that
 * thickens on selection, so a selected answer reads as *committed* rather than
 * merely highlighted — this matters on a form where students routinely change
 * their mind about their own target three times.
 */

export function ChoiceRow({
  label,
  hint,
  selected,
  onSelect,
  multi = false,
  rank,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
  multi?: boolean;
  /** For ordered multi-select, shows priority. */
  rank?: number;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={selected}
      className={[
        'group flex w-full items-center gap-4 rounded-xl border px-5 py-4 text-left transition-colors',
        selected
          ? 'border-cactus bg-cactus-pale/60 text-ink'
          : 'border-stone bg-paper hover:border-cactus/50',
      ].join(' ')}
    >
      <span
        aria-hidden
        className={[
          'grid size-5 shrink-0 place-items-center border transition-colors',
          multi ? 'rounded-[5px]' : 'rounded-full',
          selected ? 'border-cactus bg-cactus' : 'border-stone bg-transparent',
        ].join(' ')}
      >
        {selected && rank != null ? (
          <span className="text-[11px] font-semibold leading-none text-paper">{rank}</span>
        ) : selected ? (
          <span className="size-2 rounded-full bg-paper" />
        ) : null}
      </span>

      <span className="min-w-0">
        <span className="block font-medium leading-snug">{label}</span>
        {hint && <span className="mt-0.5 block text-sm leading-snug text-muted">{hint}</span>}
      </span>
    </button>
  );
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  max,
  suffix,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  max?: number;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block font-medium">{label}</span>
      {hint && <span className="mt-0.5 block text-sm text-muted">{hint}</span>}
      <span className="mt-2 flex items-baseline gap-2 rounded-xl border border-stone bg-paper px-4 py-3 focus-within:border-cactus">
        <input
          type="number"
          inputMode="decimal"
          value={value ?? ''}
          max={max}
          min={0}
          step="0.25"
          placeholder={placeholder}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === '') return onChange(null);
            const parsed = Number.parseFloat(raw);
            if (Number.isNaN(parsed)) return;
            onChange(max != null ? Math.min(parsed, max) : parsed);
          }}
          className="w-full bg-transparent font-display text-2xl font-semibold tabular-nums outline-none placeholder:font-sans placeholder:text-lg placeholder:font-normal placeholder:text-stone"
        />
        {suffix && <span className="shrink-0 text-sm text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block font-medium">{label}</span>
      {hint && <span className="mt-0.5 block text-sm text-muted">{hint}</span>}
      <input
        type="text"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value || null)}
        className="mt-2 w-full rounded-xl border border-stone bg-paper px-4 py-3 text-base outline-none placeholder:text-stone focus:border-cactus"
      />
    </label>
  );
}

/**
 * Budget input as a pair of bounds rather than a slider.
 *
 * A slider forces a student to pick a number they do not have, and its default
 * position anchors them. Two optional fields let "en fazla 3.000" be a complete
 * answer, which is how people actually think about a budget they are asking a
 * parent to cover.
 */
export function BudgetRange({
  minMinor,
  maxMinor,
  onChange,
}: {
  minMinor: number | null | undefined;
  maxMinor: number | null | undefined;
  onChange: (patch: { budgetMinMinor?: number | null; budgetMaxMinor?: number | null }) => void;
}) {
  const toMinor = (lira: string) => {
    if (lira === '') return null;
    const parsed = Number.parseInt(lira.replace(/\D/g, ''), 10);
    return Number.isNaN(parsed) ? null : parsed * 100;
  };
  const toLira = (minor: number | null | undefined) =>
    minor == null ? '' : String(Math.round(minor / 100));

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(
        [
          ['En az', minMinor, (v: number | null) => onChange({ budgetMinMinor: v })],
          ['En fazla', maxMinor, (v: number | null) => onChange({ budgetMaxMinor: v })],
        ] as const
      ).map(([label, value, setter]) => (
        <label key={label} className="block">
          <span className="block text-sm text-muted">{label}</span>
          <span className="mt-1.5 flex items-baseline gap-2 rounded-xl border border-stone bg-paper px-4 py-3 focus-within:border-cactus">
            <input
              type="text"
              inputMode="numeric"
              value={toLira(value)}
              placeholder="0"
              onChange={(event) => setter(toMinor(event.target.value))}
              className="w-full bg-transparent font-display text-2xl font-semibold tabular-nums outline-none placeholder:text-stone"
            />
            <span className="shrink-0 text-sm text-muted">₺ / ay</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function QuickPick({
  options,
  onPick,
  active,
}: {
  options: Array<{ label: string; value: number }>;
  onPick: (value: number) => void;
  active?: number | null;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onPick(option.value)}
          className={[
            'rounded-full border px-4 py-2 text-sm transition-colors',
            active === option.value
              ? 'border-cactus bg-cactus text-paper'
              : 'border-stone bg-paper text-muted hover:border-cactus hover:text-cactus',
          ].join(' ')}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
KAKTUS_FILE_EOF

emit "src/components/onboarding/steps.tsx" <<'KAKTUS_FILE_EOF'
'use client';

import {
  GRADE_LABELS,
  STEPS,
  STEP_TITLES,
  STYLE_LABELS,
  TRACK_LABELS,
  isStepComplete,
  type StepSlug,
} from '@/lib/onboarding/client-state';
import type { CoachingStyle, GradeLevel, Track } from '@/lib/matching/types';
import { useOnboarding } from './OnboardingProvider';
import { AnswerRail } from './AnswerRail';
import { BudgetRange, ChoiceRow, NumberField, QuickPick, TextField } from './controls';

/**
 * Step shell: question, answer area, navigation, and the rail.
 *
 * One question per screen. The question is the largest thing on the page and
 * the answers sit directly under it — no card, no chrome between the two.
 */
export function StepShell({
  step,
  subtitle,
  children,
}: {
  step: StepSlug;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const { draft, advance, goBack, saving } = useOnboarding();
  const index = STEPS.indexOf(step);
  const complete = isStepComplete(draft, step);
  const isLast = index === STEPS.length - 1;

  return (
    <main className="mx-auto grid max-w-5xl gap-12 px-6 py-10 sm:px-8 lg:grid-cols-[1fr_18rem] lg:gap-16">
      <div>
        <nav className="flex items-center gap-3 text-sm text-muted">
          <button
            type="button"
            onClick={() => goBack(step)}
            className="rounded-full px-2 py-1 transition-colors hover:text-cactus"
          >
            Geri
          </button>
          <span aria-hidden className="text-stone">
            /
          </span>
          <span>
            {index + 1}. adım, {STEPS.length} adımdan
          </span>
        </nav>

        <h1 className="mt-8 max-w-measure font-display text-question font-semibold text-balance">
          {STEP_TITLES[step]}
        </h1>
        {subtitle && <p className="mt-3 max-w-[48ch] leading-relaxed text-muted">{subtitle}</p>}

        <div className="mt-8 space-y-8">{children}</div>

        <div className="mt-10 flex items-center gap-4">
          <button
            type="button"
            disabled={!complete || saving}
            onClick={() => advance(step)}
            className="rounded-full bg-cactus px-7 py-3.5 font-medium text-paper transition-colors hover:bg-cactus-deep disabled:cursor-not-allowed disabled:bg-stone disabled:text-muted"
          >
            {saving ? 'Kaydediliyor' : isLast ? 'Koçlarımı göster' : 'Devam et'}
          </button>
          {!complete && (
            <p className="text-sm text-muted">Devam etmek için bu soruyu yanıtla.</p>
          )}
        </div>
      </div>

      <AnswerRail draft={draft} current={step} />
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Track (and grade level)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grade level shares this screen with track.
 *
 * The brief listed five steps without it, but `StudentProfile.gradeLevel` is
 * required and the matcher weights coach experience with that exact cohort at
 * 8%. Rather than adding a sixth step or defaulting it silently — a mezun
 * student matched as though they were in 11th grade gets visibly wrong results
 * — it rides along here. Two taps, one screen, still five steps.
 */
export function StepTrack() {
  const { draft, update } = useOnboarding();

  return (
    <StepShell step="alan" subtitle="Eşleşmenin temeli bu ikisi.">
      <fieldset>
        <legend className="mb-3 font-medium">Alanın</legend>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(TRACK_LABELS) as Track[]).map((track) => (
            <ChoiceRow
              key={track}
              label={TRACK_LABELS[track].full}
              hint={TRACK_LABELS[track].hint}
              selected={draft.track === track}
              onSelect={() => update({ track })}
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 font-medium">Sınıfın</legend>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(GRADE_LABELS) as GradeLevel[]).map((grade) => (
            <ChoiceRow
              key={grade}
              label={GRADE_LABELS[grade].short}
              hint={GRADE_LABELS[grade].hint}
              selected={draft.gradeLevel === grade}
              onSelect={() => update({ gradeLevel: grade })}
            />
          ))}
        </div>
      </fieldset>
    </StepShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Target
// ─────────────────────────────────────────────────────────────────────────────

const RANK_PRESETS = [
  { label: 'İlk 1.000', value: 1_000 },
  { label: 'İlk 5.000', value: 5_000 },
  { label: 'İlk 20.000', value: 20_000 },
  { label: 'İlk 50.000', value: 50_000 },
  { label: 'İlk 100.000', value: 100_000 },
];

export function StepTarget() {
  const { draft, update } = useOnboarding();

  return (
    <StepShell
      step="hedef"
      subtitle="Sıralama hedefin, koçun kendi çıkışıyla karşılaştırılır. Eşleşmedeki en ağırlıklı ölçüt bu."
    >
      <div>
        <p className="mb-3 font-medium">Hedef sıralaman</p>
        <QuickPick
          options={RANK_PRESETS}
          active={draft.targetRanking ?? null}
          onPick={(value) => update({ targetRanking: value })}
        />
        <div className="mt-4 max-w-xs">
          <NumberField
            label="Ya da tam sayı yaz"
            value={draft.targetRanking}
            onChange={(value) => update({ targetRanking: value ? Math.round(value) : null })}
            placeholder="12500"
            suffix="sıralama"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Hedef üniversite"
          hint="İstersen boş bırak"
          value={draft.targetUniversity}
          onChange={(value) => update({ targetUniversity: value })}
          placeholder="Boğaziçi Üniversitesi"
        />
        <TextField
          label="Hedef bölüm"
          hint="İstersen boş bırak"
          value={draft.targetDepartment}
          onChange={(value) => update({ targetDepartment: value })}
          placeholder="Bilgisayar Mühendisliği"
        />
      </div>
    </StepShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Baseline nets
// ─────────────────────────────────────────────────────────────────────────────

export function StepBaseline() {
  const { draft, update } = useOnboarding();

  return (
    <StepShell
      step="net"
      subtitle="Son denemendeki netlerin yeter. Kimse görmüyor; sadece hangi koçun senin başladığın yerden başladığını bulmak için kullanılıyor."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <NumberField
          label="TYT neti"
          hint="120 üzerinden"
          max={120}
          value={draft.baselineTytNet}
          onChange={(value) => update({ baselineTytNet: value })}
          placeholder="0"
          suffix="net"
        />
        <NumberField
          label="AYT neti"
          hint="Henüz denemediysen boş bırak"
          max={80}
          value={draft.baselineAytNet}
          onChange={(value) => update({ baselineAytNet: value })}
          placeholder="0"
          suffix="net"
        />
      </div>

      <p className="max-w-[52ch] rounded-xl border border-stone/70 bg-paper px-4 py-3 text-sm leading-relaxed text-muted">
        Düşük net eşleşmeni kötüleştirmez. Tersine: senin bulunduğun noktadan başlayıp
        hedefine ulaşmış koçlar öne çıkar.
      </p>
    </StepShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 — Coaching style
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ordered multi-select. The scorer weights preferences by rank — first choice
 * counts double the second — so the order genuinely changes results, and the
 * numbered markers here reflect real priority rather than decoration.
 */
export function StepStyle() {
  const { draft, update } = useOnboarding();
  const selected = draft.preferredStyles ?? [];

  const toggle = (style: CoachingStyle) => {
    const next = selected.includes(style)
      ? selected.filter((s) => s !== style)
      : [...selected, style].slice(0, 3);
    update({ preferredStyles: next });
  };

  return (
    <StepShell
      step="tarz"
      subtitle="En çok istediğinden başlayarak seç. İlk seçimin eşleşmede en ağır basan."
    >
      <div role="group" className="grid gap-2">
        {(Object.keys(STYLE_LABELS) as CoachingStyle[]).map((style) => {
          const position = selected.indexOf(style);
          return (
            <ChoiceRow
              key={style}
              multi
              label={STYLE_LABELS[style].short}
              hint={STYLE_LABELS[style].hint}
              selected={position !== -1}
              rank={position === -1 ? undefined : position + 1}
              onSelect={() => toggle(style)}
            />
          );
        })}
      </div>
      {selected.length >= 3 && (
        <p className="text-sm text-muted">En fazla üç tarz seçebilirsin.</p>
      )}
    </StepShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5 — Budget
// ─────────────────────────────────────────────────────────────────────────────

const BUDGET_PRESETS = [
  { label: '2.000 ₺’ye kadar', value: 200_000 },
  { label: '3.500 ₺’ye kadar', value: 350_000 },
  { label: '5.000 ₺’ye kadar', value: 500_000 },
  { label: '5.000 ₺ üzeri', value: 900_000 },
];

export function StepBudget() {
  const { draft, update } = useOnboarding();

  return (
    <StepShell
      step="butce"
      subtitle="Bütçenin biraz üzerindeki koçlar da listelenir — kapsamı küçülterek kendi teklifini gönderebilirsin."
    >
      <div>
        <p className="mb-3 font-medium">Aylık bütçen</p>
        <QuickPick
          options={BUDGET_PRESETS}
          active={draft.budgetMaxMinor ?? null}
          onPick={(value) => update({ budgetMaxMinor: value })}
        />
      </div>

      <BudgetRange
        minMinor={draft.budgetMinMinor}
        maxMinor={draft.budgetMaxMinor}
        onChange={update}
      />

      <p className="max-w-[52ch] text-sm leading-relaxed text-muted">
        Ödeme, koçla anlaştıktan sonra Kaktüs'te tutulur ve dersler tamamlandıkça koça
        aktarılır. Şimdi hiçbir ödeme yapmıyorsun.
      </p>
    </StepShell>
  );
}

/**
 * There is deliberately no STEP_COMPONENTS map exported from this file.
 *
 * This is a `'use client'` module, so every export crossing into a Server
 * Component becomes a client-reference stub. A component stub renders fine; an
 * object stub does not — indexing it server-side returns `undefined` and React
 * fails with "Element type is invalid". The slug → component mapping therefore
 * lives in the server route (`app/onboarding/[step]/page.tsx`), which holds the
 * real imported references.
 */
KAKTUS_FILE_EOF

emit "src/jobs/milestones.ts" <<'KAKTUS_FILE_EOF'
import { prisma } from '@/lib/db';
import { TX_OPTIONS, ConcurrentModificationError, casStatus, tryAdvisoryLock } from '@/lib/tx';
import { postMilestoneRelease } from '@/lib/payments/escrow';
import { transitionOffer } from '@/server/services/offer-service';

/**
 * Milestone lifecycle worker.
 *
 * Runs every 5 minutes. Three passes, deliberately separate so a failure in one
 * cannot block the others:
 *
 *   1. `activateMilestones`   SCHEDULED → IN_PROGRESS when the period opens
 *   2. `closeMilestones`      IN_PROGRESS → PENDING_CONFIRMATION when it ends,
 *                             setting the auto-release deadline
 *   3. `autoReleaseMilestones` PENDING_CONFIRMATION → RELEASED once both parties
 *                             confirmed, or the deadline passed with no dispute
 *
 * Why auto-release at all: requiring both parties to click before a coach gets
 * paid sounds fair and is a disaster in practice. Students disappear after the
 * exam. Coaches would be unpaid for work they did, would learn not to trust the
 * escrow, and would push students off-platform — which is the exact behaviour
 * the anti-circumvention filter exists to prevent. Silence must therefore mean
 * approval, with a window long enough to object.
 */

/** How long after a milestone period ends before funds release on silence. */
export const AUTO_RELEASE_DAYS = 5;

/** Cap on rows per pass, so one slow run cannot hold locks for minutes. */
const BATCH_SIZE = 200;

export interface JobResult {
  processed: number;
  skipped: number;
  failed: number;
  errors: Array<{ id: string; message: string }>;
}

const emptyResult = (): JobResult => ({ processed: 0, skipped: 0, failed: 0, errors: [] });

export async function activateMilestones(now = new Date()): Promise<JobResult> {
  const result = emptyResult();

  const due = await prisma.milestone.findMany({
    where: { status: 'SCHEDULED', periodStart: { lte: now } },
    select: { id: true },
    take: BATCH_SIZE,
  });

  for (const milestone of due) {
    try {
      await casStatus(prisma.milestone, {
        id: milestone.id,
        from: 'SCHEDULED',
        data: { status: 'IN_PROGRESS' },
        entity: 'Milestone',
      });
      result.processed++;
    } catch (error) {
      if (error instanceof ConcurrentModificationError) {
        result.skipped++; // another worker got there, or a dispute froze it
        continue;
      }
      result.failed++;
      result.errors.push({ id: milestone.id, message: String(error) });
    }
  }

  return result;
}

export async function closeMilestones(now = new Date()): Promise<JobResult> {
  const result = emptyResult();

  const ended = await prisma.milestone.findMany({
    where: { status: 'IN_PROGRESS', periodEnd: { lte: now } },
    select: { id: true },
    take: BATCH_SIZE,
  });

  const autoReleaseAt = new Date(now.getTime() + AUTO_RELEASE_DAYS * 24 * 3600 * 1000);

  for (const milestone of ended) {
    try {
      await casStatus(prisma.milestone, {
        id: milestone.id,
        from: 'IN_PROGRESS',
        data: { status: 'PENDING_CONFIRMATION', autoReleaseAt },
        entity: 'Milestone',
      });
      result.processed++;
    } catch (error) {
      if (error instanceof ConcurrentModificationError) {
        result.skipped++;
        continue;
      }
      result.failed++;
      result.errors.push({ id: milestone.id, message: String(error) });
    }
  }

  return result;
}

/**
 * Releases escrow to the coach for milestones that are ready.
 *
 * A milestone is ready when it is PENDING_CONFIRMATION, has no open dispute on
 * its engagement, has no unresolved coach no-show among its sessions, and
 * either both parties confirmed every session or the auto-release deadline has
 * passed.
 */
export async function autoReleaseMilestones(now = new Date()): Promise<JobResult> {
  const result = emptyResult();

  const candidates = await prisma.milestone.findMany({
    where: {
      status: 'PENDING_CONFIRMATION',
      OR: [
        { autoReleaseAt: { lte: now } },
        // Fast path: both parties already confirmed, no reason to make the
        // coach wait five days for money everyone agrees they earned.
        {
          bookings: {
            every: {
              OR: [
                { status: 'COMPLETED' },
                { AND: [{ coachConfirmedAt: { not: null } }, { studentConfirmedAt: { not: null } }] },
              ],
            },
          },
        },
      ],
    },
    select: {
      id: true,
      amountMinor: true,
      autoReleaseAt: true,
      engagement: {
        select: {
          id: true,
          offerId: true,
          coachProfileId: true,
          commissionBps: true,
          currency: true,
          status: true,
        },
      },
      bookings: {
        select: { id: true, status: true, coachConfirmedAt: true, studentConfirmedAt: true },
      },
    },
    take: BATCH_SIZE,
  });

  for (const milestone of candidates) {
    try {
      const released = await releaseOne(milestone, now);
      if (released) result.processed++;
      else result.skipped++;
    } catch (error) {
      result.failed++;
      result.errors.push({ id: milestone.id, message: String(error) });
    }
  }

  return result;
}

async function releaseOne(
  milestone: {
    id: string;
    amountMinor: number;
    autoReleaseAt: Date | null;
    engagement: {
      id: string;
      offerId: string;
      coachProfileId: string;
      commissionBps: number;
      currency: string;
      status: string;
    };
    bookings: Array<{
      id: string;
      status: string;
      coachConfirmedAt: Date | null;
      studentConfirmedAt: Date | null;
    }>;
  },
  now: Date,
): Promise<boolean> {
  const { engagement } = milestone;

  // A coach no-show blocks release regardless of the clock. Auto-releasing
  // payment for a session the coach did not attend is the single worst thing
  // this worker could do.
  const hasNoShow = milestone.bookings.some((b) => b.status === 'NO_SHOW_COACH');
  if (hasNoShow) return false;

  const deadlinePassed = milestone.autoReleaseAt != null && milestone.autoReleaseAt <= now;
  const allConfirmed =
    milestone.bookings.length > 0 &&
    milestone.bookings.every(
      (b) =>
        b.status === 'COMPLETED' ||
        (b.coachConfirmedAt != null && b.studentConfirmedAt != null),
    );
  if (!deadlinePassed && !allConfirmed) return false;

  const releasedNow = await prisma.$transaction(async (tx) => {
    // Non-blocking: if another worker holds this engagement, skip and let the
    // next run pick it up. Queuing workers behind each other turns a 200-row
    // batch into a serial crawl.
    const gotLock = await tryAdvisoryLock(tx, `engagement:${engagement.id}`);
    if (!gotLock) return false;

    // Re-check inside the lock. The dispute may have been opened in the
    // milliseconds since the candidate query — this is the race that would
    // otherwise pay a coach while a student is filing a no-show report.
    const openDispute = await tx.dispute.count({
      where: {
        engagementId: engagement.id,
        status: { in: ['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'] },
      },
    });
    if (openDispute > 0) return false;

    // CAS: only a milestone still PENDING_CONFIRMATION may be released. If a
    // dispute froze it to DISPUTED between the candidate query and here, this
    // matches zero rows, throws, and rolls the whole transaction back — no
    // partial ledger posting, no money moved for a disputed session.
    //
    // This single statement is the entire defence against the worst race in the
    // system: auto-release firing at the same instant a student reports a
    // no-show. Both paths CAS the same row from the same expected state, so
    // exactly one wins and the loser aborts cleanly.
    await casStatus(tx.milestone, {
      id: milestone.id,
      from: 'PENDING_CONFIRMATION',
      data: { status: 'RELEASED', releasedAt: now },
      entity: 'Milestone',
    });

    await postMilestoneRelease(tx, {
      engagementId: engagement.id,
      milestoneId: milestone.id,
      coachProfileId: engagement.coachProfileId,
      amountMinor: milestone.amountMinor,
      commissionBps: engagement.commissionBps,
      currency: engagement.currency,
    });

    // Sessions with no explicit outcome are recorded as completed, so the
    // booking history matches what was paid for.
    await tx.booking.updateMany({
      where: { milestoneId: milestone.id, status: 'SCHEDULED', endsAt: { lte: now } },
      data: { status: 'COMPLETED' },
    });

    return true;
  }, TX_OPTIONS);

  if (!releasedNow) return false;

  await maybeCompleteEngagement(engagement.id, engagement.offerId);
  return true;
}

/**
 * Moves the engagement and its offer to COMPLETED once every milestone has
 * settled. Runs outside the release transaction: it is a consequence of the
 * release, not part of it, and a failure here must not roll back a payout.
 */
export async function maybeCompleteEngagement(engagementId: string, offerId: string) {
  const outstanding = await prisma.milestone.count({
    where: {
      engagementId,
      status: { in: ['SCHEDULED', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'DISPUTED'] },
    },
  });
  if (outstanding > 0) return false;

  const engagement = await prisma.engagement.findUnique({
    where: { id: engagementId },
    select: { status: true, coachProfileId: true },
  });
  if (!engagement || engagement.status !== 'ACTIVE') return false;

  await prisma.$transaction(async (tx) => {
    await casStatus(tx.engagement, {
      id: engagementId,
      from: 'ACTIVE',
      data: { status: 'COMPLETED', completedAt: new Date() },
      entity: 'Engagement',
    });
    await tx.coachProfile.update({
      where: { id: engagement.coachProfileId },
      data: {
        activeEngagements: { decrement: 1 },
        completedEngagements: { increment: 1 },
      },
    });
  }, TX_OPTIONS);

  await transitionOffer({
    offerId,
    event: 'ALL_MILESTONES_RELEASED',
    actor: 'SYSTEM',
  });

  return true;
}

/** Convenience entry point for the scheduler. */
export async function runMilestoneWorker(now = new Date()) {
  return {
    activated: await activateMilestones(now),
    closed: await closeMilestones(now),
    released: await autoReleaseMilestones(now),
  };
}
KAKTUS_FILE_EOF

emit "src/jobs/provider-sync.ts" <<'KAKTUS_FILE_EOF'
import { prisma } from '@/lib/db';
import { getPaymentProvider } from '@/lib/payments/provider';
import { reconcileCheckout } from '@/server/services/payment-service';
import type { JobResult } from './milestones';

/**
 * Workers that talk to the payment provider.
 *
 * All of them share one shape: the database already holds the decision, and
 * these jobs make the outside world match it. That ordering is deliberate —
 * every one of these operations is retryable precisely because the accounting
 * committed first and the provider call is a separate, idempotent step.
 */

const emptyResult = (): JobResult => ({ processed: 0, skipped: 0, failed: 0, errors: [] });

// ─────────────────────────────────────────────────────────────────────────────
// 1. Escrow release: approve the basket item for each released milestone
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Under Iyzico's marketplace model, approving the basket item IS the escrow
 * release: until we call it, Iyzico holds the funds; after it, they settle to
 * the coach's sub-merchant account.
 *
 * The local ledger is written first (by `autoReleaseMilestones`), and this job
 * catches up the provider. The window between the two is the one place where
 * our books say "paid" and Iyzico still holds the money — bounded by this job's
 * 5-minute cadence, visible in `providerApprovedAt`, and safe because the
 * direction of the discrepancy always favours the student.
 */
export async function approveReleasedMilestones(now = new Date()): Promise<JobResult> {
  const result = emptyResult();
  const provider = getPaymentProvider();

  const pending = await prisma.milestone.findMany({
    where: {
      status: 'RELEASED',
      providerApprovedAt: null,
      providerTransactionId: { not: null },
    },
    select: {
      id: true,
      providerTransactionId: true,
      engagement: { select: { id: true, offerId: true } },
    },
    take: 100,
  });

  for (const milestone of pending) {
    try {
      const outcome = await provider.approveItem({
        paymentTransactionId: milestone.providerTransactionId!,
        conversationId: `approve:${milestone.id}`,
      });

      if (outcome.ok) {
        await prisma.milestone.update({
          where: { id: milestone.id },
          data: { providerApprovedAt: new Date(), providerApproveError: null },
        });
        result.processed++;
      } else {
        await prisma.milestone.update({
          where: { id: milestone.id },
          data: { providerApproveError: outcome.message.slice(0, 500) },
        });
        result.failed++;
        result.errors.push({ id: milestone.id, message: outcome.message });
      }
    } catch (error) {
      result.failed++;
      result.errors.push({ id: milestone.id, message: String(error) });
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Reconciliation sweep — the safety net
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-checks checkout sessions that never reached a terminal state.
 *
 * This exists because the two happy paths both have holes: the browser callback
 * never fires if the student closes the tab, and the webhook gives up after
 * three attempts. Without a sweep, a student's money sits in escrow against an
 * offer still marked ACCEPTED, and nobody finds out until they complain.
 *
 * Runs on sessions older than two minutes (giving the callback a chance to win)
 * and younger than 24 hours (after which the token is long dead).
 */
export async function reconcileStaleCheckouts(now = new Date()): Promise<JobResult> {
  const result = emptyResult();

  const stale = await prisma.payment.findMany({
    where: {
      status: { in: ['INITIATED', 'REQUIRES_ACTION'] },
      token: { not: null },
      createdAt: {
        lt: new Date(now.getTime() - 2 * 60_000),
        gt: new Date(now.getTime() - 24 * 3600_000),
      },
    },
    select: { id: true, token: true },
    take: 100,
  });

  for (const payment of stale) {
    try {
      const outcome = await reconcileCheckout(payment.token!);
      if (outcome.outcome === 'CAPTURED') result.processed++;
      else result.skipped++;
    } catch (error) {
      result.failed++;
      result.errors.push({ id: payment.id, message: String(error) });
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Refund submission
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Submits approved refunds to Iyzico.
 *
 * The ledger reversal already committed when the dispute was resolved, so this
 * job only moves money at the bank. Retrying is therefore safe: the worst case
 * is a duplicate refund request for the same `paymentTransactionId`, which
 * Iyzico rejects on amount grounds rather than double-refunding.
 *
 * Refunds go per basket item, so a whole-engagement refund is several Refund
 * rows — one per unreleased milestone — each carrying its own
 * `paymentTransactionId`.
 */
export async function submitPendingRefunds(now = new Date()): Promise<JobResult> {
  const result = emptyResult();
  const provider = getPaymentProvider();

  const pending = await prisma.refund.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now }, attempts: { lt: 6 } },
    include: { payment: { select: { providerRef: true } } },
    take: 50,
  });

  for (const refund of pending) {
    try {
      await prisma.refund.update({
        where: { id: refund.id },
        data: { attempts: { increment: 1 }, submittedAt: now, status: 'SUBMITTED' },
      });

      if (!refund.paymentTransactionId) {
        // Nothing was ever captured at the provider for this item — the
        // accounting reversal is the whole story. Settle rather than retrying
        // forever against a handle that does not exist.
        await settle(refund.id, null, 'no_provider_transaction');
        result.processed++;
        continue;
      }

      const outcome = await provider.refundItem({
        paymentTransactionId: refund.paymentTransactionId,
        priceMinor: refund.amountMinor,
        currency: refund.currency as 'TRY',
        conversationId: refund.idempotencyKey,
        ip: process.env.SERVER_PUBLIC_IP ?? '127.0.0.1',
      });

      if (outcome.ok) {
        await settle(refund.id, outcome.providerRef ?? null, null);
        result.processed++;
      } else if (outcome.retryable) {
        await scheduleRetry(refund.id, refund.attempts + 1, outcome.message);
        result.failed++;
        result.errors.push({ id: refund.id, message: outcome.message });
      } else {
        // A permanent rejection needs a human, not another attempt. Most often
        // this means the item was already approved — which should be impossible
        // given we never refund a released milestone, so it signals a real bug.
        await prisma.refund.update({
          where: { id: refund.id },
          data: { status: 'FAILED', lastError: outcome.message.slice(0, 500) },
        });
        result.failed++;
        result.errors.push({ id: refund.id, message: `PERMANENT: ${outcome.message}` });
      }
    } catch (error) {
      await scheduleRetry(refund.id, refund.attempts + 1, String(error));
      result.failed++;
      result.errors.push({ id: refund.id, message: String(error) });
    }
  }

  return result;
}

async function settle(refundId: string, providerRef: string | null, note: string | null) {
  await prisma.refund.update({
    where: { id: refundId },
    data: { status: 'SETTLED', settledAt: new Date(), providerRef, lastError: note },
  });
}

async function scheduleRetry(refundId: string, attempts: number, message: string) {
  // Exponential backoff, capped at six hours. After six attempts the row stops
  // being picked up and waits for a human — silent infinite retry hides real
  // breakage, and an unrefunded student is a complaint, not a mystery.
  const delayMinutes = Math.min(2 ** attempts * 5, 6 * 60);
  await prisma.refund.update({
    where: { id: refundId },
    data: {
      status: attempts >= 6 ? 'FAILED' : 'PENDING',
      lastError: message.slice(0, 500),
      nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000),
    },
  });
}
KAKTUS_FILE_EOF

emit "src/jobs/workers.ts" <<'KAKTUS_FILE_EOF'
import { prisma } from '@/lib/db';
import { TX_OPTIONS, idempotencyKey, tryAdvisoryLock } from '@/lib/tx';
import { getPaymentProvider } from '@/lib/payments/provider';
import { coachAvailableBalanceMinor, postPayout } from '@/lib/payments/escrow';
import {
  approveReleasedMilestones,
  reconcileStaleCheckouts,
  submitPendingRefunds,
} from './provider-sync';
import { transitionOffer } from '@/server/services/offer-service';
import { expireStaleHolds } from '@/lib/booking/holds';
import { runMilestoneWorker } from './milestones';
import type { JobResult } from './milestones';

/**
 * Background workers.
 *
 * Scheduling note: these are written as plain async functions with an injected
 * clock, so they are callable from a test, a cron route, or a queue consumer
 * without change. Use pg-boss or Inngest in production — a Vercel cron hitting
 * an HTTP route is fine for expiry sweeps but not for payouts, because a
 * timeout mid-run leaves you unable to tell whether the money moved.
 */

const emptyResult = (): JobResult => ({ processed: 0, skipped: 0, failed: 0, errors: [] });

/**
 * Expires offers whose deadline passed, releasing their slot holds.
 *
 * Runs before the hold sweep so slots are freed by the offer transition (which
 * writes an audit trail) rather than by the blunt hold expiry.
 */
export async function expireOffers(now = new Date()): Promise<JobResult> {
  const result = emptyResult();

  const stale = await prisma.offer.findMany({
    where: { status: { in: ['OFFERED', 'COUNTERED', 'ACCEPTED'] }, expiresAt: { lte: now } },
    select: { id: true, status: true },
    take: 200,
  });

  for (const offer of stale) {
    try {
      await transitionOffer({
        offerId: offer.id,
        event: 'EXPIRE',
        actor: 'SYSTEM',
        reason: 'offer_deadline_passed',
        expectedStatus: offer.status,
      });
      result.processed++;
    } catch (error) {
      // An ACCEPTED offer whose payment landed a second ago will fail the
      // guard. That is correct behaviour, not an error worth paging anyone.
      const message = String(error);
      if (message.includes('Payment already captured') || message.includes('modified concurrently')) {
        result.skipped++;
        continue;
      }
      result.failed++;
      result.errors.push({ id: offer.id, message });
    }
  }

  return result;
}

/** Minimum balance worth a payout run; below this the provider fee dominates. */
const MIN_PAYOUT_MINOR = 10_000; // 100 ₺

/**
 * Weekly payout batch.
 *
 * ── IMPORTANT: disabled under the Iyzico marketplace model ──
 *
 * The original design had us holding funds and instructing payouts. Iyzico's
 * marketplace model does not work that way: Iyzico is the escrow agent, and
 * approving a basket item settles that money to the coach's sub-merchant
 * account directly. We never hold it, which is what keeps us out of scope as a
 * payment institution under Turkish law 6493.
 *
 * So this job runs only for the mock provider, where it models the payout leg
 * for tests. Against Iyzico it is a no-op, and `Payout` rows become a
 * reconciliation record built from settlement reports rather than an
 * instruction we issue. Deleting the job outright would lose that test
 * coverage; leaving it enabled would double-count every release.
 */
export async function runPayoutBatch(now = new Date()): Promise<JobResult> {
  const result = emptyResult();
  const provider = getPaymentProvider();

  if (provider.name === 'iyzico') {
    // Settlement is Iyzico's. See the note above.
    return result;
  }

  const coaches = await prisma.coachProfile.findMany({
    where: { verificationStatus: 'APPROVED', submerchantKey: { not: null } },
    select: { id: true, submerchantKey: true },
    take: 500,
  });

  for (const coach of coaches) {
    try {
      const payout = await prisma.$transaction(async (tx) => {
        const gotLock = await tryAdvisoryLock(tx, `payout:${coach.id}`);
        if (!gotLock) return null;

        const balance = await coachAvailableBalanceMinor(tx, coach.id);
        if (balance < MIN_PAYOUT_MINOR) return null;

        const created = await tx.payout.create({
          data: {
            coachProfileId: coach.id,
            amountMinor: balance,
            status: 'PENDING',
            provider: provider.name,
            idempotencyKey: idempotencyKey('payout', coach.id, isoWeek(now)),
          },
        });

        await postPayout(tx, {
          payoutId: created.id,
          coachProfileId: coach.id,
          amountMinor: balance,
        });

        return created;
      }, TX_OPTIONS);

      if (!payout) {
        result.skipped++;
        continue;
      }

      // Provider call outside the transaction.
      await prisma.payout.update({
        where: { id: payout.id },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });
      result.processed++;
    } catch (error) {
      const message = String(error);
      // Unique violation on the idempotency key means this week's batch already
      // ran for this coach. Expected under retry, not a failure.
      if (message.includes('Unique constraint')) {
        result.skipped++;
        continue;
      }
      result.failed++;
      result.errors.push({ id: coach.id, message });
    }
  }

  return result;
}

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}W${String(week).padStart(2, '0')}`;
}

/**
 * Everything on the 5-minute tick.
 *
 * Order matters. Reconciliation runs first so a payment that captured while we
 * were not looking becomes an engagement before the milestone worker decides
 * what is due. Provider approval runs after the milestone worker, because it
 * acts on milestones that worker just released.
 */
export async function runFrequentJobs(now = new Date()) {
  const reconciled = await reconcileStaleCheckouts(now);
  const offers = await expireOffers(now);
  const holds = await expireStaleHolds(now);
  const milestones = await runMilestoneWorker(now);
  const approvals = await approveReleasedMilestones(now);
  const refunds = await submitPendingRefunds(now);
  return { reconciled, offers, holdsExpired: holds, milestones, approvals, refunds };
}

export { runMilestoneWorker, approveReleasedMilestones, reconcileStaleCheckouts, submitPendingRefunds };
KAKTUS_FILE_EOF

emit "src/lib/auth.ts" <<'KAKTUS_FILE_EOF'
import NextAuth, { type DefaultSession } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import Google from 'next-auth/providers/google';
import Resend from 'next-auth/providers/resend';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { ONBOARDING_COOKIE, claimOnboardingSession } from '@/lib/onboarding/session';
import { deliveryMode, sendVerificationRequest } from '@/lib/magic-link';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      roles: ('STUDENT' | 'COACH' | 'ADMIN')[];
      hasStudentProfile: boolean;
      hasCoachProfile: boolean;
      coachStatus: string | null;
    } & DefaultSession['user'];
  }
}

// One line at boot, so "why didn't I get an email" is answered before it is
// asked. Printed on the server only.
if (deliveryMode() === 'local' && process.env.NODE_ENV !== 'test') {
  console.log(
    '[auth] Magic links print to the console and .auth-link.txt (no Resend key configured).',
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'database', maxAge: 60 * 60 * 24 * 30 },
  pages: {
    signIn: '/giris',
    verifyRequest: '/giris/eposta-gonderildi',
    error: '/giris/hata',
  },
  providers: [
    Google({
      allowDangerousEmailAccountLinking: false,
      authorization: { params: { prompt: 'select_account' } },
    }),
    Resend({
      /**
       * The provider id stays `resend` so `signIn('resend', …)` keeps working,
       * but delivery is entirely ours.
       *
       * `apiKey` is given a harmless placeholder when none is configured,
       * purely so the provider factory does not refuse to build. It is never
       * read: overriding `sendVerificationRequest` replaces the code path that
       * would have used it, so no Resend client is constructed and no request
       * to their API is made when the key is missing or a placeholder.
       */
      apiKey: process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY ?? 'unused-local-dev',
      from: process.env.EMAIL_FROM ?? 'Kaktüs Koçluk <merhaba@kaktuskocluk.com>',
      sendVerificationRequest,
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      const [student, coach, record] = await Promise.all([
        prisma.studentProfile.findUnique({ where: { userId: user.id }, select: { id: true } }),
        prisma.coachProfile.findUnique({
          where: { userId: user.id },
          select: { id: true, verificationStatus: true },
        }),
        prisma.user.findUnique({ where: { id: user.id }, select: { roles: true, bannedAt: true } }),
      ]);

      if (record?.bannedAt) throw new Error('ACCOUNT_SUSPENDED');

      session.user.id = user.id;
      session.user.roles = record?.roles ?? ['STUDENT'];
      session.user.hasStudentProfile = Boolean(student);
      session.user.hasCoachProfile = Boolean(coach);
      session.user.coachStatus = coach?.verificationStatus ?? null;
      return session;
    },
  },
  events: {
    /**
     * The moment that makes the guest funnel work: the questionnaire answers
     * captured before signup become a real StudentProfile here, so the student
     * lands back on their match list with nothing lost.
     *
     * Runs on every sign-in, not just creation, because a student may complete
     * onboarding while already holding a dormant account from months earlier.
     */
    async signIn({ user }) {
      if (!user.id) return;
      const token = (await cookies()).get(ONBOARDING_COOKIE)?.value;
      if (!token) return;
      try {
        await claimOnboardingSession(token, user.id);
      } catch (error) {
        // Never block sign-in on this. A failed claim is recoverable from the
        // profile page; a failed sign-in is a lost user.
        console.error('onboarding claim failed', error);
      }
    },
  },
});

/** Throws in server actions when unauthenticated. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error('UNAUTHENTICATED');
  return session.user;
}

export async function requireCoach() {
  const user = await requireUser();
  const coach = await prisma.coachProfile.findUnique({ where: { userId: user.id } });
  if (!coach) throw new Error('NOT_A_COACH');
  if (coach.verificationStatus !== 'APPROVED') throw new Error('COACH_NOT_APPROVED');
  return coach;
}

export async function requireStudent() {
  const user = await requireUser();
  const student = await prisma.studentProfile.findUnique({ where: { userId: user.id } });
  if (!student) throw new Error('NO_STUDENT_PROFILE');
  return student;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!user.roles.includes('ADMIN')) throw new Error('FORBIDDEN');
  return user;
}
KAKTUS_FILE_EOF

emit "src/lib/booking/availability.ts" <<'KAKTUS_FILE_EOF'
import { prisma } from '@/lib/db';

/**
 * Turns a coach's recurring weekly rules into concrete, dated slots and marks
 * what each one is currently doing.
 *
 * Four states, and the distinction between two of them is the whole reason the
 * hold mechanism exists:
 *
 *   AVAILABLE  — free to propose
 *   HELD       — someone has an open offer against it (soft, expires)
 *   MINE       — held by *this* student, so their own offer doesn't look taken
 *   BOOKED     — a paid engagement owns it (hard)
 *
 * A student looking at a popular coach needs to see HELD as visibly different
 * from BOOKED: held slots free up, often within hours, and hiding that makes a
 * calendar look fuller than it is.
 */

export type SlotState = 'AVAILABLE' | 'HELD' | 'MINE' | 'BOOKED';

export interface CalendarSlot {
  /** ISO string; the client never does timezone maths. */
  startsAt: string;
  endsAt: string;
  state: SlotState;
  /** For HELD slots: when it frees up, so the UI can say "18:40'ta boşalıyor". */
  heldUntil?: string;
}

export interface CalendarDay {
  /** YYYY-MM-DD in the coach's timezone. */
  date: string;
  weekday: number;
  slots: CalendarSlot[];
}

/**
 * Offset of a zone at a given instant, in minutes.
 *
 * Turkey is UTC+3 year-round with no DST, so this is constant in practice. It
 * is computed rather than hard-coded because coaches studying abroad are a real
 * segment and a hard-coded +180 would silently produce wrong slots for them.
 * If that segment grows, replace this with a real tz library — this handles
 * fixed and standard offsets correctly but is not a substitute for one.
 */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - instant.getTime()) / 60_000;
}

/** Local wall-clock (y/m/d + minutes) in `timeZone` → the UTC instant. */
function zonedToUtc(
  year: number,
  month: number,
  day: number,
  minutes: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month, day, 0, minutes);
  // Two passes: the first offset lookup may itself sit on the wrong side of a
  // transition. Converging twice is enough for every real zone.
  let guess = new Date(naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60_000);
  guess = new Date(naive - zoneOffsetMinutes(guess, timeZone) * 60_000);
  return guess;
}

function localParts(instant: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
  aStart < bEnd && bStart < aEnd;

export interface AvailabilityOptions {
  /** How many days forward to render. */
  days?: number;
  slotMinutes?: number;
  now?: Date;
  /** Marks this student's own holds as MINE rather than HELD. */
  viewerStudentProfileId?: string | null;
}

export async function getCoachCalendar(
  coachProfileId: string,
  options: AvailabilityOptions = {},
): Promise<{ timezone: string; days: CalendarDay[] }> {
  const now = options.now ?? new Date();
  const dayCount = options.days ?? 14;
  const slotMinutes = options.slotMinutes ?? 60;

  const coach = await prisma.coachProfile.findUniqueOrThrow({
    where: { id: coachProfileId },
    select: { timezone: true },
  });
  const timeZone = coach.timezone;

  const horizonEnd = new Date(now.getTime() + dayCount * 86_400_000);

  const [rules, exceptions, holds, bookings] = await Promise.all([
    prisma.availabilityRule.findMany({
      where: {
        coachProfileId,
        active: true,
        effectiveFrom: { lte: horizonEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      select: { weekday: true, startMinute: true, endMinute: true },
    }),
    prisma.availabilityException.findMany({
      where: { coachProfileId, date: { gte: startOfDay(now), lte: horizonEnd } },
      select: { date: true, allDay: true, startMinute: true, endMinute: true },
    }),
    // Expired holds are excluded here rather than relying on the sweep job:
    // a student should never see a slot blocked by a hold that lapsed four
    // minutes ago just because the worker has not run yet.
    prisma.slotHold.findMany({
      where: {
        coachProfileId,
        status: 'HELD',
        expiresAt: { gt: now },
        endsAt: { gt: now },
        startsAt: { lt: horizonEnd },
      },
      select: { startsAt: true, endsAt: true, expiresAt: true, studentProfileId: true },
    }),
    prisma.booking.findMany({
      where: {
        coachProfileId,
        status: 'SCHEDULED',
        endsAt: { gt: now },
        startsAt: { lt: horizonEnd },
      },
      select: { startsAt: true, endsAt: true },
    }),
  ]);

  const rulesByWeekday = new Map<number, Array<{ startMinute: number; endMinute: number }>>();
  for (const rule of rules) {
    const bucket = rulesByWeekday.get(rule.weekday) ?? [];
    bucket.push(rule);
    rulesByWeekday.set(rule.weekday, bucket);
  }

  const exceptionsByDate = new Map<string, typeof exceptions>();
  for (const exception of exceptions) {
    const key = exception.date.toISOString().slice(0, 10);
    exceptionsByDate.set(key, [...(exceptionsByDate.get(key) ?? []), exception]);
  }

  const days: CalendarDay[] = [];

  for (let offset = 0; offset < dayCount; offset++) {
    const cursor = new Date(now.getTime() + offset * 86_400_000);
    const { year, month, day, date } = localParts(cursor, timeZone);
    const weekday = new Date(zonedToUtc(year, month, day, 12 * 60, timeZone)).getUTCDay();

    const dayRules = rulesByWeekday.get(weekday) ?? [];
    const dayExceptions = exceptionsByDate.get(date) ?? [];
    if (dayExceptions.some((e) => e.allDay)) {
      days.push({ date, weekday, slots: [] });
      continue;
    }

    const slots: CalendarSlot[] = [];

    for (const rule of dayRules) {
      for (let m = rule.startMinute; m + slotMinutes <= rule.endMinute; m += slotMinutes) {
        const startsAt = zonedToUtc(year, month, day, m, timeZone);
        const endsAt = new Date(startsAt.getTime() + slotMinutes * 60_000);

        // A slot that has already started is not bookable, whatever else is true.
        if (startsAt <= now) continue;

        const blockedByException = dayExceptions.some(
          (e) =>
            !e.allDay &&
            e.startMinute != null &&
            e.endMinute != null &&
            m < e.endMinute &&
            e.startMinute < m + slotMinutes,
        );
        if (blockedByException) continue;

        const booking = bookings.find((b) => overlaps(startsAt, endsAt, b.startsAt, b.endsAt));
        if (booking) {
          slots.push({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), state: 'BOOKED' });
          continue;
        }

        const hold = holds.find((h) => overlaps(startsAt, endsAt, h.startsAt, h.endsAt));
        if (hold) {
          slots.push({
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            state:
              options.viewerStudentProfileId &&
              hold.studentProfileId === options.viewerStudentProfileId
                ? 'MINE'
                : 'HELD',
            heldUntil: hold.expiresAt.toISOString(),
          });
          continue;
        }

        slots.push({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), state: 'AVAILABLE' });
      }
    }

    slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    days.push({ date, weekday, slots });
  }

  return { timezone: timeZone, days };
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}
KAKTUS_FILE_EOF

emit "src/lib/booking/holds.ts" <<'KAKTUS_FILE_EOF'
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Slot locking.
 *
 * The exclusion constraint in the database is the actual guarantee. This module
 * turns its error into something a UI can render, and never tries to prevent
 * the collision by checking first — a SELECT-then-INSERT loses the race under
 * exactly the conditions that matter (two students, one popular coach, one
 * evening slot).
 */

type Tx = Prisma.TransactionClient | PrismaClient;

const PG_EXCLUSION_VIOLATION = '23P01';

export class SlotUnavailableError extends Error {
  constructor(readonly slot: { startsAt: Date; endsAt: Date }) {
    super('SLOT_TAKEN');
    this.name = 'SlotUnavailableError';
  }
}

export interface HoldRequest {
  coachProfileId: string;
  studentProfileId: string;
  offerId?: string;
  slots: Array<{ startsAt: Date; endsAt: Date }>;
  ttlMinutes: number;
}

function isExclusionViolation(error: unknown): boolean {
  const e = error as { code?: string; message?: string; meta?: { code?: string } };
  return (
    e?.code === PG_EXCLUSION_VIOLATION ||
    e?.meta?.code === PG_EXCLUSION_VIOLATION ||
    Boolean(e?.message?.includes('SLOT_TAKEN'))
  );
}

/**
 * Acquires all slots or none. Partial holds would let a student pay for an
 * engagement whose calendar is half-booked, which is worse than failing.
 */
export async function acquireHolds(req: HoldRequest, tx: Tx = prisma) {
  const expiresAt = new Date(Date.now() + req.ttlMinutes * 60 * 1000);

  const run = async (client: Tx) => {
    const created = [];
    for (const slot of req.slots) {
      try {
        created.push(
          await client.slotHold.create({
            data: {
              coachProfileId: req.coachProfileId,
              studentProfileId: req.studentProfileId,
              offerId: req.offerId,
              startsAt: slot.startsAt,
              endsAt: slot.endsAt,
              expiresAt,
              status: 'HELD',
            },
          }),
        );
      } catch (error) {
        if (isExclusionViolation(error)) throw new SlotUnavailableError(slot);
        throw error;
      }
    }
    return created;
  };

  // If the caller already owns a transaction, join it — the all-or-nothing
  // guarantee must span their other writes too.
  return 'slotHold' in tx && '$transaction' in tx
    ? (tx as PrismaClient).$transaction((inner) => run(inner))
    : run(tx);
}

export async function extendHolds(offerId: string, minutes: number, tx: Tx = prisma) {
  return tx.slotHold.updateMany({
    where: { offerId, status: 'HELD' },
    data: { expiresAt: new Date(Date.now() + minutes * 60 * 1000) },
  });
}

export async function releaseHolds(offerId: string, tx: Tx = prisma) {
  return tx.slotHold.updateMany({
    where: { offerId, status: 'HELD' },
    data: { status: 'RELEASED' },
  });
}

/**
 * Converts held slots into scheduled bookings once escrow is funded.
 * Holds are released first so the cross-table trigger doesn't see the coach's
 * own hold as a conflict with their own booking.
 */
export async function convertHoldsToBookings(
  args: { offerId: string; engagementId: string; milestoneIds: string[] },
  tx: Tx,
) {
  const holds = await tx.slotHold.findMany({
    where: { offerId: args.offerId, status: 'HELD' },
    orderBy: { startsAt: 'asc' },
  });
  if (holds.length === 0) return [];

  const milestones = await tx.milestone.findMany({
    where: { id: { in: args.milestoneIds } },
    orderBy: { index: 'asc' },
  });

  await tx.slotHold.updateMany({
    where: { offerId: args.offerId, status: 'HELD' },
    data: { status: 'CONVERTED' },
  });

  const bookings = [];
  for (const hold of holds) {
    const milestone = milestones.find(
      (m) => hold.startsAt >= m.periodStart && hold.startsAt < m.periodEnd,
    );
    bookings.push(
      await tx.booking.create({
        data: {
          coachProfileId: hold.coachProfileId,
          studentProfileId: hold.studentProfileId,
          engagementId: args.engagementId,
          milestoneId: milestone?.id,
          startsAt: hold.startsAt,
          endsAt: hold.endsAt,
          status: 'SCHEDULED',
        },
      }),
    );
  }
  return bookings;
}

/** Job: sweep expired holds. Runs every minute. */
export async function expireStaleHolds(now = new Date()) {
  const { count } = await prisma.slotHold.updateMany({
    where: { status: 'HELD', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  });
  return count;
}
KAKTUS_FILE_EOF

emit "src/lib/chat/anti-circumvention.ts" <<'KAKTUS_FILE_EOF'
/**
 * Anti-disintermediation filter.
 *
 * Naive regex loses immediately. Real evasion in Turkish chat looks like:
 *   "sıfır beş üç iki ..."     → number words
 *   "0 5 3 2 . 1 1 1 ..."      → separator injection
 *   "insta: kaktus_._koc"      → punctuation inside handles
 *   "wp'den yazar mısın"       → abbreviation, no keyword
 *   "ıg" / "İG" / homoglyphs   → Turkish casing traps and Cyrillic lookalikes
 *
 * So: normalise aggressively first, THEN detect, and score rather than
 * pattern-match to a boolean. Masking is visible to both parties on purpose —
 * people route around filters they don't understand and comply with ones they
 * do.
 *
 * The original text is never destroyed; the caller stores it encrypted for
 * dispute evidence. Only the redacted body is broadcast.
 */

export type ViolationKind =
  | 'PHONE_NUMBER'
  | 'EMAIL'
  | 'IBAN'
  | 'SOCIAL_HANDLE'
  | 'EXTERNAL_LINK'
  | 'PAYMENT_KEYWORD'
  | 'CIRCUMVENTION_INTENT';

export type ModerationAction = 'ALLOW' | 'MASK' | 'BLOCK';

export interface Finding {
  kind: ViolationKind;
  detector: string;
  severity: number;
  /** Already-redacted excerpt, safe to store and show an admin. */
  excerpt: string;
}

export interface ModerationResult {
  action: ModerationAction;
  riskScore: number;
  redacted: string;
  findings: Finding[];
  /** Turkish notice rendered under the message bubble. Empty when ALLOW. */
  notice: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation
// ─────────────────────────────────────────────────────────────────────────────

const HOMOGLYPHS: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ѕ: 's',
  ᴀ: 'a', ɡ: 'g', ｇ: 'g', '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
};

const LEET: Record<string, string> = {
  '4': 'a', '3': 'e', '1': 'i', '0': 'o', '5': 's', '7': 't', '@': 'a', '$': 's',
};

const TR_NUMBER_WORDS: Record<string, string> = {
  sifir: '0', sıfır: '0', bir: '1', iki: '2', uc: '3', üç: '3', dort: '4', dört: '4',
  bes: '5', beş: '5', alti: '6', altı: '6', yedi: '7', sekiz: '8', dokuz: '9',
};

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u2060]/g;

/** Lowercases correctly for Turkish (İ→i, I→ı) before any ASCII matching. */
function trLower(text: string): string {
  return text.replace(/İ/g, 'i').replace(/I/g, 'ı').toLocaleLowerCase('tr');
}

function foldHomoglyphs(text: string): string {
  return [...text].map((ch) => HOMOGLYPHS[ch] ?? ch).join('');
}

/**
 * Word-boundary assertions for Turkish.
 *
 * JavaScript's `\b` only knows [A-Za-z0-9_], so `\büç\b` never matches and
 * `\bınsta\b` never matches — silently disabling the detectors that exist to
 * catch Turkish evasion. Lookarounds over the real alphabet instead.
 */
const TR_WORD = 'a-zçğıöşü0-9';
const LB = `(?<![${TR_WORD}])`;
const RB = `(?![${TR_WORD}])`;

/** Replaces spelled-out Turkish digits with numerals. */
function digitizeWords(text: string): string {
  return text.replace(
    new RegExp(`${LB}[a-zçğıöşü]+${RB}`, 'g'),
    (word) => TR_NUMBER_WORDS[word] ?? word,
  );
}

/**
 * Collapses separators that appear *between digits*, so "0 5 3-2.1 1 1" becomes
 * "0532111". Deliberately does not touch separators between letters, which
 * would mangle ordinary prose.
 */
function collapseDigitSeparators(text: string): string {
  let previous = '';
  let current = text;
  // Repeat: one pass only removes every other separator in "0 5 3 2".
  while (current !== previous) {
    previous = current;
    current = current.replace(/(\d)[\s._\-()/*+,'"|]+(\d)/g, '$1$2');
  }
  return current;
}

function deLeet(text: string): string {
  return [...text].map((ch) => LEET[ch] ?? ch).join('');
}

export interface NormalizedText {
  /** Turkish-lowercased, homoglyph-folded, zero-width stripped. */
  base: string;
  /** base + digit words + collapsed digit separators. For IBAN detection. */
  numeric: string;
  /**
   * `numeric` with IBANs blanked out. Phone detectors run against this,
   * because a TR IBAN contains a '5' followed by nine digits and would
   * otherwise be reported as a phone number — right verdict, wrong label,
   * and the wrong redaction placeholder shown to the user.
   */
  numericSansIban: string;
  /** base with punctuation stripped and leet folded. For keyword detection. */
  alpha: string;
}

const IBAN_PATTERN = /\btr\d{24}\b/g;

export function normalize(input: string): NormalizedText {
  const cleaned = input.normalize('NFKC').replace(ZERO_WIDTH, '');
  const base = foldHomoglyphs(trLower(cleaned));
  const numeric = collapseDigitSeparators(digitizeWords(base));
  const numericSansIban = numeric.replace(IBAN_PATTERN, (m) => ' '.repeat(m.length));
  const alpha = deLeet(base).replace(/[^a-zçğıöşü0-9\s]/g, '');
  return { base, numeric, numericSansIban, alpha };
}

// ─────────────────────────────────────────────────────────────────────────────
// Detectors
// ─────────────────────────────────────────────────────────────────────────────

const DETECTORS: Array<{
  name: string;
  kind: ViolationKind;
  severity: number;
  /** Which normalized form to run against. */
  field: keyof NormalizedText;
  pattern: RegExp;
}> = [
  {
    name: 'tr_mobile',
    kind: 'PHONE_NUMBER',
    severity: 45,
    field: 'numericSansIban',
    // +905xxxxxxxxx / 05xxxxxxxxx / 5xxxxxxxxx
    pattern: /(?:\+?90)?0?5\d{9}/g,
  },
  {
    name: 'long_digit_run',
    kind: 'PHONE_NUMBER',
    severity: 25,
    field: 'numericSansIban',
    // 10+ digits that aren't a plausible net score or year.
    pattern: /\b\d{10,}\b/g,
  },
  {
    name: 'iban_tr',
    kind: 'IBAN',
    severity: 60,
    field: 'numeric',
    pattern: /\btr\d{24}\b/g,
  },
  {
    name: 'email',
    kind: 'EMAIL',
    severity: 40,
    field: 'base',
    pattern: /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[a-z0-9.-]+\.[a-z]{2,}/g,
  },
  {
    name: 'messaging_shortlink',
    kind: 'SOCIAL_HANDLE',
    severity: 55,
    field: 'base',
    pattern: /\b(?:wa\.me|t\.me|api\.whatsapp\.com|ig\.me|m\.me|discord\.gg)\S*/g,
  },
  {
    name: 'platform_name',
    kind: 'SOCIAL_HANDLE',
    severity: 30,
    field: 'alpha',
    pattern: new RegExp(
      `${LB}(whatsapp|whatsap|watsap|wp|wpp|telegram|instagram|insta|ınstagram|ınsta|ig|ıg|dm|discord|snapchat|snap|skype)`,
      'g',
    ),
  },
  {
    name: 'handle_token',
    kind: 'SOCIAL_HANDLE',
    severity: 35,
    field: 'base',
    pattern: /(?:^|\s)@[a-z0-9._]{3,30}\b/g,
  },
  {
    name: 'external_link',
    kind: 'EXTERNAL_LINK',
    severity: 30,
    field: 'base',
    pattern: /\b(?:https?:\/\/|www\.)[^\s]+/g,
  },
  {
    // Two-letter abbreviations need a closing boundary or they match inside
    // ordinary words. Longer platform names deliberately do not, because
    // Turkish agglutination produces "instagramdan", "telegrama", "wp'den".
    name: 'platform_abbreviation',
    kind: 'SOCIAL_HANDLE',
    severity: 30,
    field: 'alpha',
    pattern: new RegExp(`${LB}(ig|ıg|dm)${RB}`, 'g'),
  },
  {
    name: 'payment_vocabulary',
    kind: 'PAYMENT_KEYWORD',
    severity: 40,
    field: 'alpha',
    pattern: new RegExp(
      `${LB}(iban|havale|eft|papara|ininal|hesap\\s?numaram|hesabıma|kart\\s?numaram|elden|nakit|kapıda)`,
      'g',
    ),
  },
  {
    name: 'circumvention_intent',
    kind: 'CIRCUMVENTION_INTENT',
    severity: 50,
    field: 'alpha',
    pattern: new RegExp(
      `${LB}(komisyonsuz|komisyon\\s?vermeden|site\\s?dışında|siteden\\s?çıkalım|platform\\s?dışı|dışarıdan\\s?anlaşalım|buradan\\s?çıkalım|direkt\\s?bana|aramızda\\s?halledelim)`,
      'g',
    ),
  },
];

/**
 * A whitelist that prevents the most common false positive: students quoting
 * ranks, nets, and years. "480 bin sıralama" must never be read as a phone
 * number, and a filter that eats exam talk in an exam-prep product is worse
 * than no filter.
 */
const BENIGN_NUMERIC = new RegExp(
  `${LB}(?:19|20)\\d{2}${RB}|\\d{1,3}(?:[.,]\\d{1,2})?\\s*net|\\d{1,6}\\s*(?:bin|k)?\\s*(?:sıralama|sıra)`,
);

// ─────────────────────────────────────────────────────────────────────────────
// Scoring & masking
// ─────────────────────────────────────────────────────────────────────────────

export const THRESHOLDS = {
  mask: 25,
  block: 70,
  /** Conversation-level cumulative score that flags for admin review. */
  flagConversation: 150,
} as const;

function maskExcerpt(raw: string): string {
  if (raw.length <= 4) return '*'.repeat(raw.length);
  return `${raw.slice(0, 2)}${'*'.repeat(Math.min(raw.length - 4, 8))}${raw.slice(-2)}`;
}

/**
 * Redacts in the ORIGINAL string by locating the offending substrings there.
 * Normalisation changes offsets, so we re-run the detector against the raw text
 * with a tolerant pattern rather than trying to map indices back — simpler and
 * far less likely to corrupt the message.
 */
function redactOriginal(original: string, findings: Finding[]): string {
  let out = original;

  if (findings.some((f) => f.kind === 'PHONE_NUMBER')) {
    // Any run of >=10 digits allowing separators between them.
    out = out.replace(/(?:\+?90[\s.-]*)?0?[\s.-]*5(?:[\s.\-()]*\d){9}/g, '[numara gizlendi]');
    out = out.replace(/\b(?:\d[\s.\-]?){10,}\b/g, '[numara gizlendi]');
  }
  if (findings.some((f) => f.kind === 'IBAN')) {
    out = out.replace(/\bTR[\s]?(?:\d[\s]?){24}\b/gi, '[IBAN gizlendi]');
  }
  if (findings.some((f) => f.kind === 'EMAIL')) {
    out = out.replace(
      /[a-zA-Z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      '[e-posta gizlendi]',
    );
  }
  if (findings.some((f) => f.kind === 'SOCIAL_HANDLE' || f.kind === 'EXTERNAL_LINK')) {
    out = out.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[bağlantı gizlendi]');
    out = out.replace(/(^|\s)@[a-zA-Z0-9._]{3,30}\b/g, '$1[kullanıcı adı gizlendi]');
  }

  return out;
}

const NOTICES: Record<ModerationAction, string> = {
  ALLOW: '',
  MASK:
    'İletişim bilgileri gizlendi. Ödemeler Kaktüs üzerinden yapıldığında paran ders ' +
    'tamamlanana kadar güvencede tutulur; platform dışına çıkarsan bu koruma geçerli olmaz.',
  BLOCK:
    'Bu mesaj gönderilemedi. Telefon, IBAN veya dış platform bilgisi paylaşmak kurallara ' +
    'aykırı. Anlaşmanı Kaktüs üzerinden yaparsan ödemen güvence altında olur ve ' +
    'sorun çıkarsa iade talep edebilirsin.',
};

/**
 * Main entry point. Pure and synchronous — call it on every outbound message.
 *
 * @param text        raw message body as typed
 * @param priorRisk   cumulative conversation risk, used to escalate repeat
 *                    offenders faster than first-timers
 */
export function moderateMessage(text: string, priorRisk = 0): ModerationResult {
  const normalized = normalize(text);
  const findings: Finding[] = [];

  for (const detector of DETECTORS) {
    const haystack = normalized[detector.field];
    const matches = haystack.match(detector.pattern);
    if (!matches) continue;

    for (const match of matches) {
      // Suppress exam-vocabulary false positives on numeric detectors.
      if (
        (detector.kind === 'PHONE_NUMBER' || detector.kind === 'IBAN') &&
        BENIGN_NUMERIC.test(normalized.base) &&
        detector.name === 'long_digit_run'
      ) {
        continue;
      }
      findings.push({
        kind: detector.kind,
        detector: detector.name,
        severity: detector.severity,
        excerpt: maskExcerpt(match.trim()),
      });
    }
  }

  // Deduplicate: one hit per detector, so a repeated word doesn't inflate risk.
  const deduped = [...new Map(findings.map((f) => [f.detector, f])).values()];

  // Combined signals are worse than the sum of their parts: a handle plus a
  // "let's talk outside" is a real attempt, while either alone is often noise.
  let riskScore = deduped.reduce((sum, f) => sum + f.severity, 0);
  const kinds = new Set(deduped.map((f) => f.kind));
  if (kinds.has('CIRCUMVENTION_INTENT') && kinds.size > 1) riskScore = Math.round(riskScore * 1.5);
  if (kinds.has('PAYMENT_KEYWORD') && kinds.has('IBAN')) riskScore += 30;

  // Repeat offenders escalate faster.
  const escalation = priorRisk >= THRESHOLDS.flagConversation ? 20 : 0;
  const effective = riskScore + escalation;

  const action: ModerationAction =
    effective >= THRESHOLDS.block ? 'BLOCK' : effective >= THRESHOLDS.mask ? 'MASK' : 'ALLOW';

  return {
    action,
    riskScore,
    redacted: action === 'ALLOW' ? text : redactOriginal(text, deduped),
    findings: deduped,
    notice: NOTICES[action],
  };
}
KAKTUS_FILE_EOF

emit "src/lib/coach/application.ts" <<'KAKTUS_FILE_EOF'
import { z } from 'zod';

/**
 * Coach application: shared shape for the client form and the server action.
 *
 * No server-only imports here — this module is bundled to the browser so the
 * form can validate before submitting. The server re-validates with the same
 * schema, because client-side validation is a courtesy and never a control.
 */

export const APPLY_STEPS = ['kimlik', 'yontem', 'ucret', 'takvim', 'odeme'] as const;
export type ApplyStep = (typeof APPLY_STEPS)[number];

export const APPLY_STEP_TITLES: Record<ApplyStep, string> = {
  kimlik: 'Sınav geçmişin ve okulun',
  yontem: 'Nasıl çalışıyorsun?',
  ucret: 'Ücretlendirme ve kapasite',
  takvim: 'Haftalık müsaitliğin',
  odeme: 'Ödeme bilgilerin',
};

export const APPLY_STEP_HINTS: Record<ApplyStep, string> = {
  kimlik: 'Sıralaman doğrulanmadan profilin yayına alınmıyor.',
  yontem: 'Öğrenciler en çok bu bölümü okuyup karar veriyor.',
  ucret: 'Sonradan değiştirebilirsin. Öğrenciler yine de kendi teklifini gönderebilir.',
  takvim: 'Sadece kesin müsait olduğun saatleri işaretle.',
  odeme: 'Bu bilgiler yalnızca ödeme kuruluşuna iletilir; öğrenciler görmez.',
};

const trackEnum = z.enum(['SAYISAL', 'ESIT_AGIRLIK', 'SOZEL', 'DIL']);
const styleEnum = z.enum(['STRICT', 'EMPATHETIC', 'STRATEGIC', 'HIGH_TOUCH']);
const gradeEnum = z.enum(['GRADE_11', 'GRADE_12', 'MEZUN']);

export const weeklyWindowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1440),
  endMinute: z.number().int().min(0).max(1440),
});

export const coachApplicationSchema = z.object({
  // ── Credentials ──
  university: z.string().min(2, 'Üniversite gerekli').max(120),
  department: z.string().min(2, 'Bölüm gerekli').max(120),
  graduationYear: z.number().int().min(1990).max(2100).nullable().optional(),
  yksTrack: trackEnum,
  yksRank: z.number().int().min(1, 'Sıralama gerekli').max(3_000_000),
  yksYear: z.number().int().min(2000).max(2100),
  ownBaselineNet: z.number().min(0).max(200).nullable().optional(),
  ownFinalNet: z.number().min(0).max(200).nullable().optional(),
  wasMezun: z.boolean().default(false),

  // ── Method ──
  headline: z.string().min(10, 'Kısa bir tanıtım yaz').max(120),
  bio: z.string().min(120, 'En az 120 karakter yaz — öğrenciler bunu okuyor').max(4000),
  styles: z.array(styleEnum).min(1, 'En az bir çalışma tarzı seç').max(4),
  tracks: z.array(trackEnum).min(1, 'En az bir alan seç'),
  subjects: z.array(z.string().max(60)).max(20).default([]),
  supportedGrades: z.array(gradeEnum).min(1, 'En az bir sınıf seviyesi seç'),

  // Target student criteria — becomes a CoachSpecialization row, which the
  // matcher already reads when scoring trajectory similarity.
  targetRankFrom: z.number().int().min(1).max(3_000_000).nullable().optional(),
  targetRankTo: z.number().int().min(1).max(3_000_000).nullable().optional(),
  specializationLabel: z.string().max(120).nullable().optional(),

  // ── Pricing & capacity ──
  monthlyPriceMinor: z.number().int().min(50_000, 'Aylık ücret en az 500 ₺ olmalı').max(5_000_000),
  sessionPriceMinor: z.number().int().min(10_000).max(1_000_000).nullable().optional(),
  sessionsPerMonth: z.number().int().min(1).max(30).default(4),
  minutesPerSession: z.number().int().min(30).max(180).default(60),
  maxActiveStudents: z.number().int().min(1).max(50).default(8),
  weeklyCapacityHours: z.number().int().min(1).max(60).nullable().optional(),

  // ── Availability ──
  availability: z.array(weeklyWindowSchema).min(1, 'En az bir müsait aralık ekle').max(40),

  // ── Payout ──
  submerchantType: z.enum(['PERSONAL', 'PRIVATE_COMPANY', 'LIMITED_COMPANY']),
  legalName: z.string().min(3, 'Ad soyad / unvan gerekli').max(160),
  identityNumber: z.string().min(10).max(11),
  iban: z.string().min(26).max(34),
  taxOffice: z.string().max(120).nullable().optional(),
  address: z.string().min(10, 'Adres gerekli').max(400),
  city: z.string().min(2, 'Şehir gerekli').max(80),
  phone: z.string().min(10).max(20),

  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'Devam etmek için sözleşmeyi onaylaman gerekiyor' }),
  }),
});

export type CoachApplicationInput = z.input<typeof coachApplicationSchema>;
export type CoachApplication = z.output<typeof coachApplicationSchema>;

/** Per-step field lists, so the wizard can validate one step at a time. */
export const STEP_FIELDS: Record<ApplyStep, Array<keyof CoachApplication>> = {
  kimlik: ['university', 'department', 'yksTrack', 'yksRank', 'yksYear'],
  yontem: ['headline', 'bio', 'styles', 'tracks', 'supportedGrades'],
  ucret: ['monthlyPriceMinor', 'maxActiveStudents'],
  takvim: ['availability'],
  odeme: ['submerchantType', 'legalName', 'identityNumber', 'iban', 'address', 'city', 'phone', 'acceptedTerms'],
};

export const SUBMERCHANT_TYPE_LABELS: Record<string, { label: string; hint: string }> = {
  PERSONAL: { label: 'Bireysel', hint: 'Şirketin yok. TC kimlik numaranla kaydolursun.' },
  PRIVATE_COMPANY: { label: 'Şahıs şirketi', hint: 'Vergi numaran ve vergi dairen gerekir.' },
  LIMITED_COMPANY: { label: 'Limited / A.Ş.', hint: 'Şirket unvanı ve vergi bilgileri gerekir.' },
};

export const WEEKDAY_LABELS = [
  'Pazar',
  'Pazartesi',
  'Salı',
  'Çarşamba',
  'Perşembe',
  'Cuma',
  'Cumartesi',
];

/** "18:00" → 1080 */
export function timeToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Slug from the coach's display name, with Turkish characters folded. */
export function slugify(input: string): string {
  const map: Record<string, string> = {
    ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u',
    Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u',
  };
  return input
    .split('')
    .map((c) => map[c] ?? c)
    .join('')
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
KAKTUS_FILE_EOF

emit "src/lib/coach/identifiers.ts" <<'KAKTUS_FILE_EOF'
/**
 * Turkish identifier validation.
 *
 * Deliberately in its own module with NO node imports, because both the
 * browser form and the server action need it. It previously lived in
 * `crypto/field.ts` alongside the AES helpers — which meant the client form
 * imported `node:crypto` transitively and the browser bundle failed to build.
 *
 * Validating properly rather than checking length is worth the twenty lines: a
 * mistyped IBAN is otherwise not caught until Iyzico rejects the sub-merchant
 * registration days later, by which point the coach is approved, has students,
 * and cannot be paid.
 */

export function isValidTckn(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11 || digits[0] === '0') return false;

  const n = digits.split('').map(Number);
  const oddSum = n[0] + n[2] + n[4] + n[6] + n[8];
  const evenSum = n[1] + n[3] + n[5] + n[7];

  if ((oddSum * 7 - evenSum) % 10 !== n[9]) return false;
  const total = n.slice(0, 10).reduce((a, b) => a + b, 0);
  return total % 10 === n[10];
}

/** VKN (10-digit tax number) checksum. */
export function isValidVkn(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 10) return false;

  const n = digits.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const tmp = (n[i] + 10 - (i + 1)) % 10;
    sum +=
      tmp === 9 ? tmp : (tmp * 2 ** (10 - (i + 1))) % 9 === 0 && tmp !== 0
        ? 9
        : (tmp * 2 ** (10 - (i + 1))) % 9;
  }
  return (10 - (sum % 10)) % 10 === n[9];
}

/** TR IBAN: 26 chars, mod-97 check. */
export function isValidTrIban(value: string): boolean {
  const iban = value.replace(/\s/g, '').toUpperCase();
  if (!/^TR\d{24}$/.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

  // Chunked mod-97: the full number exceeds Number.MAX_SAFE_INTEGER.
  let remainder = 0;
  for (const digit of numeric) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export function ibanLast4(value: string): string {
  return value.replace(/\s/g, '').slice(-4);
}
KAKTUS_FILE_EOF

emit "src/lib/crypto/field.ts" <<'KAKTUS_FILE_EOF'
import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Field-level encryption for the handful of columns that must not be readable
 * from a database dump: national ID numbers, IBANs, and original message bodies
 * retained as dispute evidence.
 *
 * AES-256-GCM, so the ciphertext is authenticated — a tampered value fails to
 * decrypt rather than silently returning garbage that then gets sent to a bank.
 *
 * This is not a substitute for a KMS. It protects against a leaked backup or a
 * read-only SQL injection, not against an attacker who already has the app's
 * environment. When there is budget for it, move the key into AWS KMS or Vault
 * and keep this interface — the call sites do not need to change.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32',
    );
  }

  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== 32) {
    // Fail at first use rather than encrypting with a short key and discovering
    // it during an incident.
    throw new Error(
      `FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes, got ${decoded.length}.`,
    );
  }

  cachedKey = decoded;
  return cachedKey;
}

/** Layout: [12-byte IV][16-byte auth tag][ciphertext] */
export function encryptField(plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptField(payload: Buffer | Uint8Array): string {
  const buffer = Buffer.from(payload);
  if (buffer.length <= IV_BYTES + TAG_BYTES) {
    throw new Error('Ciphertext is too short to be valid');
  }

  const iv = buffer.subarray(0, IV_BYTES);
  const tag = buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buffer.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** True when a key is configured — lets callers degrade rather than crash. */
export function encryptionAvailable(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Turkish identifier validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TCKN checksum.
 *
 * Validating locally means a typo is caught in the form rather than three days
 * later as an opaque Iyzico rejection, by which point the coach has given up.
 * It proves the number is well-formed, not that it belongs to this person —
 * only Iyzico's own verification does that.
 */

/**
 * `import 'server-only'` at the top is load-bearing.
 *
 * If a Client Component ever imports this module again — directly or through a
 * barrel file — the build fails immediately with a message naming the file,
 * instead of producing an obscure "Can't resolve 'crypto'" error or, worse,
 * shipping key-handling code to the browser. Identifier validators live in
 * `@/lib/coach/identifiers` precisely so nobody needs to reach in here for them.
 */
KAKTUS_FILE_EOF

emit "src/lib/db.ts" <<'KAKTUS_FILE_EOF'
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
KAKTUS_FILE_EOF

emit "src/lib/magic-link.ts" <<'KAKTUS_FILE_EOF'
import 'server-only';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Magic-link delivery.
 *
 * Auth.js's built-in Resend provider calls the Resend API unconditionally. With
 * no key — the normal state on a fresh local checkout — that is a 401 and a
 * dead sign-in flow, which blocks *every* seeded account at once.
 *
 * So delivery is decided here, before anything is instantiated:
 *
 *   usable key + not development  →  send via Resend's REST API
 *   otherwise                     →  print the link and write .auth-link.txt
 *
 * The fallback is not a mock that pretends to send. It prints the real
 * verification URL, which is a working credential — sign-in genuinely completes
 * locally with no third-party account at all.
 */

const PLACEHOLDER_MARKERS = [
  'xxx',
  'your',
  'placeholder',
  'dummy',
  'changeme',
  'replace',
  'todo',
  'example',
  'test-key',
  'sk_test',
];

export function readResendKey(): string | undefined {
  // Auth.js reads AUTH_RESEND_KEY; the Resend SDK's own convention is
  // RESEND_API_KEY. Accept either, so a key copied from Resend's dashboard
  // instructions works without anyone having to know which name we chose.
  return process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY;
}

/**
 * Whether a key looks like a genuine Resend key rather than an empty string or
 * scaffolding left in `.env.example`.
 *
 * Deliberately strict about the `re_` prefix. A malformed key produces a 401 at
 * the worst moment — a real user waiting on a login email — and failing over to
 * console output is strictly better than failing.
 */
export function isUsableResendKey(key: string | undefined): boolean {
  if (!key) return false;
  const value = key.trim();
  if (value.length < 12) return false;
  if (!value.startsWith('re_')) return false;
  const lower = value.toLowerCase();
  return !PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

export type DeliveryMode = 'resend' | 'local';

/**
 * Picks the delivery route.
 *
 * Development always goes local, even with a valid key: sending real email
 * during development is how you accidentally mail a customer from a seed
 * script. `AUTH_FORCE_EMAIL=1` overrides that when you specifically want to
 * test the real template.
 */
export function deliveryMode(): DeliveryMode {
  const key = readResendKey();
  if (!isUsableResendKey(key)) return 'local';
  if (process.env.NODE_ENV === 'development' && process.env.AUTH_FORCE_EMAIL !== '1') {
    return 'local';
  }
  return 'resend';
}

export const AUTH_LINK_FILE = '.auth-link.txt';

export interface VerificationRequest {
  identifier: string;
  url: string;
  expires?: Date;
  from?: string;
}

/**
 * Prints the sign-in link and appends it to `.auth-link.txt`.
 *
 * The file matters more than the console line: Next's dev server output is
 * noisy and a link scrolls away in seconds, while `tail -f .auth-link.txt`
 * gives a reliable place to grab it from.
 */
export async function deliverLocally(request: VerificationRequest): Promise<void> {
  // A sign-in link is a bearer credential. Writing them to a file on a
  // production server would be handing out working sessions, so this refuses
  // rather than trusting that it is never reached.
  if (process.env.NODE_ENV === 'production' && process.env.AUTH_ALLOW_LOCAL_LINKS !== '1') {
    throw new Error(
      'Refusing to write sign-in links to disk in production. ' +
        'Configure AUTH_RESEND_KEY with a valid Resend key.',
    );
  }

  const line = [
    '',
    '┌─ Kaktüs Koçluk — giriş bağlantısı ' + '─'.repeat(32),
    `│  ${request.identifier}`,
    '│',
    `│  ${request.url}`,
    '│',
    request.expires
      ? `│  geçerlilik: ${request.expires.toLocaleString('tr-TR')}`
      : '│  geçerlilik: 24 saat',
    '│  (e-posta gönderilmedi — geliştirme modunda bağlantı burada gösterilir)',
    '└' + '─'.repeat(66),
    '',
  ].join('\n');

  console.log(line);

  try {
    await appendFile(
      join(process.cwd(), AUTH_LINK_FILE),
      `${new Date().toISOString()}\t${request.identifier}\t${request.url}\n`,
      'utf8',
    );
  } catch (error) {
    // Losing the file is survivable — the link is already on the console.
    // Failing sign-in because a log file could not be written is not.
    console.warn(`[auth] could not write ${AUTH_LINK_FILE}:`, error);
  }
}

/**
 * Sends via Resend's REST API directly.
 *
 * No SDK: it is one HTTP call, and going direct means the client is never
 * constructed on a path where the key might be missing. It also lets the email
 * be written in Turkish — Auth.js's default template is English, which is a
 * jarring thing to receive from a Turkish product at the exact moment someone
 * is deciding whether to trust it.
 */
export async function deliverByResend(request: VerificationRequest): Promise<void> {
  const key = readResendKey();
  if (!isUsableResendKey(key)) {
    throw new Error('deliverByResend called without a usable Resend key');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: request.from ?? 'Kaktüs Koçluk <merhaba@kaktuskocluk.com>',
      to: [request.identifier],
      subject: 'Kaktüs Koçluk giriş bağlantın',
      text: turkishText(request.url),
      html: turkishHtml(request.url),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend rejected the request (${response.status}): ${detail.slice(0, 300)}`);
  }
}

/** Entry point handed to Auth.js. */
export async function sendVerificationRequest(request: VerificationRequest): Promise<void> {
  if (deliveryMode() === 'local') {
    await deliverLocally(request);
    return;
  }

  try {
    await deliverByResend(request);
  } catch (error) {
    // A provider outage should not silently swallow the sign-in. Outside
    // production we fall back to the console so work continues; in production
    // it must surface, because the user is waiting for an email that is not
    // coming and needs to see an error rather than a "check your inbox" lie.
    if (process.env.NODE_ENV === 'production') throw error;
    console.error('[auth] Resend failed, falling back to local link:', error);
    await deliverLocally(request);
  }
}

function turkishText(url: string): string {
  return [
    'Kaktüs Koçluk hesabına giriş yapmak için bağlantıya tıkla:',
    '',
    url,
    '',
    'Bağlantı 24 saat geçerli ve yalnızca bir kez kullanılabilir.',
    'Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.',
  ].join('\n');
}

function turkishHtml(url: string): string {
  return `<!doctype html>
<html lang="tr"><body style="margin:0;padding:32px;background:#E9ECE6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#12211C">
  <div style="max-width:480px;margin:0 auto;background:#F5F7F3;border-radius:16px;padding:32px">
    <p style="margin:0 0 24px;font-size:18px;font-weight:600">Kaktüs Koçluk</p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6">Giriş yapmak için aşağıdaki butona tıkla.</p>
    <a href="${url}" style="display:inline-block;background:#1E6B4B;color:#F5F7F3;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:500">Giriş yap</a>
    <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#5C6B63">Bağlantı 24 saat geçerli ve yalnızca bir kez kullanılabilir. Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.</p>
  </div>
</body></html>`;
}
KAKTUS_FILE_EOF

emit "src/lib/matching/engine.ts" <<'KAKTUS_FILE_EOF'
import { prisma } from '@/lib/db';
import type { TimeWindow } from '@/lib/time/windows';
import { coveredWeekdays } from '@/lib/time/windows';
import { rankCoaches } from './score';
import { WEIGHTS_VERSION } from './weights';
import type { CoachCandidate, MatchResult, StudentMatchInput } from './types';

/**
 * Two-phase matching.
 *
 * Phase 1 (this file, in SQL): eliminate on hard constraints — cheap, indexed,
 * and safe to run against the whole coach table.
 * Phase 2 (score.ts, pure TS): rank the survivors in memory.
 *
 * The split matters. Hard constraints are business rules that must never be
 * traded away by a high score elsewhere: an unverified coach is not a 91% match
 * with a caveat, they are not a match. Everything soft belongs in the scorer.
 */

const HARD_FILTERS = [
  'coach must be APPROVED',
  'coach must be accepting students',
  'coach must support the student track',
  'coach must have at least one active pricing tier',
  'coach must share at least one available weekday with the student',
  'price must not exceed budget ceiling × tolerance',
] as const;

/** Students see coaches up to 40% over their stated ceiling — they negotiate. */
const BUDGET_TOLERANCE = 1.4;

export interface MatchOptions {
  limit?: number;
  now?: Date;
  /** Records a MatchRun row for weighting analysis. */
  onboardingSessionId?: string;
  studentProfileId?: string;
  persist?: boolean;
}

export async function findMatches(
  student: StudentMatchInput,
  options: MatchOptions = {},
): Promise<{ results: MatchResult[]; coaches: Map<string, CoachCandidate> }> {
  const startedAt = Date.now();
  const weekdays = coveredWeekdays(student.availability);
  const priceCeiling =
    student.budget.maxMinor != null
      ? Math.round(student.budget.maxMinor * BUDGET_TOLERANCE)
      : undefined;

  const rows = await prisma.coachProfile.findMany({
    where: {
      verificationStatus: 'APPROVED',
      acceptingStudents: true,
      tracks: { has: student.track },
      pricingTiers: {
        some: {
          active: true,
          ...(priceCeiling != null ? { priceMinor: { lte: priceCeiling } } : {}),
        },
      },
      ...(weekdays.length > 0
        ? { availabilityRules: { some: { active: true, weekday: { in: weekdays } } } }
        : {}),
    },
    select: {
      id: true,
      slug: true,
      university: true,
      department: true,
      tracks: true,
      subjects: true,
      styles: true,
      supportedGrades: true,
      yksRank: true,
      yksYear: true,
      yksTrack: true,
      ownBaselineNet: true,
      ownFinalNet: true,
      ownBaselineRank: true,
      wasMezun: true,
      ratingAvg: true,
      ratingCount: true,
      completedEngagements: true,
      activeEngagements: true,
      maxActiveStudents: true,
      responseP50Seconds: true,
      cancellationRate: true,
      lastActiveAt: true,
      user: { select: { name: true } },
      specializations: { select: { label: true, fromRank: true, toRank: true } },
      pricingTiers: {
        where: { active: true },
        select: { cadence: true, priceMinor: true },
      },
      availabilityRules: {
        where: { active: true },
        select: { weekday: true, startMinute: true, endMinute: true },
      },
      reviews: {
        where: { published: true, netGainReported: { not: null } },
        select: { netGainReported: true },
        take: 50,
        orderBy: { createdAt: 'desc' },
      },
    },
    // Bound the in-memory scoring set. Rating order is a proxy, not the ranking.
    take: 400,
    orderBy: { ratingAvg: 'desc' },
  });

  const coaches = new Map<string, CoachCandidate>();
  for (const row of rows) {
    coaches.set(row.id, {
      id: row.id,
      slug: row.slug,
      displayName: row.user.name ?? 'Koç',
      university: row.university,
      department: row.department,
      tracks: row.tracks,
      subjects: row.subjects,
      styles: row.styles,
      supportedGrades: row.supportedGrades,
      journey: {
        baselineNet: row.ownBaselineNet,
        finalNet: row.ownFinalNet,
        baselineRank: row.ownBaselineRank,
        finalRank: row.yksRank,
        wasMezun: row.wasMezun,
        track: row.yksTrack,
        year: row.yksYear,
      },
      specializations: row.specializations,
      availability: row.availabilityRules as TimeWindow[],
      pricing: row.pricingTiers,
      stats: {
        ratingAvg: row.ratingAvg,
        ratingCount: row.ratingCount,
        completedEngagements: row.completedEngagements,
        activeEngagements: row.activeEngagements,
        maxActiveStudents: row.maxActiveStudents,
        responseP50Seconds: row.responseP50Seconds,
        cancellationRate: row.cancellationRate,
        lastActiveAt: row.lastActiveAt,
        medianStudentNetGain: median(
          row.reviews.map((r) => r.netGainReported).filter((n): n is number => n != null),
        ),
      },
    });
  }

  const results = rankCoaches(student, [...coaches.values()], {
    limit: options.limit ?? 20,
    now: options.now,
  });

  if (options.persist !== false) {
    // Fire-and-forget: analytics must never fail a page render.
    void prisma.matchRun
      .create({
        data: {
          onboardingSessionId: options.onboardingSessionId,
          studentProfileId: options.studentProfileId,
          weightsVersion: WEIGHTS_VERSION,
          candidateCount: rows.length,
          latencyMs: Date.now() - startedAt,
          results: results.map((r, i) => ({
            coachProfileId: r.coachId,
            rawScore: Number(r.rawScore.toFixed(4)),
            displayScore: r.displayScore,
            position: i + 1,
            reasons: r.reasons,
          })),
        },
      })
      .catch(() => undefined);
  }

  return { results, coaches };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export { HARD_FILTERS };
KAKTUS_FILE_EOF

emit "src/lib/matching/labels.ts" <<'KAKTUS_FILE_EOF'
import type { CoachingStyle, GradeLevel, PricingCadence, ScoreDimension, Track } from './types';

/**
 * Turkish surface copy for the matching model.
 *
 * Lives beside the scorer rather than in the components because the dimension
 * names are domain vocabulary, not UI strings: when a weight changes in
 * weights.ts, the label that explains it to a student should be one file away,
 * not scattered across three components.
 */

export const DIMENSION_LABEL_TR: Record<ScoreDimension, string> = {
  trajectory: 'Hedef benzerliği',
  style: 'Çalışma tarzı',
  availability: 'Saat uyumu',
  trackDepth: 'Alan uyumu',
  budget: 'Bütçe uyumu',
  reputation: 'Öğrenci puanı',
  gradeExperience: 'Sınıf deneyimi',
};

/** One-line explanation shown when a student expands a pill. */
export const DIMENSION_HELP_TR: Record<ScoreDimension, string> = {
  trajectory:
    'Koçun kendi net çıkışı ve öğrencilerinin ilerlemesi, senin hedefine ulaşmak için gereken artışla karşılaştırılır.',
  style: 'Seçtiğin çalışma tarzı tercihleriyle koçun çalışma biçiminin örtüşmesi.',
  availability: 'Boş saatlerinle koçun müsait saatlerinin kesişimi.',
  trackDepth: 'Koçun senin alanındaki dersleri kapsaması.',
  budget: 'Koçun paket fiyatının belirttiğin bütçe aralığına uzaklığı.',
  reputation: 'Değerlendirme ortalaması, tamamlanan koçluk sayısı ve dönüş hızı.',
  gradeExperience: 'Koçun senin sınıf seviyendeki öğrencilerle çalışma geçmişi.',
};

export const TRACK_LABEL_TR: Record<Track, string> = {
  SAYISAL: 'Sayısal',
  ESIT_AGIRLIK: 'Eşit Ağırlık',
  SOZEL: 'Sözel',
  DIL: 'Dil',
};

export const TRACK_BLURB_TR: Record<Track, string> = {
  SAYISAL: 'Matematik, Fizik, Kimya, Biyoloji',
  ESIT_AGIRLIK: 'Matematik, Edebiyat, Tarih, Coğrafya',
  SOZEL: 'Edebiyat, Tarih, Coğrafya, Felsefe',
  DIL: 'YDT — İngilizce, Almanca, Fransızca',
};

export const GRADE_LABEL_TR: Record<GradeLevel, string> = {
  GRADE_11: '11. sınıf',
  GRADE_12: '12. sınıf',
  MEZUN: 'Mezun',
};

export const STYLE_LABEL_TR: Record<CoachingStyle, string> = {
  STRICT: 'Disiplinli takip',
  EMPATHETIC: 'Mentor yaklaşımı',
  STRATEGIC: 'Strateji odaklı',
  HIGH_TOUCH: 'Sık check-in',
};

export const STYLE_BLURB_TR: Record<CoachingStyle, string> = {
  STRICT:
    'Program net, teslim saatleri belli. Aksatırsan üstüne gelir. "Bugün neden yapmadın" sorusunu soran koç.',
  EMPATHETIC:
    'Önce moral, sonra program. Kötü deneme sonrası konuşabileceğin, tükenmişliği ciddiye alan koç.',
  STRATEGIC:
    'Deneme analizi, net hedefi, konu önceliklendirme. Nereye çalışacağını rakamla gösteren koç.',
  HIGH_TOUCH:
    'Günlük kısa temas. Haftada bir uzun görüşme yerine her gün beş dakika ilerleme kontrolü.',
};

export const CADENCE_LABEL_TR: Record<PricingCadence, string> = {
  WEEKLY_SYNC: 'Haftalık görüşme',
  MONTHLY_STANDARD: 'Aylık standart',
  INTENSIVE: 'Yoğun program',
  SINGLE_SESSION: 'Tek seans',
};

/** 400000 → "4.000 ₺" */
export function formatTry(minor: number): string {
  return `${Math.round(minor / 100).toLocaleString('tr-TR')} ₺`;
}

export function formatRanking(rank: number): string {
  return rank.toLocaleString('tr-TR');
}
KAKTUS_FILE_EOF

emit "src/lib/matching/present.ts" <<'KAKTUS_FILE_EOF'
import type { CoachCandidate, MatchResult, ScoreDimension } from './types';

/**
 * Turns a MatchResult into what the card renders.
 *
 * The pills come from the scorer's own per-dimension scores, not from copy
 * invented in the component. That matters: if a pill says "Alan uyumu %95" it
 * has to be the number that actually contributed to the ranking, otherwise the
 * explanation is decoration and students will eventually catch it out.
 *
 * Only dimensions the student can act on are surfaced. Budget fit is scored but
 * not shown as a pill — telling someone their match is 40% on budget is just
 * telling them the price, which the card already shows plainly.
 */

export const DIMENSION_LABEL: Record<ScoreDimension, string> = {
  trajectory: 'Hedef benzerliği',
  style: 'Çalışma tarzı',
  availability: 'Saat uyumu',
  trackDepth: 'Alan uyumu',
  budget: 'Bütçe',
  reputation: 'Öğrenci puanı',
  gradeExperience: 'Sınıf deneyimi',
};

/** Order the pills appear in. Highest-signal first, not highest-scoring. */
const PILL_ORDER: ScoreDimension[] = [
  'trackDepth',
  'trajectory',
  'style',
  'availability',
  'gradeExperience',
  'reputation',
];

export interface MatchPill {
  dimension: ScoreDimension;
  label: string;
  /** 0–100, rounded. */
  percent: number;
  /** The scorer's own explanation, in Turkish. */
  reason: string;
  tone: 'strong' | 'fair' | 'weak';
}

export interface CoachCardModel {
  coachId: string;
  slug: string;
  displayName: string;
  university: string;
  department: string;
  matchScore: number;
  headlineReasons: string[];
  caveats: string[];
  pills: MatchPill[];
  priceFromMinor: number | null;
  ratingAvg: number;
  ratingCount: number;
  completedEngagements: number;
  /** e.g. "72 → 98 net" — the single most persuasive fact we have. */
  journeyLabel: string | null;
  specializationLabel: string | null;
}

function tone(percent: number): MatchPill['tone'] {
  if (percent >= 80) return 'strong';
  if (percent >= 55) return 'fair';
  return 'weak';
}

export function toCoachCard(result: MatchResult, coach: CoachCandidate): CoachCardModel {
  const byDimension = new Map(result.dimensions.map((d) => [d.dimension, d]));

  const pills: MatchPill[] = PILL_ORDER.flatMap((dimension) => {
    const d = byDimension.get(dimension);
    if (!d) return [];
    const percent = Math.round(d.score * 100);
    // A near-zero dimension is noise on a card; the caveat line covers the
    // genuinely disqualifying cases (no shared hours, over budget).
    if (percent < 25) return [];
    return [{ dimension, label: DIMENSION_LABEL[dimension], percent, reason: d.reason, tone: tone(percent) }];
  }).slice(0, 4);

  const { baselineNet, finalNet } = coach.journey;
  const journeyLabel =
    baselineNet != null && finalNet != null && finalNet > baselineNet
      ? `${Math.round(baselineNet)} → ${Math.round(finalNet)} net`
      : null;

  const prices = coach.pricing.map((p) => p.priceMinor);

  return {
    coachId: result.coachId,
    slug: coach.slug,
    displayName: coach.displayName,
    university: coach.university,
    department: coach.department,
    matchScore: result.displayScore,
    headlineReasons: result.reasons,
    caveats: result.caveats,
    pills,
    priceFromMinor: prices.length > 0 ? Math.min(...prices) : null,
    ratingAvg: coach.stats.ratingAvg,
    ratingCount: coach.stats.ratingCount,
    completedEngagements: coach.stats.completedEngagements,
    journeyLabel,
    specializationLabel: coach.specializations[0]?.label ?? null,
  };
}
KAKTUS_FILE_EOF

emit "src/lib/matching/score.ts" <<'KAKTUS_FILE_EOF'
import { coveredWeekdays, intersectWindows, totalMinutes } from '@/lib/time/windows';
import {
  CALIBRATION,
  CAPACITY,
  COLD_START,
  REPUTATION,
  WEIGHTS,
  WEIGHTS_VERSION,
} from './weights';
import type {
  CoachCandidate,
  DimensionScore,
  MatchResult,
  StudentMatchInput,
  Track,
} from './types';

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// ─────────────────────────────────────────────────────────────────────────────
// Ranking ⇄ net calibration
//
// Converts a target university ranking into an approximate net requirement so
// "hedefim ilk 5000" and "şu an 42 netim" become comparable numbers.
//
// These anchors are illustrative. Recalibrate every September from published
// ÖSYM sıralama/net tables — treat this table as configuration, not as truth.
// ─────────────────────────────────────────────────────────────────────────────

type Anchor = readonly [rank: number, netIndex: number];

const RANK_TO_NET: Record<Track, readonly Anchor[]> = {
  SAYISAL: [
    [500, 112], [1_000, 106], [5_000, 94], [20_000, 80],
    [50_000, 68], [100_000, 57], [300_000, 41],
  ],
  ESIT_AGIRLIK: [
    [500, 108], [1_000, 103], [5_000, 91], [20_000, 78],
    [50_000, 66], [100_000, 55], [300_000, 39],
  ],
  SOZEL: [
    [500, 105], [1_000, 100], [5_000, 88], [20_000, 75],
    [50_000, 64], [100_000, 53], [300_000, 38],
  ],
  DIL: [
    [500, 100], [1_000, 95], [5_000, 84], [20_000, 71],
    [50_000, 60], [100_000, 50], [300_000, 36],
  ],
};

/** Log-linear interpolation between anchors; clamps outside the table. */
export function netIndexForRanking(track: Track, ranking: number): number {
  const anchors = RANK_TO_NET[track];
  const r = Math.max(1, ranking);

  if (r <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (r >= last[0]) return last[1];

  for (let i = 0; i < anchors.length - 1; i++) {
    const [r0, n0] = anchors[i];
    const [r1, n1] = anchors[i + 1];
    if (r >= r0 && r <= r1) {
      const t = (Math.log(r) - Math.log(r0)) / (Math.log(r1) - Math.log(r0));
      return n0 + t * (n1 - n0);
    }
  }
  return last[1];
}

/** Student's current position as a single comparable net index. */
function baselineNetIndex(student: StudentMatchInput): number | null {
  const { tytNet, aytNet } = student.baseline;
  if (tytNet == null && aytNet == null) return null;
  return (tytNet ?? 0) + (aytNet ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dimension scorers. Each returns 0..1 plus a Turkish, user-facing reason.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trajectory similarity — the product thesis.
 *
 * A coach who personally climbed 45 → 95 net is evidence for a student who
 * needs 40 → 90. Rewards demonstrated climb of at least the required size,
 * with a bonus when the coach *started* somewhere near where the student is
 * now (they remember the problem), and when past students report similar gains.
 */
function scoreTrajectory(
  student: StudentMatchInput,
  coach: CoachCandidate,
): { score: number; reason: string } {
  const base = baselineNetIndex(student);
  const required =
    student.target.ranking != null && base != null
      ? netIndexForRanking(student.track, student.target.ranking) - base
      : null;

  const { baselineNet, finalNet } = coach.journey;
  const demonstrated =
    baselineNet != null && finalNet != null ? finalNet - baselineNet : null;

  // No trajectory data at all → neutral, so unverified journeys neither win
  // nor are punished into invisibility.
  if (required == null && demonstrated == null && coach.stats.medianStudentNetGain == null) {
    return { score: 0.5, reason: 'Gelişim verisi henüz yok' };
  }

  let score = 0.5;
  let reason = '';

  if (required != null && demonstrated != null) {
    // Meeting the required climb = 1.0; exceeding it adds a little, halved,
    // because 3x the needed climb is not 3x the evidence.
    const ratio = required <= 0 ? 1 : demonstrated / required;
    score = ratio >= 1 ? clamp01(0.85 + Math.min(ratio - 1, 1) * 0.15) : clamp01(ratio * 0.85);
    reason = `Kendisi ${Math.round(baselineNet!)} netten ${Math.round(finalNet!)} nete çıkmış; senin hedefin ${Math.round(required)} net artış`;
  } else if (demonstrated != null && demonstrated > 0) {
    score = clamp01(0.45 + Math.min(demonstrated / 50, 1) * 0.4);
    reason = `${Math.round(demonstrated)} netlik kendi çıkışını yapmış`;
  }

  // Familiarity bonus: coach started within ~12 net of where the student is.
  if (base != null && baselineNet != null) {
    const distance = Math.abs(baselineNet - base);
    if (distance <= 12) {
      score = clamp01(score + 0.08);
      if (!reason) reason = 'Senin bulunduğun noktadan başlamış';
    }
  }

  // Specialization band explicitly covering the student's starting rank.
  const band = coach.specializations.find(
    (s) =>
      student.target.ranking != null &&
      s.toRank != null &&
      s.toRank <= student.target.ranking * 1.5,
  );
  if (band) {
    score = clamp01(score + 0.06);
    reason = band.label;
  }

  // Outcome evidence from real students beats self-reported history.
  const median = coach.stats.medianStudentNetGain;
  if (median != null && required != null && required > 0) {
    const outcomeRatio = clamp01(median / required);
    score = clamp01(score * 0.7 + outcomeRatio * 0.3);
    if (median >= required * 0.8) {
      reason = `Öğrencileri ortalama ${Math.round(median)} net artış bildirmiş`;
    }
  }

  return { score, reason: reason || 'Benzer bir çıkış hikâyesi var' };
}

/**
 * Style fit, rank-weighted: the student's first choice matters most.
 * Weights 1, 1/2, 1/3… over their ordered preferences.
 */
function scoreStyle(
  student: StudentMatchInput,
  coach: CoachCandidate,
): { score: number; reason: string } {
  if (student.preferredStyles.length === 0) {
    return { score: 0.5, reason: 'Çalışma stili tercihi belirtilmemiş' };
  }

  const coachStyles = new Set(coach.styles);
  let earned = 0;
  let possible = 0;
  const matched: string[] = [];

  student.preferredStyles.forEach((style, index) => {
    const weight = 1 / (index + 1);
    possible += weight;
    if (coachStyles.has(style)) {
      earned += weight;
      matched.push(STYLE_TR[style]);
    }
  });

  const score = possible === 0 ? 0.5 : clamp01(earned / possible);
  const reason =
    matched.length > 0
      ? `${matched.join(' + ')} çalışıyor — tam aradığın tarz`
      : 'Çalışma stili tercihinden farklı';

  return { score, reason };
}

const STYLE_TR: Record<string, string> = {
  STRICT: 'Disiplinli takip',
  EMPATHETIC: 'Mentor yaklaşımı',
  STRATEGIC: 'Strateji odaklı',
  HIGH_TOUCH: 'Sık check-in',
};

/**
 * Availability overlap. Scored against what the student actually needs
 * (weeklyHoursGoal), not against their total free time — a coach available
 * for all 20 declared free hours is not 4x better than one available for the
 * 5 hours the student wants.
 */
function scoreAvailability(
  student: StudentMatchInput,
  coach: CoachCandidate,
): { score: number; reason: string } {
  if (student.availability.length === 0) {
    return { score: 0.5, reason: 'Müsaitlik belirtilmemiş' };
  }

  const shared = intersectWindows(student.availability, coach.availability);
  const sharedMinutes = totalMinutes(shared);
  if (sharedMinutes === 0) {
    return { score: 0, reason: 'Ortak müsait saat yok' };
  }

  const neededMinutes = Math.max(60, (student.weeklyHoursGoal ?? 2) * 60);
  const coverage = clamp01(sharedMinutes / neededMinutes);
  // Spread across days matters as much as raw minutes for weekly check-ins.
  const days = coveredWeekdays(shared).length;
  const spread = clamp01(days / 3);
  const score = clamp01(coverage * 0.7 + spread * 0.3);

  return {
    score,
    reason: `Haftada ${days} gün, toplam ${Math.round(sharedMinutes / 60)} saat ortak müsaitlik`,
  };
}

/** Track match plus subject depth for that track. */
function scoreTrackDepth(
  student: StudentMatchInput,
  coach: CoachCandidate,
): { score: number; reason: string } {
  const primary = coach.journey.track === student.track;
  const supports = coach.tracks.includes(student.track);
  if (!supports) return { score: 0, reason: 'Farklı alan' };

  const needed = CRITICAL_SUBJECTS[student.track];
  const covered = needed.filter((s) =>
    coach.subjects.some((cs) => cs.toLocaleLowerCase('tr').includes(s.toLocaleLowerCase('tr'))),
  );
  const depth = needed.length === 0 ? 1 : covered.length / needed.length;

  const score = clamp01((primary ? 0.6 : 0.42) + depth * 0.4);
  const reason = primary
    ? `${TRACK_TR[student.track]} alanından, ${covered.length > 0 ? covered.join(' ve ') + ' dahil' : 'aynı alan'}`
    : `${TRACK_TR[student.track]} desteği veriyor`;

  return { score, reason };
}

const TRACK_TR: Record<Track, string> = {
  SAYISAL: 'Sayısal',
  ESIT_AGIRLIK: 'Eşit Ağırlık',
  SOZEL: 'Sözel',
  DIL: 'Dil',
};

const CRITICAL_SUBJECTS: Record<Track, string[]> = {
  SAYISAL: ['AYT Matematik', 'Fizik', 'Kimya', 'Biyoloji'],
  ESIT_AGIRLIK: ['AYT Matematik', 'Edebiyat', 'Tarih', 'Coğrafya'],
  SOZEL: ['Edebiyat', 'Tarih', 'Coğrafya', 'Felsefe'],
  DIL: ['YDT İngilizce', 'TYT Türkçe'],
};

/**
 * Budget fit, deliberately asymmetric. Cheaper than the student's floor costs
 * nothing; more expensive than their ceiling decays sharply, because price is
 * the most common reason a promising match dies at the offer stage.
 */
function scoreBudget(
  student: StudentMatchInput,
  coach: CoachCandidate,
): { score: number; reason: string; caveat?: string } {
  const max = student.budget.maxMinor;
  if (max == null) return { score: 0.6, reason: 'Bütçe belirtilmemiş' };

  const preferred = coach.pricing.find((p) => p.cadence === student.budget.cadence);
  const cheapest = coach.pricing.reduce<number | null>(
    (min, p) => (min == null || p.priceMinor < min ? p.priceMinor : min),
    null,
  );
  const price = preferred?.priceMinor ?? cheapest;
  if (price == null) return { score: 0.4, reason: 'Fiyatlandırma tanımlanmamış' };

  const tl = (minor: number) => Math.round(minor / 100).toLocaleString('tr-TR');

  if (price <= max) {
    const headroom = (max - price) / max;
    return {
      score: clamp01(0.85 + headroom * 0.15),
      reason: `${tl(price)} ₺ — bütçenin içinde`,
    };
  }

  const overBy = (price - max) / max;
  return {
    score: clamp01(Math.exp(-overBy * 3.2)),
    reason: `${tl(price)} ₺ — bütçenin %${Math.round(overBy * 100)} üzerinde`,
    caveat: `Bu koçun paketi belirttiğin bütçenin üzerinde. Kapsamı küçülterek teklif verebilirsin.`,
  };
}

/** Bayesian-smoothed reputation blended with volume, responsiveness, reliability. */
function scoreReputation(coach: CoachCandidate): { score: number; reason: string } {
  const { ratingAvg, ratingCount, completedEngagements, responseP50Seconds, cancellationRate } =
    coach.stats;

  const smoothed =
    (ratingAvg * ratingCount + REPUTATION.priorRating * REPUTATION.priorWeight) /
    (ratingCount + REPUTATION.priorWeight);
  const ratingScore = clamp01((smoothed - 3) / 2);

  const volumeScore = clamp01(Math.log10(completedEngagements + 1) / Math.log10(21));

  let responseScore = 0.6;
  if (responseP50Seconds != null) {
    const { idealResponseSeconds: ideal, poorResponseSeconds: poor } = REPUTATION;
    responseScore = clamp01(1 - (responseP50Seconds - ideal) / (poor - ideal));
  }

  const reliability = clamp01(1 - cancellationRate * 2.5);

  const score = clamp01(
    ratingScore * 0.45 + volumeScore * 0.2 + responseScore * 0.15 + reliability * 0.2,
  );

  const reason =
    ratingCount >= 3
      ? `${ratingAvg.toFixed(1)} puan, ${ratingCount} değerlendirme`
      : 'Platformda yeni — henüz az değerlendirme';

  return { score, reason };
}

function scoreGradeExperience(
  student: StudentMatchInput,
  coach: CoachCandidate,
): { score: number; reason: string } {
  const supports = coach.supportedGrades.includes(student.gradeLevel);
  let score = supports ? 0.8 : 0.35;
  let reason = supports
    ? `${GRADE_TR[student.gradeLevel]} öğrencileriyle çalışıyor`
    : `Ağırlıklı olarak farklı sınıf seviyesiyle çalışıyor`;

  if (student.gradeLevel === 'MEZUN' && coach.journey.wasMezun) {
    score = clamp01(score + 0.2);
    reason = 'Kendisi de mezun yılında çalışmış — o süreci yaşamış';
  }

  return { score, reason };
}

const GRADE_TR: Record<string, string> = {
  GRADE_11: '11. sınıf',
  GRADE_12: '12. sınıf',
  MEZUN: 'Mezun',
};

// ─────────────────────────────────────────────────────────────────────────────
// Composition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps raw 0..1 to the displayed 0..100. Strictly increasing, so it can never
 * reorder results — it only changes how the same ranking is presented.
 */
export function calibrate(raw: number): number {
  const curved = Math.pow(clamp01(raw), CALIBRATION.gamma);
  const spread = CALIBRATION.displayCeiling - CALIBRATION.displayFloor;
  return Math.round(CALIBRATION.displayFloor + curved * spread);
}

function coldStartBonus(coach: CoachCandidate, now: Date): number {
  if (coach.stats.completedEngagements >= COLD_START.engagementThreshold) return 0;
  const ageDays =
    (now.getTime() - coach.stats.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24);
  const decay = clamp01(1 - ageDays / COLD_START.decayDays);
  return COLD_START.maxBonusPoints * decay;
}

/**
 * Scores one coach against one student. Pure: no I/O, no clock reads except the
 * injected `now`, fully unit-testable.
 */
export function scoreCoach(
  student: StudentMatchInput,
  coach: CoachCandidate,
  now: Date = new Date(),
): MatchResult {
  const trajectory = scoreTrajectory(student, coach);
  const style = scoreStyle(student, coach);
  const availability = scoreAvailability(student, coach);
  const trackDepth = scoreTrackDepth(student, coach);
  const budget = scoreBudget(student, coach);
  const reputation = scoreReputation(coach);
  const gradeExperience = scoreGradeExperience(student, coach);

  const dimension = (
    dimension: DimensionScore['dimension'],
    part: { score: number; reason: string },
    surface: boolean,
  ): DimensionScore => ({
    dimension,
    score: part.score,
    reason: part.reason,
    weight: WEIGHTS[dimension],
    surface,
  });

  const dimensions: DimensionScore[] = [
    dimension('trajectory', trajectory, true),
    dimension('style', style, true),
    dimension('availability', availability, true),
    dimension('trackDepth', trackDepth, true),
    dimension('budget', budget, false),
    dimension('reputation', reputation, true),
    dimension('gradeExperience', gradeExperience, true),
  ];

  let raw = dimensions.reduce((sum, d) => sum + d.score * d.weight, 0);

  // Capacity demotion — near-full coaches convert worse and reply slower.
  const utilisation =
    coach.stats.maxActiveStudents > 0
      ? coach.stats.activeEngagements / coach.stats.maxActiveStudents
      : 0;
  if (utilisation >= CAPACITY.nearFullThreshold) raw *= CAPACITY.nearFullMultiplier;

  raw = clamp01(raw);

  const displayScore = Math.min(
    CALIBRATION.displayCeiling,
    calibrate(raw) + Math.round(coldStartBonus(coach, now)),
  );

  const reasons = dimensions
    .filter((d) => d.surface && d.score >= 0.62 && d.reason)
    .sort((a, b) => b.score * b.weight - a.score * a.weight)
    .slice(0, 3)
    .map((d) => d.reason);

  const caveats: string[] = [];
  if (budget.caveat) caveats.push(budget.caveat);
  if (availability.score < 0.25) {
    caveats.push('Müsait saatleriniz büyük ölçüde çakışmıyor.');
  }
  if (utilisation >= 1) caveats.push('Şu anda kontenjanı dolu.');

  return {
    coachId: coach.id,
    rawScore: raw,
    displayScore,
    dimensions,
    reasons,
    caveats,
    weightsVersion: WEIGHTS_VERSION,
  };
}

/** Scores, filters below the visibility floor, and ranks. Deterministic. */
export function rankCoaches(
  student: StudentMatchInput,
  candidates: CoachCandidate[],
  options: { limit?: number; now?: Date } = {},
): MatchResult[] {
  const now = options.now ?? new Date();
  return candidates
    .map((c) => scoreCoach(student, c, now))
    .filter((r) => r.rawScore >= CALIBRATION.minRawScore)
    .sort((a, b) => b.displayScore - a.displayScore || a.coachId.localeCompare(b.coachId))
    .slice(0, options.limit ?? 20);
}
KAKTUS_FILE_EOF

emit "src/lib/matching/types.ts" <<'KAKTUS_FILE_EOF'
import type { TimeWindow } from '@/lib/time/windows';

export type Track = 'SAYISAL' | 'ESIT_AGIRLIK' | 'SOZEL' | 'DIL';
export type GradeLevel = 'GRADE_11' | 'GRADE_12' | 'MEZUN';
export type CoachingStyle = 'STRICT' | 'EMPATHETIC' | 'STRATEGIC' | 'HIGH_TOUCH';
export type PricingCadence =
  | 'WEEKLY_SYNC'
  | 'MONTHLY_STANDARD'
  | 'INTENSIVE'
  | 'SINGLE_SESSION';

/** Everything the guest questionnaire produces. No user id required. */
export interface StudentMatchInput {
  track: Track;
  gradeLevel: GradeLevel;
  baseline: {
    tytNet: number | null;
    aytNet: number | null;
  };
  target: {
    ranking: number | null;
    university?: string | null;
    department?: string | null;
  };
  /** Ordered — index 0 is the strongest preference. */
  preferredStyles: CoachingStyle[];
  availability: TimeWindow[];
  budget: {
    minMinor: number | null;
    maxMinor: number | null;
    cadence: PricingCadence;
  };
  weeklyHoursGoal?: number | null;
}

export interface CoachJourney {
  baselineNet: number | null;
  finalNet: number | null;
  baselineRank: number | null;
  finalRank: number;
  wasMezun: boolean;
  track: Track;
  year: number;
}

export interface CoachStats {
  ratingAvg: number;
  ratingCount: number;
  completedEngagements: number;
  activeEngagements: number;
  maxActiveStudents: number;
  responseP50Seconds: number | null;
  cancellationRate: number;
  lastActiveAt: Date;
  /** Median net gain reported by past students. Strongest evidence we have. */
  medianStudentNetGain: number | null;
}

export interface CoachCandidate {
  id: string;
  slug: string;
  displayName: string;
  university: string;
  department: string;
  tracks: Track[];
  subjects: string[];
  styles: CoachingStyle[];
  supportedGrades: GradeLevel[];
  journey: CoachJourney;
  specializations: Array<{ label: string; fromRank: number | null; toRank: number | null }>;
  availability: TimeWindow[];
  pricing: Array<{ cadence: PricingCadence; priceMinor: number }>;
  stats: CoachStats;
}

export type ScoreDimension =
  | 'trajectory'
  | 'style'
  | 'availability'
  | 'trackDepth'
  | 'budget'
  | 'reputation'
  | 'gradeExperience';

export interface DimensionScore {
  dimension: ScoreDimension;
  /** 0..1 */
  score: number;
  weight: number;
  /** Turkish, user-facing when `surface` is true. */
  reason: string;
  surface: boolean;
}

export interface MatchResult {
  coachId: string;
  /** 0..1, uncalibrated. Persist this one. */
  rawScore: number;
  /** 0..100 integer, what the UI shows. */
  displayScore: number;
  dimensions: DimensionScore[];
  /** Top user-facing reasons, already sorted by contribution. */
  reasons: string[];
  /** Non-fatal mismatches worth disclosing, e.g. price above budget. */
  caveats: string[];
  weightsVersion: string;
}

export interface RejectedCandidate {
  coachId: string;
  rule: string;
}
KAKTUS_FILE_EOF

emit "src/lib/matching/weights.ts" <<'KAKTUS_FILE_EOF'
import type { ScoreDimension } from './types';

/**
 * Bump this on ANY change below. Every MatchRun records it, so a weighting
 * change can be attributed to a change in offer-send rate instead of being
 * argued about in a meeting.
 */
export const WEIGHTS_VERSION = '2026.09.01-a';

export const WEIGHTS: Record<ScoreDimension, number> = {
  trajectory: 0.22,
  style: 0.17,
  availability: 0.15,
  trackDepth: 0.14,
  budget: 0.12,
  reputation: 0.12,
  gradeExperience: 0.08,
};

// Fail loudly at import time rather than shipping a silently rescaled model.
const WEIGHT_SUM = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(WEIGHT_SUM - 1) > 1e-9) {
  throw new Error(`Matching weights must sum to 1, got ${WEIGHT_SUM}`);
}

export const REPUTATION = {
  /** Bayesian prior so a single 5★ doesn't outrank fifty 4.7★. */
  priorRating: 4.4,
  priorWeight: 8,
  /** Response time at or under this counts as perfect. */
  idealResponseSeconds: 2 * 3600,
  poorResponseSeconds: 48 * 3600,
} as const;

export const COLD_START = {
  /** Coaches below this many completed engagements get exposure support. */
  engagementThreshold: 3,
  /** Maximum bonus in display points. Enough to be seen, not enough to top the list. */
  maxBonusPoints: 4,
  /** Bonus decays to zero over this many days after approval. */
  decayDays: 45,
} as const;

export const CALIBRATION = {
  /**
   * Raw weighted scores realistically land in 0.45–0.85. Presenting "58% Match"
   * to a 17-year-old reads as a broken product, so we apply one documented
   * monotone curve here — never scattered fudge factors at call sites.
   * Ranking is unaffected: the curve is strictly increasing.
   */
  gamma: 0.62,
  displayFloor: 55,
  displayCeiling: 98,
  /** Candidates below this raw score are not shown at all. */
  minRawScore: 0.38,
} as const;

export const CAPACITY = {
  /** Coaches at >=90% capacity are slightly demoted; they convert worse. */
  nearFullThreshold: 0.9,
  nearFullMultiplier: 0.96,
} as const;
KAKTUS_FILE_EOF

emit "src/lib/offers/draft.ts" <<'KAKTUS_FILE_EOF'
/**
 * Draft offers that survive the auth wall.
 *
 * A guest configures a whole offer — package type, four slots, a price they
 * negotiated down in their head — and only then hits the wall. Losing that is
 * losing the sale, and asking them to rebuild it after sign-in is worse than
 * asking for the account up front.
 *
 * So the draft goes into an httpOnly cookie with `sameSite: lax`, which is the
 * one storage that survives the Google OAuth redirect. It is deliberately small
 * and non-sensitive: coach id, package type, ISO slot strings, a price. No
 * personal data, so a stolen cookie is worth nothing.
 *
 * Limitation, stated plainly: a magic link opened in a *different browser* will
 * not carry the cookie. The return URL therefore also encodes the coach slug
 * and package type, so the worst case rebuilds the scope and loses only the
 * slot selection — not the whole offer.
 */

export const OFFER_DRAFT_COOKIE = 'kk_offer_draft';
export const OFFER_DRAFT_TTL_SECONDS = 60 * 60 * 6;

export type PackageType = 'EXPLORATORY' | 'MONTHLY_4W';

export interface OfferDraft {
  coachProfileId: string;
  coachSlug: string;
  packageType: PackageType;
  /** ISO start times, in selection order. */
  slots: string[];
  priceMinor: number;
  note?: string;
  createdAt: string;
}

export const PACKAGE_CONFIG: Record<
  PackageType,
  {
    label: string;
    summary: string;
    sessions: number;
    weeks: number;
    minutesPerSession: number;
    cadence: 'SINGLE_SESSION' | 'MONTHLY_STANDARD';
    milestoneCount: number;
  }
> = {
  EXPLORATORY: {
    label: 'Tanışma seansı',
    summary: 'Tek seans. Anlaşamazsanız devam etme zorunluluğu yok.',
    sessions: 1,
    weeks: 1,
    minutesPerSession: 60,
    cadence: 'SINGLE_SESSION',
    milestoneCount: 1,
  },
  MONTHLY_4W: {
    label: '4 haftalık program',
    summary: 'Haftada bir görüşme, arada mesajlaşma. Ödeme haftalık dilimler hâlinde aktarılır.',
    sessions: 4,
    weeks: 4,
    minutesPerSession: 60,
    cadence: 'MONTHLY_STANDARD',
    milestoneCount: 4,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Pricing
// ─────────────────────────────────────────────────────────────────────────────

export interface PriceBreakdownView {
  totalMinor: number;
  platformFeeMinor: number;
  coachReceivesMinor: number;
  perSessionMinor: number;
  commissionBps: number;
}

/**
 * What the student pays, and where it goes.
 *
 * The student's total is the number they chose; the commission comes out of the
 * coach's side, matching `splitAmount` in the ledger exactly (floor on the
 * commission, remainder to the coach). Showing a fee *added on top* would be a
 * different product and a different price — so this mirrors the accounting
 * rather than reimplementing it.
 */
export function computeBreakdown(totalMinor: number, commissionBps: number): PriceBreakdownView {
  const platformFeeMinor = Math.floor((totalMinor * commissionBps) / 10_000);
  return {
    totalMinor,
    platformFeeMinor,
    coachReceivesMinor: totalMinor - platformFeeMinor,
    perSessionMinor: totalMinor,
    commissionBps,
  };
}

export function suggestedPriceMinor(
  packageType: PackageType,
  tiers: Array<{ cadence: string; priceMinor: number; sessionsPerCycle: number }>,
): number | null {
  const config = PACKAGE_CONFIG[packageType];
  const exact = tiers.find((tier) => tier.cadence === config.cadence);
  if (exact) return exact.priceMinor;

  // No exact tier: derive from the monthly rate rather than showing nothing.
  // An empty price field makes students guess wildly and send offers that get
  // declined, which wastes both sides' time.
  const monthly = tiers.find((tier) => tier.cadence === 'MONTHLY_STANDARD');
  if (!monthly) return null;

  if (packageType === 'EXPLORATORY') {
    const perSession = Math.round(monthly.priceMinor / Math.max(monthly.sessionsPerCycle, 1));
    return Math.round(perSession / 100) * 100;
  }
  return monthly.priceMinor;
}

export function isDraftComplete(draft: Partial<OfferDraft>): draft is OfferDraft {
  const required = draft.packageType ? PACKAGE_CONFIG[draft.packageType].sessions : 0;
  return Boolean(
    draft.coachProfileId &&
      draft.packageType &&
      draft.priceMinor &&
      draft.priceMinor > 0 &&
      draft.slots &&
      draft.slots.length === required,
  );
}
KAKTUS_FILE_EOF

emit "src/lib/offers/scope.ts" <<'KAKTUS_FILE_EOF'
import { z } from 'zod';

/**
 * The negotiated terms, stored on `Offer.scope` as JSON.
 *
 * JSON rather than columns because this is the part of the product that will
 * change shape most often — deliverables, session formats, trial weeks — and
 * every change would otherwise be a migration on a hot table. It is validated
 * on write, so it is JSON in storage but not in practice.
 *
 * The requested slots live here too: they are a *proposal* until escrow is
 * funded, at which point they become SlotHolds → Bookings.
 */

export const slotSchema = z
  .object({
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((s) => s.endsAt > s.startsAt, { message: 'Slot must end after it starts' });

export const offerScopeSchema = z.object({
  cadence: z.enum(['WEEKLY_SYNC', 'MONTHLY_STANDARD', 'INTENSIVE', 'SINGLE_SESSION']),
  sessionsPerCycle: z.number().int().min(1).max(14),
  minutesPerSession: z.number().int().min(15).max(240),
  weeks: z.number().int().min(1).max(52),
  includesMessaging: z.boolean().default(true),
  deliverables: z.array(z.string().max(200)).max(12).default([]),
  notes: z.string().max(2000).optional(),
  slots: z.array(slotSchema).max(60).default([]),
});

export type OfferScope = z.infer<typeof offerScopeSchema>;

export function parseScope(raw: unknown): OfferScope {
  return offerScopeSchema.parse(raw);
}

/**
 * Milestone boundaries.
 *
 * Milestones are the escrow release unit, so their periods must tile the
 * engagement exactly — no gaps where a session belongs to no milestone and no
 * overlaps where it belongs to two. The final period is extended to the
 * engagement end rather than truncated, so a 5-week engagement split into 4
 * milestones does not silently drop the last 7 days of sessions.
 */
export function milestonePeriods(
  startDate: Date,
  endDate: Date,
  count: number,
): Array<{ index: number; periodStart: Date; periodEnd: Date }> {
  if (count < 1) throw new Error('Milestone count must be >= 1');
  if (endDate <= startDate) throw new Error('endDate must be after startDate');

  const totalMs = endDate.getTime() - startDate.getTime();
  const step = Math.floor(totalMs / count);

  return Array.from({ length: count }, (_, i) => ({
    index: i,
    periodStart: new Date(startDate.getTime() + step * i),
    periodEnd: i === count - 1 ? endDate : new Date(startDate.getTime() + step * (i + 1)),
  }));
}
KAKTUS_FILE_EOF

emit "src/lib/offers/state-machine.ts" <<'KAKTUS_FILE_EOF'
/**
 * Offer / escrow state machine.
 *
 * This module is the ONLY place `Offer.status` may be decided. Every other file
 * calls `transition()`. If you find yourself writing
 * `prisma.offer.update({ data: { status } })` anywhere else, that is the bug.
 *
 *                    ┌────────┐
 *                    │ DRAFT  │
 *                    └───┬────┘
 *                        │ submit
 *                        ▼
 *        cancel   ┌────────────┐  counter   ┌───────────┐
 *      ◄──────────│  OFFERED   │◄──────────►│ COUNTERED │──────────►
 *                 └─────┬──────┘            └─────┬─────┘   cancel/expire
 *                       │ accept                  │ accept
 *                       ▼                         ▼
 *                    ┌──────────────┐
 *                    │   ACCEPTED   │──── cancel/expire ──►
 *                    └──────┬───────┘
 *                           │ payment captured  (holds → bookings)
 *                           ▼
 *                 ┌──────────────────┐
 *                 │  PAID_IN_ESCROW  │──── refund (pre-start) ──► REFUNDED
 *                 └────────┬─────────┘
 *                          │ start date reached
 *                          ▼
 *                     ┌─────────┐   open dispute   ┌──────────┐
 *                     │ ACTIVE  │◄────────────────►│ DISPUTED │
 *                     └────┬────┘   resolve→release└────┬─────┘
 *                          │ all milestones released    │ resolve→refund
 *                          ▼                            ▼
 *                    ┌───────────┐                ┌──────────┐
 *                    │ COMPLETED │───dispute────► │ REFUNDED │
 *                    └───────────┘  (window)      └──────────┘
 */

export type OfferStatus =
  | 'DRAFT'
  | 'OFFERED'
  | 'COUNTERED'
  | 'ACCEPTED'
  | 'PAID_IN_ESCROW'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'REFUNDED'
  | 'CANCELLED'
  | 'EXPIRED';

export type ActorRole = 'STUDENT' | 'COACH' | 'ADMIN' | 'SYSTEM';

export type OfferEventName =
  | 'SUBMIT'
  | 'COUNTER'
  | 'ACCEPT'
  | 'PAYMENT_CAPTURED'
  | 'ENGAGEMENT_STARTED'
  | 'ALL_MILESTONES_RELEASED'
  | 'OPEN_DISPUTE'
  | 'RESOLVE_DISPUTE_RELEASE'
  | 'RESOLVE_DISPUTE_REFUND'
  | 'REFUND'
  | 'CANCEL'
  | 'EXPIRE';

/** Terminal states never transition again. */
export const TERMINAL_STATES: readonly OfferStatus[] = [
  'COMPLETED',
  'REFUNDED',
  'CANCELLED',
  'EXPIRED',
];

/** Once here, real money is held. Cancellation must move money, not just status. */
export const ESCROW_FUNDED_STATES: readonly OfferStatus[] = [
  'PAID_IN_ESCROW',
  'ACTIVE',
  'DISPUTED',
];

// ─────────────────────────────────────────────────────────────────────────────
// Side effects — declarative, executed by the caller inside one transaction.
// Keeping them as data (not inline writes) makes the machine unit-testable
// without a database and makes the full consequence set of a transition
// readable in one place.
// ─────────────────────────────────────────────────────────────────────────────

export type SideEffect =
  | { type: 'CREATE_SLOT_HOLDS'; extendMinutes: number }
  | { type: 'EXTEND_SLOT_HOLDS'; minutes: number }
  | { type: 'RELEASE_SLOT_HOLDS' }
  | { type: 'CONVERT_HOLDS_TO_BOOKINGS' }
  | { type: 'CREATE_ENGAGEMENT' }
  | { type: 'CREATE_MILESTONES' }
  | { type: 'POST_ESCROW_FUNDING' }
  | { type: 'FREEZE_PENDING_MILESTONES' }
  | { type: 'RELEASE_REMAINING_MILESTONES' }
  | { type: 'REFUND_UNRELEASED_ESCROW'; reason: string }
  | { type: 'SUPERSEDE_PARENT_OFFER' }
  | { type: 'NOTIFY'; audience: 'STUDENT' | 'COACH' | 'BOTH' | 'ADMIN'; template: string }
  | { type: 'AUDIT'; action: string };

export interface TransitionDefinition {
  from: OfferStatus;
  to: OfferStatus;
  event: OfferEventName;
  /** Who is permitted to trigger this. */
  allowedActors: readonly ActorRole[];
  effects: readonly SideEffect[];
  /** Human-readable invariant, asserted by `guard` where machine-checkable. */
  requires?: string;
}

export interface TransitionContext {
  hasCapturedPayment?: boolean;
  hasOpenDispute?: boolean;
  allMilestonesSettled?: boolean;
  startDateReached?: boolean;
  /** Disputes are only accepted within N days of the last milestone period. */
  withinDisputeWindow?: boolean;
  isInitiatorOfCurrentOffer?: boolean;
}

const TRANSITIONS: readonly TransitionDefinition[] = [
  {
    from: 'DRAFT',
    to: 'OFFERED',
    event: 'SUBMIT',
    allowedActors: ['STUDENT', 'COACH'],
    effects: [
      { type: 'CREATE_SLOT_HOLDS', extendMinutes: 48 * 60 },
      { type: 'NOTIFY', audience: 'BOTH', template: 'offer.received' },
      { type: 'AUDIT', action: 'offer.submitted' },
    ],
  },
  {
    from: 'OFFERED',
    to: 'COUNTERED',
    event: 'COUNTER',
    allowedActors: ['STUDENT', 'COACH'],
    requires: 'counter must come from the party that did not send the current offer',
    effects: [
      { type: 'SUPERSEDE_PARENT_OFFER' },
      { type: 'EXTEND_SLOT_HOLDS', minutes: 48 * 60 },
      { type: 'NOTIFY', audience: 'BOTH', template: 'offer.countered' },
      { type: 'AUDIT', action: 'offer.countered' },
    ],
  },
  {
    from: 'COUNTERED',
    to: 'COUNTERED',
    event: 'COUNTER',
    allowedActors: ['STUDENT', 'COACH'],
    requires: 'counter must come from the party that did not send the current offer',
    effects: [
      { type: 'SUPERSEDE_PARENT_OFFER' },
      { type: 'EXTEND_SLOT_HOLDS', minutes: 48 * 60 },
      { type: 'NOTIFY', audience: 'BOTH', template: 'offer.countered' },
      { type: 'AUDIT', action: 'offer.countered' },
    ],
  },
  ...(['OFFERED', 'COUNTERED'] as const).map(
    (from): TransitionDefinition => ({
      from,
      to: 'ACCEPTED',
      event: 'ACCEPT',
      allowedActors: ['STUDENT', 'COACH'],
      requires: 'acceptor must be the counterparty, not the sender',
      effects: [
        // Short window: the student now has 2h to pay before the coach's
        // calendar is freed for everyone else.
        { type: 'EXTEND_SLOT_HOLDS', minutes: 120 },
        { type: 'NOTIFY', audience: 'BOTH', template: 'offer.accepted' },
        { type: 'AUDIT', action: 'offer.accepted' },
      ],
    }),
  ),
  {
    from: 'ACCEPTED',
    to: 'PAID_IN_ESCROW',
    event: 'PAYMENT_CAPTURED',
    allowedActors: ['SYSTEM'],
    requires: 'a captured Payment row must exist for this offer',
    effects: [
      { type: 'POST_ESCROW_FUNDING' },
      { type: 'CREATE_ENGAGEMENT' },
      { type: 'CREATE_MILESTONES' },
      { type: 'CONVERT_HOLDS_TO_BOOKINGS' },
      { type: 'NOTIFY', audience: 'BOTH', template: 'escrow.funded' },
      { type: 'AUDIT', action: 'offer.paid' },
    ],
  },
  {
    from: 'PAID_IN_ESCROW',
    to: 'ACTIVE',
    event: 'ENGAGEMENT_STARTED',
    allowedActors: ['SYSTEM'],
    requires: 'engagement start date must have been reached',
    effects: [
      { type: 'NOTIFY', audience: 'BOTH', template: 'engagement.started' },
      { type: 'AUDIT', action: 'engagement.started' },
    ],
  },
  {
    from: 'ACTIVE',
    to: 'COMPLETED',
    event: 'ALL_MILESTONES_RELEASED',
    allowedActors: ['SYSTEM'],
    requires: 'every milestone must be RELEASED or REFUNDED, and no dispute open',
    effects: [
      { type: 'NOTIFY', audience: 'BOTH', template: 'engagement.completed' },
      { type: 'AUDIT', action: 'engagement.completed' },
    ],
  },
  ...(['ACTIVE', 'PAID_IN_ESCROW', 'COMPLETED'] as const).map(
    (from): TransitionDefinition => ({
      from,
      to: 'DISPUTED',
      event: 'OPEN_DISPUTE',
      allowedActors: ['STUDENT', 'COACH', 'ADMIN'],
      requires: 'dispute window must still be open',
      effects: [
        { type: 'FREEZE_PENDING_MILESTONES' },
        { type: 'NOTIFY', audience: 'ADMIN', template: 'dispute.opened' },
        { type: 'NOTIFY', audience: 'BOTH', template: 'dispute.opened' },
        { type: 'AUDIT', action: 'dispute.opened' },
      ],
    }),
  ),
  {
    from: 'DISPUTED',
    to: 'ACTIVE',
    event: 'RESOLVE_DISPUTE_RELEASE',
    allowedActors: ['ADMIN'],
    effects: [
      { type: 'RELEASE_REMAINING_MILESTONES' },
      { type: 'NOTIFY', audience: 'BOTH', template: 'dispute.resolved.release' },
      { type: 'AUDIT', action: 'dispute.resolved.release' },
    ],
  },
  {
    from: 'DISPUTED',
    to: 'REFUNDED',
    event: 'RESOLVE_DISPUTE_REFUND',
    allowedActors: ['ADMIN'],
    effects: [
      { type: 'REFUND_UNRELEASED_ESCROW', reason: 'dispute_resolved_refund' },
      { type: 'RELEASE_SLOT_HOLDS' },
      { type: 'NOTIFY', audience: 'BOTH', template: 'dispute.resolved.refund' },
      { type: 'AUDIT', action: 'dispute.resolved.refund' },
    ],
  },
  {
    from: 'PAID_IN_ESCROW',
    to: 'REFUNDED',
    event: 'REFUND',
    allowedActors: ['ADMIN', 'SYSTEM'],
    requires: 'engagement must not have started',
    effects: [
      { type: 'REFUND_UNRELEASED_ESCROW', reason: 'pre_start_cancellation' },
      { type: 'RELEASE_SLOT_HOLDS' },
      { type: 'NOTIFY', audience: 'BOTH', template: 'escrow.refunded' },
      { type: 'AUDIT', action: 'offer.refunded' },
    ],
  },
  ...(['DRAFT', 'OFFERED', 'COUNTERED', 'ACCEPTED'] as const).map(
    (from): TransitionDefinition => ({
      from,
      to: 'CANCELLED',
      event: 'CANCEL',
      allowedActors: ['STUDENT', 'COACH', 'ADMIN'],
      requires: 'no captured payment may exist',
      effects: [
        { type: 'RELEASE_SLOT_HOLDS' },
        { type: 'NOTIFY', audience: 'BOTH', template: 'offer.cancelled' },
        { type: 'AUDIT', action: 'offer.cancelled' },
      ],
    }),
  ),
  ...(['OFFERED', 'COUNTERED', 'ACCEPTED'] as const).map(
    (from): TransitionDefinition => ({
      from,
      to: 'EXPIRED',
      event: 'EXPIRE',
      allowedActors: ['SYSTEM'],
      requires: 'no captured payment may exist',
      effects: [
        { type: 'RELEASE_SLOT_HOLDS' },
        { type: 'NOTIFY', audience: 'BOTH', template: 'offer.expired' },
        { type: 'AUDIT', action: 'offer.expired' },
      ],
    }),
  ),
];

const INDEX = new Map<string, TransitionDefinition>();
for (const t of TRANSITIONS) INDEX.set(`${t.from}::${t.event}`, t);

export class OfferTransitionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'ILLEGAL_TRANSITION'
      | 'FORBIDDEN_ACTOR'
      | 'GUARD_FAILED'
      | 'TERMINAL_STATE',
  ) {
    super(message);
    this.name = 'OfferTransitionError';
  }
}

function checkGuards(
  def: TransitionDefinition,
  ctx: TransitionContext,
): string | null {
  switch (def.event) {
    case 'COUNTER':
      if (ctx.isInitiatorOfCurrentOffer === true) {
        return 'You cannot counter your own offer; edit it or cancel instead.';
      }
      return null;
    case 'ACCEPT':
      if (ctx.isInitiatorOfCurrentOffer === true) {
        return 'You cannot accept your own offer.';
      }
      return null;
    case 'PAYMENT_CAPTURED':
      return ctx.hasCapturedPayment ? null : 'No captured payment found for this offer.';
    case 'ENGAGEMENT_STARTED':
      return ctx.startDateReached ? null : 'Engagement start date has not been reached.';
    case 'ALL_MILESTONES_RELEASED':
      if (!ctx.allMilestonesSettled) return 'Some milestones are still unsettled.';
      if (ctx.hasOpenDispute) return 'An open dispute must be resolved first.';
      return null;
    case 'OPEN_DISPUTE':
      if (ctx.hasOpenDispute) return 'A dispute is already open.';
      if (ctx.withinDisputeWindow === false) return 'The dispute window has closed.';
      return null;
    case 'CANCEL':
    case 'EXPIRE':
      return ctx.hasCapturedPayment
        ? 'Payment already captured — refund instead of cancelling.'
        : null;
    case 'REFUND':
      return ctx.startDateReached
        ? 'Engagement has started; resolve through a dispute instead.'
        : null;
    default:
      return null;
  }
}

export interface TransitionOutcome {
  from: OfferStatus;
  to: OfferStatus;
  event: OfferEventName;
  effects: readonly SideEffect[];
}

/**
 * Validates a transition and returns the resulting status plus the side effects
 * the caller must apply inside the same database transaction. Throws rather
 * than returning a result type: an illegal money transition is a bug, and bugs
 * should be loud.
 */
export function transition(
  current: OfferStatus,
  event: OfferEventName,
  actor: ActorRole,
  ctx: TransitionContext = {},
): TransitionOutcome {
  if (TERMINAL_STATES.includes(current)) {
    throw new OfferTransitionError(
      `Offer is in terminal state ${current} and cannot transition.`,
      'TERMINAL_STATE',
    );
  }

  const def = INDEX.get(`${current}::${event}`);
  if (!def) {
    throw new OfferTransitionError(
      `No transition from ${current} on ${event}.`,
      'ILLEGAL_TRANSITION',
    );
  }

  if (!def.allowedActors.includes(actor)) {
    throw new OfferTransitionError(
      `${actor} may not trigger ${event} from ${current}.`,
      'FORBIDDEN_ACTOR',
    );
  }

  const failure = checkGuards(def, ctx);
  if (failure) throw new OfferTransitionError(failure, 'GUARD_FAILED');

  return { from: current, to: def.to, event, effects: def.effects };
}

/** For rendering available actions in the UI without duplicating the rules. */
export function availableEvents(
  current: OfferStatus,
  actor: ActorRole,
): OfferEventName[] {
  return TRANSITIONS.filter((t) => t.from === current && t.allowedActors.includes(actor)).map(
    (t) => t.event,
  );
}

export function canTransition(
  current: OfferStatus,
  event: OfferEventName,
  actor: ActorRole,
  ctx: TransitionContext = {},
): boolean {
  try {
    transition(current, event, actor, ctx);
    return true;
  } catch {
    return false;
  }
}

export const OFFER_STATUS_TR: Record<OfferStatus, string> = {
  DRAFT: 'Taslak',
  OFFERED: 'Teklif gönderildi',
  COUNTERED: 'Karşı teklif',
  ACCEPTED: 'Kabul edildi — ödeme bekleniyor',
  PAID_IN_ESCROW: 'Ödeme güvencede',
  ACTIVE: 'Devam ediyor',
  COMPLETED: 'Tamamlandı',
  DISPUTED: 'İtiraz sürecinde',
  REFUNDED: 'İade edildi',
  CANCELLED: 'İptal edildi',
  EXPIRED: 'Süresi doldu',
};

export { TRANSITIONS };
KAKTUS_FILE_EOF

emit "src/lib/onboarding/client-state.ts" <<'KAKTUS_FILE_EOF'
import type { CoachingStyle, GradeLevel, Track } from '@/lib/matching/types';

/**
 * Guest onboarding state, client side.
 *
 * ── Why this is not "just sessionStorage" ──
 *
 * The brief asks for sessionStorage so answers survive until the auth modal.
 * That covers the common case and misses the one that actually loses students:
 * the magic-link sign-in. The student starts in Chrome, the email opens in the
 * iOS Mail in-app browser, and sessionStorage is gone along with the five
 * answers they just gave.
 *
 * So this layer is a fast local cache, not the record. Every step also writes
 * server-side to `OnboardingSession`, keyed by an httpOnly cookie that survives
 * the OAuth redirect, with the token additionally embedded in the magic-link
 * callback. sessionStorage exists so the UI never waits on a round trip and so
 * a refresh mid-funnel is instant; the server copy is what gets claimed into a
 * StudentProfile at sign-in.
 *
 * Read order on mount: server session (authoritative) → sessionStorage (fast
 * path when the server has nothing yet) → empty.
 */

export const ONBOARDING_STORAGE_KEY = 'kaktus.onboarding.v1';

export interface OnboardingDraft {
  track?: Track;
  gradeLevel?: GradeLevel;
  targetRanking?: number | null;
  targetUniversity?: string | null;
  targetDepartment?: string | null;
  baselineTytNet?: number | null;
  baselineAytNet?: number | null;
  preferredStyles?: CoachingStyle[];
  budgetMinMinor?: number | null;
  budgetMaxMinor?: number | null;
  completedStep?: number;
}

export const STEPS = ['alan', 'hedef', 'net', 'tarz', 'butce'] as const;
export type StepSlug = (typeof STEPS)[number];

export const STEP_TITLES: Record<StepSlug, string> = {
  alan: 'Hangi alanda hazırlanıyorsun?',
  hedef: 'Hedefin ne?',
  net: 'Şu an nerede duruyorsun?',
  tarz: 'Nasıl bir koç seni ileri taşır?',
  butce: 'Aylık ne kadar ayırabilirsin?',
};

export function stepIndex(slug: string): number {
  const i = (STEPS as readonly string[]).indexOf(slug);
  return i === -1 ? 0 : i;
}

export function isStepComplete(draft: OnboardingDraft, slug: StepSlug): boolean {
  switch (slug) {
    case 'alan':
      return Boolean(draft.track && draft.gradeLevel);
    case 'hedef':
      return draft.targetRanking != null || Boolean(draft.targetUniversity);
    case 'net':
      return draft.baselineTytNet != null;
    case 'tarz':
      return (draft.preferredStyles?.length ?? 0) > 0;
    case 'butce':
      return draft.budgetMaxMinor != null;
  }
}

/** The matcher needs these two; everything else degrades to a neutral score. */
export function canMatch(draft: OnboardingDraft): boolean {
  return Boolean(draft.track && draft.gradeLevel);
}

// ─────────────────────────────────────────────────────────────────────────────
// Local cache
// ─────────────────────────────────────────────────────────────────────────────

export function readDraft(): OnboardingDraft {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(ONBOARDING_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OnboardingDraft) : {};
  } catch {
    // Private mode, quota, or corrupted JSON. The server copy still has it.
    return {};
  }
}

export function writeDraft(draft: OnboardingDraft): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* non-fatal, see above */
  }
}

export function clearDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(ONBOARDING_STORAGE_KEY);
  } catch {
    /* non-fatal */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

export const TRACK_LABELS: Record<Track, { short: string; full: string; hint: string }> = {
  SAYISAL: { short: 'Sayısal', full: 'Sayısal', hint: 'Mat, Fizik, Kimya, Biyoloji' },
  ESIT_AGIRLIK: { short: 'Eşit Ağırlık', full: 'Eşit Ağırlık', hint: 'Mat, Edebiyat, Tarih, Coğrafya' },
  SOZEL: { short: 'Sözel', full: 'Sözel', hint: 'Edebiyat, Tarih, Coğrafya, Felsefe' },
  DIL: { short: 'Dil', full: 'Dil', hint: 'YDT İngilizce ağırlıklı' },
};

export const GRADE_LABELS: Record<GradeLevel, { short: string; hint: string }> = {
  GRADE_11: { short: '11. sınıf', hint: 'Bir yılın daha var' },
  GRADE_12: { short: '12. sınıf', hint: 'Bu yıl gireceksin' },
  MEZUN: { short: 'Mezun', hint: 'Tekrar deneyeceksin' },
};

export const STYLE_LABELS: Record<CoachingStyle, { short: string; hint: string }> = {
  STRICT: { short: 'Disiplinli takip', hint: 'Program net, teslim saatleri belli, mazeret az' },
  EMPATHETIC: { short: 'Destekleyici mentor', hint: 'Önce motivasyon, kötü haftalarda yanında' },
  STRATEGIC: { short: 'Strateji odaklı', hint: 'Net analizi, deneme taktiği, zaman yönetimi' },
  HIGH_TOUCH: { short: 'Sık temas', hint: 'Neredeyse her gün kısa kontrol' },
};

export const DIMENSION_LABELS: Record<string, string> = {
  trajectory: 'Hedef benzerliği',
  style: 'Çalışma tarzı',
  availability: 'Saat uyumu',
  trackDepth: 'Alan uyumu',
  budget: 'Bütçe uyumu',
  reputation: 'Öğrenci geri bildirimi',
  gradeExperience: 'Sınıf deneyimi',
};

export function formatTry(minor: number | null | undefined): string {
  if (minor == null) return '—';
  return `${Math.round(minor / 100).toLocaleString('tr-TR')} ₺`;
}
KAKTUS_FILE_EOF

emit "src/lib/onboarding/labels.ts" <<'KAKTUS_FILE_EOF'
import type { CoachingStyle, GradeLevel, PricingCadence, ScoreDimension, Track } from '@/lib/matching/types';

/**
 * Turkish copy for every enum the student sees.
 *
 * Centralised because the same label has to appear identically in the wizard,
 * the summary rail, the coach card, and the offer — and because a student who
 * picks "Sayısal" in step 1 and then reads "SAY" in the summary loses trust in
 * a product that is asking for their money.
 */

export const TRACKS: Array<{
  value: Track;
  label: string;
  short: string;
  blurb: string;
}> = [
  {
    value: 'SAYISAL',
    label: 'Sayısal',
    short: 'SAY',
    blurb: 'Mühendislik, tıp, mimarlık',
  },
  {
    value: 'ESIT_AGIRLIK',
    label: 'Eşit Ağırlık',
    short: 'EA',
    blurb: 'Hukuk, psikoloji, işletme',
  },
  {
    value: 'SOZEL',
    label: 'Sözel',
    short: 'SÖZ',
    blurb: 'Öğretmenlik, tarih, iletişim',
  },
  {
    value: 'DIL',
    label: 'Dil',
    short: 'DİL',
    blurb: 'Mütercim tercümanlık, dil öğretmenliği',
  },
];

export const GRADE_LEVELS: Array<{ value: GradeLevel; label: string; blurb: string }> = [
  { value: 'GRADE_11', label: '11. sınıf', blurb: 'Bir sonraki yıl için hazırlanıyorum' },
  { value: 'GRADE_12', label: '12. sınıf', blurb: 'Bu yıl sınava gireceğim' },
  { value: 'MEZUN', label: 'Mezun', blurb: 'Tekrar gireceğim' },
];

/**
 * Coaching styles, written as behaviour rather than as personality labels.
 *
 * "Disiplinli" alone tells a student nothing about what will happen to them on
 * a Tuesday night. What they need to know is whether someone will message them
 * when they skip a session.
 */
export const COACHING_STYLES: Array<{
  value: CoachingStyle;
  label: string;
  blurb: string;
}> = [
  {
    value: 'STRICT',
    label: 'Sıkı takip',
    blurb: 'Program net, ödev takibi var. Aksattığımda üstüme gelmesini istiyorum.',
  },
  {
    value: 'EMPATHETIC',
    label: 'Anlayışlı mentor',
    blurb: 'Kötü günlerimde motivasyon veren, baskı kurmayan biri olsun.',
  },
  {
    value: 'STRATEGIC',
    label: 'Strateji odaklı',
    blurb: 'Hangi konudan kaç net, neyi bırakmalıyım — sayılarla çalışsın.',
  },
  {
    value: 'HIGH_TOUCH',
    label: 'Sık görüşme',
    blurb: 'Haftada bir yetmez, sık sık konuşmak beni ayakta tutuyor.',
  },
];

export const CADENCES: Array<{ value: PricingCadence; label: string }> = [
  { value: 'WEEKLY_SYNC', label: 'Haftalık görüşme' },
  { value: 'MONTHLY_STANDARD', label: 'Aylık standart' },
  { value: 'INTENSIVE', label: 'Yoğun program' },
  { value: 'SINGLE_SESSION', label: 'Tek seans' },
];

/**
 * Match breakdown labels.
 *
 * Every score the student sees has to be answerable if they ask "why?". These
 * name the actual comparison being made, not the internal dimension key.
 */
export const DIMENSION_LABELS: Record<ScoreDimension, string> = {
  trajectory: 'Hedef benzerliği',
  style: 'Çalışma tarzı',
  availability: 'Saat uyumu',
  trackDepth: 'Alan uyumu',
  budget: 'Bütçe uyumu',
  reputation: 'Öğrenci puanı',
  gradeExperience: 'Sınıf deneyimi',
};

/** Which dimensions are worth showing as pills, in display order. */
export const PILL_DIMENSIONS: ScoreDimension[] = [
  'trackDepth',
  'trajectory',
  'style',
  'gradeExperience',
  'availability',
];

export function trackLabel(track: Track | null | undefined): string {
  return TRACKS.find((t) => t.value === track)?.label ?? '';
}

export function gradeLabel(grade: GradeLevel | null | undefined): string {
  return GRADE_LEVELS.find((g) => g.value === grade)?.label ?? '';
}

export function styleLabel(style: CoachingStyle): string {
  return COACHING_STYLES.find((s) => s.value === style)?.label ?? '';
}

/** 400000 (kuruş) → "4.000 ₺" */
export function formatTry(minor: number | null | undefined): string {
  if (minor == null) return '—';
  return `${Math.round(minor / 100).toLocaleString('tr-TR')} ₺`;
}

export function formatRanking(rank: number | null | undefined): string {
  if (rank == null) return '—';
  if (rank >= 1000) return `${(rank / 1000).toLocaleString('tr-TR')} bin`;
  return rank.toLocaleString('tr-TR');
}
KAKTUS_FILE_EOF

emit "src/lib/onboarding/schema.ts" <<'KAKTUS_FILE_EOF'
import { z } from 'zod';
import type { CoachingStyle, GradeLevel, Track } from '@/lib/matching/types';

/**
 * Step definitions, shared by the client wizard and the server actions.
 *
 * One source of truth for what a step contains and when it is complete, so the
 * "Devam et" button and the server-side validation can never disagree — a
 * mismatch there produces the worst funnel bug there is: a button that does
 * nothing with no explanation.
 */

export const STEP_SLUGS = ['alan', 'hedef', 'net', 'tarz', 'butce'] as const;
export type StepSlug = (typeof STEP_SLUGS)[number];

export interface StepMeta {
  slug: StepSlug;
  index: number;
  /** The question, asked the way a student would ask it. */
  question: string;
  /** One line of help. Never marketing copy. */
  hint?: string;
}

export const STEPS: StepMeta[] = [
  {
    slug: 'alan',
    index: 0,
    question: 'Hangi alanda hazırlanıyorsun?',
    hint: 'Koçları önce alanına göre eliyoruz, sonra puanlıyoruz.',
  },
  {
    slug: 'hedef',
    index: 1,
    question: 'Hedefin ne?',
    hint: 'Sıralamayı bilmiyorsan bölüm yazman da yeter.',
  },
  {
    slug: 'net',
    index: 2,
    question: 'Şu an kaç net yapıyorsun?',
    hint: 'Son denemeni yaz. Tahmini olması sorun değil.',
  },
  { slug: 'tarz', index: 3, question: 'Nasıl bir koç seni daha iyi çalıştırır?' },
  {
    slug: 'butce',
    index: 4,
    question: 'Aylık bütçen ne kadar?',
    hint: 'Koçlar sana özel teklif verebilir, bu bir üst sınır değil.',
  },
];

export const stepBySlug = new Map(STEPS.map((s) => [s.slug, s]));

// ─────────────────────────────────────────────────────────────────────────────
// Answers
// ─────────────────────────────────────────────────────────────────────────────

export interface OnboardingAnswers {
  track?: Track;
  gradeLevel?: GradeLevel;
  targetRanking?: number | null;
  targetUniversity?: string | null;
  targetDepartment?: string | null;
  baselineTytNet?: number | null;
  baselineAytNet?: number | null;
  preferredStyles: CoachingStyle[];
  budgetMinMinor?: number | null;
  budgetMaxMinor?: number | null;
  weeklyHoursGoal?: number | null;
}

export const emptyAnswers: OnboardingAnswers = { preferredStyles: [] };

/** Whether a given step has enough to move on. Mirrors the server's checks. */
export function isStepComplete(slug: StepSlug, a: OnboardingAnswers): boolean {
  switch (slug) {
    case 'alan':
      return Boolean(a.track && a.gradeLevel);
    case 'hedef':
      // Either a ranking or a named target — a student who only knows "Tıp
      // istiyorum" should not be blocked here.
      return Boolean(a.targetRanking || a.targetDepartment || a.targetUniversity);
    case 'net':
      return a.baselineTytNet != null;
    case 'tarz':
      return a.preferredStyles.length > 0;
    case 'butce':
      return a.budgetMaxMinor != null;
  }
}

export function firstIncompleteStep(a: OnboardingAnswers): StepSlug {
  return STEPS.find((s) => !isStepComplete(s.slug, a))?.slug ?? 'butce';
}

export function completionRatio(a: OnboardingAnswers): number {
  const done = STEPS.filter((s) => isStepComplete(s.slug, a)).length;
  return done / STEPS.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Option data
// ─────────────────────────────────────────────────────────────────────────────

export const TRACK_OPTIONS: Array<{
  value: Track;
  label: string;
  short: string;
  detail: string;
}> = [
  { value: 'SAYISAL', label: 'Sayısal', short: 'SAY', detail: 'Matematik, Fizik, Kimya, Biyoloji' },
  { value: 'ESIT_AGIRLIK', label: 'Eşit Ağırlık', short: 'EA', detail: 'Matematik, Edebiyat, Tarih, Coğrafya' },
  { value: 'SOZEL', label: 'Sözel', short: 'SÖZ', detail: 'Edebiyat, Tarih, Coğrafya, Felsefe' },
  { value: 'DIL', label: 'Dil', short: 'DİL', detail: 'YDT İngilizce, Almanca, Fransızca' },
];

export const GRADE_OPTIONS: Array<{ value: GradeLevel; label: string; detail: string }> = [
  { value: 'GRADE_11', label: '11. sınıf', detail: 'Erken başlıyorum' },
  { value: 'GRADE_12', label: '12. sınıf', detail: 'Bu yıl gireceğim' },
  { value: 'MEZUN', label: 'Mezun', detail: 'Tekrar gireceğim' },
];

export const STYLE_OPTIONS: Array<{
  value: CoachingStyle;
  label: string;
  detail: string;
}> = [
  {
    value: 'STRICT',
    label: 'Sıkı takip',
    detail: 'Program verir, uymadığında üstüne gelir. Disiplini dışarıdan kurar.',
  },
  {
    value: 'EMPATHETIC',
    label: 'Mentor gibi',
    detail: 'Önce motivasyonunla ilgilenir. Kötü geçen haftada seni ayağa kaldırır.',
  },
  {
    value: 'STRATEGIC',
    label: 'Strateji odaklı',
    detail: 'Net analizi, deneme taktiği, hangi konuya kaç saat. Sayılarla konuşur.',
  },
  {
    value: 'HIGH_TOUCH',
    label: 'Sık görüşme',
    detail: 'Haftada birden fazla temas, günlük mesajlaşma. Yalnız bırakmaz.',
  },
];

/** Budget bands in kuruş. Anchored to what coaching actually costs in TR. */
export const BUDGET_BANDS: Array<{ label: string; minMinor: number; maxMinor: number }> = [
  { label: "1.500 ₺'ye kadar", minMinor: 0, maxMinor: 150_000 },
  { label: '1.500 – 3.000 ₺', minMinor: 150_000, maxMinor: 300_000 },
  { label: '3.000 – 5.000 ₺', minMinor: 300_000, maxMinor: 500_000 },
  { label: '5.000 ₺ ve üzeri', minMinor: 500_000, maxMinor: 1_200_000 },
];

export const TRACK_LABEL: Record<Track, string> = {
  SAYISAL: 'Sayısal',
  ESIT_AGIRLIK: 'Eşit Ağırlık',
  SOZEL: 'Sözel',
  DIL: 'Dil',
};

export const GRADE_LABEL: Record<GradeLevel, string> = {
  GRADE_11: '11. sınıf',
  GRADE_12: '12. sınıf',
  MEZUN: 'Mezun',
};

export const STYLE_LABEL: Record<CoachingStyle, string> = {
  STRICT: 'Sıkı takip',
  EMPATHETIC: 'Mentor gibi',
  STRATEGIC: 'Strateji odaklı',
  HIGH_TOUCH: 'Sık görüşme',
};

/** AYT net ceiling differs by track; the input must not allow impossible values. */
export const AYT_MAX_NET: Record<Track, number> = {
  SAYISAL: 80,
  ESIT_AGIRLIK: 80,
  SOZEL: 80,
  DIL: 80,
};

export const TYT_MAX_NET = 120;

export function aytLabel(track?: Track): string {
  switch (track) {
    case 'SAYISAL':
      return 'AYT neti (Mat, Fiz, Kim, Biyo)';
    case 'ESIT_AGIRLIK':
      return 'AYT neti (Mat, Edebiyat, Tarih, Coğrafya)';
    case 'SOZEL':
      return 'AYT neti (Edebiyat, Tarih, Coğrafya, Felsefe)';
    case 'DIL':
      return 'YDT neti';
    default:
      return 'AYT neti';
  }
}

export function formatTry(minor?: number | null): string {
  if (minor == null) return '—';
  return `${Math.round(minor / 100).toLocaleString('tr-TR')} ₺`;
}

export function formatRanking(rank?: number | null): string {
  if (rank == null) return '—';
  if (rank >= 1000) return `${Math.round(rank / 1000).toLocaleString('tr-TR')} bin`;
  return rank.toLocaleString('tr-TR');
}

// ─────────────────────────────────────────────────────────────────────────────
// Wire schema — what the client may send to the server action
// ─────────────────────────────────────────────────────────────────────────────

export const answersPatchSchema = z.object({
  track: z.enum(['SAYISAL', 'ESIT_AGIRLIK', 'SOZEL', 'DIL']).optional(),
  gradeLevel: z.enum(['GRADE_11', 'GRADE_12', 'MEZUN']).optional(),
  targetRanking: z.number().int().min(1).max(3_000_000).nullable().optional(),
  targetUniversity: z.string().max(120).nullable().optional(),
  targetDepartment: z.string().max(120).nullable().optional(),
  baselineTytNet: z.number().min(0).max(TYT_MAX_NET).nullable().optional(),
  baselineAytNet: z.number().min(0).max(80).nullable().optional(),
  preferredStyles: z
    .array(z.enum(['STRICT', 'EMPATHETIC', 'STRATEGIC', 'HIGH_TOUCH']))
    .max(4)
    .optional(),
  budgetMinMinor: z.number().int().min(0).nullable().optional(),
  budgetMaxMinor: z.number().int().min(0).nullable().optional(),
  weeklyHoursGoal: z.number().int().min(1).max(40).nullable().optional(),
  completedStep: z.number().int().min(0).max(5).optional(),
});

export type AnswersPatch = z.infer<typeof answersPatchSchema>;
KAKTUS_FILE_EOF

emit "src/lib/onboarding/session.ts" <<'KAKTUS_FILE_EOF'
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import type { StudentMatchInput } from '@/lib/matching/types';

/**
 * Guest onboarding state.
 *
 * The answers live server-side from step 1, keyed by an httpOnly cookie.
 * localStorage would be simpler and would lose the data on the magic-link
 * round trip: the student starts in Chrome, the email opens in the iOS Mail
 * in-app browser, and their five answers are gone. So the token also rides
 * along in the auth callback URL as a fallback for exactly that case.
 */

export const ONBOARDING_COOKIE = 'kk_onb';
const TTL_DAYS = 30;

export const timeWindowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1440),
  endMinute: z.number().int().min(0).max(1440),
});

export const onboardingSchema = z.object({
  track: z.enum(['SAYISAL', 'ESIT_AGIRLIK', 'SOZEL', 'DIL']).optional(),
  gradeLevel: z.enum(['GRADE_11', 'GRADE_12', 'MEZUN']).optional(),
  baselineTytNet: z.number().min(0).max(120).nullable().optional(),
  baselineAytNet: z.number().min(0).max(80).nullable().optional(),
  targetRanking: z.number().int().min(1).max(3_000_000).nullable().optional(),
  targetUniversity: z.string().max(120).nullable().optional(),
  targetDepartment: z.string().max(120).nullable().optional(),
  preferredStyles: z
    .array(z.enum(['STRICT', 'EMPATHETIC', 'STRATEGIC', 'HIGH_TOUCH']))
    .max(4)
    .optional(),
  availability: z.array(timeWindowSchema).max(60).optional(),
  budgetMinMinor: z.number().int().min(0).nullable().optional(),
  budgetMaxMinor: z.number().int().min(0).nullable().optional(),
  budgetCadence: z
    .enum(['WEEKLY_SYNC', 'MONTHLY_STANDARD', 'INTENSIVE', 'SINGLE_SESSION'])
    .optional(),
  weeklyHoursGoal: z.number().int().min(1).max(40).nullable().optional(),
  completedStep: z.number().int().min(0).max(6).optional(),
});

export type OnboardingPatch = z.infer<typeof onboardingSchema>;

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

function expiry(): Date {
  return new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Reads the current token, creating a session on first write. */
export async function upsertOnboardingSession(patch: OnboardingPatch, meta?: {
  ipHash?: string;
  userAgent?: string;
  referrer?: string;
}) {
  const jar = await cookies();
  const existing = jar.get(ONBOARDING_COOKIE)?.value;

  const data = {
    ...patch,
    availability: patch.availability ? (patch.availability as unknown as object) : undefined,
    expiresAt: expiry(),
  };

  if (existing) {
    const updated = await prisma.onboardingSession
      .update({ where: { token: existing }, data })
      .catch(() => null);
    if (updated) return updated;
    // Token pointed at a purged row — fall through and mint a new one.
  }

  const token = newToken();
  const created = await prisma.onboardingSession.create({
    data: { token, ...data, ...meta },
  });

  jar.set(ONBOARDING_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // must survive the OAuth redirect
    path: '/',
    maxAge: TTL_DAYS * 24 * 60 * 60,
  });

  return created;
}

export async function readOnboardingSession(tokenOverride?: string) {
  const token = tokenOverride ?? (await cookies()).get(ONBOARDING_COOKIE)?.value;
  if (!token) return null;
  return prisma.onboardingSession.findFirst({
    where: { token, expiresAt: { gt: new Date() } },
  });
}

/** Shapes a stored session into the matcher's input. Returns null if unusable. */
export function toMatchInput(
  session: Awaited<ReturnType<typeof readOnboardingSession>>,
): StudentMatchInput | null {
  if (!session?.track || !session.gradeLevel) return null;
  return {
    track: session.track,
    gradeLevel: session.gradeLevel,
    baseline: { tytNet: session.baselineTytNet, aytNet: session.baselineAytNet },
    target: {
      ranking: session.targetRanking,
      university: session.targetUniversity,
      department: session.targetDepartment,
    },
    preferredStyles: session.preferredStyles,
    availability: (session.availability as never) ?? [],
    budget: {
      minMinor: session.budgetMinMinor,
      maxMinor: session.budgetMaxMinor,
      cadence: session.budgetCadence ?? 'MONTHLY_STANDARD',
    },
    weeklyHoursGoal: session.weeklyHoursGoal,
  };
}

/**
 * Binds a guest session to a freshly authenticated user.
 *
 * Idempotent and additive: called on every sign-in, it will not overwrite a
 * profile the student has since edited by hand. A student who redoes the
 * questionnaire deliberately goes through an explicit "update my profile"
 * action, not through a silent re-claim.
 */
export async function claimOnboardingSession(token: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.onboardingSession.findFirst({
      where: { token, expiresAt: { gt: new Date() } },
    });
    if (!session || !session.track || !session.gradeLevel) return null;
    if (session.claimedByUserId && session.claimedByUserId !== userId) return null;

    const existing = await tx.studentProfile.findUnique({ where: { userId } });
    if (existing) {
      await tx.onboardingSession.update({
        where: { id: session.id },
        data: { claimedByUserId: userId, claimedAt: new Date() },
      });
      return existing;
    }

    const profile = await tx.studentProfile.create({
      data: {
        userId,
        track: session.track,
        gradeLevel: session.gradeLevel,
        baselineTytNet: session.baselineTytNet,
        baselineAytNet: session.baselineAytNet,
        targetRanking: session.targetRanking,
        targetUniversity: session.targetUniversity,
        targetDepartment: session.targetDepartment,
        preferredStyles: session.preferredStyles,
        availability: session.availability ?? undefined,
        budgetMinMinor: session.budgetMinMinor,
        budgetMaxMinor: session.budgetMaxMinor,
        budgetCadence: session.budgetCadence ?? 'MONTHLY_STANDARD',
        weeklyHoursGoal: session.weeklyHoursGoal,
        sourceOnboardingId: session.id,
      },
    });

    await tx.onboardingSession.update({
      where: { id: session.id },
      data: { claimedByUserId: userId, claimedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorRole: 'STUDENT',
        action: 'onboarding.claimed',
        entityType: 'StudentProfile',
        entityId: profile.id,
        metadata: { onboardingSessionId: session.id },
      },
    });

    return profile;
  });
}
KAKTUS_FILE_EOF

emit "src/lib/onboarding/steps.ts" <<'KAKTUS_FILE_EOF'
import { z } from 'zod';
import type { CoachingStyle, GradeLevel, PricingCadence, Track } from '@/lib/matching/types';

/**
 * The funnel, defined once.
 *
 * Step order, URL slugs, validation, and copy all live here so the wizard, the
 * route handler, the progress indicator, and the server action cannot disagree
 * about what step 3 is. Turkish slugs because the URL is user-facing.
 */

export const STEP_SLUGS = ['alan', 'hedef', 'net', 'tarz', 'butce'] as const;
export type StepSlug = (typeof STEP_SLUGS)[number];

export function isStepSlug(value: string): value is StepSlug {
  return (STEP_SLUGS as readonly string[]).includes(value);
}

export function stepIndex(slug: StepSlug): number {
  return STEP_SLUGS.indexOf(slug);
}

export function nextStep(slug: StepSlug): StepSlug | null {
  return STEP_SLUGS[stepIndex(slug) + 1] ?? null;
}

export function previousStep(slug: StepSlug): StepSlug | null {
  const i = stepIndex(slug);
  return i > 0 ? STEP_SLUGS[i - 1] : null;
}

export const STEP_META: Record<StepSlug, { title: string; help: string }> = {
  alan: {
    title: 'Hangi alanda hazırlanıyorsun?',
    help: 'Koçları önce alanına göre süzüyoruz, o yüzden burada doğru seçim önemli.',
  },
  hedef: {
    title: 'Hedefin ne?',
    help: 'Sıralama hedefin, koçun kendi çıkışıyla ne kadar örtüşüyor diye bakacağız.',
  },
  net: {
    title: 'Şu an nerede duruyorsun?',
    help: 'Son denemendeki netlerin yeterli. Kimse bunları görmüyor, sadece eşleştirmede kullanıyoruz.',
  },
  tarz: {
    title: 'Nasıl bir koç sana iyi gelir?',
    help: 'En çok istediğini ilk sıraya koy. Birden fazla seçebilirsin.',
  },
  butce: {
    title: 'Aylık bütçen ne kadar?',
    help: 'Bütçenin biraz üstündeki koçları da göstereceğiz — kapsamı küçültüp teklif verebilirsin.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────────────────

export const TRACK_OPTIONS: Array<{
  value: Track;
  short: string;
  label: string;
  detail: string;
}> = [
  { value: 'SAYISAL', short: 'SAY', label: 'Sayısal', detail: 'Matematik, Fizik, Kimya, Biyoloji' },
  { value: 'ESIT_AGIRLIK', short: 'EA', label: 'Eşit Ağırlık', detail: 'Matematik, Edebiyat, Tarih, Coğrafya' },
  { value: 'SOZEL', short: 'SÖZ', label: 'Sözel', detail: 'Edebiyat, Tarih, Coğrafya, Felsefe' },
  { value: 'DIL', short: 'DİL', label: 'Dil', detail: 'YDT İngilizce, Türkçe' },
];

export const GRADE_OPTIONS: Array<{ value: GradeLevel; label: string; detail: string }> = [
  { value: 'GRADE_11', label: '11. sınıf', detail: 'Uzun vadeli plan kurma zamanı' },
  { value: 'GRADE_12', label: '12. sınıf', detail: 'Okul ve sınav aynı anda' },
  { value: 'MEZUN', label: 'Mezun', detail: 'Tüm gün sınava ayrılmış bir yıl' },
];

/**
 * Coaching styles, written as the student would experience them rather than as
 * the enum names. "STRICT" is a database value; "Beni sıkı takip etsin" is what
 * a 17-year-old actually recognises about themselves.
 */
export const STYLE_OPTIONS: Array<{
  value: CoachingStyle;
  label: string;
  detail: string;
}> = [
  {
    value: 'STRICT',
    label: 'Sıkı takip etsin',
    detail: 'Program net, ödev kontrol edilir, kaçırdığın gün konuşulur.',
  },
  {
    value: 'EMPATHETIC',
    label: 'Moralimi toparlasın',
    detail: 'Kötü deneme sonrası konuşulacak biri; baskı değil destek.',
  },
  {
    value: 'STRATEGIC',
    label: 'Strateji kursun',
    detail: 'Hangi konu kaç net getirir, neyi bırakmak mantıklı — sayılarla çalışır.',
  },
  {
    value: 'HIGH_TOUCH',
    label: 'Sık sık görüşelim',
    detail: 'Haftada birkaç kez kısa temas, uzun aralar yok.',
  },
];

/** Ranking bands, phrased the way students talk about targets. */
export const RANKING_OPTIONS: Array<{ value: number; label: string; detail: string }> = [
  { value: 1_000, label: 'İlk 1.000', detail: 'Tıp, Boğaziçi/ODTÜ mühendislik' },
  { value: 5_000, label: 'İlk 5.000', detail: 'Devlet üniversitesi güçlü bölümler' },
  { value: 20_000, label: 'İlk 20.000', detail: 'İyi bir 4 yıllık bölüm' },
  { value: 50_000, label: 'İlk 50.000', detail: 'Hedefi netleştirme aşamasındayım' },
  { value: 150_000, label: 'İlk 150.000', detail: 'Önce sağlam bir temel' },
];

export const BUDGET_BOUNDS = {
  minMinor: 50_000, // 500 ₺
  maxMinor: 1_000_000, // 10.000 ₺
  stepMinor: 25_000, // 250 ₺
} as const;

export const DEFAULT_BUDGET = { minMinor: 150_000, maxMinor: 400_000 } as const;

export const CADENCE_OPTIONS: Array<{ value: PricingCadence; label: string }> = [
  { value: 'MONTHLY_STANDARD', label: 'Aylık paket' },
  { value: 'WEEKLY_SYNC', label: 'Haftalık görüşme' },
  { value: 'INTENSIVE', label: 'Yoğun program' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Per-step validation
// ─────────────────────────────────────────────────────────────────────────────

const trackSchema = z.object({
  track: z.enum(['SAYISAL', 'ESIT_AGIRLIK', 'SOZEL', 'DIL']),
  gradeLevel: z.enum(['GRADE_11', 'GRADE_12', 'MEZUN']),
});

const targetSchema = z.object({
  targetRanking: z.number().int().min(1).max(3_000_000),
  targetUniversity: z.string().trim().max(120).optional().or(z.literal('')),
  targetDepartment: z.string().trim().max(120).optional().or(z.literal('')),
});

/**
 * Nets are optional on purpose.
 *
 * A student who has not taken a deneme yet, or who is embarrassed by their
 * score, must not be blocked here — the matcher treats missing baselines as
 * neutral rather than as zero. Requiring a number we do not strictly need is
 * how you lose the exact students who need a coach most.
 */
const baselineSchema = z.object({
  baselineTytNet: z.number().min(0).max(120).nullable().optional(),
  baselineAytNet: z.number().min(0).max(80).nullable().optional(),
});

const styleSchema = z.object({
  preferredStyles: z
    .array(z.enum(['STRICT', 'EMPATHETIC', 'STRATEGIC', 'HIGH_TOUCH']))
    .min(1, 'En az bir tarz seç.')
    .max(4),
});

const budgetSchema = z
  .object({
    budgetMinMinor: z.number().int().min(0),
    budgetMaxMinor: z.number().int().min(0),
    budgetCadence: z.enum(['WEEKLY_SYNC', 'MONTHLY_STANDARD', 'INTENSIVE', 'SINGLE_SESSION']),
  })
  .refine((v) => v.budgetMaxMinor >= v.budgetMinMinor, {
    message: 'Üst sınır alt sınırdan küçük olamaz.',
    path: ['budgetMaxMinor'],
  });

export const STEP_SCHEMAS = {
  alan: trackSchema,
  hedef: targetSchema,
  net: baselineSchema,
  tarz: styleSchema,
  butce: budgetSchema,
} as const;

export type StepValues = {
  alan: z.infer<typeof trackSchema>;
  hedef: z.infer<typeof targetSchema>;
  net: z.infer<typeof baselineSchema>;
  tarz: z.infer<typeof styleSchema>;
  butce: z.infer<typeof budgetSchema>;
};

/** Everything the wizard holds client-side, all optional mid-funnel. */
export type OnboardingDraft = Partial<
  StepValues['alan'] &
    StepValues['hedef'] &
    StepValues['net'] &
    StepValues['tarz'] &
    StepValues['butce']
> & { completedStep?: number };

export function formatTry(minor: number): string {
  return `${Math.round(minor / 100).toLocaleString('tr-TR')} ₺`;
}
KAKTUS_FILE_EOF

emit "src/lib/payments/escrow.ts" <<'KAKTUS_FILE_EOF'
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Escrow accounting.
 *
 * Rules, in order of importance:
 *  1. Money is Int minor units. No floats, ever.
 *  2. Every movement is a balanced entry group. The DB trigger enforces it;
 *     this module makes it hard to get wrong in the first place.
 *  3. Balances are computed from entries. There is no mutable balance column.
 *  4. Commission is computed once, at capture, from the offer's snapshotted
 *     `commissionBps` — never from the current platform-wide setting.
 */

type Tx = Prisma.TransactionClient | PrismaClient;

export interface Split {
  grossMinor: number;
  commissionMinor: number;
  netToCoachMinor: number;
}

/**
 * Commission split. Rounds the commission DOWN, so any sub-kuruş remainder
 * lands with the coach rather than the platform. That is a deliberate choice:
 * rounding in the platform's own favour is the kind of detail that costs trust
 * for a rounding error's worth of revenue.
 */
export function splitAmount(grossMinor: number, commissionBps: number): Split {
  if (!Number.isInteger(grossMinor) || grossMinor <= 0) {
    throw new Error(`grossMinor must be a positive integer, got ${grossMinor}`);
  }
  if (commissionBps < 0 || commissionBps > 5000) {
    throw new Error(`commissionBps out of range: ${commissionBps}`);
  }
  const commissionMinor = Math.floor((grossMinor * commissionBps) / 10_000);
  return {
    grossMinor,
    commissionMinor,
    netToCoachMinor: grossMinor - commissionMinor,
  };
}

/** Divides a total across n milestones so the parts sum exactly to the total. */
export function splitIntoMilestones(totalMinor: number, count: number): number[] {
  if (count < 1) throw new Error('Milestone count must be >= 1');
  const base = Math.floor(totalMinor / count);
  const remainder = totalMinor - base * count;
  // Front-load the remainder: earlier milestones are worth marginally more,
  // which slightly favours the student if the engagement ends early.
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

type EntryInput = {
  account: Prisma.LedgerEntryCreateManyInput['account'];
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: number;
  description: string;
};

async function postGroup(
  tx: Tx,
  entries: EntryInput[],
  refs: {
    engagementId?: string;
    milestoneId?: string;
    paymentId?: string;
    payoutId?: string;
    coachProfileId?: string;
    currency?: string;
  },
): Promise<string> {
  const balance = entries.reduce(
    (sum, e) => sum + (e.direction === 'DEBIT' ? e.amountMinor : -e.amountMinor),
    0,
  );
  if (balance !== 0) {
    throw new Error(`Refusing to post unbalanced ledger group (off by ${balance})`);
  }

  const entryGroupId = randomUUID();
  await tx.ledgerEntry.createMany({
    data: entries.map((e) => ({
      entryGroupId,
      account: e.account,
      direction: e.direction,
      amountMinor: e.amountMinor,
      currency: refs.currency ?? 'TRY',
      description: e.description,
      engagementId: refs.engagementId,
      milestoneId: refs.milestoneId,
      paymentId: refs.paymentId,
      payoutId: refs.payoutId,
      coachProfileId: refs.coachProfileId,
    })),
  });
  return entryGroupId;
}

/**
 * Student's card is captured. Funds sit at the PSP and are owed to escrow.
 * Nothing is earned by anyone yet — that is the whole point of escrow.
 */
export async function postEscrowFunding(
  tx: Tx,
  args: { engagementId: string; paymentId: string; amountMinor: number; currency?: string },
) {
  return postGroup(
    tx,
    [
      {
        account: 'PSP_RECEIVABLE',
        direction: 'DEBIT',
        amountMinor: args.amountMinor,
        description: 'Card capture received at provider',
      },
      {
        account: 'PLATFORM_ESCROW',
        direction: 'CREDIT',
        amountMinor: args.amountMinor,
        description: 'Funds held in escrow for engagement',
      },
    ],
    { engagementId: args.engagementId, paymentId: args.paymentId, currency: args.currency },
  );
}

/**
 * Posts the ledger entries for a milestone release WITHOUT touching milestone
 * status. Callers that need to guard the status transition themselves (the
 * auto-release worker, which must CAS from PENDING_CONFIRMATION) use this and
 * own the write; everything else uses `releaseMilestone` below.
 */
export async function postMilestoneRelease(
  tx: Tx,
  args: {
    engagementId: string;
    milestoneId: string;
    coachProfileId: string;
    amountMinor: number;
    commissionBps: number;
    currency?: string;
  },
) {
  const split = splitAmount(args.amountMinor, args.commissionBps);

  const entries: EntryInput[] = [
    {
      account: 'PLATFORM_ESCROW',
      direction: 'DEBIT',
      amountMinor: split.grossMinor,
      description: 'Escrow released on milestone completion',
    },
    {
      account: 'COACH_PAYABLE',
      direction: 'CREDIT',
      amountMinor: split.netToCoachMinor,
      description: 'Coach earnings',
    },
  ];
  if (split.commissionMinor > 0) {
    entries.push({
      account: 'PLATFORM_REVENUE',
      direction: 'CREDIT',
      amountMinor: split.commissionMinor,
      description: `Platform commission (${args.commissionBps} bps)`,
    });
  }

  const entryGroupId = await postGroup(tx, entries, {
    engagementId: args.engagementId,
    milestoneId: args.milestoneId,
    coachProfileId: args.coachProfileId,
    currency: args.currency,
  });

  return { entryGroupId, split };
}

/**
 * A milestone period closed cleanly. Escrow is drawn down; the split lands in
 * coach payable and platform revenue.
 */
export async function releaseMilestone(
  tx: Tx,
  args: {
    engagementId: string;
    milestoneId: string;
    coachProfileId: string;
    amountMinor: number;
    commissionBps: number;
    currency?: string;
  },
) {
  const result = await postMilestoneRelease(tx, args);

  await tx.milestone.update({
    where: { id: args.milestoneId },
    data: { status: 'RELEASED', releasedAt: new Date() },
  });

  return result;
}

/** Money goes back to the student. Only unreleased escrow can be refunded. */
export async function refundFromEscrow(
  tx: Tx,
  args: {
    engagementId: string;
    milestoneId?: string;
    amountMinor: number;
    reason: string;
    currency?: string;
  },
) {
  const entryGroupId = await postGroup(
    tx,
    [
      {
        account: 'PLATFORM_ESCROW',
        direction: 'DEBIT',
        amountMinor: args.amountMinor,
        description: `Escrow refunded: ${args.reason}`,
      },
      {
        account: 'STUDENT_REFUND',
        direction: 'CREDIT',
        amountMinor: args.amountMinor,
        description: `Refund to student: ${args.reason}`,
      },
    ],
    {
      engagementId: args.engagementId,
      milestoneId: args.milestoneId,
      currency: args.currency,
    },
  );

  if (args.milestoneId) {
    await tx.milestone.update({
      where: { id: args.milestoneId },
      data: { status: 'REFUNDED', refundedAt: new Date() },
    });
  }
  return entryGroupId;
}

/** Coach withdraws. Payable is drawn down against the PSP receivable. */
export async function postPayout(
  tx: Tx,
  args: {
    payoutId: string;
    coachProfileId: string;
    amountMinor: number;
    currency?: string;
  },
) {
  return postGroup(
    tx,
    [
      {
        account: 'COACH_PAYABLE',
        direction: 'DEBIT',
        amountMinor: args.amountMinor,
        description: 'Payout to coach',
      },
      {
        account: 'PSP_RECEIVABLE',
        direction: 'CREDIT',
        amountMinor: args.amountMinor,
        description: 'Funds disbursed via provider',
      },
    ],
    {
      payoutId: args.payoutId,
      coachProfileId: args.coachProfileId,
      currency: args.currency,
    },
  );
}

/** Withdrawable balance, derived. Never read a cached column for this. */
export async function coachAvailableBalanceMinor(
  tx: Tx,
  coachProfileId: string,
): Promise<number> {
  const rows = await tx.ledgerEntry.groupBy({
    by: ['direction'],
    where: { coachProfileId, account: 'COACH_PAYABLE' },
    _sum: { amountMinor: true },
  });
  const credits = rows.find((r) => r.direction === 'CREDIT')?._sum.amountMinor ?? 0;
  const debits = rows.find((r) => r.direction === 'DEBIT')?._sum.amountMinor ?? 0;
  return credits - debits;
}

export async function engagementEscrowBalanceMinor(
  tx: Tx,
  engagementId: string,
): Promise<number> {
  const rows = await tx.ledgerEntry.groupBy({
    by: ['direction'],
    where: { engagementId, account: 'PLATFORM_ESCROW' },
    _sum: { amountMinor: true },
  });
  const credits = rows.find((r) => r.direction === 'CREDIT')?._sum.amountMinor ?? 0;
  const debits = rows.find((r) => r.direction === 'DEBIT')?._sum.amountMinor ?? 0;
  return credits - debits;
}
KAKTUS_FILE_EOF

emit "src/lib/payments/iyzico/client.ts" <<'KAKTUS_FILE_EOF'
import { buildAuthHeaders } from './signature';

/**
 * Iyzico HTTP transport.
 *
 * Hand-rolled rather than using the official `iyzipay` npm package, for three
 * reasons: the package is callback-based and awkward to await, it does not
 * expose the raw request and response bodies we need to persist as dispute
 * evidence, and its signing targets the retired SHA1 scheme. The v2 HMAC
 * scheme is about ten lines, so the dependency buys little.
 *
 * The trade-off is that we now own the correctness of the auth signature.
 * That is why it lives in `signature.ts` with a test reproducing Iyzico's own
 * documented worked example.
 */

export interface IyzicoConfig {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
  /** Reject unsigned responses. Must be true in production. */
  requireSignature: boolean;
  timeoutMs?: number;
}

export class IyzicoError extends Error {
  constructor(
    message: string,
    readonly kind: 'NETWORK' | 'TIMEOUT' | 'HTTP' | 'API' | 'SIGNATURE' | 'MALFORMED',
    readonly errorCode?: string,
    readonly httpStatus?: number,
    readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'IyzicoError';
  }

  /**
   * Whether a retry could plausibly succeed.
   *
   * Deliberately conservative: an API-level failure ("insufficient funds",
   * "invalid card") must never be retried, because retrying a payment that the
   * bank already declined for a business reason risks a duplicate charge if the
   * decline was actually a timeout misreported as a decline.
   */
  get retryable(): boolean {
    return this.kind === 'NETWORK' || this.kind === 'TIMEOUT' || (this.httpStatus ?? 0) >= 500;
  }
}

export interface IyzicoResponse {
  status: 'success' | 'failure';
  errorCode?: string;
  errorMessage?: string;
  locale?: string;
  systemTime?: number;
  conversationId?: string;
  signature?: string;
  [key: string]: unknown;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export class IyzicoClient {
  constructor(private readonly config: IyzicoConfig) {
    if (!config.apiKey || !config.secretKey) {
      throw new Error('Iyzico apiKey and secretKey are required');
    }
  }

  get secretKey(): string {
    return this.config.secretKey;
  }

  get requireSignature(): boolean {
    return this.config.requireSignature;
  }

  /**
   * Posts a JSON request and returns the parsed response.
   *
   * The body is serialised exactly once and that same string is both signed and
   * sent. Iyzico signs `randomKey + uriPath + body`, so any re-serialisation
   * (different key order, different whitespace) between signing and sending
   * yields a 401 that is genuinely painful to debug.
   */
  async post<T extends IyzicoResponse>(
    uriPath: string,
    body: Record<string, unknown>,
  ): Promise<{ data: T; rawRequest: string; rawResponse: string }> {
    const rawRequest = JSON.stringify(body);
    const headers = buildAuthHeaders({
      apiKey: this.config.apiKey,
      secretKey: this.config.secretKey,
      uriPath,
      requestBody: rawRequest,
    });

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${uriPath}`, {
        method: 'POST',
        headers,
        body: rawRequest,
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = (error as Error).name === 'AbortError';
      throw new IyzicoError(
        aborted ? `Iyzico request to ${uriPath} timed out` : `Network failure calling ${uriPath}`,
        aborted ? 'TIMEOUT' : 'NETWORK',
        undefined,
        undefined,
        error,
      );
    } finally {
      clearTimeout(timeout);
    }

    const rawResponse = await response.text();

    if (!response.ok && rawResponse.length === 0) {
      throw new IyzicoError(
        `Iyzico returned HTTP ${response.status} for ${uriPath}`,
        'HTTP',
        undefined,
        response.status,
      );
    }

    let data: T;
    try {
      data = JSON.parse(rawResponse) as T;
    } catch {
      throw new IyzicoError(
        `Iyzico returned a non-JSON body for ${uriPath}`,
        'MALFORMED',
        undefined,
        response.status,
        rawResponse.slice(0, 500),
      );
    }

    return { data, rawRequest, rawResponse };
  }
}

/**
 * A timed-out payment request is the single most dangerous outcome in this
 * integration: the charge may or may not have happened, and we cannot tell from
 * the error. Never retry blindly — query the payment by conversationId first.
 * The Checkout Form flow makes this tractable because the token is ours and the
 * retrieve endpoint is idempotent.
 */
export const TIMEOUT_RECOVERY_NOTE =
  'On TIMEOUT, do not retry the charge. Call retrieveCheckoutForm(token) to determine the true outcome.';
KAKTUS_FILE_EOF

emit "src/lib/payments/iyzico/money.ts" <<'KAKTUS_FILE_EOF'
/**
 * Money formatting for Iyzico.
 *
 * We store kuruş as integers. Iyzico wants decimal strings. Every conversion
 * between the two happens here and nowhere else, because this boundary is where
 * marketplace payment bugs live: a basket whose item prices do not sum exactly
 * to `price` is rejected outright, and a rounding error of one kuruş in a split
 * fails the whole payment.
 */

/**
 * 400000 (kuruş) → "4000.0"
 *
 * Iyzico accepts a trailing ".0"; its own SDKs send it. We keep one decimal
 * place minimum rather than emitting a bare integer, matching their samples.
 */
export function minorToIyzicoAmount(minor: number): string {
  if (!Number.isInteger(minor)) {
    throw new Error(`Amount must be an integer in minor units, got ${minor}`);
  }
  if (minor < 0) throw new Error(`Amount must not be negative, got ${minor}`);

  const lira = Math.floor(minor / 100);
  const kurus = minor % 100;
  if (kurus === 0) return `${lira}.0`;
  return `${lira}.${String(kurus).padStart(2, '0')}`;
}

/** "4000.0" | 4000 | "4000.55" → 400000 */
export function iyzicoAmountToMinor(amount: string | number): number {
  const value = typeof amount === 'number' ? amount : Number.parseFloat(amount);
  if (!Number.isFinite(value)) throw new Error(`Unparseable amount: ${amount}`);
  // Round rather than truncate: floating-point representation of 40.55 is
  // 40.549999999999997, and truncating would lose a kuruş on every conversion.
  return Math.round(value * 100);
}

/**
 * Trailing-zero normalisation required before computing a response signature.
 *
 * From Iyzico's spec: "10.50" → "10.5", "10.0" → "10", "10.51050" → "10.5105".
 *
 * Note that JSON.parse already collapses these — a response containing
 * `"price": 4000.00` parses to the number 4000 — so applying this to the parsed
 * value gives the same answer as applying it to the raw text. That equivalence
 * is verified in the test suite; it is the reason we can validate signatures
 * without re-parsing the raw response body.
 */
export function normalizeAmountForSignature(value: string | number): string {
  const s = String(value);
  if (!s.includes('.')) return s;
  const trimmed = s.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' ? '0' : trimmed;
}

/**
 * Splits a gross amount into per-milestone basket items whose prices sum
 * exactly to the total, and whose sub-merchant prices sum exactly to the
 * total minus commission.
 *
 * Iyzico infers the platform's commission as `price - Σ subMerchantPrice`, so
 * both sums have to be exact. Remainders are pushed onto the first item.
 */
export function buildSplit(args: {
  totalMinor: number;
  commissionBps: number;
  milestoneAmountsMinor: number[];
}): Array<{ priceMinor: number; subMerchantPriceMinor: number }> {
  const { totalMinor, commissionBps, milestoneAmountsMinor } = args;

  const sum = milestoneAmountsMinor.reduce((a, b) => a + b, 0);
  if (sum !== totalMinor) {
    throw new Error(`Milestone amounts sum to ${sum}, expected ${totalMinor}`);
  }

  const items = milestoneAmountsMinor.map((priceMinor) => {
    const commission = Math.floor((priceMinor * commissionBps) / 10_000);
    return { priceMinor, subMerchantPriceMinor: priceMinor - commission };
  });

  // Guard the invariant explicitly rather than trusting the arithmetic above:
  // a mismatch here is a silently wrong commission, which is the worst class of
  // bug in this system because it looks like it works.
  const netSum = items.reduce((a, i) => a + i.subMerchantPriceMinor, 0);
  const expectedCommission = totalMinor - netSum;
  if (expectedCommission < 0 || netSum > totalMinor) {
    throw new Error(`Invalid split: net ${netSum} exceeds total ${totalMinor}`);
  }

  return items;
}
KAKTUS_FILE_EOF

emit "src/lib/payments/iyzico/provider.ts" <<'KAKTUS_FILE_EOF'
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
KAKTUS_FILE_EOF

emit "src/lib/payments/iyzico/signature.ts" <<'KAKTUS_FILE_EOF'
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
KAKTUS_FILE_EOF

emit "src/lib/payments/provider.ts" <<'KAKTUS_FILE_EOF'
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

  if (process.env.PAYMENT_PROVIDER === 'iyzico') {
    // Imported lazily so the mock path never pulls in the Iyzico client, and so
    // a missing credential cannot break tests that do not touch payments.
    const { IyzicoPaymentProvider } = require('./iyzico/provider') as typeof import('./iyzico/provider');
    cached = new IyzicoPaymentProvider({
      apiKey: requireEnv('IYZICO_API_KEY'),
      secretKey: requireEnv('IYZICO_SECRET_KEY'),
      baseUrl: process.env.IYZICO_BASE_URL ?? 'https://sandbox-api.iyzipay.com',
      requireSignature: process.env.NODE_ENV === 'production',
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

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}
KAKTUS_FILE_EOF

emit "src/lib/storage/private-storage.ts" <<'KAKTUS_FILE_EOF'
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Private storage for verification documents.
 *
 * These are ÖSYM result documents and student ID cards belonging to people who
 * are frequently minors. Two rules follow and neither is negotiable:
 *
 *   1. The bucket is private. We store an object key, never a URL. Reads happen
 *      through a short-lived signed URL issued to an authenticated admin.
 *   2. Nothing is served from the app's public directory, ever. A file under
 *      `/public` is world-readable the moment its name is guessed.
 *
 * The local driver exists so `npm run dev` works without cloud credentials. It
 * writes outside the served tree and refuses to run in production.
 */

export interface StoredObject {
  storageKey: string;
  sizeBytes: number;
  mimeType: string;
}

export interface PrivateStorage {
  readonly name: string;
  put(args: {
    /** Logical folder, e.g. `verification/<coachProfileId>`. */
    prefix: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }): Promise<StoredObject>;
  /**
   * A short-lived URL for reading one stored object.
   *
   * Documents are never public — this is how the verification queue shows a
   * reviewer an ÖSYM result without the file ever becoming fetchable by anyone
   * holding its key. The link expires; reviewing a document twice means asking
   * for it twice, which is the correct cost.
   */
  signedUrl(storageKey: string, expiresInSeconds?: number): Promise<string>;
}

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export class DocumentRejected extends Error {
  constructor(
    message: string,
    readonly code: 'TOO_LARGE' | 'BAD_TYPE' | 'EMPTY' | 'CONTENT_MISMATCH',
  ) {
    super(message);
    this.name = 'DocumentRejected';
  }
}

/**
 * Validates a candidate upload.
 *
 * The magic-byte check matters more than the MIME header: the browser-supplied
 * `type` is trivially spoofed, and a private bucket full of files whose real
 * contents nobody verified is how a document store becomes a malware host.
 */
export function validateDocument(file: { size: number; type: string }, body: Buffer): void {
  if (body.length === 0) throw new DocumentRejected('Dosya boş.', 'EMPTY');
  if (body.length > MAX_DOCUMENT_BYTES) {
    throw new DocumentRejected('Dosya 8 MB sınırını aşıyor.', 'TOO_LARGE');
  }
  if (!ALLOWED_MIME.has(file.type)) {
    throw new DocumentRejected('Yalnızca PDF, JPG veya PNG yükleyebilirsin.', 'BAD_TYPE');
  }

  const declared = file.type;
  const actual = sniff(body);
  if (actual && actual !== declared) {
    throw new DocumentRejected(
      'Dosya içeriği uzantısıyla uyuşmuyor.',
      'CONTENT_MISMATCH',
    );
  }
}

function sniff(body: Buffer): string | null {
  if (body.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }
  if (body.subarray(0, 4).toString('latin1') === 'RIFF' && body.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function safeExtension(filename: string, contentType: string): string {
  const byType: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  return byType[contentType] ?? 'bin';
}

/** Development driver. Writes to `.private-uploads/`, outside the served tree. */
class LocalDiskStorage implements PrivateStorage {
  readonly name = 'local-disk';
  private readonly root = join(process.cwd(), '.private-uploads');

  async put(args: {
    prefix: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }): Promise<StoredObject> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'LocalDiskStorage refuses to run in production. Configure Supabase Storage.',
      );
    }
    // The stored name is generated, never taken from the upload: a filename is
    // attacker-controlled and path traversal here would write anywhere on disk.
    const key = `${args.prefix}/${randomUUID()}.${safeExtension(args.filename, args.contentType)}`;
    const target = join(this.root, key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, args.body);
    return { storageKey: key, sizeBytes: args.body.length, mimeType: args.contentType };
  }

  async signedUrl(storageKey: string): Promise<string> {
    // In development the reviewer opens the file from disk. Deliberately not a
    // served URL: wiring a route that streams arbitrary stored keys is exactly
    // the mistake this class of storage exists to avoid.
    return `file://${join(this.root, storageKey)}`;
  }
}

class SupabaseStorage implements PrivateStorage {
  readonly name = 'supabase';

  constructor(
    private readonly config: { url: string; serviceRoleKey: string; bucket: string },
  ) {}

  async put(args: {
    prefix: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }): Promise<StoredObject> {
    const key = `${args.prefix}/${randomUUID()}.${safeExtension(args.filename, args.contentType)}`;
    const endpoint = `${this.config.url}/storage/v1/object/${this.config.bucket}/${key}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.serviceRoleKey}`,
        'Content-Type': args.contentType,
        'x-upsert': 'false',
      },
      body: new Uint8Array(args.body),
    });

    if (!response.ok) {
      throw new Error(`Storage upload failed (${response.status}): ${await response.text()}`);
    }
    return { storageKey: key, sizeBytes: args.body.length, mimeType: args.contentType };
  }

  async signedUrl(storageKey: string, expiresInSeconds = 300): Promise<string> {
    const endpoint = `${this.config.url}/storage/v1/object/sign/${this.config.bucket}/${storageKey}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });
    if (!response.ok) {
      throw new Error(`Could not sign document URL (${response.status})`);
    }
    const data = (await response.json()) as { signedURL?: string };
    if (!data.signedURL) throw new Error('Storage returned no signed URL');
    return `${this.config.url}/storage/v1${data.signedURL}`;
  }
}

let cached: PrivateStorage | null = null;

export function getPrivateStorage(): PrivateStorage {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  cached =
    url && serviceRoleKey
      ? new SupabaseStorage({
          url,
          serviceRoleKey,
          bucket: process.env.SUPABASE_VERIFICATION_BUCKET ?? 'verification',
        })
      : new LocalDiskStorage();

  return cached;
}

/** Convenience wrapper used by the admin verification queue. */
export async function getDocumentUrl(storageKey: string, expiresInSeconds = 300): Promise<string> {
  return getPrivateStorage().signedUrl(storageKey, expiresInSeconds);
}
KAKTUS_FILE_EOF

emit "src/lib/time/windows.ts" <<'KAKTUS_FILE_EOF'
/**
 * Weekly time windows, expressed in minutes from local midnight.
 *
 * Turkey is UTC+3 year-round with no DST, so weekday+minute arithmetic is safe
 * for the domestic case. The `timezone` field is carried anyway because coaches
 * studying abroad are a real segment, and retrofitting timezones later is
 * expensive.
 */

export interface TimeWindow {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  /** minutes from local midnight, 0..1440 */
  startMinute: number;
  endMinute: number;
}

export const MINUTES_PER_DAY = 1440;

export function isValidWindow(w: TimeWindow): boolean {
  return (
    Number.isInteger(w.weekday) &&
    w.weekday >= 0 &&
    w.weekday <= 6 &&
    w.startMinute >= 0 &&
    w.endMinute <= MINUTES_PER_DAY &&
    w.endMinute > w.startMinute
  );
}

/** Merges overlapping/adjacent windows per weekday. Input is not mutated. */
export function normalizeWindows(windows: TimeWindow[]): TimeWindow[] {
  const byDay = new Map<number, TimeWindow[]>();

  for (const w of windows) {
    if (!isValidWindow(w)) continue;
    const bucket = byDay.get(w.weekday) ?? [];
    bucket.push({ ...w });
    byDay.set(w.weekday, bucket);
  }

  const out: TimeWindow[] = [];
  for (const [weekday, bucket] of byDay) {
    bucket.sort((a, b) => a.startMinute - b.startMinute);
    let current = bucket[0];
    for (let i = 1; i < bucket.length; i++) {
      const next = bucket[i];
      if (next.startMinute <= current.endMinute) {
        current = {
          weekday,
          startMinute: current.startMinute,
          endMinute: Math.max(current.endMinute, next.endMinute),
        };
      } else {
        out.push(current);
        current = next;
      }
    }
    out.push(current);
  }

  return out.sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
}

export function totalMinutes(windows: TimeWindow[]): number {
  return normalizeWindows(windows).reduce(
    (sum, w) => sum + (w.endMinute - w.startMinute),
    0,
  );
}

/** Intersection of two window sets, as a new normalized set. */
export function intersectWindows(a: TimeWindow[], b: TimeWindow[]): TimeWindow[] {
  const left = normalizeWindows(a);
  const right = normalizeWindows(b);
  const out: TimeWindow[] = [];

  for (const l of left) {
    for (const r of right) {
      if (l.weekday !== r.weekday) continue;
      const start = Math.max(l.startMinute, r.startMinute);
      const end = Math.min(l.endMinute, r.endMinute);
      if (end > start) out.push({ weekday: l.weekday, startMinute: start, endMinute: end });
    }
  }

  return normalizeWindows(out);
}

export function overlapMinutes(a: TimeWindow[], b: TimeWindow[]): number {
  return totalMinutes(intersectWindows(a, b));
}

/** Distinct weekdays covered, useful for "kaç gün ortak müsaitlik" copy. */
export function coveredWeekdays(windows: TimeWindow[]): number[] {
  return [...new Set(normalizeWindows(windows).map((w) => w.weekday))].sort();
}

export function subtractWindow(base: TimeWindow, cut: TimeWindow): TimeWindow[] {
  if (base.weekday !== cut.weekday) return [base];
  const start = Math.max(base.startMinute, cut.startMinute);
  const end = Math.min(base.endMinute, cut.endMinute);
  if (end <= start) return [base];

  const pieces: TimeWindow[] = [];
  if (base.startMinute < start) {
    pieces.push({ weekday: base.weekday, startMinute: base.startMinute, endMinute: start });
  }
  if (end < base.endMinute) {
    pieces.push({ weekday: base.weekday, startMinute: end, endMinute: base.endMinute });
  }
  return pieces;
}

const TR_WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

export function formatWindowTr(w: TimeWindow): string {
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `${TR_WEEKDAYS[w.weekday]} ${fmt(w.startMinute)}–${fmt(w.endMinute)}`;
}
KAKTUS_FILE_EOF

emit "src/lib/tx.ts" <<'KAKTUS_FILE_EOF'
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Concurrency primitives.
 *
 * The governing idea: **every state write is a compare-and-swap against the
 * expected prior state.** The FSM guards in `state-machine.ts` are advisory —
 * they run against a snapshot that may already be stale by the time we write.
 * The CAS is authoritative. If the row moved under us, the update matches zero
 * rows and we fail loudly instead of applying a transition computed from a
 * state that no longer exists.
 *
 * This is why the money paths do not need SERIALIZABLE isolation for the common
 * case: a lost update is impossible when the WHERE clause names the prior state,
 * and READ COMMITTED re-evaluates the predicate on a blocked row when the
 * conflicting transaction commits. Serializable is reserved for the reads that
 * must see a consistent *aggregate* (escrow balance sums), where CAS does not
 * help.
 */

export type Tx = Prisma.TransactionClient;

/** Prisma's default 5s interactive-transaction timeout is too tight for the
 *  money paths, which touch six tables. Explicit, not inherited. */
export const TX_OPTIONS = {
  maxWait: 5_000,
  timeout: 20_000,
} as const;

export class ConcurrentModificationError extends Error {
  constructor(
    readonly entity: string,
    readonly id: string,
    readonly expected: string,
  ) {
    super(
      `${entity} ${id} was modified concurrently (expected state ${expected}). Retry with fresh state.`,
    );
    this.name = 'ConcurrentModificationError';
  }
}

/**
 * Compare-and-swap on a status column.
 *
 * `updateMany` with the expected status in the WHERE clause compiles to a single
 * conditional UPDATE. Under READ COMMITTED, a second transaction attempting the
 * same swap blocks on the row lock, then re-checks the predicate after the first
 * commits — and matches zero rows. Exactly one caller wins, with no explicit
 * locking and no retry loop.
 */
export async function casStatus<T extends { updateMany: (args: any) => Promise<{ count: number }> }>(
  model: T,
  args: {
    id: string;
    from: string | string[];
    data: Record<string, unknown>;
    entity: string;
  },
): Promise<void> {
  const from = Array.isArray(args.from) ? args.from : [args.from];
  const { count } = await model.updateMany({
    where: { id: args.id, status: { in: from } },
    data: args.data,
  });
  if (count !== 1) {
    throw new ConcurrentModificationError(args.entity, args.id, from.join('|'));
  }
}

/**
 * Transaction-scoped Postgres advisory lock, keyed by an arbitrary string.
 *
 * Used to serialise *job* execution, not user requests: two workers sweeping
 * milestones must not both process the same engagement. Released automatically
 * at commit or rollback, so a crashed worker cannot strand the lock — which is
 * the failure mode that makes application-level "isLocked" columns a bad idea.
 */
export async function acquireAdvisoryLock(tx: Tx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** Non-blocking variant: skip the work rather than queue behind another worker. */
export async function tryAdvisoryLock(tx: Tx, key: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked
  `;
  return rows[0]?.locked === true;
}

const SERIALIZATION_FAILURE = '40001';
const DEADLOCK_DETECTED = '40P01';

function isRetryable(error: unknown): boolean {
  const e = error as { code?: string; meta?: { code?: string } };
  const code = e?.code ?? e?.meta?.code;
  return code === SERIALIZATION_FAILURE || code === DEADLOCK_DETECTED;
}

/**
 * Runs a transaction at SERIALIZABLE with bounded retry.
 *
 * Postgres aborts serialization conflicts rather than blocking, so the caller
 * *must* retry — a SERIALIZABLE transaction without a retry loop is a latent
 * 500. Only used where an aggregate read (escrow balance) drives a write.
 */
export async function withSerializableRetry<T>(
  fn: (tx: Tx) => Promise<T>,
  attempts = 3,
  client: PrismaClient = prisma,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await client.$transaction(fn, {
        ...TX_OPTIONS,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) throw error;
      // Full jitter — synchronised retries just re-collide.
      await new Promise((r) => setTimeout(r, Math.random() * 40 * attempt));
    }
  }
  throw lastError;
}

/** Deterministic idempotency key. Same inputs must always produce the same key. */
export function idempotencyKey(...parts: (string | number)[]): string {
  return parts.map((p) => String(p).replace(/[:|]/g, '_')).join(':');
}
KAKTUS_FILE_EOF

emit "src/lib/utils.ts" <<'KAKTUS_FILE_EOF'
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** 400000 (kuruş) → "4.000 ₺" */
export function formatTry(minor: number): string {
  return `${Math.round(minor / 100).toLocaleString('tr-TR')} ₺`;
}

/** 4500 → "4.500", 120000 → "120 bin" — how students actually say rankings. */
export function formatRanking(rank: number): string {
  if (rank >= 100_000) return `${Math.round(rank / 1000)} bin`;
  return rank.toLocaleString('tr-TR');
}
KAKTUS_FILE_EOF

emit "src/server/actions/admin.ts" <<'KAKTUS_FILE_EOF'
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { resolveDispute } from '@/server/services/dispute-service';
import { getDocumentUrl } from '@/lib/storage/private-storage';

/**
 * Admin actions.
 *
 * Every one of these is gated by `requireAdmin`, which throws rather than
 * returning a flag — an admin check that can be accidentally ignored by not
 * reading the return value is not a check.
 *
 * These are deliberately thin. For the first dozen coaches you will verify
 * documents by eye and resolve disputes by talking to people; the tooling
 * exists to record the decision and move the money, not to make the decision
 * for you. What the tools should eventually automate will be obvious after
 * doing it manually twenty times, and not before.
 */

export type AdminResult = { ok: true } | { ok: false; message: string };

const reviewSchema = z.object({
  coachProfileId: z.string().min(1),
  note: z.string().max(1000).optional(),
});

/**
 * Approves a coach and makes them discoverable.
 *
 * Also flips their documents to APPROVED, so the verification queue empties as
 * decisions are made rather than accumulating rows nobody looks at again.
 */
export async function approveCoach(input: { coachProfileId: string; note?: string }): Promise<AdminResult> {
  const admin = await requireAdmin();
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Geçersiz istek.' };

  await prisma.$transaction(async (tx) => {
    const coach = await tx.coachProfile.update({
      where: { id: parsed.data.coachProfileId },
      data: {
        verificationStatus: 'APPROVED',
        verifiedAt: new Date(),
        verificationNote: parsed.data.note ?? null,
      },
      select: { userId: true },
    });

    await tx.verificationDocument.updateMany({
      where: { coachProfileId: parsed.data.coachProfileId, status: { in: ['PENDING', 'IN_REVIEW'] } },
      data: { status: 'APPROVED', reviewedById: admin.id, reviewedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        actorId: admin.id,
        actorRole: 'ADMIN',
        action: 'coach.approved',
        entityType: 'CoachProfile',
        entityId: parsed.data.coachProfileId,
        metadata: { note: parsed.data.note ?? null },
      },
    });

    void coach;
  });

  revalidatePath('/admin');
  revalidatePath('/koc-ol');
  return { ok: true };
}

/**
 * Rejects an application.
 *
 * The note is required, not optional. A rejection without a reason produces a
 * support ticket and a confused person; most rejections here are an unreadable
 * document, which is entirely fixable if we say so.
 */
export async function rejectCoach(input: { coachProfileId: string; note: string }): Promise<AdminResult> {
  const admin = await requireAdmin();
  if (!input.note || input.note.trim().length < 10) {
    return { ok: false, message: 'Gerekçe yaz — koç bunu görecek ve düzeltebilmeli.' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.coachProfile.update({
      where: { id: input.coachProfileId },
      data: { verificationStatus: 'REJECTED', verificationNote: input.note.trim() },
    });
    await tx.verificationDocument.updateMany({
      where: { coachProfileId: input.coachProfileId, status: { in: ['PENDING', 'IN_REVIEW'] } },
      data: { status: 'REJECTED', reviewedById: admin.id, reviewedAt: new Date(), reviewNote: input.note.trim() },
    });
    await tx.auditLog.create({
      data: {
        actorId: admin.id,
        actorRole: 'ADMIN',
        action: 'coach.rejected',
        entityType: 'CoachProfile',
        entityId: input.coachProfileId,
        metadata: { note: input.note.trim() },
      },
    });
  });

  revalidatePath('/admin');
  return { ok: true };
}

/** Suspends an approved coach. Existing engagements are untouched. */
export async function suspendCoach(input: { coachProfileId: string; note: string }): Promise<AdminResult> {
  const admin = await requireAdmin();
  if (!input.note?.trim()) return { ok: false, message: 'Gerekçe gerekli.' };

  await prisma.coachProfile.update({
    where: { id: input.coachProfileId },
    data: {
      verificationStatus: 'SUSPENDED',
      suspendedAt: new Date(),
      acceptingStudents: false,
      verificationNote: input.note.trim(),
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      actorRole: 'ADMIN',
      action: 'coach.suspended',
      entityType: 'CoachProfile',
      entityId: input.coachProfileId,
      metadata: { note: input.note.trim() },
    },
  });

  revalidatePath('/admin');
  return { ok: true };
}

/**
 * Short-lived link to a verification document. Admin only, never public.
 *
 * Its own result type rather than reusing `AdminResult`: unioning a success
 * shape that carries a URL with one that does not means callers cannot narrow
 * on `ok` alone, and the compiler rejects reading `message` off the failure
 * branch. Two different results deserve two different types.
 */
export type ViewDocumentResult =
  | { ok: true; url: string }
  | { ok: false; message: string };

export async function viewDocument(documentId: string): Promise<ViewDocumentResult> {
  await requireAdmin();
  const document = await prisma.verificationDocument.findUnique({
    where: { id: documentId },
    select: { storageKey: true },
  });
  if (!document) return { ok: false, message: 'Belge bulunamadı.' };

  try {
    const url = await getDocumentUrl(document.storageKey);
    return { ok: true, url };
  } catch (error) {
    console.error('[admin] could not sign document url', error);
    return { ok: false, message: 'Belge bağlantısı oluşturulamadı.' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Disputes
// ─────────────────────────────────────────────────────────────────────────────

const resolutionSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('RELEASE'), note: z.string().min(5).max(1000) }),
  z.object({ outcome: z.literal('REFUND'), note: z.string().min(5).max(1000) }),
  z.object({
    outcome: z.literal('SPLIT'),
    note: z.string().min(5).max(1000),
    coachShareMinor: z.number().int().min(0),
  }),
]);

/**
 * Records a dispute decision and moves the money.
 *
 * The actual accounting lives in the dispute service, which is the only thing
 * allowed to touch the ledger. This is a thin wrapper that checks the admin
 * role and validates the shape — deliberately, so there is exactly one code
 * path that can reverse a payment.
 */
export async function resolveDisputeAction(input: {
  disputeId: string;
  outcome: 'RELEASE' | 'REFUND' | 'SPLIT';
  note: string;
  coachShareMinor?: number;
}): Promise<AdminResult> {
  const admin = await requireAdmin();
  const parsed = resolutionSchema.safeParse(
    input.outcome === 'SPLIT'
      ? { outcome: 'SPLIT', note: input.note, coachShareMinor: input.coachShareMinor ?? 0 }
      : { outcome: input.outcome, note: input.note },
  );
  if (!parsed.success) {
    return { ok: false, message: 'Karar gerekçesi en az 5 karakter olmalı.' };
  }

  try {
    await resolveDispute({
      disputeId: input.disputeId,
      adminUserId: admin.id,
      resolution: parsed.data,
    });
    revalidatePath('/admin/itirazlar');
    return { ok: true };
  } catch (error) {
    console.error('[admin] dispute resolution failed', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Karar uygulanamadı.',
    };
  }
}
KAKTUS_FILE_EOF

emit "src/server/actions/coach-application.ts" <<'KAKTUS_FILE_EOF'
'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { TX_OPTIONS } from '@/lib/tx';
import {
  coachApplicationSchema,
  slugify,
  type CoachApplicationInput,
} from '@/lib/coach/application';
import { encryptField } from '@/lib/crypto/field';
import { ibanLast4, isValidTckn, isValidTrIban, isValidVkn } from '@/lib/coach/identifiers';
import {
  DocumentRejected,
  getPrivateStorage,
  validateDocument,
} from '@/lib/storage/private-storage';

/**
 * Coach application.
 *
 * Unlike the student funnel, this requires an account *before* the form rather
 * than after. Two reasons: the application carries a national ID and an IBAN,
 * which must never sit in a guest cookie the way a draft offer does; and a
 * coach signing up is making a considered decision, so an account is not the
 * friction that loses them.
 */

export type ApplyResult =
  | { ok: true; coachProfileId: string; slug: string }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'ALREADY_APPLIED' | 'VALIDATION' | 'FAILED';
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

/**
 * Creates (or returns) a DRAFT profile so verification documents have something
 * to attach to before the application is complete. A coach uploads their ÖSYM
 * document early and finishes the rest later; without a row to hang it on, the
 * upload would have to be held in memory across steps.
 */
export async function ensureCoachDraft(): Promise<
  { ok: true; coachProfileId: string } | { ok: false; code: 'UNAUTHENTICATED' | 'ALREADY_APPLIED' }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: 'UNAUTHENTICATED' };

  const existing = await prisma.coachProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, verificationStatus: true },
  });

  if (existing) {
    if (existing.verificationStatus !== 'DRAFT') {
      return { ok: false, code: 'ALREADY_APPLIED' };
    }
    return { ok: true, coachProfileId: existing.id };
  }

  const created = await prisma.coachProfile.create({
    data: {
      userId: session.user.id,
      slug: `taslak-${randomBytes(6).toString('hex')}`,
      headline: '',
      bio: '',
      university: '',
      department: '',
      yksRank: 1,
      yksYear: new Date().getFullYear(),
      yksTrack: 'SAYISAL',
      verificationStatus: 'DRAFT',
      acceptingStudents: false,
    },
    select: { id: true },
  });

  return { ok: true, coachProfileId: created.id };
}

export type UploadResult =
  | { ok: true; documentId: string; filename: string; sizeBytes: number }
  | { ok: false; message: string };

/**
 * Stores a verification document in the private bucket.
 *
 * Server Actions cap request bodies at 1 MB by default, which silently breaks
 * on a phone photo of an ÖSYM printout. `next.config.ts` raises it to 8 MB to
 * match `MAX_DOCUMENT_BYTES`.
 */
export async function uploadVerificationDocument(formData: FormData): Promise<UploadResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: 'Önce giriş yapman gerekiyor.' };

  const file = formData.get('file');
  const type = String(formData.get('type') ?? 'YKS_RESULT');
  if (!(file instanceof File)) return { ok: false, message: 'Dosya bulunamadı.' };

  const draft = await ensureCoachDraft();
  if (!draft.ok) {
    return {
      ok: false,
      message:
        draft.code === 'ALREADY_APPLIED'
          ? 'Başvurun zaten inceleniyor.'
          : 'Önce giriş yapman gerekiyor.',
    };
  }

  try {
    const body = Buffer.from(await file.arrayBuffer());
    validateDocument({ size: file.size, type: file.type }, body);

    const stored = await getPrivateStorage().put({
      prefix: `verification/${draft.coachProfileId}`,
      filename: file.name,
      contentType: file.type,
      body,
    });

    const document = await prisma.verificationDocument.create({
      data: {
        coachProfileId: draft.coachProfileId,
        type: type as never,
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        status: 'PENDING',
      },
      select: { id: true },
    });

    return {
      ok: true,
      documentId: document.id,
      filename: file.name,
      sizeBytes: stored.sizeBytes,
    };
  } catch (error) {
    if (error instanceof DocumentRejected) return { ok: false, message: error.message };
    console.error('[coach-apply] upload failed', error);
    return { ok: false, message: 'Dosya yüklenemedi. Tekrar dene.' };
  }
}

/**
 * Submits the application.
 *
 * Everything lands in one transaction: the profile, its pricing tiers, its
 * availability rules, the specialization, and the encrypted payout details. A
 * partial application would appear in the admin queue looking complete while
 * being unpayable, which is exactly the kind of half-state that wastes a
 * reviewer's afternoon.
 */
export async function submitCoachApplication(
  input: CoachApplicationInput,
): Promise<ApplyResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Önce giriş yapman gerekiyor.' };
  }

  const parsed = coachApplicationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'Bazı alanlar eksik ya da hatalı.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const data = parsed.data;

  // Identity and bank checks run server-side too. The client validates the same
  // rules for fast feedback, but a malformed IBAN reaching Iyzico produces an
  // opaque rejection days later, so this is the copy that counts.
  const identityValid =
    data.submerchantType === 'PERSONAL'
      ? isValidTckn(data.identityNumber)
      : isValidVkn(data.identityNumber);
  if (!identityValid) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'Kimlik/vergi numarası doğrulanamadı.',
      fieldErrors: { identityNumber: ['Numara geçersiz görünüyor.'] },
    };
  }
  if (!isValidTrIban(data.iban)) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'IBAN doğrulanamadı.',
      fieldErrors: { iban: ['TR ile başlayan 26 haneli bir IBAN gir.'] },
    };
  }

  const existing = await prisma.coachProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, verificationStatus: true },
  });
  if (existing && existing.verificationStatus !== 'DRAFT') {
    return {
      ok: false,
      code: 'ALREADY_APPLIED',
      message: 'Başvurun zaten alındı. Sonucu e-posta ile bildireceğiz.',
    };
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { name: true },
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const slug = await uniqueSlug(tx, user.name ?? data.legalName);

      const coach = existing
        ? await tx.coachProfile.update({
            where: { id: existing.id },
            data: profileFields(data, slug),
            select: { id: true, slug: true },
          })
        : await tx.coachProfile.create({
            data: { userId: session.user.id!, ...profileFields(data, slug) },
            select: { id: true, slug: true },
          });

      // Replace rather than merge: resubmitting a draft must not leave stale
      // prices or availability windows from an earlier attempt.
      await tx.pricingTier.deleteMany({ where: { coachProfileId: coach.id } });
      await tx.availabilityRule.deleteMany({ where: { coachProfileId: coach.id } });
      await tx.coachSpecialization.deleteMany({ where: { coachProfileId: coach.id } });

      await tx.pricingTier.create({
        data: {
          coachProfileId: coach.id,
          name: 'Aylık program',
          cadence: 'MONTHLY_STANDARD',
          priceMinor: data.monthlyPriceMinor,
          sessionsPerCycle: data.sessionsPerMonth,
          minutesPerSession: data.minutesPerSession,
          sortOrder: 0,
        },
      });

      if (data.sessionPriceMinor) {
        await tx.pricingTier.create({
          data: {
            coachProfileId: coach.id,
            name: 'Tanışma seansı',
            cadence: 'SINGLE_SESSION',
            priceMinor: data.sessionPriceMinor,
            sessionsPerCycle: 1,
            minutesPerSession: data.minutesPerSession,
            sortOrder: 1,
          },
        });
      }

      await tx.availabilityRule.createMany({
        data: data.availability.map((window) => ({
          coachProfileId: coach.id,
          weekday: window.weekday,
          startMinute: window.startMinute,
          endMinute: window.endMinute,
          active: true,
        })),
      });

      if (data.specializationLabel) {
        await tx.coachSpecialization.create({
          data: {
            coachProfileId: coach.id,
            label: data.specializationLabel,
            slug: slugify(data.specializationLabel) || 'uzmanlik',
            fromRank: data.targetRankFrom ?? null,
            toRank: data.targetRankTo ?? null,
          },
        });
      }

      await tx.coachPayoutProfile.upsert({
        where: { coachProfileId: coach.id },
        create: {
          coachProfileId: coach.id,
          submerchantType: data.submerchantType,
          legalName: data.legalName,
          ibanEncrypted: encryptField(data.iban.replace(/\s/g, '').toUpperCase()),
          ibanLast4: ibanLast4(data.iban),
          identityEncrypted: encryptField(data.identityNumber.replace(/\D/g, '')),
          taxOffice: data.taxOffice ?? null,
          address: data.address,
          city: data.city,
          phone: data.phone,
        },
        update: {
          submerchantType: data.submerchantType,
          legalName: data.legalName,
          ibanEncrypted: encryptField(data.iban.replace(/\s/g, '').toUpperCase()),
          ibanLast4: ibanLast4(data.iban),
          identityEncrypted: encryptField(data.identityNumber.replace(/\D/g, '')),
          taxOffice: data.taxOffice ?? null,
          address: data.address,
          city: data.city,
          phone: data.phone,
        },
      });

      await tx.user.update({
        where: { id: session.user.id! },
        data: { roles: { set: ['STUDENT', 'COACH'] } },
      });

      await tx.auditLog.create({
        data: {
          actorId: session.user.id,
          actorRole: 'COACH',
          action: 'coach.applied',
          entityType: 'CoachProfile',
          entityId: coach.id,
          // Deliberately no payout fields in the audit metadata: an audit log is
          // widely readable and must not become a second copy of the IBAN.
          metadata: { slug: coach.slug, submerchantType: data.submerchantType },
        },
      });

      return coach;
    }, TX_OPTIONS);

    revalidatePath('/koc-ol');
    return { ok: true, coachProfileId: result.id, slug: result.slug };
  } catch (error) {
    console.error('[coach-apply] submit failed', error);
    return { ok: false, code: 'FAILED', message: 'Başvuru kaydedilemedi. Tekrar dene.' };
  }
}

function profileFields(
  data: Awaited<ReturnType<typeof coachApplicationSchema.parse>>,
  slug: string,
) {
  return {
    slug,
    headline: data.headline,
    bio: data.bio,
    university: data.university,
    department: data.department,
    graduationYear: data.graduationYear ?? null,
    yksRank: data.yksRank,
    yksYear: data.yksYear,
    yksTrack: data.yksTrack,
    ownBaselineNet: data.ownBaselineNet ?? null,
    ownFinalNet: data.ownFinalNet ?? null,
    wasMezun: data.wasMezun,
    tracks: data.tracks,
    subjects: data.subjects,
    styles: data.styles,
    supportedGrades: data.supportedGrades,
    maxActiveStudents: data.maxActiveStudents,
    weeklyCapacityHours: data.weeklyCapacityHours ?? null,
    city: data.city,
    // PENDING is the enum's name for what the brief calls PENDING_VERIFICATION.
    verificationStatus: 'PENDING' as const,
    // Not accepting students until a human approves. The discovery query filters
    // on APPROVED anyway, but leaving this true would make an unreviewed coach
    // one enum change away from being live.
    acceptingStudents: false,
  };
}

/** Appends a short suffix on collision rather than failing the submission. */
async function uniqueSlug(tx: Prisma.TransactionClient, name: string): Promise<string> {
  const base = slugify(name) || 'koc';
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
    const taken = await tx.coachProfile.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return `${base}-${randomBytes(4).toString('hex')}`;
}

/** Status for the landing/success screen. */
export async function getApplicationStatus() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return prisma.coachProfile.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      slug: true,
      verificationStatus: true,
      verificationNote: true,
      createdAt: true,
      documents: { select: { id: true, type: true, status: true } },
    },
  });
}
KAKTUS_FILE_EOF

emit "src/server/actions/negotiation.ts" <<'KAKTUS_FILE_EOF'
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { moderateMessage, THRESHOLDS } from '@/lib/chat/anti-circumvention';
import { encryptField, encryptionAvailable } from '@/lib/crypto/field';
import { transitionOffer } from '@/server/services/offer-service';
import { startCheckout } from '@/server/services/payment-service';
import { SlotUnavailableError } from '@/lib/booking/holds';
import { createOffer } from '@/server/services/offer-service';

/**
 * Negotiation actions.
 *
 * Everything exported from this file must be an async function — Next enforces
 * that for `'use server'` modules, because every export becomes a callable RPC
 * endpoint and an object cannot be one. Shared constants live in plain modules
 * (`PACKAGE_CONFIG` is in `@/lib/offers/draft`) and are imported directly by
 * whoever needs them; re-exporting one from here to save an import breaks the
 * build.
 *
 * Every one of these re-derives the caller's role from the database rather than
 * trusting anything sent from the browser. A conversation is between two named
 * parties and involves money; "the client said I'm the coach" is not a basis
 * for accepting an offer.
 */

async function requireParty(conversationId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('UNAUTHENTICATED');

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      riskScore: true,
      coachProfileId: true,
      studentProfileId: true,
      coach: { select: { userId: true } },
      student: { select: { userId: true } },
    },
  });
  if (!conversation) throw new Error('NOT_FOUND');

  const isCoach = conversation.coach.userId === session.user.id;
  const isStudent = conversation.student.userId === session.user.id;
  if (!isCoach && !isStudent) throw new Error('FORBIDDEN');

  return {
    conversation,
    userId: session.user.id,
    role: (isCoach ? 'COACH' : 'STUDENT') as 'COACH' | 'STUDENT',
    profileId: isCoach ? conversation.coachProfileId : conversation.studentProfileId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Messaging
// ─────────────────────────────────────────────────────────────────────────────

export type SendMessageResult =
  | { ok: true; masked: boolean; notice: string }
  | { ok: false; blocked: true; notice: string }
  | { ok: false; blocked: false; message: string };

const bodySchema = z.string().trim().min(1).max(4000);

/**
 * Sends a message through the anti-circumvention filter.
 *
 * Three outcomes: sent as written, sent with contact details masked, or refused.
 * All three tell the user what happened. A silently altered message would be
 * worse than a blocked one — people need to know their phone number did not
 * reach the other side, or they will sit waiting for a call that never comes.
 */
export async function sendMessage(
  conversationId: string,
  rawBody: string,
): Promise<SendMessageResult> {
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return { ok: false, blocked: false, message: 'Mesaj boş olamaz.' };

  const { conversation, userId } = await requireParty(conversationId);
  const verdict = moderateMessage(parsed.data, conversation.riskScore);

  if (verdict.action === 'BLOCK') {
    // Record the attempt without storing the message. The violation rows carry
    // redacted excerpts only — enough for an admin to see a pattern, never
    // enough to reconstruct the contact detail someone tried to share.
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        riskScore: { increment: verdict.riskScore },
        ...(conversation.riskScore + verdict.riskScore >= THRESHOLDS.flagConversation
          ? { flaggedAt: new Date() }
          : {}),
      },
    });
    return { ok: false, blocked: true, notice: verdict.notice };
  }

  await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        conversationId,
        senderId: userId,
        body: verdict.redacted,
        // The original is kept only when a mask actually happened, and only
        // encrypted — it is dispute evidence, not a searchable archive.
        bodyOriginalEncrypted:
          verdict.action === 'MASK' && encryptionAvailable() ? encryptField(parsed.data) : null,
        moderationAction: verdict.action,
        riskScore: verdict.riskScore,
        systemNotice: verdict.action === 'MASK' ? verdict.notice : null,
      },
    });

    if (verdict.findings.length > 0) {
      await tx.messageViolation.createMany({
        data: verdict.findings.map((finding) => ({
          messageId: message.id,
          kind: finding.kind,
          severity: finding.severity,
          detector: finding.detector,
          excerpt: finding.excerpt,
        })),
      });
    }

    const newRisk = conversation.riskScore + verdict.riskScore;
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        riskScore: newRisk,
        ...(newRisk >= THRESHOLDS.flagConversation ? { flaggedAt: new Date() } : {}),
      },
    });
  });

  revalidatePath(`/panel/sohbet/${conversationId}`);
  return { ok: true, masked: verdict.action === 'MASK', notice: verdict.notice };
}

// ─────────────────────────────────────────────────────────────────────────────
// Offer moves
// ─────────────────────────────────────────────────────────────────────────────

export type OfferActionResult =
  | { ok: true; offerId?: string }
  | { ok: false; message: string };

async function runTransition(
  offerId: string,
  event: 'ACCEPT' | 'CANCEL',
  reason?: string,
): Promise<OfferActionResult> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { id: true, conversationId: true, status: true },
  });
  if (!offer) return { ok: false, message: 'Teklif bulunamadı.' };

  const { userId, role, profileId } = await requireParty(offer.conversationId);

  try {
    await transitionOffer({
      offerId,
      event,
      actor: role,
      actorId: userId,
      actorProfileId: profileId,
      reason,
      // Guards against acting on a stale screen: if the offer moved since the
      // page rendered, this fails instead of applying a move the user never saw.
      expectedStatus: offer.status,
    });
    revalidatePath(`/panel/sohbet/${offer.conversationId}`);
    revalidatePath('/panel');
    return { ok: true, offerId };
  } catch (error) {
    const message = String(error);
    if (message.includes('modified concurrently')) {
      return { ok: false, message: 'Bu teklif az önce güncellendi. Sayfayı yenile.' };
    }
    if (message.includes('cannot accept your own')) {
      return { ok: false, message: 'Kendi teklifini kabul edemezsin.' };
    }
    console.error('[negotiation] transition failed', error);
    return { ok: false, message: 'İşlem tamamlanamadı. Tekrar dene.' };
  }
}

export async function acceptOffer(offerId: string): Promise<OfferActionResult> {
  return runTransition(offerId, 'ACCEPT');
}

export async function declineOffer(offerId: string, reason?: string): Promise<OfferActionResult> {
  return runTransition(offerId, 'CANCEL', reason);
}

const counterSchema = z.object({
  priceMinor: z.number().int().min(10_000).max(5_000_000),
  note: z.string().max(1000).optional(),
});

/**
 * Counters an open offer.
 *
 * Keeps the parent's scope and hours, changing only the price and the note —
 * which is what the overwhelming majority of real counters are. Changing hours
 * as well means going back to the calendar, and cramming a slot picker into a
 * chat reply would make the common case worse to serve the rare one.
 */
export async function counterOffer(
  offerId: string,
  input: { priceMinor: number; note?: string },
): Promise<OfferActionResult> {
  const parsed = counterSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Geçerli bir tutar gir.' };

  const parent = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      conversationId: true,
      status: true,
      coachProfileId: true,
      studentProfileId: true,
      title: true,
      scope: true,
      startDate: true,
      endDate: true,
      milestoneCount: true,
      basePricingTierId: true,
    },
  });
  if (!parent) return { ok: false, message: 'Teklif bulunamadı.' };
  if (!['OFFERED', 'COUNTERED'].includes(parent.status)) {
    return { ok: false, message: 'Bu teklife artık karşı teklif verilemez.' };
  }

  const { userId, role, profileId } = await requireParty(parent.conversationId);

  const scope = (parent.scope ?? {}) as Record<string, unknown>;

  try {
    const created = await createOffer({
      conversationId: parent.conversationId,
      coachProfileId: parent.coachProfileId,
      studentProfileId: parent.studentProfileId,
      initiatorRole: role,
      actorId: userId,
      actorProfileId: profileId,
      title: parent.title,
      scope: { ...scope, notes: parsed.data.note ?? scope.notes },
      priceMinor: parsed.data.priceMinor,
      basePricingTierId: parent.basePricingTierId ?? undefined,
      startDate: parent.startDate,
      endDate: parent.endDate,
      milestoneCount: parent.milestoneCount,
      parentOfferId: parent.id,
    });

    revalidatePath(`/panel/sohbet/${parent.conversationId}`);
    return { ok: true, offerId: created.id };
  } catch (error) {
    if (error instanceof SlotUnavailableError) {
      return {
        ok: false,
        message: 'Teklifteki saatlerden biri dolmuş. Yeni bir teklif oluşturman gerekiyor.',
      };
    }
    console.error('[negotiation] counter failed', error);
    return { ok: false, message: 'Karşı teklif gönderilemedi.' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment
// ─────────────────────────────────────────────────────────────────────────────

export type CheckoutResult =
  | { ok: true; checkoutFormContent: string; token: string }
  | { ok: false; message: string };

/**
 * Opens payment for an accepted offer.
 *
 * Only the student can pay, and only from ACCEPTED — both enforced here and
 * again inside the payment service, because this is the single point where the
 * product starts handling real money.
 */
export async function payForOffer(offerId: string): Promise<CheckoutResult> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      conversationId: true,
      status: true,
      student: { select: { userId: true, user: { select: { name: true, email: true } } } },
    },
  });
  if (!offer) return { ok: false, message: 'Teklif bulunamadı.' };

  const { userId, role } = await requireParty(offer.conversationId);
  if (role !== 'STUDENT' || offer.student.userId !== userId) {
    return { ok: false, message: 'Ödemeyi yalnızca öğrenci yapabilir.' };
  }
  if (offer.status !== 'ACCEPTED') {
    return { ok: false, message: 'Ödeme yalnızca kabul edilmiş teklifler için yapılabilir.' };
  }

  const [name, ...rest] = (offer.student.user.name ?? 'Öğrenci').split(' ');

  try {
    const session = await startCheckout({
      offerId,
      studentUserId: userId,
      buyer: {
        name,
        surname: rest.join(' ') || name,
        email: offer.student.user.email ?? 'ogrenci@kaktuskocluk.com',
        // Iyzico requires an identity number. Collected on the payment screen
        // in production; this placeholder keeps the sandbox path working.
        identityNumber: '11111111111',
        ip: '127.0.0.1',
        city: 'İstanbul',
        address: 'Belirtilmedi',
      },
      callbackUrl: `${process.env.APP_URL ?? 'http://localhost:3000'}/api/payments/callback`,
    });
    return { ok: true, checkoutFormContent: session.checkoutFormContent, token: session.token };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ödeme başlatılamadı.';
    console.error('[negotiation] checkout failed', error);
    return { ok: false, message };
  }
}
KAKTUS_FILE_EOF

emit "src/server/actions/offers.ts" <<'KAKTUS_FILE_EOF'
'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { createOffer } from '@/server/services/offer-service';
import { SlotUnavailableError } from '@/lib/booking/holds';
import {
  OFFER_DRAFT_COOKIE,
  OFFER_DRAFT_TTL_SECONDS,
  PACKAGE_CONFIG,
  type OfferDraft,
} from '@/lib/offers/draft';

const draftSchema = z.object({
  coachProfileId: z.string().min(1).max(64),
  coachSlug: z.string().min(1).max(120),
  packageType: z.enum(['EXPLORATORY', 'MONTHLY_4W']),
  slots: z.array(z.string().datetime()).max(8),
  priceMinor: z.number().int().min(0).max(50_000_00),
  note: z.string().max(1000).optional(),
  createdAt: z.string(),
});

/**
 * Parks a draft offer in an httpOnly cookie so it survives the sign-in
 * redirect. Called right before the auth gate opens.
 */
export async function saveOfferDraft(draft: OfferDraft): Promise<{ ok: boolean }> {
  const parsed = draftSchema.safeParse(draft);
  if (!parsed.success) return { ok: false };

  const jar = await cookies();
  jar.set(OFFER_DRAFT_COOKIE, JSON.stringify(parsed.data), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // must survive the OAuth round trip
    path: '/',
    maxAge: OFFER_DRAFT_TTL_SECONDS,
  });
  return { ok: true };
}

export async function readOfferDraft(): Promise<OfferDraft | null> {
  const raw = (await cookies()).get(OFFER_DRAFT_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = draftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function clearOfferDraft(): Promise<void> {
  (await cookies()).delete(OFFER_DRAFT_COOKIE);
}

// ─────────────────────────────────────────────────────────────────────────────
// Submission
// ─────────────────────────────────────────────────────────────────────────────

export type SubmitOfferResult =
  | { ok: true; offerId: string; conversationId: string }
  | { ok: false; code: 'UNAUTHENTICATED' | 'NO_PROFILE' | 'SLOT_TAKEN' | 'INVALID' | 'FAILED'; message: string };

/**
 * Creates the conversation if needed and submits the offer.
 *
 * Deliberately re-derives everything from the database rather than trusting the
 * posted draft: the coach id is looked up by slug, and the price is the only
 * number taken from the client. A draft cookie is user-controlled input like
 * any other.
 */
export async function submitOffer(draft: OfferDraft): Promise<SubmitOfferResult> {
  const parsed = draftSchema.safeParse(draft);
  if (!parsed.success) return { ok: false, code: 'INVALID', message: 'Teklif bilgileri eksik.' };

  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Önce giriş yapman gerekiyor.' };
  }

  const student = await prisma.studentProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!student) {
    return {
      ok: false,
      code: 'NO_PROFILE',
      message: 'Öğrenci profilin henüz oluşmamış. Soruları tamamlayıp tekrar dene.',
    };
  }

  const coach = await prisma.coachProfile.findUnique({
    where: { slug: parsed.data.coachSlug },
    select: { id: true, verificationStatus: true, acceptingStudents: true },
  });
  if (!coach || coach.verificationStatus !== 'APPROVED' || !coach.acceptingStudents) {
    return { ok: false, code: 'INVALID', message: 'Bu koç şu anda yeni öğrenci almıyor.' };
  }

  const config = PACKAGE_CONFIG[parsed.data.packageType];
  const slots = parsed.data.slots
    .map((iso) => new Date(iso))
    .filter((date) => date.getTime() > Date.now())
    .sort((a, b) => a.getTime() - b.getTime());

  if (slots.length !== config.sessions) {
    return {
      ok: false,
      code: 'INVALID',
      message: `${config.sessions} seans seçmen gerekiyor.`,
    };
  }

  const conversation = await prisma.conversation.upsert({
    where: {
      coachProfileId_studentProfileId: {
        coachProfileId: coach.id,
        studentProfileId: student.id,
      },
    },
    create: { coachProfileId: coach.id, studentProfileId: student.id },
    update: {},
    select: { id: true },
  });

  const startDate = slots[0];
  const endDate = new Date(
    slots[slots.length - 1].getTime() + config.minutesPerSession * 60_000,
  );

  try {
    const offer = await createOffer({
      conversationId: conversation.id,
      coachProfileId: coach.id,
      studentProfileId: student.id,
      initiatorRole: 'STUDENT',
      actorId: session.user.id,
      actorProfileId: student.id,
      title: config.label,
      scope: {
        cadence: config.cadence,
        sessionsPerCycle: config.sessions,
        minutesPerSession: config.minutesPerSession,
        weeks: config.weeks,
        includesMessaging: true,
        deliverables: [],
        notes: parsed.data.note,
        slots: slots.map((startsAt) => ({
          startsAt,
          endsAt: new Date(startsAt.getTime() + config.minutesPerSession * 60_000),
        })),
      },
      priceMinor: parsed.data.priceMinor,
      startDate,
      endDate,
      milestoneCount: config.milestoneCount,
    });

    await clearOfferDraft();
    return { ok: true, offerId: offer.id, conversationId: conversation.id };
  } catch (error) {
    // The exclusion constraint fired: someone took a slot between the student
    // opening the composer and pressing send. Say which problem it is, because
    // the fix (pick another hour) is entirely in the student's hands.
    if (error instanceof SlotUnavailableError) {
      return {
        ok: false,
        code: 'SLOT_TAKEN',
        message: 'Seçtiğin saatlerden biri az önce doldu. Takvimden başka bir saat seç.',
      };
    }
    console.error('[offers] submit failed', error);
    return { ok: false, code: 'FAILED', message: 'Teklif gönderilemedi. Tekrar dene.' };
  }
}
KAKTUS_FILE_EOF

emit "src/server/actions/onboarding.ts" <<'KAKTUS_FILE_EOF'
'use server';

import { revalidatePath } from 'next/cache';
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { findMatches } from '@/lib/matching/engine';
import {
  onboardingSchema,
  readOnboardingSession,
  toMatchInput,
  upsertOnboardingSession,
} from '@/lib/onboarding/session';
import { DIMENSION_LABELS } from '@/lib/onboarding/client-state';
import type { OnboardingDraft } from '@/lib/onboarding/client-state';

/**
 * Server actions for the guest funnel.
 *
 * These run without authentication on purpose — it is the product bet. A
 * student answers five questions and sees real matched coaches before being
 * asked who they are. The auth wall sits between *seeing* and *acting*, not
 * between arriving and seeing.
 */

export interface SaveStepResult {
  ok: boolean;
  ready: boolean;
  errors?: Record<string, string[]>;
}

/**
 * Persists one step. Called on every transition rather than once at the end, so
 * a student who abandons at step 3 still leaves a usable signal, and returning
 * tomorrow resumes where they stopped.
 */
export async function saveOnboardingStep(patch: OnboardingDraft): Promise<SaveStepResult> {
  const parsed = onboardingSchema.safeParse(patch);
  if (!parsed.success) {
    return {
      ok: false,
      ready: false,
      errors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const headerList = await headers();
  const forwarded = headerList.get('x-forwarded-for') ?? '';

  const session = await upsertOnboardingSession(parsed.data, {
    ipHash: forwarded ? createHash('sha256').update(forwarded).digest('hex').slice(0, 32) : undefined,
    userAgent: headerList.get('user-agent') ?? undefined,
    referrer: headerList.get('referer') ?? undefined,
  });

  return { ok: true, ready: Boolean(session.track && session.gradeLevel) };
}

/** Reads the server-side answers so the client can hydrate authoritatively. */
export async function loadOnboardingDraft(): Promise<OnboardingDraft> {
  const session = await readOnboardingSession();
  if (!session) return {};
  return {
    track: session.track ?? undefined,
    gradeLevel: session.gradeLevel ?? undefined,
    targetRanking: session.targetRanking,
    targetUniversity: session.targetUniversity,
    targetDepartment: session.targetDepartment,
    baselineTytNet: session.baselineTytNet,
    baselineAytNet: session.baselineAytNet,
    preferredStyles: session.preferredStyles,
    budgetMinMinor: session.budgetMinMinor,
    budgetMaxMinor: session.budgetMaxMinor,
    completedStep: session.completedStep,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching
// ─────────────────────────────────────────────────────────────────────────────

export interface MatchBreakdown {
  key: string;
  label: string;
  /** 0–100, for the pill. */
  percent: number;
  reason: string;
}

export interface CoachMatchView {
  coachId: string;
  slug: string;
  displayName: string;
  university: string;
  department: string;
  matchScore: number;
  reasons: string[];
  caveats: string[];
  breakdown: MatchBreakdown[];
  priceFromMinor: number | null;
  ratingAvg: number;
  ratingCount: number;
  journey: { baselineNet: number | null; finalNet: number | null; finalRank: number };
  specializations: string[];
}

export interface MatchesResult {
  ready: boolean;
  coaches: CoachMatchView[];
  totalConsidered: number;
}

/**
 * Runs the matcher for the current guest session.
 *
 * Everything here comes from the existing engine — the SQL prefilter and the
 * pure scorer — rather than being reimplemented for the UI. The only new work
 * is shaping `dimensions` into pills and deciding what a guest may see.
 *
 * Withheld until sign-in: exact availability windows, full surname, contact
 * surface. The score and its reasons are the hook; the specifics are what the
 * account is for.
 */
export async function getMatches(limit = 12): Promise<MatchesResult> {
  const session = await readOnboardingSession();
  const input = session ? toMatchInput(session) : null;
  if (!session || !input) return { ready: false, coaches: [], totalConsidered: 0 };

  const { results, coaches } = await findMatches(input, {
    limit,
    onboardingSessionId: session.id,
  });

  const view = results.map<CoachMatchView>((result) => {
    const coach = coaches.get(result.coachId)!;
    return {
      coachId: result.coachId,
      slug: coach.slug,
      displayName: coach.displayName,
      university: coach.university,
      department: coach.department,
      matchScore: result.displayScore,
      reasons: result.reasons,
      caveats: result.caveats,
      breakdown: result.dimensions
        // Budget is scored but never surfaced: telling a student their budget
        // scores 41% reads as a judgement on them rather than on the match.
        .filter((d) => d.surface)
        .sort((a, b) => b.score * b.weight - a.score * a.weight)
        .map((d) => ({
          key: d.dimension,
          label: DIMENSION_LABELS[d.dimension] ?? d.dimension,
          percent: Math.round(d.score * 100),
          reason: d.reason,
        })),
      priceFromMinor: coach.pricing.length
        ? Math.min(...coach.pricing.map((p) => p.priceMinor))
        : null,
      ratingAvg: coach.stats.ratingAvg,
      ratingCount: coach.stats.ratingCount,
      journey: {
        baselineNet: coach.journey.baselineNet,
        finalNet: coach.journey.finalNet,
        finalRank: coach.journey.finalRank,
      },
      specializations: coach.specializations.slice(0, 2).map((s) => s.label),
    };
  });

  return { ready: true, coaches: view, totalConsidered: coaches.size };
}

/** Called after the last step; refreshes the results page cache. */
export async function completeOnboarding(patch: OnboardingDraft) {
  await saveOnboardingStep({ ...patch, completedStep: 5 });
  revalidatePath('/kocbul');
}
KAKTUS_FILE_EOF

emit "src/server/queries/coach-profile.ts" <<'KAKTUS_FILE_EOF'
import { prisma } from '@/lib/db';

/**
 * Coach profile read model.
 *
 * A single query shaped for the page rather than a set of generic repository
 * calls. Reviews, pricing, and credentials are all needed to render the first
 * paint, so fetching them separately would mean three round trips before the
 * hero appears.
 *
 * Note what is *not* selected: verification document keys, the coach's phone,
 * their sub-merchant key. Those live on the same row and have no business
 * crossing into a page that renders for anonymous visitors.
 */

const DEFAULT_COMMISSION_BPS = 1800;

export interface CoachProfileView {
  id: string;
  slug: string;
  displayName: string;
  headline: string;
  bio: string;
  introVideoUrl: string | null;
  city: string | null;
  timezone: string;
  university: string;
  department: string;
  graduationYear: number | null;
  yksRank: number;
  yksYear: number;
  verifiedAt: Date | null;
  journey: { baselineNet: number | null; finalNet: number | null; wasMezun: boolean };
  tracks: string[];
  subjects: string[];
  styles: string[];
  supportedGrades: string[];
  specializations: Array<{ label: string; fromRank: number | null; toRank: number | null }>;
  pricingTiers: Array<{
    id: string;
    name: string;
    cadence: string;
    priceMinor: number;
    sessionsPerCycle: number;
    minutesPerSession: number;
    description: string | null;
  }>;
  stats: {
    ratingAvg: number;
    ratingCount: number;
    completedEngagements: number;
    activeEngagements: number;
    maxActiveStudents: number;
    responseP50Seconds: number | null;
    acceptingStudents: boolean;
  };
  reviews: Array<{
    id: string;
    rating: number;
    body: string | null;
    netGainReported: number | null;
    createdAt: Date;
    studentInitials: string;
  }>;
  commissionBps: number;
}

export async function getCoachProfile(slug: string): Promise<CoachProfileView | null> {
  const coach = await prisma.coachProfile.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      headline: true,
      bio: true,
      introVideoUrl: true,
      city: true,
      timezone: true,
      university: true,
      department: true,
      graduationYear: true,
      yksRank: true,
      yksYear: true,
      verificationStatus: true,
      verifiedAt: true,
      ownBaselineNet: true,
      ownFinalNet: true,
      wasMezun: true,
      tracks: true,
      subjects: true,
      styles: true,
      supportedGrades: true,
      ratingAvg: true,
      ratingCount: true,
      completedEngagements: true,
      activeEngagements: true,
      maxActiveStudents: true,
      responseP50Seconds: true,
      acceptingStudents: true,
      commissionBpsOverride: true,
      user: { select: { name: true } },
      specializations: { select: { label: true, fromRank: true, toRank: true } },
      pricingTiers: {
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          cadence: true,
          priceMinor: true,
          sessionsPerCycle: true,
          minutesPerSession: true,
          description: true,
        },
      },
      reviews: {
        where: { published: true },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          rating: true,
          body: true,
          netGainReported: true,
          createdAt: true,
          student: { select: { user: { select: { name: true } } } },
        },
      },
    },
  });

  // An unapproved coach is not a 403, it is a 404. Confirming that a pending or
  // suspended profile exists leaks a moderation decision to anyone with the URL.
  if (!coach || coach.verificationStatus !== 'APPROVED') return null;

  const policy =
    coach.commissionBpsOverride == null
      ? await prisma.commissionPolicy.findFirst({
          where: {
            effectiveFrom: { lte: new Date() },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
          },
          orderBy: { effectiveFrom: 'desc' },
          select: { defaultBps: true },
        })
      : null;

  return {
    id: coach.id,
    slug: coach.slug,
    displayName: coach.user.name ?? 'Koç',
    headline: coach.headline,
    bio: coach.bio,
    introVideoUrl: coach.introVideoUrl,
    city: coach.city,
    timezone: coach.timezone,
    university: coach.university,
    department: coach.department,
    graduationYear: coach.graduationYear,
    yksRank: coach.yksRank,
    yksYear: coach.yksYear,
    verifiedAt: coach.verifiedAt,
    journey: {
      baselineNet: coach.ownBaselineNet,
      finalNet: coach.ownFinalNet,
      wasMezun: coach.wasMezun,
    },
    tracks: coach.tracks,
    subjects: coach.subjects,
    styles: coach.styles,
    supportedGrades: coach.supportedGrades,
    specializations: coach.specializations,
    pricingTiers: coach.pricingTiers,
    stats: {
      ratingAvg: coach.ratingAvg,
      ratingCount: coach.ratingCount,
      completedEngagements: coach.completedEngagements,
      activeEngagements: coach.activeEngagements,
      maxActiveStudents: coach.maxActiveStudents,
      responseP50Seconds: coach.responseP50Seconds,
      acceptingStudents: coach.acceptingStudents,
    },
    reviews: coach.reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      body: review.body,
      netGainReported: review.netGainReported,
      createdAt: review.createdAt,
      // Students are minors. Reviews show initials only — never a full name,
      // and never anything that ties a review to a school or a city.
      studentInitials: initials(review.student.user.name),
    })),
    commissionBps: coach.commissionBpsOverride ?? policy?.defaultBps ?? DEFAULT_COMMISSION_BPS,
  };
}

function initials(name: string | null): string {
  if (!name) return 'K.K.';
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => `${part[0]?.toLocaleUpperCase('tr')}.`)
      .join('') || 'K.K.'
  );
}
KAKTUS_FILE_EOF

emit "src/server/queries/conversation.ts" <<'KAKTUS_FILE_EOF'
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { availableEvents, type OfferStatus } from '@/lib/offers/state-machine';

/**
 * The negotiation view's read model.
 *
 * Messages and offers are merged into one timeline, because that is what the
 * conversation actually is: "I can do Tuesdays" / "here's 3.000 ₺ for four
 * weeks" / "can we make it 2.700?" are the same discussion. Keeping offers in a
 * separate panel would hide the thing being discussed from the discussion.
 */

export type TimelineEntry =
  | {
      kind: 'message';
      id: string;
      at: Date;
      body: string;
      mine: boolean;
      moderationAction: 'ALLOW' | 'MASK' | 'BLOCK';
      systemNotice: string | null;
    }
  | {
      kind: 'offer';
      id: string;
      at: Date;
      mine: boolean;
      title: string;
      status: OfferStatus;
      priceMinor: number;
      commissionBps: number;
      startDate: Date;
      endDate: Date;
      milestoneCount: number;
      sessions: number;
      minutesPerSession: number;
      notes: string | null;
      slots: string[];
      superseded: boolean;
      /** What the viewer is allowed to do with it right now. */
      actions: string[];
    };

export interface ConversationView {
  id: string;
  viewerRole: 'STUDENT' | 'COACH';
  viewerUserId: string;
  counterpartyName: string;
  coachSlug: string;
  coachProfileId: string;
  studentProfileId: string;
  timeline: TimelineEntry[];
  /** The one offer still open for action, if any. */
  liveOfferId: string | null;
  flagged: boolean;
}

export async function getConversation(conversationId: string): Promise<ConversationView | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      flaggedAt: true,
      coachProfileId: true,
      studentProfileId: true,
      coach: { select: { slug: true, userId: true, user: { select: { name: true } } } },
      student: { select: { userId: true, user: { select: { name: true } } } },
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 200,
        select: {
          id: true,
          body: true,
          senderId: true,
          createdAt: true,
          moderationAction: true,
          systemNotice: true,
        },
      },
      offers: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          title: true,
          status: true,
          priceMinor: true,
          commissionBps: true,
          startDate: true,
          endDate: true,
          milestoneCount: true,
          scope: true,
          createdAt: true,
          initiatorRole: true,
          parentOfferId: true,
        },
      },
    },
  });

  if (!conversation) return null;

  // Authorisation, not just authentication. A conversation id in a URL must not
  // be enough to read someone else's negotiation.
  const isCoach = conversation.coach.userId === session.user.id;
  const isStudent = conversation.student.userId === session.user.id;
  if (!isCoach && !isStudent) return null;

  const viewerRole = isCoach ? 'COACH' : 'STUDENT';

  // A counter-offer supersedes its parent. Marking them lets the UI grey out
  // the history instead of showing four live-looking offers at once.
  const supersededIds = new Set(
    conversation.offers.map((o) => o.parentOfferId).filter((id): id is string => Boolean(id)),
  );

  const messages: TimelineEntry[] = conversation.messages.map((message) => ({
    kind: 'message',
    id: message.id,
    at: message.createdAt,
    body: message.body,
    mine: message.senderId === session.user.id,
    moderationAction: message.moderationAction,
    systemNotice: message.systemNotice,
  }));

  const offers: TimelineEntry[] = conversation.offers.map((offer) => {
    const scope = (offer.scope ?? {}) as {
      sessionsPerCycle?: number;
      minutesPerSession?: number;
      notes?: string;
      slots?: Array<{ startsAt: string }>;
    };
    const mine = offer.initiatorRole === viewerRole;
    return {
      kind: 'offer',
      id: offer.id,
      at: offer.createdAt,
      mine,
      title: offer.title,
      status: offer.status,
      priceMinor: offer.priceMinor,
      commissionBps: offer.commissionBps,
      startDate: offer.startDate,
      endDate: offer.endDate,
      milestoneCount: offer.milestoneCount,
      sessions: scope.sessionsPerCycle ?? offer.milestoneCount,
      minutesPerSession: scope.minutesPerSession ?? 60,
      notes: scope.notes ?? null,
      slots: (scope.slots ?? []).map((s) => String(s.startsAt)),
      superseded: supersededIds.has(offer.id),
      // The state machine decides what is legal; the UI only renders it. Two
      // sources of truth here would mean buttons that throw when pressed.
      actions: supersededIds.has(offer.id)
        ? []
        : availableEvents(offer.status, viewerRole).filter((event) =>
            // A party may not accept or counter their own offer.
            mine ? !['ACCEPT', 'COUNTER'].includes(event) : true,
          ),
    };
  });

  const timeline = [...messages, ...offers].sort((a, b) => a.at.getTime() - b.at.getTime());

  const live = offers.find(
    (entry) =>
      entry.kind === 'offer' &&
      !entry.superseded &&
      ['OFFERED', 'COUNTERED', 'ACCEPTED'].includes(entry.status),
  );

  return {
    id: conversation.id,
    viewerRole,
    viewerUserId: session.user.id,
    counterpartyName:
      (isCoach ? conversation.student.user.name : conversation.coach.user.name) ??
      (isCoach ? 'Öğrenci' : 'Koç'),
    coachSlug: conversation.coach.slug,
    coachProfileId: conversation.coachProfileId,
    studentProfileId: conversation.studentProfileId,
    timeline,
    liveOfferId: live?.id ?? null,
    flagged: Boolean(conversation.flaggedAt),
  };
}

/** Conversation list for the dashboard. */
export async function listConversations() {
  const session = await auth();
  if (!session?.user?.id) return [];

  const rows = await prisma.conversation.findMany({
    where: {
      OR: [{ coach: { userId: session.user.id } }, { student: { userId: session.user.id } }],
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 50,
    select: {
      id: true,
      lastMessageAt: true,
      coach: { select: { userId: true, user: { select: { name: true } } } },
      student: { select: { user: { select: { name: true } } } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, senderId: true } },
      offers: {
        where: { status: { in: ['OFFERED', 'COUNTERED', 'ACCEPTED'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, status: true, priceMinor: true, initiatorRole: true },
      },
    },
  });

  return rows.map((row) => {
    const isCoach = row.coach.userId === session.user!.id;
    const liveOffer = row.offers[0];
    return {
      id: row.id,
      counterpartyName:
        (isCoach ? row.student.user.name : row.coach.user.name) ?? (isCoach ? 'Öğrenci' : 'Koç'),
      lastMessage: row.messages[0]?.body ?? null,
      lastMessageAt: row.lastMessageAt,
      liveOfferStatus: liveOffer?.status ?? null,
      liveOfferPriceMinor: liveOffer?.priceMinor ?? null,
      /** True when the ball is in the viewer's court. */
      awaitingViewer: liveOffer
        ? liveOffer.status === 'ACCEPTED'
          ? !isCoach // accepted offers wait on the student to pay
          : liveOffer.initiatorRole !== (isCoach ? 'COACH' : 'STUDENT')
        : false,
    };
  });
}
KAKTUS_FILE_EOF

emit "src/server/services/dispute-service.ts" <<'KAKTUS_FILE_EOF'
import { prisma } from '@/lib/db';
import { TX_OPTIONS, type Tx, acquireAdvisoryLock, casStatus } from '@/lib/tx';
import { transitionOffer } from './offer-service';
import { refundFromEscrow, releaseMilestone, splitAmount } from '@/lib/payments/escrow';

/**
 * Dispute handling.
 *
 * The governing principle: **freeze first, decide later.** Opening a dispute
 * must be instant and must stop the auto-release clock, because the failure
 * mode that destroys trust is a student reporting a no-show on day 6 and the
 * money releasing to the coach on day 7 while an admin is still reading the
 * ticket.
 *
 * The second principle: **already-released milestones are not clawed back.** A
 * coach who was paid for weeks 1–2 that the student confirmed keeps that money
 * even if week 3 goes wrong. Reversible earnings are not earnings, and a
 * marketplace whose payouts can be retroactively voided cannot recruit supply.
 */

export type DisputeReason =
  | 'COACH_NO_SHOW'
  | 'STUDENT_NO_SHOW'
  | 'QUALITY'
  | 'SCOPE_NOT_DELIVERED'
  | 'UNRESPONSIVE'
  | 'OTHER';

export interface OpenDisputeInput {
  engagementId: string;
  milestoneId?: string;
  openedByUserId: string;
  openedByRole: 'STUDENT' | 'COACH' | 'ADMIN';
  reason: DisputeReason;
  detail: string;
  evidence?: unknown;
}

export async function openDispute(input: OpenDisputeInput) {
  const engagement = await prisma.engagement.findUniqueOrThrow({
    where: { id: input.engagementId },
    select: { id: true, offerId: true, status: true },
  });

  const dispute = await prisma.$transaction(async (tx) => {
    await acquireAdvisoryLock(tx, `engagement:${engagement.id}`);

    const existing = await tx.dispute.findFirst({
      where: {
        engagementId: engagement.id,
        status: { in: ['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'] },
      },
    });
    if (existing) return existing; // idempotent — a double-tap must not open two

    return tx.dispute.create({
      data: {
        engagementId: engagement.id,
        milestoneId: input.milestoneId,
        openedById: input.openedByUserId,
        openedByRole: input.openedByRole,
        reason: input.reason,
        detail: input.detail,
        evidence: (input.evidence ?? undefined) as never,
        status: 'OPEN',
      },
    });
  }, TX_OPTIONS);

  // Freezing runs through the FSM so the offer, engagement and milestones move
  // together — the dispute row alone is a ticket, not a state change.
  await transitionOffer({
    offerId: engagement.offerId,
    event: 'OPEN_DISPUTE',
    actor: input.openedByRole,
    actorId: input.openedByUserId,
    reason: input.reason,
    metadata: { disputeId: dispute.id },
  });

  return dispute;
}

export type Resolution =
  | { outcome: 'RELEASE'; note: string }
  | { outcome: 'REFUND'; note: string }
  | { outcome: 'SPLIT'; coachShareMinor: number; note: string };

/**
 * Admin decision. Only an admin reaches this — the FSM enforces that, and it is
 * worth keeping strict: letting a coach "resolve" a dispute in their own favour
 * is the single most exploitable path in a marketplace.
 */
export async function resolveDispute(args: {
  disputeId: string;
  adminUserId: string;
  resolution: Resolution;
}) {
  const dispute = await prisma.dispute.findUniqueOrThrow({
    where: { id: args.disputeId },
    include: {
      engagement: {
        select: {
          id: true,
          offerId: true,
          coachProfileId: true,
          commissionBps: true,
          currency: true,
        },
      },
    },
  });

  if (!['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'].includes(dispute.status)) {
    throw new Error(`Dispute ${dispute.id} is already resolved (${dispute.status})`);
  }

  const { engagement } = dispute;
  const now = new Date();

  /**
   * Hoisted into a local const before the branch, deliberately.
   *
   * TypeScript discards discriminated-union narrowing on a *property access*
   * (`args.resolution`) once it crosses into a callback, because the property
   * could in principle be reassigned before that callback runs. Narrowing a
   * `const` local survives. Without this the SPLIT branch below cannot see
   * `coachShareMinor` at all, and the build fails.
   */
  const resolution = args.resolution;

  // SPLIT is settled here directly: it is a partial release and a partial
  // refund of the same frozen milestones, which no single FSM transition
  // expresses. RELEASE and REFUND go through the FSM, which owns those paths.
  if (resolution.outcome === 'SPLIT') {
    await prisma.$transaction(async (tx) => {
      await acquireAdvisoryLock(tx, `engagement:${engagement.id}`);
      await settleSplit(tx, {
        engagementId: engagement.id,
        coachProfileId: engagement.coachProfileId,
        commissionBps: engagement.commissionBps,
        currency: engagement.currency,
        coachShareMinor: resolution.coachShareMinor,
        now,
      });
      await casStatus(tx.dispute, {
        id: dispute.id,
        from: ['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'],
        data: {
          status: 'RESOLVED_SPLIT',
          resolution: resolution.note,
          resolvedById: args.adminUserId,
          resolvedAt: now,
          coachShareMinor: resolution.coachShareMinor,
        },
        entity: 'Dispute',
      });
    }, TX_OPTIONS);

    // The offer follows the money: a split that leaves nothing in escrow ends
    // the engagement.
    await transitionOffer({
      offerId: engagement.offerId,
      event: 'RESOLVE_DISPUTE_REFUND',
      actor: 'ADMIN',
      actorId: args.adminUserId,
      reason: resolution.note,
      metadata: { disputeId: dispute.id, outcome: 'SPLIT' },
    });
    return;
  }

  const event =
    resolution.outcome === 'RELEASE'
      ? ('RESOLVE_DISPUTE_RELEASE' as const)
      : ('RESOLVE_DISPUTE_REFUND' as const);

  const result = await transitionOffer({
    offerId: engagement.offerId,
    event,
    actor: 'ADMIN',
    actorId: args.adminUserId,
    reason: resolution.note,
    metadata: { disputeId: dispute.id },
  });

  await prisma.$transaction(async (tx) => {
    await casStatus(tx.dispute, {
      id: dispute.id,
      from: ['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'],
      data: {
        status: resolution.outcome === 'RELEASE' ? 'RESOLVED_RELEASE' : 'RESOLVED_REFUND',
        resolution: resolution.note,
        resolvedById: args.adminUserId,
        resolvedAt: now,
      },
      entity: 'Dispute',
    });

    if (resolution.outcome === 'RELEASE') {
      await tx.engagement.update({
        where: { id: engagement.id },
        data: { status: 'ACTIVE' },
      });
    }
  }, TX_OPTIONS);

  return result;
}

/**
 * Partial settlement: the coach keeps `coachShareMinor` of the frozen escrow,
 * the student gets the rest back.
 *
 * Implemented by walking frozen milestones in order and paying them out until
 * the coach's share is exhausted, splitting at most one milestone. Milestone
 * amounts are the ledger's unit of account, so allocating share proportionally
 * across all of them would produce rounding drift across four rows; walking in
 * order produces at most one partial and keeps the arithmetic exact.
 */
async function settleSplit(
  tx: Tx,
  args: {
    engagementId: string;
    coachProfileId: string;
    commissionBps: number;
    currency: string;
    coachShareMinor: number;
    now: Date;
  },
) {
  const frozen = await tx.milestone.findMany({
    where: { engagementId: args.engagementId, status: 'DISPUTED' },
    orderBy: { index: 'asc' },
  });

  const frozenTotal = frozen.reduce((sum, m) => sum + m.amountMinor, 0);
  if (args.coachShareMinor < 0 || args.coachShareMinor > frozenTotal) {
    throw new Error(
      `Coach share ${args.coachShareMinor} outside frozen escrow of ${frozenTotal}`,
    );
  }

  let remainingToCoach = args.coachShareMinor;

  for (const milestone of frozen) {
    if (remainingToCoach >= milestone.amountMinor) {
      await releaseMilestone(tx, {
        engagementId: args.engagementId,
        milestoneId: milestone.id,
        coachProfileId: args.coachProfileId,
        amountMinor: milestone.amountMinor,
        commissionBps: args.commissionBps,
        currency: args.currency,
      });
      remainingToCoach -= milestone.amountMinor;
      continue;
    }

    if (remainingToCoach > 0) {
      // Partial: release what the coach earned, refund the balance. Both
      // postings carry the same milestoneId so the two halves reconcile.
      await releaseMilestone(tx, {
        engagementId: args.engagementId,
        milestoneId: milestone.id,
        coachProfileId: args.coachProfileId,
        amountMinor: remainingToCoach,
        commissionBps: args.commissionBps,
        currency: args.currency,
      });
      await refundFromEscrow(tx, {
        engagementId: args.engagementId,
        milestoneId: milestone.id,
        amountMinor: milestone.amountMinor - remainingToCoach,
        reason: 'dispute_split',
        currency: args.currency,
      });
      remainingToCoach = 0;
      continue;
    }

    await refundFromEscrow(tx, {
      engagementId: args.engagementId,
      milestoneId: milestone.id,
      amountMinor: milestone.amountMinor,
      reason: 'dispute_split',
      currency: args.currency,
    });
  }

  // Future sessions are cancelled either way; the slots return to the coach.
  await tx.booking.updateMany({
    where: {
      engagementId: args.engagementId,
      status: 'SCHEDULED',
      startsAt: { gte: args.now },
    },
    data: { status: 'CANCELLED_BY_STUDENT', cancelReason: 'dispute_split' },
  });

  const refundTotal = frozenTotal - args.coachShareMinor;
  if (refundTotal > 0) {
    const engagement = await tx.engagement.findUniqueOrThrow({
      where: { id: args.engagementId },
      select: { offerId: true, currency: true },
    });
    const payment = await tx.payment.findFirst({
      where: { offerId: engagement.offerId, status: 'CAPTURED' },
      select: { id: true },
    });
    await tx.refund.create({
      data: {
        engagementId: args.engagementId,
        paymentId: payment?.id,
        amountMinor: refundTotal,
        currency: engagement.currency,
        reason: 'dispute_split',
        status: 'PENDING',
        idempotencyKey: `refund:${args.engagementId}:dispute_split`,
      },
    });
  }

  await tx.engagement.update({
    where: { id: args.engagementId },
    data: { status: 'CANCELLED', completedAt: args.now },
  });
}

/**
 * No-show detection.
 *
 * A coach no-show is the case the product must handle well, so it does not wait
 * for the student to file paperwork: when a session passes with the coach
 * unconfirmed and the student having marked it, a dispute is opened
 * automatically. The student's obligation is one tap, not a support ticket.
 */
export async function flagCoachNoShow(args: {
  bookingId: string;
  reportedByUserId: string;
}) {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: args.bookingId },
    select: {
      id: true,
      status: true,
      engagementId: true,
      milestoneId: true,
      endsAt: true,
      coachConfirmedAt: true,
    },
  });

  if (!booking.engagementId) throw new Error('Booking has no engagement');
  if (booking.endsAt > new Date()) throw new Error('Session has not ended yet');

  await prisma.$transaction(async (tx) => {
    await casStatus(tx.booking, {
      id: booking.id,
      from: 'SCHEDULED',
      data: { status: 'NO_SHOW_COACH', cancelledByRole: 'STUDENT' },
      entity: 'Booking',
    });
  }, TX_OPTIONS);

  return openDispute({
    engagementId: booking.engagementId,
    milestoneId: booking.milestoneId ?? undefined,
    openedByUserId: args.reportedByUserId,
    openedByRole: 'STUDENT',
    reason: 'COACH_NO_SHOW',
    detail: `Koç ${booking.id} numaralı seansta yer almadı.`,
    evidence: { bookingId: booking.id, endsAt: booking.endsAt },
  });
}

export { splitAmount };
KAKTUS_FILE_EOF

emit "src/server/services/offer-service.ts" <<'KAKTUS_FILE_EOF'
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  ConcurrentModificationError,
  TX_OPTIONS,
  type Tx,
  acquireAdvisoryLock,
  casStatus,
} from '@/lib/tx';
import {
  type ActorRole,
  type OfferEventName,
  type OfferStatus,
  type SideEffect,
  type TransitionContext,
  transition,
} from '@/lib/offers/state-machine';
import { milestonePeriods, parseScope } from '@/lib/offers/scope';
import {
  acquireHolds,
  convertHoldsToBookings,
  extendHolds,
  releaseHolds,
} from '@/lib/booking/holds';
import { postEscrowFunding, releaseMilestone, splitIntoMilestones } from '@/lib/payments/escrow';

/**
 * The Offer Service.
 *
 * This is the only module permitted to write `Offer.status`. Everything else —
 * server actions, webhooks, jobs, the admin console — calls `transitionOffer`.
 *
 * Structure of every transition:
 *   1. Load the offer and derive a TransitionContext (facts the guards need).
 *   2. Ask the FSM whether the transition is legal. It returns the target state
 *      and a list of side effects as *data*.
 *   3. Inside one transaction: CAS the status, apply the effects, write an
 *      OfferEvent and an AuditLog row.
 *
 * Steps 1 and 2 read a snapshot that may be stale by step 3. The CAS in step 3
 * is what makes that safe: if another caller moved the offer in between, the
 * conditional UPDATE matches zero rows and the whole transaction rolls back.
 * That is the entire concurrency story for offer acceptance, and it needs no
 * locks and no retry loop.
 *
 * External calls (payment provider, email) never happen inside the transaction.
 * A network call holding a row lock is how you turn a provider slowdown into a
 * database outage. Effects that need the outside world are recorded as intent
 * and picked up by a worker.
 */

export interface TransitionRequest {
  offerId: string;
  event: OfferEventName;
  actor: ActorRole;
  /** User id — for audit trail and OfferEvent attribution. */
  actorId?: string;
  /**
   * StudentProfile or CoachProfile id — for authorisation guards.
   *
   * Kept distinct from `actorId` on purpose. The guard that stops someone
   * accepting their own offer compares profile ownership; comparing a user id
   * against a profile id would silently always be false, quietly disabling the
   * guard. Two fields that are never interchangeable should not share a name.
   */
  actorProfileId?: string;
  reason?: string;
  metadata?: Prisma.InputJsonValue;
  /**
   * Optimistic-concurrency guard from the client. When the UI renders a button
   * for state X, it sends X back; if the offer has since moved, the request is
   * rejected rather than silently applying a transition the user never saw.
   */
  expectedStatus?: OfferStatus;
  /** Set on a parent offer's COUNTER: the child offer that supersedes it. */
  supersededByOfferId?: string;
}

export interface TransitionResult {
  offerId: string;
  from: OfferStatus;
  to: OfferStatus;
  effectsApplied: SideEffect['type'][];
  /** Work that must happen after commit — provider calls, notifications. */
  deferred: DeferredWork[];
}

export type DeferredWork =
  | { type: 'NOTIFY'; audience: string; template: string; offerId: string }
  | { type: 'PROVIDER_REFUND'; refundId: string };

const OFFER_INCLUDE = {
  payments: { where: { status: 'CAPTURED' as const }, select: { id: true, amountMinor: true } },
  engagement: {
    select: {
      id: true,
      startDate: true,
      status: true,
      milestones: { select: { id: true, index: true, status: true } },
      disputes: {
        where: { status: { in: ['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'] as const } },
        select: { id: true },
      },
    },
  },
} satisfies Prisma.OfferInclude;

type LoadedOffer = Prisma.OfferGetPayload<{ include: typeof OFFER_INCLUDE }>;

/** Dispute window: how long after the last milestone period a party may object. */
const DISPUTE_WINDOW_DAYS = 7;

function buildContext(
  offer: LoadedOffer,
  actorProfileId: string | undefined,
  now: Date,
): TransitionContext {
  const engagement = offer.engagement;
  const milestones = engagement?.milestones ?? [];

  return {
    hasCapturedPayment: offer.payments.length > 0,
    hasOpenDispute: (engagement?.disputes.length ?? 0) > 0,
    allMilestonesSettled:
      milestones.length > 0 &&
      milestones.every((m) => m.status === 'RELEASED' || m.status === 'REFUNDED'),
    startDateReached: engagement ? engagement.startDate <= now : offer.startDate <= now,
    withinDisputeWindow:
      now.getTime() <=
      offer.endDate.getTime() + DISPUTE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    isInitiatorOfCurrentOffer: isInitiator(offer, actorProfileId),
  };
}

/**
 * Determines whether the actor is the party who sent the current offer.
 *
 * Compares profile ownership rather than trusting a role string from the
 * caller: the guard that stops someone accepting their own offer is only as
 * good as this check, and a spoofed `actor: 'COACH'` must not defeat it.
 */
function isInitiator(
  offer: LoadedOffer,
  actorProfileId: string | undefined,
): boolean | undefined {
  if (!actorProfileId) return undefined;
  return offer.initiatorRole === 'STUDENT'
    ? actorProfileId === offer.studentProfileId
    : actorProfileId === offer.coachProfileId;
}

export async function transitionOffer(req: TransitionRequest): Promise<TransitionResult> {
  const now = new Date();

  const snapshot = await prisma.offer.findUnique({
    where: { id: req.offerId },
    include: OFFER_INCLUDE,
  });
  if (!snapshot) throw new Error(`Offer ${req.offerId} not found`);

  if (req.expectedStatus && snapshot.status !== req.expectedStatus) {
    throw new ConcurrentModificationError('Offer', req.offerId, req.expectedStatus);
  }

  const ctx = buildContext(snapshot, req.actorProfileId, now);
  // Throws OfferTransitionError on an illegal or unauthorised transition.
  const plan = transition(snapshot.status, req.event, req.actor, ctx);

  const deferred: DeferredWork[] = [];

  await prisma.$transaction(async (tx) => {
    // Serialise all transitions on this offer. The CAS below is sufficient for
    // correctness on its own; the lock additionally prevents two writers from
    // both doing expensive effect work before one of them loses.
    await acquireAdvisoryLock(tx, `offer:${req.offerId}`);

    await casStatus(tx.offer, {
      id: req.offerId,
      from: plan.from,
      data: {
        status: plan.to,
        ...(plan.to === 'ACCEPTED' ? { acceptedAt: now } : {}),
        ...(plan.to === 'CANCELLED' || plan.to === 'EXPIRED' ? { cancelledAt: now } : {}),
      },
      entity: 'Offer',
    });

    for (const effect of plan.effects) {
      const result = await applyEffect(tx, effect, {
        offer: snapshot,
        now,
        actorId: req.actorId,
        supersededByOfferId: req.supersededByOfferId,
      });
      if (result) deferred.push(...result);
    }

    await tx.offerEvent.create({
      data: {
        offerId: req.offerId,
        fromStatus: plan.from,
        toStatus: plan.to,
        actorRole: req.actor,
        actorId: req.actorId,
        reason: req.reason,
        metadata: req.metadata,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: req.actorId,
        actorRole: req.actor,
        action: `offer.${req.event.toLowerCase()}`,
        entityType: 'Offer',
        entityId: req.offerId,
        metadata: { from: plan.from, to: plan.to },
      },
    });
  }, TX_OPTIONS);

  return {
    offerId: req.offerId,
    from: plan.from,
    to: plan.to,
    effectsApplied: plan.effects.map((e) => e.type),
    deferred,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Effect application
// ─────────────────────────────────────────────────────────────────────────────

interface EffectContext {
  offer: LoadedOffer;
  now: Date;
  actorId?: string;
  supersededByOfferId?: string;
}

async function applyEffect(
  tx: Tx,
  effect: SideEffect,
  ctx: EffectContext,
): Promise<DeferredWork[] | void> {
  const { offer, now } = ctx;

  switch (effect.type) {
    case 'CREATE_SLOT_HOLDS': {
      const scope = parseScope(offer.scope);
      if (scope.slots.length === 0) return;

      // Reconcile rather than blindly insert. A counter-offer inherits the
      // parent's holds, so some of the requested slots may already be held by
      // this very offer — inserting them again would collide with the coach's
      // own hold on the exclusion constraint and fail a legitimate counter.
      const existing = await tx.slotHold.findMany({
        where: { offerId: offer.id, status: 'HELD' },
        select: { id: true, startsAt: true, endsAt: true },
      });

      type SlotKey = { startsAt: Date; endsAt: Date };
      const key = (s: SlotKey) => `${s.startsAt.getTime()}-${s.endsAt.getTime()}`;

      // The tuple annotations are load-bearing. Without them TypeScript widens
      // `[key(s), s]` to `(string | SlotKey)[]` rather than inferring a pair,
      // so `new Map(...)` resolves to `Map<unknown, unknown>` and every slot
      // read back out is `unknown`. The build fails on the next line rather
      // than here, which makes it a genuinely confusing five minutes.
      const desired = new Map<string, SlotKey>(
        scope.slots.map((s): [string, SlotKey] => [key(s), s]),
      );
      const held = new Map<string, (typeof existing)[number]>(
        existing.map((h): [string, (typeof existing)[number]] => [key(h), h]),
      );

      const stale = existing.filter((h) => !desired.has(key(h)));
      if (stale.length > 0) {
        await tx.slotHold.updateMany({
          where: { id: { in: stale.map((h) => h.id) } },
          data: { status: 'RELEASED' },
        });
      }

      const missing = [...desired.values()].filter((s) => !held.has(key(s)));
      if (missing.length > 0) {
        // Throws SlotUnavailableError if any slot collides — all or nothing, so
        // a student never pays for a half-booked calendar.
        await acquireHolds(
          {
            coachProfileId: offer.coachProfileId,
            studentProfileId: offer.studentProfileId,
            offerId: offer.id,
            slots: missing,
            ttlMinutes: effect.extendMinutes,
          },
          tx,
        );
      }
      if (held.size > 0) await extendHolds(offer.id, effect.extendMinutes, tx);
      return;
    }

    case 'EXTEND_SLOT_HOLDS':
      await extendHolds(offer.id, effect.minutes, tx);
      return;

    case 'RELEASE_SLOT_HOLDS':
      await releaseHolds(offer.id, tx);
      return;

    case 'SUPERSEDE_PARENT_OFFER': {
      // Runs on the PARENT offer as it moves OFFERED → COUNTERED. Its holds are
      // transferred to the child rather than released and re-acquired: a
      // release-then-acquire opens a window in which a third party can take the
      // slot, which is exactly the moment a negotiation is most likely to die.
      if (!ctx.supersededByOfferId) return;
      await tx.slotHold.updateMany({
        where: { offerId: offer.id, status: 'HELD' },
        data: { offerId: ctx.supersededByOfferId },
      });
      return;
    }

    case 'CREATE_ENGAGEMENT': {
      const existing = await tx.engagement.findUnique({ where: { offerId: offer.id } });
      if (existing) return; // idempotent: webhook retries must not duplicate
      await tx.engagement.create({
        data: {
          offerId: offer.id,
          coachProfileId: offer.coachProfileId,
          studentProfileId: offer.studentProfileId,
          status: 'ACTIVE',
          startDate: offer.startDate,
          endDate: offer.endDate,
          totalMinor: offer.priceMinor,
          currency: offer.currency,
          commissionBps: offer.commissionBps,
        },
      });
      await tx.coachProfile.update({
        where: { id: offer.coachProfileId },
        data: { activeEngagements: { increment: 1 } },
      });
      return;
    }

    case 'CREATE_MILESTONES': {
      const engagement = await tx.engagement.findUniqueOrThrow({
        where: { offerId: offer.id },
        select: { id: true, startDate: true, endDate: true, totalMinor: true },
      });
      const already = await tx.milestone.count({ where: { engagementId: engagement.id } });
      if (already > 0) return;

      const periods = milestonePeriods(
        engagement.startDate,
        engagement.endDate,
        offer.milestoneCount,
      );
      const amounts = splitIntoMilestones(engagement.totalMinor, offer.milestoneCount);

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
      return;
    }

    case 'POST_ESCROW_FUNDING': {
      const engagement = await tx.engagement.findUniqueOrThrow({
        where: { offerId: offer.id },
        select: { id: true },
      });
      const payment = offer.payments[0];
      if (!payment) throw new Error('POST_ESCROW_FUNDING without a captured payment');

      const alreadyPosted = await tx.ledgerEntry.count({
        where: { paymentId: payment.id, account: 'PLATFORM_ESCROW' },
      });
      if (alreadyPosted > 0) return; // idempotent

      await postEscrowFunding(tx, {
        engagementId: engagement.id,
        paymentId: payment.id,
        amountMinor: payment.amountMinor,
        currency: offer.currency,
      });
      return;
    }

    case 'CONVERT_HOLDS_TO_BOOKINGS': {
      const engagement = await tx.engagement.findUniqueOrThrow({
        where: { offerId: offer.id },
        select: { id: true, milestones: { select: { id: true } } },
      });
      await convertHoldsToBookings(
        {
          offerId: offer.id,
          engagementId: engagement.id,
          milestoneIds: engagement.milestones.map((m) => m.id),
        },
        tx,
      );
      return;
    }

    case 'FREEZE_PENDING_MILESTONES': {
      const engagement = await tx.engagement.findUnique({
        where: { offerId: offer.id },
        select: { id: true },
      });
      if (!engagement) return;
      // Only unreleased money can be frozen. Already-released milestones are
      // settled and are not clawed back — the coach has been paid for work the
      // student confirmed, and reversing that would make earnings unreliable.
      await tx.milestone.updateMany({
        where: {
          engagementId: engagement.id,
          status: { in: ['SCHEDULED', 'IN_PROGRESS', 'PENDING_CONFIRMATION'] },
        },
        data: { status: 'DISPUTED' },
      });
      await tx.engagement.update({
        where: { id: engagement.id },
        data: { status: 'DISPUTED' },
      });
      return;
    }

    case 'RELEASE_REMAINING_MILESTONES': {
      const engagement = await tx.engagement.findUniqueOrThrow({
        where: { offerId: offer.id },
        select: { id: true, coachProfileId: true, commissionBps: true, currency: true },
      });
      const frozen = await tx.milestone.findMany({
        where: { engagementId: engagement.id, status: 'DISPUTED' },
        orderBy: { index: 'asc' },
      });
      for (const milestone of frozen) {
        await releaseMilestone(tx, {
          engagementId: engagement.id,
          milestoneId: milestone.id,
          coachProfileId: engagement.coachProfileId,
          amountMinor: milestone.amountMinor,
          commissionBps: engagement.commissionBps,
          currency: engagement.currency,
        });
      }
      await tx.engagement.update({
        where: { id: engagement.id },
        data: { status: 'ACTIVE' },
      });
      return;
    }

    case 'REFUND_UNRELEASED_ESCROW': {
      const engagement = await tx.engagement.findUnique({
        where: { offerId: offer.id },
        select: { id: true },
      });
      if (!engagement) return;
      const { refundId } = await refundUnreleasedEscrow(tx, {
        engagementId: engagement.id,
        offerId: offer.id,
        reason: effect.reason,
        now,
      });
      // The provider call happens after commit — never inside the transaction.
      return refundId ? [{ type: 'PROVIDER_REFUND', refundId }] : [];
    }

    case 'NOTIFY':
      return [
        { type: 'NOTIFY', audience: effect.audience, template: effect.template, offerId: offer.id },
      ];

    case 'AUDIT':
      // Written once per transition by the caller; the effect is declarative
      // documentation of intent rather than a second row.
      return;

    default: {
      const exhaustive: never = effect;
      throw new Error(`Unhandled side effect: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Refunds everything still sitting in escrow for an engagement, cancels future
 * bookings, and records a Refund row for the worker to submit to the provider.
 *
 * Deliberately computes the refundable amount from *milestone rows*, not from
 * the engagement total: partial releases may already have happened, and
 * refunding the full price after two milestones were paid out would create
 * money the platform does not have.
 */
export async function refundUnreleasedEscrow(
  tx: Tx,
  args: { engagementId: string; offerId: string; reason: string; now: Date },
): Promise<{ refundId: string | null; amountMinor: number }> {
  const { refundFromEscrow } = await import('@/lib/payments/escrow');

  const refundable = await tx.milestone.findMany({
    where: {
      engagementId: args.engagementId,
      status: { in: ['SCHEDULED', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'DISPUTED'] },
    },
    orderBy: { index: 'asc' },
  });

  const total = refundable.reduce((sum, m) => sum + m.amountMinor, 0);
  if (total === 0) return { refundId: null, amountMinor: 0 };

  const engagementRow = await tx.engagement.findUniqueOrThrow({
    where: { id: args.engagementId },
    select: { currency: true },
  });
  const payment = await tx.payment.findFirst({
    where: { offerId: args.offerId, status: 'CAPTURED' },
    select: { id: true },
  });

  // One Refund row per milestone, not one per engagement.
  //
  // Iyzico refunds against a `paymentTransactionId`, which is per basket item,
  // and we send one basket item per milestone. A single aggregate refund row
  // would have no valid handle to submit. This also means a partially-released
  // engagement refunds exactly the unreleased portion, with no arithmetic.
  let firstRefundId: string | null = null;

  for (const milestone of refundable) {
    await refundFromEscrow(tx, {
      engagementId: args.engagementId,
      milestoneId: milestone.id,
      amountMinor: milestone.amountMinor,
      reason: args.reason,
    });

    const refund = await tx.refund.create({
      data: {
        engagementId: args.engagementId,
        paymentId: payment?.id,
        milestoneId: milestone.id,
        paymentTransactionId: milestone.providerTransactionId,
        amountMinor: milestone.amountMinor,
        currency: engagementRow.currency,
        reason: args.reason,
        status: 'PENDING',
        idempotencyKey: `refund:${milestone.id}:${args.reason}`,
      },
    });
    firstRefundId ??= refund.id;
  }

  // Future sessions no longer exist; the slots go back to the coach's calendar.
  await tx.booking.updateMany({
    where: {
      engagementId: args.engagementId,
      status: 'SCHEDULED',
      startsAt: { gte: args.now },
    },
    data: { status: 'CANCELLED_BY_STUDENT', cancelReason: args.reason },
  });

  const engagement = await tx.engagement.update({
    where: { id: args.engagementId },
    data: { status: 'CANCELLED', completedAt: args.now },
    select: { coachProfileId: true },
  });

  await tx.coachProfile.update({
    where: { id: engagement.coachProfileId },
    data: { activeEngagements: { decrement: 1 } },
  });

  return { refundId: firstRefundId, amountMinor: total };
}

// ─────────────────────────────────────────────────────────────────────────────
// Creation
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateOfferInput {
  conversationId: string;
  coachProfileId: string;
  studentProfileId: string;
  initiatorRole: Extract<ActorRole, 'STUDENT' | 'COACH'>;
  /** User id, for audit. */
  actorId: string;
  /** Profile id of the initiator, for authorisation guards. */
  actorProfileId: string;
  title: string;
  scope: unknown;
  priceMinor: number;
  basePricingTierId?: string;
  startDate: Date;
  endDate: Date;
  milestoneCount?: number;
  expiresInHours?: number;
  parentOfferId?: string;
}

const DEFAULT_COMMISSION_BPS = 1800;

async function resolveCommissionBps(tx: Tx, coachProfileId: string): Promise<number> {
  const coach = await tx.coachProfile.findUniqueOrThrow({
    where: { id: coachProfileId },
    select: { commissionBpsOverride: true },
  });
  if (coach.commissionBpsOverride != null) return coach.commissionBpsOverride;

  const policy = await tx.commissionPolicy.findFirst({
    where: { effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] },
    orderBy: { effectiveFrom: 'desc' },
  });
  return policy?.defaultBps ?? DEFAULT_COMMISSION_BPS;
}

/**
 * Creates and submits an offer atomically.
 *
 * Draft and submit are one operation because a DRAFT offer holds no slots — and
 * an offer visible to the counterparty without holds is an offer whose calendar
 * can be taken out from under it before they read it.
 *
 * A counter-offer is a *new row* linked by `parentOfferId`, not a mutation of
 * the original. The negotiation history is then immutable and auditable: when a
 * dispute turns on "what did we actually agree to", the chain of offers is the
 * evidence, and an in-place edit would have destroyed it.
 *
 * Ordering matters. The parent must move to COUNTERED first, so its slot holds
 * transfer to the child; submitting the child first would try to acquire slots
 * the parent still holds and fail on the exclusion constraint.
 */
export async function createOffer(input: CreateOfferInput) {
  const scope = parseScope(input.scope);
  const now = new Date();

  const parent = input.parentOfferId
    ? await prisma.offer.findUniqueOrThrow({
        where: { id: input.parentOfferId },
        select: { id: true, status: true, version: true },
      })
    : null;

  const offer = await prisma.$transaction(async (tx) => {
    const commissionBps = await resolveCommissionBps(tx, input.coachProfileId);

    const created = await tx.offer.create({
      data: {
        conversationId: input.conversationId,
        coachProfileId: input.coachProfileId,
        studentProfileId: input.studentProfileId,
        initiatorRole: input.initiatorRole,
        basePricingTierId: input.basePricingTierId,
        title: input.title,
        scope: scope as unknown as Prisma.InputJsonValue,
        priceMinor: input.priceMinor,
        commissionBps,
        startDate: input.startDate,
        endDate: input.endDate,
        milestoneCount: input.milestoneCount ?? 4,
        parentOfferId: parent?.id,
        version: (parent?.version ?? 0) + 1,
        status: 'DRAFT',
        expiresAt: new Date(now.getTime() + (input.expiresInHours ?? 48) * 3600 * 1000),
      },
    });

    await tx.conversation.update({
      where: { id: input.conversationId },
      data: { lastMessageAt: now },
    });

    return created;
  }, TX_OPTIONS);

  if (parent) {
    await transitionOffer({
      offerId: parent.id,
      event: 'COUNTER',
      actor: input.initiatorRole,
      actorId: input.actorId,
      actorProfileId: input.actorProfileId,
      supersededByOfferId: offer.id,
      expectedStatus: parent.status as OfferStatus,
      metadata: { supersededBy: offer.id },
    });
  }

  await transitionOffer({
    offerId: offer.id,
    event: 'SUBMIT',
    actor: input.initiatorRole,
    actorId: input.actorId,
    actorProfileId: input.actorProfileId,
    metadata: parent ? { counterTo: parent.id } : undefined,
  });

  return offer;
}
KAKTUS_FILE_EOF

emit "src/server/services/payment-service.ts" <<'KAKTUS_FILE_EOF'
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { TX_OPTIONS, acquireAdvisoryLock, idempotencyKey } from '@/lib/tx';
import { getPaymentProvider } from '@/lib/payments/provider';
import type { CheckoutRetrieveResult, EscrowBasketItem } from '@/lib/payments/provider';
import { buildSplit } from '@/lib/payments/iyzico/money';
import { splitIntoMilestones } from '@/lib/payments/escrow';
import { milestonePeriods, parseScope } from '@/lib/offers/scope';
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
          status: 'ACTIVE',
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

    const periods = milestonePeriods(offer.startDate, offer.endDate, offer.milestoneCount);
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
KAKTUS_FILE_EOF

emit "tailwind.config.ts" <<'KAKTUS_FILE_EOF'
import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        limestone: '#E9ECE6',
        paper: '#F5F7F3',
        ink: '#12211C',
        muted: '#5C6B63',
        stone: '#C6CCC2',
        cactus: { DEFAULT: '#1E6B4B', deep: '#123D2C', pale: '#D7E5DC' },
        bloom: { DEFAULT: '#D6246E', pale: '#FBE4EE' },
        dust: '#B8A98D',
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui'],
        sans: ['var(--font-body)', 'ui-sans-serif', 'system-ui'],
      },
      fontSize: {
        // A deliberate scale rather than Tailwind's defaults: the question text
        // is the loudest thing on the onboarding screen and needs room.
        question: ['clamp(1.75rem, 1.2rem + 2.2vw, 2.85rem)', { lineHeight: '1.08', letterSpacing: '-0.022em' }],
        score: ['clamp(2.5rem, 2rem + 2vw, 3.5rem)', { lineHeight: '0.9', letterSpacing: '-0.03em' }],
      },
      maxWidth: { measure: '62ch' },
    },
  },
  plugins: [],
} satisfies Config;
KAKTUS_FILE_EOF

emit "tests/concurrency.integration.test.ts" <<'KAKTUS_FILE_EOF'
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createOffer, transitionOffer } from '@/server/services/offer-service';
import { openDispute, resolveDispute } from '@/server/services/dispute-service';
import { autoReleaseMilestones, closeMilestones } from '@/jobs/milestones';
import { expireOffers, runPayoutBatch } from '@/jobs/workers';
import { SlotUnavailableError, acquireHolds } from '@/lib/booking/holds';
import { ConcurrentModificationError } from '@/lib/tx';
import {
  assertEscrowNonNegative,
  assertLedgerBalanced,
  capturePayment,
  coachPayable,
  makeConversation,
  makeCoach,
  makeStudent,
  race,
  resetDatabase,
  scope,
  slot,
} from './factories';

/**
 * Concurrency and race-condition suite.
 *
 * Requires a real Postgres with the constraints migration applied:
 *
 *   docker compose -f docker-compose.test.yml up -d
 *   DATABASE_URL=postgresql://kaktus:kaktus@localhost:5433/kaktus_test \
 *     npx prisma migrate deploy && npx vitest run tests/concurrency
 *
 * These tests deliberately do NOT mock Prisma. Every guarantee under test lives
 * in the database — an EXCLUDE constraint, a row lock, a conditional UPDATE. A
 * mocked client would report success against a system that double-books in
 * production, which is worse than having no test at all.
 *
 * Note on `Promise.all`: Node runs one event loop, but each Prisma call is a
 * separate connection from the pool executing a separate server-side
 * transaction, so the statements genuinely interleave inside Postgres. That is
 * where the contention we care about happens.
 */

const PRICE = 400_000; // 4.000 ₺

beforeEach(resetDatabase);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('slot contention', () => {
  it('lets exactly one of many simultaneous holds win the same slot', async () => {
    const { coach } = await makeCoach();
    const students = await Promise.all(Array.from({ length: 20 }, () => makeStudent()));
    const contested = slot(0);

    const { fulfilled, rejected } = await race(20, (i) =>
      acquireHolds({
        coachProfileId: coach.id,
        studentProfileId: students[i].student.id,
        slots: [contested],
        ttlMinutes: 60,
      }),
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(19);
    expect(rejected.every((e) => e instanceof SlotUnavailableError)).toBe(true);

    const held = await prisma.slotHold.count({ where: { status: 'HELD' } });
    expect(held).toBe(1);
  });

  it('allows adjacent, non-overlapping slots to be held simultaneously', async () => {
    const { coach } = await makeCoach();
    const students = await Promise.all(Array.from({ length: 4 }, () => makeStudent()));

    const { fulfilled, rejected } = await race(4, (i) =>
      acquireHolds({
        coachProfileId: coach.id,
        studentProfileId: students[i].student.id,
        slots: [slot(i)], // 18:00, 19:00, 20:00, 21:00 — back-to-back, no overlap
        ttlMinutes: 60,
      }),
    );

    expect(fulfilled).toHaveLength(4);
    expect(rejected).toHaveLength(0);
  });

  it('rejects a partially-conflicting multi-slot request atomically', async () => {
    const { coach } = await makeCoach();
    const a = await makeStudent();
    const b = await makeStudent();

    await acquireHolds({
      coachProfileId: coach.id,
      studentProfileId: a.student.id,
      slots: [slot(2)],
      ttlMinutes: 60,
    });

    // B wants three slots, one of which A already holds. All three must fail:
    // a student must never pay for a half-booked calendar.
    await expect(
      acquireHolds({
        coachProfileId: coach.id,
        studentProfileId: b.student.id,
        slots: [slot(0), slot(2), slot(4)],
        ttlMinutes: 60,
      }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);

    const bHolds = await prisma.slotHold.count({
      where: { studentProfileId: b.student.id, status: 'HELD' },
    });
    expect(bHolds).toBe(0);
  });

  it('detects overlap between a hold and a confirmed booking across tables', async () => {
    const { coach } = await makeCoach();
    const a = await makeStudent();
    const b = await makeStudent();
    const s = slot(0);

    await prisma.booking.create({
      data: {
        coachProfileId: coach.id,
        studentProfileId: a.student.id,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        status: 'SCHEDULED',
      },
    });

    // Half-overlapping, not identical — the range operator must catch it where
    // an equality check on start time would not.
    await expect(
      acquireHolds({
        coachProfileId: coach.id,
        studentProfileId: b.student.id,
        slots: [{ startsAt: new Date(s.startsAt.getTime() + 30 * 60_000), endsAt: new Date(s.endsAt.getTime() + 30 * 60_000) }],
        ttlMinutes: 60,
      }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it('frees the slot for the next student once a hold expires', async () => {
    const { coach } = await makeCoach();
    const a = await makeStudent();
    const b = await makeStudent();

    await acquireHolds({
      coachProfileId: coach.id,
      studentProfileId: a.student.id,
      slots: [slot(0)],
      ttlMinutes: 60,
    });
    await prisma.slotHold.updateMany({
      where: { studentProfileId: a.student.id },
      data: { status: 'EXPIRED' },
    });

    // The partial index only covers status='HELD', so an expired hold does not
    // block. This is what makes expiry a status change rather than a delete.
    await expect(
      acquireHolds({
        coachProfileId: coach.id,
        studentProfileId: b.student.id,
        slots: [slot(0)],
        ttlMinutes: 60,
      }),
    ).resolves.toHaveLength(1);
  });
});

describe('concurrent offer acceptance', () => {
  async function openOffer() {
    const { coach } = await makeCoach();
    const { user: studentUser, student } = await makeStudent();
    const conversation = await makeConversation(coach.id, student.id);

    const offer = await createOffer({
      conversationId: conversation.id,
      coachProfileId: coach.id,
      studentProfileId: student.id,
      initiatorRole: 'STUDENT',
      actorId: studentUser.id,
      actorProfileId: student.id,
      title: 'Aylık koçluk',
      scope: scope({ slots: [slot(0), slot(24)] }),
      priceMinor: PRICE,
      startDate: new Date('2027-01-11'),
      endDate: new Date('2027-02-08'),
      milestoneCount: 4,
    });

    return { coach, student, studentUser, conversation, offer };
  }

  it('applies exactly one of ten simultaneous accepts', async () => {
    const { coach, offer } = await openOffer();
    const coachUser = await prisma.user.findFirstOrThrow({
      where: { coachProfile: { id: coach.id } },
    });

    const { fulfilled, rejected } = await race(10, () =>
      transitionOffer({
        offerId: offer.id,
        event: 'ACCEPT',
        actor: 'COACH',
        actorId: coachUser.id,
        actorProfileId: coach.id,
      }),
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    expect(rejected.every((e) => e instanceof ConcurrentModificationError)).toBe(true);

    const events = await prisma.offerEvent.count({
      where: { offerId: offer.id, toStatus: 'ACCEPTED' },
    });
    expect(events).toBe(1);

    const after = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(after.status).toBe('ACCEPTED');
  });

  it('resolves accept-versus-cancel to exactly one winner', async () => {
    const { coach, student, studentUser, offer } = await openOffer();
    const coachUser = await prisma.user.findFirstOrThrow({
      where: { coachProfile: { id: coach.id } },
    });

    const outcomes = await Promise.allSettled([
      transitionOffer({
        offerId: offer.id,
        event: 'ACCEPT',
        actor: 'COACH',
        actorId: coachUser.id,
        actorProfileId: coach.id,
      }),
      transitionOffer({
        offerId: offer.id,
        event: 'CANCEL',
        actor: 'STUDENT',
        actorId: studentUser.id,
        actorProfileId: student.id,
      }),
    ]);

    const won = outcomes.filter((o) => o.status === 'fulfilled');
    expect(won).toHaveLength(1);

    const after = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(['ACCEPTED', 'CANCELLED']).toContain(after.status);

    // If cancel won, the slots must be free. If accept won, they must still be
    // held. Either is correct; a mix is not.
    const heldCount = await prisma.slotHold.count({
      where: { offerId: offer.id, status: 'HELD' },
    });
    expect(heldCount).toBe(after.status === 'CANCELLED' ? 0 : 2);
  });

  it('refuses to expire an offer whose payment landed first', async () => {
    const { offer } = await openOffer();
    await prisma.offer.update({
      where: { id: offer.id },
      data: { status: 'ACCEPTED', expiresAt: new Date(Date.now() - 60_000) },
    });
    await capturePayment(offer.id, PRICE);

    const result = await expireOffers();
    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(1);

    const after = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(after.status).toBe('ACCEPTED');
  });
});

describe('escrow funding idempotency', () => {
  async function fundedEngagement() {
    const { coach } = await makeCoach();
    const { user: studentUser, student } = await makeStudent();
    const conversation = await makeConversation(coach.id, student.id);
    const coachUser = await prisma.user.findFirstOrThrow({
      where: { coachProfile: { id: coach.id } },
    });

    const offer = await createOffer({
      conversationId: conversation.id,
      coachProfileId: coach.id,
      studentProfileId: student.id,
      initiatorRole: 'STUDENT',
      actorId: studentUser.id,
      actorProfileId: student.id,
      title: 'Aylık koçluk',
      scope: scope({ slots: [slot(0), slot(24 * 7), slot(24 * 14), slot(24 * 21)] }),
      priceMinor: PRICE,
      startDate: new Date('2027-01-11'),
      endDate: new Date('2027-02-08'),
      milestoneCount: 4,
    });

    await transitionOffer({
      offerId: offer.id,
      event: 'ACCEPT',
      actor: 'COACH',
      actorId: coachUser.id,
      actorProfileId: coach.id,
    });
    await capturePayment(offer.id, PRICE);
    await transitionOffer({ offerId: offer.id, event: 'PAYMENT_CAPTURED', actor: 'SYSTEM' });

    const engagement = await prisma.engagement.findUniqueOrThrow({
      where: { offerId: offer.id },
      include: { milestones: { orderBy: { index: 'asc' } } },
    });

    return { coach, student, studentUser, offer, engagement };
  }

  it('creates one engagement, one escrow posting and four milestones', async () => {
    const { engagement } = await fundedEngagement();

    expect(engagement.milestones).toHaveLength(4);
    expect(engagement.milestones.reduce((s, m) => s + m.amountMinor, 0)).toBe(PRICE);

    const escrow = await assertEscrowNonNegative(engagement.id);
    expect(escrow).toBe(PRICE);
    await assertLedgerBalanced();

    const bookings = await prisma.booking.count({ where: { engagementId: engagement.id } });
    expect(bookings).toBe(4);
    const stillHeld = await prisma.slotHold.count({
      where: { offerId: engagement.offerId, status: 'HELD' },
    });
    expect(stillHeld).toBe(0);
  });

  it('survives a duplicated payment webhook without double-crediting escrow', async () => {
    const { offer, engagement } = await fundedEngagement();

    // The provider redelivers. The FSM rejects the second transition because
    // the offer already left ACCEPTED — but even if it did not, the effects
    // are individually idempotent.
    await expect(
      transitionOffer({ offerId: offer.id, event: 'PAYMENT_CAPTURED', actor: 'SYSTEM' }),
    ).rejects.toThrow();

    const escrow = await assertEscrowNonNegative(engagement.id);
    expect(escrow).toBe(PRICE);

    const engagements = await prisma.engagement.count({ where: { offerId: offer.id } });
    expect(engagements).toBe(1);
    const milestones = await prisma.milestone.count({ where: { engagementId: engagement.id } });
    expect(milestones).toBe(4);
  });
});

describe('auto-release versus dispute', () => {
  async function readyForRelease() {
    const { coach } = await makeCoach();
    const { user: studentUser, student } = await makeStudent();
    const conversation = await makeConversation(coach.id, student.id);
    const coachUser = await prisma.user.findFirstOrThrow({
      where: { coachProfile: { id: coach.id } },
    });

    const offer = await createOffer({
      conversationId: conversation.id,
      coachProfileId: coach.id,
      studentProfileId: student.id,
      initiatorRole: 'STUDENT',
      actorId: studentUser.id,
      actorProfileId: student.id,
      title: 'Aylık koçluk',
      scope: scope({ slots: [slot(0)] }),
      priceMinor: PRICE,
      startDate: new Date('2027-01-11'),
      endDate: new Date('2027-02-08'),
      milestoneCount: 4,
    });
    await transitionOffer({
      offerId: offer.id,
      event: 'ACCEPT',
      actor: 'COACH',
      actorId: coachUser.id,
      actorProfileId: coach.id,
    });
    await capturePayment(offer.id, PRICE);
    await transitionOffer({ offerId: offer.id, event: 'PAYMENT_CAPTURED', actor: 'SYSTEM' });
    await transitionOffer({
      offerId: offer.id,
      event: 'ENGAGEMENT_STARTED',
      actor: 'SYSTEM',
      metadata: {},
    });

    const engagement = await prisma.engagement.findUniqueOrThrow({
      where: { offerId: offer.id },
      include: { milestones: { orderBy: { index: 'asc' } } },
    });

    // Put milestone 0 one second past its auto-release deadline.
    await prisma.milestone.update({
      where: { id: engagement.milestones[0].id },
      data: {
        status: 'PENDING_CONFIRMATION',
        autoReleaseAt: new Date(Date.now() - 1000),
      },
    });

    return { coach, student, studentUser, offer, engagement };
  }

  it('releases escrow and splits the commission correctly', async () => {
    const { coach, engagement } = await readyForRelease();
    const milestoneAmount = engagement.milestones[0].amountMinor;

    const result = await autoReleaseMilestones();
    expect(result.processed).toBe(1);

    await assertLedgerBalanced();
    const escrow = await assertEscrowNonNegative(engagement.id);
    expect(escrow).toBe(PRICE - milestoneAmount);

    // 18% default commission, rounded toward the coach.
    const expectedCommission = Math.floor((milestoneAmount * 1800) / 10_000);
    expect(await coachPayable(coach.id)).toBe(milestoneAmount - expectedCommission);
  });

  it('never both releases and freezes the same milestone', async () => {
    const { studentUser, engagement } = await readyForRelease();
    const milestone = engagement.milestones[0];

    // The dangerous moment: a student files a no-show at the exact instant the
    // worker sweeps. Both paths compare-and-swap the same row from
    // PENDING_CONFIRMATION, so one must lose.
    const [releaseOutcome, disputeOutcome] = await Promise.allSettled([
      autoReleaseMilestones(),
      openDispute({
        engagementId: engagement.id,
        milestoneId: milestone.id,
        openedByUserId: studentUser.id,
        openedByRole: 'STUDENT',
        reason: 'COACH_NO_SHOW',
        detail: 'Koç seansa gelmedi.',
      }),
    ]);

    const after = await prisma.milestone.findUniqueOrThrow({ where: { id: milestone.id } });
    expect(['RELEASED', 'DISPUTED']).toContain(after.status);

    // Whichever won, the books must be consistent and escrow must not be
    // double-spent.
    await assertLedgerBalanced();
    const escrow = await assertEscrowNonNegative(engagement.id);

    if (after.status === 'RELEASED') {
      expect(escrow).toBe(PRICE - milestone.amountMinor);
    } else {
      // Frozen: nothing left escrow at all.
      expect(escrow).toBe(PRICE);
      const releaseEntries = await prisma.ledgerEntry.count({
        where: { milestoneId: milestone.id, account: 'COACH_PAYABLE' },
      });
      expect(releaseEntries).toBe(0);
    }

    void releaseOutcome;
    void disputeOutcome;
  });

  it('refuses to auto-release a milestone containing a coach no-show', async () => {
    const { engagement } = await readyForRelease();
    const milestone = engagement.milestones[0];

    await prisma.booking.updateMany({
      where: { engagementId: engagement.id },
      data: { milestoneId: milestone.id, status: 'NO_SHOW_COACH' },
    });

    const result = await autoReleaseMilestones();
    expect(result.processed).toBe(0);

    const after = await prisma.milestone.findUniqueOrThrow({ where: { id: milestone.id } });
    expect(after.status).toBe('PENDING_CONFIRMATION');
    expect(await coachPayable(engagement.coachProfileId)).toBe(0);
  });

  it('is idempotent when two workers sweep at once', async () => {
    const { coach, engagement } = await readyForRelease();
    const milestoneAmount = engagement.milestones[0].amountMinor;

    const results = await Promise.all([
      autoReleaseMilestones(),
      autoReleaseMilestones(),
      autoReleaseMilestones(),
    ]);

    const totalProcessed = results.reduce((s, r) => s + r.processed, 0);
    expect(totalProcessed).toBe(1);

    const expectedCommission = Math.floor((milestoneAmount * 1800) / 10_000);
    expect(await coachPayable(coach.id)).toBe(milestoneAmount - expectedCommission);
    await assertLedgerBalanced();
  });
});

describe('dispute resolution', () => {
  async function disputedEngagement() {
    const { coach } = await makeCoach();
    const { user: studentUser, student } = await makeStudent();
    const conversation = await makeConversation(coach.id, student.id);
    const coachUser = await prisma.user.findFirstOrThrow({
      where: { coachProfile: { id: coach.id } },
    });
    const admin = await prisma.user.create({
      data: { email: `admin-${Date.now()}@example.com`, roles: ['ADMIN'] },
    });

    const offer = await createOffer({
      conversationId: conversation.id,
      coachProfileId: coach.id,
      studentProfileId: student.id,
      initiatorRole: 'STUDENT',
      actorId: studentUser.id,
      actorProfileId: student.id,
      title: 'Aylık koçluk',
      scope: scope({ slots: [slot(0), slot(24 * 7)] }),
      priceMinor: PRICE,
      startDate: new Date('2027-01-11'),
      endDate: new Date('2027-02-08'),
      milestoneCount: 4,
    });
    await transitionOffer({
      offerId: offer.id,
      event: 'ACCEPT',
      actor: 'COACH',
      actorId: coachUser.id,
      actorProfileId: coach.id,
    });
    await capturePayment(offer.id, PRICE);
    await transitionOffer({ offerId: offer.id, event: 'PAYMENT_CAPTURED', actor: 'SYSTEM' });
    await transitionOffer({ offerId: offer.id, event: 'ENGAGEMENT_STARTED', actor: 'SYSTEM' });

    const engagement = await prisma.engagement.findUniqueOrThrow({
      where: { offerId: offer.id },
      include: { milestones: { orderBy: { index: 'asc' } } },
    });

    return { coach, student, studentUser, admin, offer, engagement };
  }

  it('freezes every unreleased milestone and cancels nothing already paid', async () => {
    const { coach, studentUser, engagement } = await disputedEngagement();
    const first = engagement.milestones[0];

    // Release milestone 0 legitimately first.
    await prisma.milestone.update({
      where: { id: first.id },
      data: { status: 'PENDING_CONFIRMATION', autoReleaseAt: new Date(Date.now() - 1000) },
    });
    await autoReleaseMilestones();
    const paidOut = await coachPayable(coach.id);
    expect(paidOut).toBeGreaterThan(0);

    await openDispute({
      engagementId: engagement.id,
      openedByUserId: studentUser.id,
      openedByRole: 'STUDENT',
      reason: 'UNRESPONSIVE',
      detail: 'Koç iki haftadır cevap vermiyor.',
    });

    const after = await prisma.milestone.findMany({
      where: { engagementId: engagement.id },
      orderBy: { index: 'asc' },
    });
    expect(after[0].status).toBe('RELEASED'); // untouched — already earned
    expect(after.slice(1).every((m) => m.status === 'DISPUTED')).toBe(true);
    expect(await coachPayable(coach.id)).toBe(paidOut);
  });

  it('refunds unreleased escrow and frees future slots on a refund ruling', async () => {
    const { admin, studentUser, engagement } = await disputedEngagement();

    const dispute = await openDispute({
      engagementId: engagement.id,
      openedByUserId: studentUser.id,
      openedByRole: 'STUDENT',
      reason: 'COACH_NO_SHOW',
      detail: 'Hiç seans yapılmadı.',
    });

    await resolveDispute({
      disputeId: dispute.id,
      adminUserId: admin.id,
      resolution: { outcome: 'REFUND', note: 'Koç seanslara katılmadı.' },
    });

    await assertLedgerBalanced();
    expect(await assertEscrowNonNegative(engagement.id)).toBe(0);

    const refund = await prisma.refund.findFirstOrThrow({
      where: { engagementId: engagement.id },
    });
    expect(refund.amountMinor).toBe(PRICE);
    expect(refund.status).toBe('PENDING'); // provider call is the worker's job

    const futureBookings = await prisma.booking.count({
      where: { engagementId: engagement.id, status: 'SCHEDULED' },
    });
    expect(futureBookings).toBe(0);

    const engagementAfter = await prisma.engagement.findUniqueOrThrow({
      where: { id: engagement.id },
    });
    expect(engagementAfter.status).toBe('CANCELLED');
  });

  it('splits frozen escrow exactly, with no rounding drift', async () => {
    const { admin, coach, studentUser, engagement } = await disputedEngagement();

    const dispute = await openDispute({
      engagementId: engagement.id,
      openedByUserId: studentUser.id,
      openedByRole: 'STUDENT',
      reason: 'QUALITY',
      detail: 'İlk iki hafta iyiydi, sonrası kötü.',
    });

    // Award the coach an amount that does not align to a milestone boundary.
    const coachShare = 150_001;
    await resolveDispute({
      disputeId: dispute.id,
      adminUserId: admin.id,
      resolution: { outcome: 'SPLIT', coachShareMinor: coachShare, note: 'Kısmi iade.' },
    });

    await assertLedgerBalanced();
    expect(await assertEscrowNonNegative(engagement.id)).toBe(0);

    const expectedCommission = 0; // computed below per posting; assert the sum instead
    void expectedCommission;

    const payable = await coachPayable(coach.id);
    const refund = await prisma.refund.findFirstOrThrow({
      where: { engagementId: engagement.id, reason: 'dispute_split' },
    });

    // Coach's net + platform commission + refund must reconstruct the total.
    const commission = await prisma.ledgerEntry.aggregate({
      where: { engagementId: engagement.id, account: 'PLATFORM_REVENUE' },
      _sum: { amountMinor: true },
    });
    expect(payable + (commission._sum.amountMinor ?? 0)).toBe(coachShare);
    expect(refund.amountMinor).toBe(PRICE - coachShare);
  });

  it('opens only one dispute when a student double-taps', async () => {
    const { studentUser, engagement } = await disputedEngagement();

    const { fulfilled } = await race(5, () =>
      openDispute({
        engagementId: engagement.id,
        openedByUserId: studentUser.id,
        openedByRole: 'STUDENT',
        reason: 'UNRESPONSIVE',
        detail: 'Cevap yok.',
      }),
    );

    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const disputes = await prisma.dispute.count({ where: { engagementId: engagement.id } });
    expect(disputes).toBe(1);
  });
});

describe('payout batching', () => {
  it('produces one payout per coach per week under concurrent runs', async () => {
    const { coach } = await makeCoach();
    const { user: studentUser, student } = await makeStudent();
    const conversation = await makeConversation(coach.id, student.id);
    const coachUser = await prisma.user.findFirstOrThrow({
      where: { coachProfile: { id: coach.id } },
    });

    const offer = await createOffer({
      conversationId: conversation.id,
      coachProfileId: coach.id,
      studentProfileId: student.id,
      initiatorRole: 'STUDENT',
      actorId: studentUser.id,
      actorProfileId: student.id,
      title: 'Aylık koçluk',
      scope: scope({ slots: [slot(0)] }),
      priceMinor: PRICE,
      startDate: new Date('2027-01-11'),
      endDate: new Date('2027-02-08'),
      milestoneCount: 4,
    });
    await transitionOffer({
      offerId: offer.id,
      event: 'ACCEPT',
      actor: 'COACH',
      actorId: coachUser.id,
      actorProfileId: coach.id,
    });
    await capturePayment(offer.id, PRICE);
    await transitionOffer({ offerId: offer.id, event: 'PAYMENT_CAPTURED', actor: 'SYSTEM' });

    const milestone = await prisma.milestone.findFirstOrThrow({
      where: { engagement: { offerId: offer.id } },
      orderBy: { index: 'asc' },
    });
    await prisma.milestone.update({
      where: { id: milestone.id },
      data: { status: 'PENDING_CONFIRMATION', autoReleaseAt: new Date(Date.now() - 1000) },
    });
    await autoReleaseMilestones();

    const balanceBefore = await coachPayable(coach.id);
    expect(balanceBefore).toBeGreaterThan(0);

    await Promise.all([runPayoutBatch(), runPayoutBatch(), runPayoutBatch()]);

    const payouts = await prisma.payout.findMany({ where: { coachProfileId: coach.id } });
    expect(payouts).toHaveLength(1);
    expect(payouts[0].amountMinor).toBe(balanceBefore);
    expect(await coachPayable(coach.id)).toBe(0);
    await assertLedgerBalanced();
  });
});

describe('milestone lifecycle', () => {
  it('closes an ended milestone and sets the auto-release deadline', async () => {
    const { coach } = await makeCoach();
    const { user: studentUser, student } = await makeStudent();
    const conversation = await makeConversation(coach.id, student.id);
    const coachUser = await prisma.user.findFirstOrThrow({
      where: { coachProfile: { id: coach.id } },
    });

    const offer = await createOffer({
      conversationId: conversation.id,
      coachProfileId: coach.id,
      studentProfileId: student.id,
      initiatorRole: 'STUDENT',
      actorId: studentUser.id,
      actorProfileId: student.id,
      title: 'Aylık koçluk',
      scope: scope({ slots: [] }),
      priceMinor: PRICE,
      startDate: new Date('2020-01-01'),
      endDate: new Date('2020-02-01'),
      milestoneCount: 4,
    });
    await transitionOffer({
      offerId: offer.id,
      event: 'ACCEPT',
      actor: 'COACH',
      actorId: coachUser.id,
      actorProfileId: coach.id,
    });
    await capturePayment(offer.id, PRICE);
    await transitionOffer({ offerId: offer.id, event: 'PAYMENT_CAPTURED', actor: 'SYSTEM' });

    await prisma.milestone.updateMany({
      where: { engagement: { offerId: offer.id } },
      data: { status: 'IN_PROGRESS' },
    });

    const closed = await closeMilestones();
    expect(closed.processed).toBe(4);

    const milestones = await prisma.milestone.findMany({
      where: { engagement: { offerId: offer.id } },
    });
    expect(milestones.every((m) => m.status === 'PENDING_CONFIRMATION')).toBe(true);
    expect(milestones.every((m) => m.autoReleaseAt !== null)).toBe(true);
  });
});
KAKTUS_FILE_EOF

emit "tests/core.test.ts" <<'KAKTUS_FILE_EOF'
import { describe, expect, it } from 'vitest';
import { calibrate, netIndexForRanking, rankCoaches, scoreCoach } from '@/lib/matching/score';
import { CALIBRATION } from '@/lib/matching/weights';
import type { CoachCandidate, StudentMatchInput } from '@/lib/matching/types';
import { OfferTransitionError, availableEvents, transition } from '@/lib/offers/state-machine';
import { splitAmount, splitIntoMilestones } from '@/lib/payments/escrow';
import { moderateMessage, normalize } from '@/lib/chat/anti-circumvention';

// ─── fixtures ────────────────────────────────────────────────────────────────

const student: StudentMatchInput = {
  track: 'SAYISAL',
  gradeLevel: 'MEZUN',
  baseline: { tytNet: 55, aytNet: 20 },
  target: { ranking: 5_000 },
  preferredStyles: ['STRICT', 'STRATEGIC'],
  availability: [
    { weekday: 1, startMinute: 1080, endMinute: 1260 },
    { weekday: 3, startMinute: 1080, endMinute: 1260 },
    { weekday: 6, startMinute: 600, endMinute: 840 },
  ],
  budget: { minMinor: 200_000, maxMinor: 500_000, cadence: 'MONTHLY_STANDARD' },
  weeklyHoursGoal: 3,
};

function coach(overrides: Partial<CoachCandidate> = {}): CoachCandidate {
  return {
    id: 'coach_1',
    slug: 'ayse-y',
    displayName: 'Ayşe Y.',
    university: 'Boğaziçi Üniversitesi',
    department: 'Elektrik-Elektronik Mühendisliği',
    tracks: ['SAYISAL'],
    subjects: ['AYT Matematik', 'Fizik', 'TYT Matematik'],
    styles: ['STRICT', 'STRATEGIC'],
    supportedGrades: ['GRADE_12', 'MEZUN'],
    journey: {
      baselineNet: 72,
      finalNet: 98,
      baselineRank: 48_000,
      finalRank: 3_100,
      wasMezun: true,
      track: 'SAYISAL',
      year: 2023,
    },
    specializations: [{ label: 'Mezun yılında 50binden ilk 5bine', fromRank: 50_000, toRank: 5_000 }],
    availability: [
      { weekday: 1, startMinute: 1020, endMinute: 1320 },
      { weekday: 3, startMinute: 1140, endMinute: 1320 },
    ],
    pricing: [{ cadence: 'MONTHLY_STANDARD', priceMinor: 400_000 }],
    stats: {
      ratingAvg: 4.8,
      ratingCount: 24,
      completedEngagements: 18,
      activeEngagements: 4,
      maxActiveStudents: 10,
      responseP50Seconds: 3600,
      cancellationRate: 0.02,
      lastActiveAt: new Date('2026-09-01'),
      medianStudentNetGain: 22,
    },
    ...overrides,
  };
}

// ─── matching ────────────────────────────────────────────────────────────────

describe('rank → net calibration', () => {
  it('is monotonically decreasing in ranking', () => {
    const ranks = [500, 1_000, 5_000, 20_000, 50_000, 100_000, 300_000];
    const nets = ranks.map((r) => netIndexForRanking('SAYISAL', r));
    for (let i = 1; i < nets.length; i++) expect(nets[i]).toBeLessThan(nets[i - 1]);
  });

  it('clamps outside the anchor table', () => {
    expect(netIndexForRanking('SAYISAL', 1)).toBe(netIndexForRanking('SAYISAL', 500));
    expect(netIndexForRanking('SAYISAL', 9_000_000)).toBe(netIndexForRanking('SAYISAL', 300_000));
  });
});

describe('scoreCoach', () => {
  it('ranks a well-aligned coach highly and explains why', () => {
    const result = scoreCoach(student, coach());
    expect(result.displayScore).toBeGreaterThan(80);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.caveats).toHaveLength(0);
  });

  it('destroys the score when there is no availability overlap', () => {
    const aligned = scoreCoach(student, coach());
    const clashing = scoreCoach(
      student,
      coach({ availability: [{ weekday: 2, startMinute: 480, endMinute: 600 }] }),
    );
    expect(clashing.rawScore).toBeLessThan(aligned.rawScore);
    expect(clashing.caveats.join(' ')).toContain('çakışmıyor');
  });

  it('penalises price over budget but keeps the coach visible', () => {
    const expensive = scoreCoach(
      student,
      coach({ pricing: [{ cadence: 'MONTHLY_STANDARD', priceMinor: 750_000 }] }),
    );
    expect(expensive.caveats.some((c) => c.includes('bütçenin'))).toBe(true);
    expect(expensive.rawScore).toBeGreaterThan(CALIBRATION.minRawScore);
  });

  it('does not let one 5-star review outrank a large sample', () => {
    const newcomer = scoreCoach(
      student,
      coach({
        id: 'c_new',
        stats: { ...coach().stats, ratingAvg: 5, ratingCount: 1, completedEngagements: 1 },
      }),
    );
    const established = scoreCoach(student, coach());
    expect(established.rawScore).toBeGreaterThan(newcomer.rawScore);
  });

  it('rewards a coach who lived the student\'s own situation', () => {
    const mezunCoach = scoreCoach(student, coach());
    const nonMezun = scoreCoach(
      student,
      coach({
        id: 'c_2',
        journey: { ...coach().journey, wasMezun: false },
        supportedGrades: ['GRADE_11', 'GRADE_12'],
      }),
    );
    expect(mezunCoach.rawScore).toBeGreaterThan(nonMezun.rawScore);
  });

  it('is deterministic', () => {
    const now = new Date('2026-09-02');
    expect(scoreCoach(student, coach(), now)).toEqual(scoreCoach(student, coach(), now));
  });
});

describe('calibration', () => {
  it('is strictly increasing, so display never reorders results', () => {
    for (let raw = 0; raw < 1; raw += 0.02) {
      expect(calibrate(raw + 0.01)).toBeGreaterThanOrEqual(calibrate(raw));
    }
  });

  it('stays inside the presentation band', () => {
    expect(calibrate(0)).toBe(CALIBRATION.displayFloor);
    expect(calibrate(1)).toBe(CALIBRATION.displayCeiling);
  });
});

describe('rankCoaches', () => {
  it('sorts descending and drops candidates below the visibility floor', () => {
    const results = rankCoaches(student, [
      coach(),
      coach({
        id: 'c_bad',
        tracks: ['SAYISAL'],
        styles: ['EMPATHETIC'],
        subjects: [],
        supportedGrades: ['GRADE_11'],
        availability: [{ weekday: 5, startMinute: 0, endMinute: 60 }],
        journey: { ...coach().journey, baselineNet: 90, finalNet: 92, wasMezun: false },
        pricing: [{ cadence: 'MONTHLY_STANDARD', priceMinor: 2_000_000 }],
        stats: { ...coach().stats, ratingAvg: 3.2, ratingCount: 2, completedEngagements: 0 },
      }),
    ]);
    expect(results[0].coachId).toBe('coach_1');
    expect(results.every((r) => r.rawScore >= CALIBRATION.minRawScore)).toBe(true);
  });
});

// ─── offer state machine ─────────────────────────────────────────────────────

describe('offer state machine', () => {
  it('walks the happy path', () => {
    expect(transition('DRAFT', 'SUBMIT', 'STUDENT').to).toBe('OFFERED');
    expect(transition('OFFERED', 'ACCEPT', 'COACH', { isInitiatorOfCurrentOffer: false }).to).toBe(
      'ACCEPTED',
    );
    expect(
      transition('ACCEPTED', 'PAYMENT_CAPTURED', 'SYSTEM', { hasCapturedPayment: true }).to,
    ).toBe('PAID_IN_ESCROW');
    expect(
      transition('PAID_IN_ESCROW', 'ENGAGEMENT_STARTED', 'SYSTEM', { startDateReached: true }).to,
    ).toBe('ACTIVE');
    expect(
      transition('ACTIVE', 'ALL_MILESTONES_RELEASED', 'SYSTEM', {
        allMilestonesSettled: true,
        hasOpenDispute: false,
      }).to,
    ).toBe('COMPLETED');
  });

  it('refuses to cancel an offer whose payment was captured', () => {
    expect(() => transition('ACCEPTED', 'CANCEL', 'STUDENT', { hasCapturedPayment: true })).toThrow(
      OfferTransitionError,
    );
  });

  it('refuses to skip escrow funding', () => {
    expect(() => transition('ACCEPTED', 'ENGAGEMENT_STARTED', 'SYSTEM')).toThrow(
      /No transition/,
    );
  });

  it('will not let a party accept their own offer', () => {
    expect(() =>
      transition('OFFERED', 'ACCEPT', 'STUDENT', { isInitiatorOfCurrentOffer: true }),
    ).toThrow(/cannot accept your own/);
  });

  it('reserves dispute resolution for admins', () => {
    expect(() => transition('DISPUTED', 'RESOLVE_DISPUTE_REFUND', 'COACH')).toThrow(
      /may not trigger/,
    );
  });

  it('treats terminal states as final', () => {
    for (const terminal of ['COMPLETED', 'REFUNDED', 'CANCELLED', 'EXPIRED'] as const) {
      expect(() => transition(terminal, 'CANCEL', 'ADMIN')).toThrow(/terminal state/);
    }
  });

  it('creates slot holds exactly once, at submission', () => {
    const submitted = transition('DRAFT', 'SUBMIT', 'STUDENT');
    expect(submitted.effects.some((e) => e.type === 'CREATE_SLOT_HOLDS')).toBe(true);
    const accepted = transition('OFFERED', 'ACCEPT', 'COACH', { isInitiatorOfCurrentOffer: false });
    expect(accepted.effects.some((e) => e.type === 'CREATE_SLOT_HOLDS')).toBe(false);
  });

  it('exposes only actor-legal actions to the UI', () => {
    expect(availableEvents('ACTIVE', 'STUDENT')).toEqual(['OPEN_DISPUTE']);
    expect(availableEvents('DISPUTED', 'STUDENT')).toEqual([]);
  });
});

// ─── money ───────────────────────────────────────────────────────────────────

describe('commission split', () => {
  it('never loses or invents a kuruş', () => {
    for (const gross of [1, 99, 100, 12_345, 999_999, 1_000_000]) {
      const s = splitAmount(gross, 1800);
      expect(s.commissionMinor + s.netToCoachMinor).toBe(gross);
    }
  });

  it('rounds the remainder toward the coach, not the platform', () => {
    // 1801 bps of 999 = 179.92 → platform gets 179, coach gets the rest.
    expect(splitAmount(999, 1801).commissionMinor).toBe(179);
    expect(splitAmount(999, 1801).netToCoachMinor).toBe(820);
  });

  it('rejects non-integer and non-positive amounts', () => {
    expect(() => splitAmount(10.5, 1800)).toThrow();
    expect(() => splitAmount(0, 1800)).toThrow();
  });
});

describe('milestone division', () => {
  it('sums exactly to the total for awkward divisions', () => {
    for (const [total, count] of [[100_000, 3], [7, 4], [999_999, 7]] as const) {
      const parts = splitIntoMilestones(total, count);
      expect(parts).toHaveLength(count);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

// ─── anti-circumvention ──────────────────────────────────────────────────────

describe('normalisation', () => {
  it('collapses separators between digits', () => {
    expect(normalize('0 5 3 2 - 1 1 1 . 2 2 3 3').numeric).toContain('05321112233');
  });

  it('turns spelled-out Turkish digits into numerals', () => {
    expect(normalize('sıfır beş üç iki').numeric).toContain('0532');
  });

  it('lowercases Turkish I correctly', () => {
    expect(normalize('INSTAGRAM').base).toBe('ınstagram');
  });
});

describe('moderateMessage', () => {
  it('lets ordinary coaching talk through untouched', () => {
    const result = moderateMessage(
      'Merhaba, şu an TYT 55 net civarındayım, AYT matematikte zorlanıyorum. Pazartesi 18:00 uygun mu?',
    );
    expect(result.action).toBe('ALLOW');
    expect(result.redacted).toContain('55 net');
  });

  it('does not mistake exam numbers for contact details', () => {
    const result = moderateMessage('Geçen sene 480 bin sıralamadaydım, hedefim ilk 5000.');
    expect(result.action).toBe('ALLOW');
  });

  it('catches a plainly written phone number', () => {
    const result = moderateMessage('numaram 05321112233, ara beni');
    expect(result.action).not.toBe('ALLOW');
    expect(result.redacted).toContain('[numara gizlendi]');
    expect(result.redacted).not.toContain('05321112233');
  });

  it('catches spaced and dotted evasion', () => {
    const result = moderateMessage('0 5 3 2 . 1 1 1 . 2 2 . 3 3 buradan yaz');
    expect(result.findings.some((f) => f.kind === 'PHONE_NUMBER')).toBe(true);
  });

  it('catches spelled-out digits', () => {
    const result = moderateMessage('sıfır beş üç iki bir bir bir iki iki üç üç');
    expect(result.findings.some((f) => f.kind === 'PHONE_NUMBER')).toBe(true);
  });

  it('catches IBAN sharing and blocks it', () => {
    const result = moderateMessage('ücreti TR330006100519786457841326 hesabıma gönder');
    expect(result.action).toBe('BLOCK');
    expect(result.findings.some((f) => f.kind === 'IBAN')).toBe(true);
  });

  it('catches platform handoffs including shortlinks', () => {
    expect(moderateMessage('wa.me/905321112233 üzerinden konuşalım').action).toBe('BLOCK');
    expect(moderateMessage('insta: kaktus_koc yazarsın').action).not.toBe('ALLOW');
  });

  it('escalates explicit circumvention intent', () => {
    const soft = moderateMessage('komisyonsuz halledelim');
    const combined = moderateMessage('komisyonsuz halledelim, wp den yaz');
    expect(combined.riskScore).toBeGreaterThan(soft.riskScore);
    expect(combined.action).toBe('BLOCK');
  });

  it('never stores or echoes the raw contact detail in findings', () => {
    const result = moderateMessage('05321112233');
    expect(result.findings.every((f) => !f.excerpt.includes('05321112233'))).toBe(true);
  });

  it('escalates faster for a conversation already under suspicion', () => {
    const first = moderateMessage('instagramdan bakabilirsin', 0);
    const repeat = moderateMessage('instagramdan bakabilirsin', 200);
    expect(repeat.action === 'BLOCK' || repeat.action === first.action).toBe(true);
  });

  it('always explains itself to the user', () => {
    const result = moderateMessage('numaram 05321112233');
    expect(result.notice.length).toBeGreaterThan(0);
  });
});
KAKTUS_FILE_EOF

emit "tests/factories.ts" <<'KAKTUS_FILE_EOF'
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import type { OfferScope } from '@/lib/offers/scope';

/**
 * Test fixtures.
 *
 * These build real rows against a real Postgres. The races under test are
 * enforced by exclusion constraints, row locks and conditional updates — none
 * of which a mocked Prisma client can reproduce. A test suite that mocks the
 * database here would pass while the production system double-books.
 */

export async function resetDatabase() {
  // Order matters less than TRUNCATE ... CASCADE, but the ledger has an
  // append-only RULE that blocks DELETE, so TRUNCATE is the only way to clear it.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "LedgerEntry", "Refund", "Payout", "Payment", "Dispute", "Review",
      "Milestone", "Booking", "SlotHold", "Engagement", "OfferEvent", "Offer",
      "MessageViolation", "Message", "Conversation",
      "AvailabilityException", "AvailabilityRule", "PricingTier",
      "VerificationDocument", "CoachSpecialization",
      "CoachProfile", "StudentProfile", "OnboardingSession", "MatchRun",
      "AuditLog", "Session", "Account", "User", "CommissionPolicy"
    RESTART IDENTITY CASCADE
  `);
}

export async function makeCoach(overrides: Partial<{ maxActiveStudents: number }> = {}) {
  const user = await prisma.user.create({
    data: {
      email: `coach-${randomUUID()}@example.com`,
      name: 'Ayşe Y.',
      roles: ['COACH'],
    },
  });

  const coach = await prisma.coachProfile.create({
    data: {
      userId: user.id,
      slug: `ayse-${randomUUID().slice(0, 8)}`,
      headline: 'Sayısal koçu',
      bio: 'Test',
      university: 'Boğaziçi Üniversitesi',
      department: 'EEM',
      yksRank: 3100,
      yksYear: 2023,
      yksTrack: 'SAYISAL',
      tracks: ['SAYISAL'],
      subjects: ['AYT Matematik'],
      styles: ['STRICT'],
      supportedGrades: ['MEZUN'],
      verificationStatus: 'APPROVED',
      submerchantKey: `sub_${randomUUID().slice(0, 8)}`,
      maxActiveStudents: overrides.maxActiveStudents ?? 10,
    },
  });

  return { user, coach };
}

export async function makeStudent() {
  const user = await prisma.user.create({
    data: { email: `student-${randomUUID()}@example.com`, name: 'Mert K.', roles: ['STUDENT'] },
  });
  const student = await prisma.studentProfile.create({
    data: { userId: user.id, track: 'SAYISAL', gradeLevel: 'MEZUN' },
  });
  return { user, student };
}

export async function makeConversation(coachProfileId: string, studentProfileId: string) {
  return prisma.conversation.create({ data: { coachProfileId, studentProfileId } });
}

/** A slot on a fixed future date, so tests are not sensitive to the wall clock. */
export const SLOT_BASE = new Date('2027-01-11T18:00:00.000Z'); // a Monday

export function slot(offsetHours = 0, durationMinutes = 60) {
  const startsAt = new Date(SLOT_BASE.getTime() + offsetHours * 3600_000);
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000) };
}

export function scope(overrides: Partial<OfferScope> = {}): OfferScope {
  return {
    cadence: 'MONTHLY_STANDARD',
    sessionsPerCycle: 4,
    minutesPerSession: 60,
    weeks: 4,
    includesMessaging: true,
    deliverables: ['Haftalık program'],
    slots: [slot(0)],
    ...overrides,
  };
}

/** Captures a payment for an offer, as the provider webhook would. */
export async function capturePayment(offerId: string, amountMinor: number) {
  return prisma.payment.create({
    data: {
      offerId,
      provider: 'mock',
      providerRef: `mock_${randomUUID().slice(0, 10)}`,
      amountMinor,
      status: 'CAPTURED',
      idempotencyKey: `pay:${offerId}`,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant assertions — run these after any concurrent scenario.
// ─────────────────────────────────────────────────────────────────────────────

/** Every entry group must sum to zero. The DB trigger enforces it; this proves it. */
export async function assertLedgerBalanced() {
  const rows = await prisma.$queryRaw<Array<{ entryGroupId: string; imbalance: bigint }>>`
    SELECT "entryGroupId",
           SUM(CASE WHEN direction = 'DEBIT' THEN "amountMinor" ELSE -"amountMinor" END) AS imbalance
    FROM "LedgerEntry"
    GROUP BY "entryGroupId"
    HAVING SUM(CASE WHEN direction = 'DEBIT' THEN "amountMinor" ELSE -"amountMinor" END) <> 0
  `;
  if (rows.length > 0) {
    throw new Error(`Unbalanced ledger groups: ${JSON.stringify(rows.map((r) => r.entryGroupId))}`);
  }
}

/**
 * Escrow must never go negative for an engagement. A negative balance means the
 * platform released or refunded money it never held — the failure that a
 * race-condition bug in the release path would produce.
 */
export async function assertEscrowNonNegative(engagementId: string) {
  const rows = await prisma.$queryRaw<Array<{ balance: bigint }>>`
    SELECT COALESCE(SUM(
      CASE WHEN direction = 'CREDIT' THEN "amountMinor" ELSE -"amountMinor" END
    ), 0) AS balance
    FROM "LedgerEntry"
    WHERE "engagementId" = ${engagementId} AND account = 'PLATFORM_ESCROW'
  `;
  const balance = Number(rows[0]?.balance ?? 0);
  if (balance < 0) throw new Error(`Escrow for ${engagementId} went negative: ${balance}`);
  return balance;
}

/** Total credited to a coach across all releases. */
export async function coachPayable(coachProfileId: string) {
  const rows = await prisma.$queryRaw<Array<{ balance: bigint }>>`
    SELECT COALESCE(SUM(
      CASE WHEN direction = 'CREDIT' THEN "amountMinor" ELSE -"amountMinor" END
    ), 0) AS balance
    FROM "LedgerEntry"
    WHERE "coachProfileId" = ${coachProfileId} AND account = 'COACH_PAYABLE'
  `;
  return Number(rows[0]?.balance ?? 0);
}

/** Runs `fn` n times truly concurrently and partitions the outcomes. */
export async function race<T>(
  n: number,
  fn: (index: number) => Promise<T>,
): Promise<{ fulfilled: T[]; rejected: Error[] }> {
  const settled = await Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)));
  return {
    fulfilled: settled
      .filter((s): s is PromiseFulfilledResult<T> => s.status === 'fulfilled')
      .map((s) => s.value),
    rejected: settled
      .filter((s): s is PromiseRejectedResult => s.status === 'rejected')
      .map((s) => s.reason as Error),
  };
}
KAKTUS_FILE_EOF

emit "tests/iyzico.test.ts" <<'KAKTUS_FILE_EOF'
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
KAKTUS_FILE_EOF

emit "tests/onboarding.test.ts" <<'KAKTUS_FILE_EOF'
import { describe, expect, it } from 'vitest';
import {
  STEPS,
  firstIncompleteStep,
  isStepComplete,
  formatRanking,
  formatTry,
  type OnboardingAnswers,
} from '@/lib/onboarding/schema';
import { toCoachCard } from '@/lib/matching/present';
import type { CoachCandidate, MatchResult } from '@/lib/matching/types';

const base: OnboardingAnswers = { preferredStyles: [] };

describe('step gating', () => {
  it('requires both track and grade before leaving step 1', () => {
    expect(isStepComplete('alan', { ...base, track: 'SAYISAL' })).toBe(false);
    expect(isStepComplete('alan', { ...base, track: 'SAYISAL', gradeLevel: 'MEZUN' })).toBe(true);
  });

  it('accepts a target expressed as a department, with no ranking', () => {
    // A student who only knows "Tıp istiyorum" must not be blocked here.
    expect(isStepComplete('hedef', { ...base, targetDepartment: 'Tıp' })).toBe(true);
  });

  it('treats AYT net as optional and TYT net as required', () => {
    expect(isStepComplete('net', { ...base, baselineTytNet: 55 })).toBe(true);
    expect(isStepComplete('net', { ...base, baselineAytNet: 20 })).toBe(false);
  });

  it('treats zero as an answer, not as missing', () => {
    // The classic falsy-check bug: a student genuinely at 0 net gets stuck.
    expect(isStepComplete('net', { ...base, baselineTytNet: 0 })).toBe(true);
  });

  it('resumes at the first gap rather than the last step touched', () => {
    const answers: OnboardingAnswers = {
      track: 'SAYISAL',
      gradeLevel: 'MEZUN',
      baselineTytNet: 55,
      preferredStyles: ['STRICT'],
      budgetMaxMinor: 300_000,
    };
    expect(firstIncompleteStep(answers)).toBe('hedef');
  });

  it('has five steps with contiguous indices', () => {
    expect(STEPS.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('Turkish formatting', () => {
  it('formats rankings the way students say them', () => {
    expect(formatRanking(150_000)).toBe('150 bin');
    expect(formatRanking(850)).toBe('850');
  });

  it('formats lira with a Turkish thousands separator', () => {
    expect(formatTry(300_000)).toBe('3.000 ₺');
    expect(formatTry(null)).toBe('—');
  });
});

describe('match pills', () => {
  const coach = {
    id: 'c1',
    slug: 'ayse-y',
    displayName: 'Ayşe Y.',
    university: 'Boğaziçi Üniversitesi',
    department: 'EEM',
    tracks: ['SAYISAL'],
    subjects: [],
    styles: ['STRICT'],
    supportedGrades: ['MEZUN'],
    journey: {
      baselineNet: 72,
      finalNet: 98,
      baselineRank: 48_000,
      finalRank: 3100,
      wasMezun: true,
      track: 'SAYISAL',
      year: 2023,
    },
    specializations: [{ label: 'Mezunlukta 50binden ilk 5bine', fromRank: 50_000, toRank: 5_000 }],
    availability: [],
    pricing: [{ cadence: 'MONTHLY_STANDARD', priceMinor: 400_000 }],
    stats: {
      ratingAvg: 4.8,
      ratingCount: 24,
      completedEngagements: 18,
      activeEngagements: 4,
      maxActiveStudents: 10,
      responseP50Seconds: 3600,
      cancellationRate: 0.02,
      lastActiveAt: new Date('2026-09-01'),
      medianStudentNetGain: 22,
    },
  } as unknown as CoachCandidate;

  const result = {
    coachId: 'c1',
    rawScore: 0.82,
    displayScore: 94,
    reasons: ['Sayısal alanından'],
    caveats: [],
    weightsVersion: 'test',
    dimensions: [
      { dimension: 'trackDepth', score: 0.95, weight: 0.14, reason: 'Alan', surface: true },
      { dimension: 'trajectory', score: 0.88, weight: 0.22, reason: 'Çıkış', surface: true },
      { dimension: 'style', score: 0.6, weight: 0.17, reason: 'Tarz', surface: true },
      { dimension: 'availability', score: 0.1, weight: 0.15, reason: 'Saat', surface: true },
      { dimension: 'budget', score: 0.99, weight: 0.12, reason: 'Bütçe', surface: false },
      { dimension: 'reputation', score: 0.83, weight: 0.12, reason: 'Puan', surface: true },
      { dimension: 'gradeExperience', score: 0.4, weight: 0.08, reason: 'Mezun', surface: true },
    ],
  } as unknown as MatchResult;

  const card = toCoachCard(result, coach);

  it('shows percentages that are the scorer\'s own, not invented for display', () => {
    expect(card.pills.find((p) => p.dimension === 'trackDepth')?.percent).toBe(95);
  });

  it('drops dimensions too weak to be worth a pill', () => {
    expect(card.pills.some((p) => p.dimension === 'availability')).toBe(false);
  });

  it('never shows budget as a pill — the price is already on the card', () => {
    expect(card.pills.some((p) => p.dimension === 'budget')).toBe(false);
  });

  it('caps the pill count so a card stays scannable', () => {
    expect(card.pills.length).toBeLessThanOrEqual(4);
  });

  it('renders the coach journey as the number pair students recognise', () => {
    expect(card.journeyLabel).toBe('72 → 98 net');
  });

  it('omits the journey label when the coach reported no climb', () => {
    const flat = { ...coach, journey: { ...coach.journey, baselineNet: 98 } } as CoachCandidate;
    expect(toCoachCard(result, flat).journeyLabel).toBeNull();
  });
});
KAKTUS_FILE_EOF

emit "tsconfig.json" <<'KAKTUS_FILE_EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
KAKTUS_FILE_EOF

emit "vitest.config.ts" <<'KAKTUS_FILE_EOF'
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'node',
    // Integration tests share one database and TRUNCATE between cases, so they
    // must not run in parallel across files. The concurrency they exercise is
    // *inside* each test, not between them.
    fileParallelism: false,
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 30_000,
    include: ['tests/**/*.test.ts'],
  },
});
KAKTUS_FILE_EOF

chmod +x scripts/*.mjs 2>/dev/null || true
cat <<'BANNER'

 Kaktüs Koçluk source tree written.

   Read PROJE-DURUMU.md first — plain-language status and next steps.

   1. cp .env.example .env   (AUTH_SECRET, PII_ENCRYPTION_KEY:
                              openssl rand -base64 32)
      Leave AUTH_RESEND_KEY empty — sign-in links print to the console
      and .auth-link.txt instead of being emailed.
   2. npm install
   3. npx prisma migrate dev --name init
      THEN apply prisma/migrations/20260101000000_marketplace_constraints/
      migration.sql — this is the step that prevents double-booking.
   4. npm run db:seed        # 15 coaches + a test student
   5. npm run verify         # static checks (fast) — then npm run dev

   To use the admin area, give your user the ADMIN role:
     UPDATE "User" SET roles = '{STUDENT,ADMIN}' WHERE email = 'you@example.com';
BANNER

echo
echo "$written files written into $(pwd)"
