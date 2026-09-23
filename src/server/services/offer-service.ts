import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  ConcurrentModificationError,
  TX_OPTIONS,
  type Tx,
  acquireAdvisoryLock,
  casStatus,
} from '@/lib/tx';
import { dispatchNotifications } from './notification-service';
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

  // Outside the transaction, and never awaited-to-fail: an email provider
  // hiccup must not turn a committed status change into a thrown error.
  //
  // Deliberately not `next/server`'s `after()` here: this module is called
  // from tests and the job runner with no request scope, and `after()` throws
  // outside one. The trade-off is real on a serverless host — a function that
  // freezes the instant after the response is sent could drop the email — but
  // it keeps this service framework-agnostic, which the whole `jobs/` layer
  // already depends on (see the scheduling note in `jobs/workers.ts`).
  void dispatchNotifications(deferred);

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
