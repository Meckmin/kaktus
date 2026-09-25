import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { milestoneCompletableAt } from '@/lib/offers/scope';
import {
  RESOLVED_DISPUTE_STATUSES,
  reviewEligibility,
  type ReviewEligibility,
} from '@/lib/reviews/eligibility';
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

export interface MilestoneEntry {
  id: string;
  index: number;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'PENDING_CONFIRMATION' | 'RELEASED' | 'DISPUTED' | 'REFUNDED';
  amountMinor: number;
  periodStart: Date;
  autoReleaseAt: Date | null;
  /** When the coach may mark it done: after its last session ends. */
  completableAt: Date;
}

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
  /** The paid offer's engagement, if payment has happened — milestones live here. */
  engagement: {
    id: string;
    offerId: string;
    status: string;
    milestones: MilestoneEntry[];
    reviewed: boolean;
    /** Whether the student may review it, and whether it'd be marked as ended early. */
    reviewEligibility: ReviewEligibility;
  } | null;
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
          engagement: {
            select: {
              id: true,
              status: true,
              milestones: {
                orderBy: { index: 'asc' },
                select: {
                  id: true,
                  index: true,
                  status: true,
                  amountMinor: true,
                  periodStart: true,
                  periodEnd: true,
                  autoReleaseAt: true,
                  bookings: { select: { endsAt: true, status: true } },
                },
              },
              review: { select: { id: true } },
              disputes: { where: { status: { in: [...RESOLVED_DISPUTE_STATUSES] } }, select: { id: true } },
            },
          },
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

  // A conversation can carry more than one engagement over time — the same
  // coach and student booking a second program after the first completes.
  // `offers` is ordered oldest-first, so among offers with an engagement,
  // prefer the currently unsettled one (ACTIVE) over a settled one; between
  // two of the same kind, prefer the most recent.
  // An engagement still PENDING_PAYMENT only exists because checkout opened;
  // it has no milestones to show until the payment is captured.
  const engagementOffers = conversation.offers.filter(
    (o) => o.engagement && o.engagement.status !== 'PENDING_PAYMENT',
  );
  const paidOffer =
    [...engagementOffers].reverse().find((o) => o.engagement?.status === 'ACTIVE') ??
    engagementOffers[engagementOffers.length - 1];
  const engagement = paidOffer?.engagement
    ? {
        id: paidOffer.engagement.id,
        offerId: paidOffer.id,
        status: paidOffer.engagement.status,
        milestones: paidOffer.engagement.milestones.map(
          ({ bookings, periodEnd, ...m }): MilestoneEntry => ({
            ...m,
            completableAt: milestoneCompletableAt(bookings, periodEnd),
          }),
        ),
        reviewed: Boolean(paidOffer.engagement.review),
        reviewEligibility: reviewEligibility({
          status: paidOffer.engagement.status,
          releasedMilestones: paidOffer.engagement.milestones.filter((m) => m.status === 'RELEASED')
            .length,
          resolvedDisputes: paidOffer.engagement.disputes.length,
        }),
      }
    : null;

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
    engagement,
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
        // A countered offer has been replaced by its child; without the
        // counterOffers check, once the child settled (paid, refunded) the
        // list fell back to the stale parent and showed it as awaiting a reply.
        where: {
          status: { in: ['OFFERED', 'COUNTERED', 'ACCEPTED'] },
          counterOffers: { none: {} },
        },
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
