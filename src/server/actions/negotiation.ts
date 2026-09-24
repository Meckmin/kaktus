'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import { moderateMessage, THRESHOLDS } from '@/lib/chat/anti-circumvention';
import { encryptField, encryptionAvailable } from '@/lib/crypto/field';
import { transitionOffer } from '@/server/services/offer-service';
import { startCheckout } from '@/server/services/payment-service';
import { SlotUnavailableError } from '@/lib/booking/holds';
import { createOffer } from '@/server/services/offer-service';
import { checkRateLimit, RateLimitError } from '@/lib/rate-limit';
import { belowFloorMessage, minOfferMinor, packageTypeForCadence } from '@/lib/offers/price-floor';
import { buyerDetailsSchema, type BuyerDetailsInput } from '@/lib/payments/buyer';

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

export type SentMessage = {
  id: string;
  body: string;
  moderationAction: 'ALLOW' | 'MASK' | 'BLOCK';
  systemNotice: string | null;
  createdAt: string;
};

export type SendMessageResult =
  | { ok: true; masked: boolean; notice: string; message: SentMessage }
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

  try {
    checkRateLimit(`send-message:${userId}`, 20, 60_000);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { ok: false, blocked: false, message: 'Çok hızlı mesaj gönderiyorsun. Biraz yavaşla.' };
    }
    throw error;
  }

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

  const message = await prisma.$transaction(async (tx) => {
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

    return message;
  });

  revalidatePath(`/panel/sohbet/${conversationId}`);
  return {
    ok: true,
    masked: verdict.action === 'MASK',
    notice: verdict.notice,
    message: {
      id: message.id,
      body: message.body,
      moderationAction: message.moderationAction,
      systemNotice: message.systemNotice,
      createdAt: message.createdAt.toISOString(),
    },
  };
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
    checkRateLimit(`offer-action:${userId}`, 20, 60_000);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { ok: false, message: 'Çok hızlı işlem yapıyorsun. Biraz yavaşla.' };
    }
    throw error;
  }

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

  try {
    checkRateLimit(`offer-action:${userId}`, 20, 60_000);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { ok: false, message: 'Çok hızlı işlem yapıyorsun. Biraz yavaşla.' };
    }
    throw error;
  }

  const scope = (parent.scope ?? {}) as Record<string, unknown>;

  const tiers = await prisma.pricingTier.findMany({
    where: { coachProfileId: parent.coachProfileId, active: true },
    select: { cadence: true, priceMinor: true, sessionsPerCycle: true },
  });
  const floor = minOfferMinor({
    packageType: packageTypeForCadence(scope.cadence),
    tiers,
    role,
  });
  if (parsed.data.priceMinor < floor) return { ok: false, message: belowFloorMessage(floor) };

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
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * Opens payment for an accepted offer.
 *
 * Only the student can pay, and only from ACCEPTED — both enforced here and
 * again inside the payment service, because this is the single point where the
 * product starts handling real money.
 */
export async function payForOffer(
  offerId: string,
  buyerInput: BuyerDetailsInput,
): Promise<CheckoutResult> {
  const buyer = buyerDetailsSchema.safeParse(buyerInput);
  if (!buyer.success) {
    return {
      ok: false,
      message: 'Ödeme bilgilerinde eksik ya da hatalı alan var.',
      fieldErrors: buyer.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

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

  // Iyzico's fraud checks use the buyer's IP; the first x-forwarded-for hop is
  // the client behind our proxy. Localhost only when there is no proxy at all.
  const forwarded = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim();

  try {
    const session = await startCheckout({
      offerId,
      studentUserId: userId,
      // Passed through to the provider only — not persisted anywhere.
      buyer: {
        ...buyer.data,
        email: offer.student.user.email ?? 'ogrenci@kaktuskocluk.com',
        ip: forwarded || '127.0.0.1',
      },
      callbackUrl: `${env.APP_URL}/api/payments/callback`,
    });
    return { ok: true, checkoutFormContent: session.checkoutFormContent, token: session.token };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ödeme başlatılamadı.';
    console.error('[negotiation] checkout failed', error);
    return { ok: false, message };
  }
}
