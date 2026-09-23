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
    // CREATE_ENGAGEMENT must run before POST_ESCROW_FUNDING and
    // CREATE_MILESTONES: both look the engagement up by offerId and throw if
    // it isn't there yet. CREATE_ENGAGEMENT is idempotent (skips if a caller —
    // payment-service.ts, notably — already created it), so ordering it first
    // costs nothing when it's redundant and is load-bearing when it isn't.
    effects: [
      { type: 'CREATE_ENGAGEMENT' },
      { type: 'POST_ESCROW_FUNDING' },
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
