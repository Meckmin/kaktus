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
                              │  saveOnboardingStep()  → OnboardingSession row
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
