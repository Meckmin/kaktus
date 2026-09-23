import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import type { OfferScope } from '@/lib/offers/scope';
import { createOffer, transitionOffer } from '@/server/services/offer-service';

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

/**
 * Fixture engagement window: started a day ago, a 28-day span — relative to
 * whenever the suite actually runs, not a fixed calendar date. See
 * `tests/concurrency.integration.test.ts` for why this can't be hardcoded.
 */
export const ENGAGEMENT_START = new Date(Date.now() - 24 * 60 * 60 * 1000);
export const ENGAGEMENT_END = new Date(Date.now() + 27 * 24 * 60 * 60 * 1000);

/**
 * A fully paid, active engagement: offer created, accepted, paid, escrow
 * funded, engagement started. Milestones come back in `SCHEDULED` status,
 * exactly as a coach or student would find them mid-program.
 */
export async function fundedEngagement(
  opts: {
    milestoneCount?: number;
    slots?: Array<{ startsAt: Date; endsAt: Date }>;
    priceMinor?: number;
  } = {},
) {
  const { coach } = await makeCoach();
  const { user: studentUser, student } = await makeStudent();
  const conversation = await makeConversation(coach.id, student.id);
  const coachUser = await prisma.user.findFirstOrThrow({
    where: { coachProfile: { id: coach.id } },
  });

  const priceMinor = opts.priceMinor ?? 400_000;
  const milestoneCount = opts.milestoneCount ?? 4;
  const slots = opts.slots ?? [slot(0)];

  const offer = await createOffer({
    conversationId: conversation.id,
    coachProfileId: coach.id,
    studentProfileId: student.id,
    initiatorRole: 'STUDENT',
    actorId: studentUser.id,
    actorProfileId: student.id,
    title: 'Aylık koçluk',
    scope: scope({ slots }),
    priceMinor,
    startDate: ENGAGEMENT_START,
    endDate: ENGAGEMENT_END,
    milestoneCount,
  });

  await transitionOffer({
    offerId: offer.id,
    event: 'ACCEPT',
    actor: 'COACH',
    actorId: coachUser.id,
    actorProfileId: coach.id,
  });
  await capturePayment(offer.id, priceMinor);
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

  return { coach, coachUser, student, studentUser, conversation, offer, engagement };
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
): Promise<{ fulfilled: Awaited<T>[]; rejected: Error[] }> {
  const settled = await Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)));
  const fulfilled: Awaited<T>[] = [];
  const rejected: Error[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') fulfilled.push(s.value);
    else rejected.push(s.reason as Error);
  }
  return { fulfilled, rejected };
}
