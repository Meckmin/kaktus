'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import {
  MilestoneActionError,
  approveMilestoneRelease,
  markMilestoneCompleted,
} from '@/server/services/milestone-service';
import { openDispute } from '@/server/services/dispute-service';
import { declineOffer } from '@/server/actions/negotiation';
import { OfferTransitionError } from '@/lib/offers/state-machine';
import { enforceRateLimit, RateLimitError } from '@/lib/rate-limit';

/**
 * Milestone completion, escrow release, and the student's dispute / cancellation
 * triggers — the write side of the engagement half of `/panel/teklifler/[id]`.
 */

const idSchema = z.string().min(1).max(64);

export type MilestoneResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

function milestoneErrorMessage(error: unknown): string {
  if (error instanceof MilestoneActionError) return error.userMessage;
  console.error('[milestones] action failed', error);
  return 'İşlem tamamlanamadı. Tekrar dene.';
}

/** Coach: "Bu dönemi tamamladım." */
export async function completeMilestone(milestoneId: string): Promise<MilestoneResult> {
  try {
    idSchema.parse(milestoneId);
    const session = await auth();
    if (!session?.user?.id) return { ok: false, message: 'Önce giriş yapman gerekiyor.' };

    await markMilestoneCompleted({ milestoneId, coachUserId: session.user.id });

    revalidatePath('/panel');
    return {
      ok: true,
      message: 'Dilim tamamlandı olarak işaretlendi. Öğrencinin onayı ya da 5 gün bekleniyor.',
    };
  } catch (error) {
    return { ok: false, message: milestoneErrorMessage(error) };
  }
}

/** Student: "Onayla ve ücreti aktar." */
export async function releaseMilestoneToCoach(milestoneId: string): Promise<MilestoneResult> {
  try {
    idSchema.parse(milestoneId);
    const session = await auth();
    if (!session?.user?.id) return { ok: false, message: 'Önce giriş yapman gerekiyor.' };

    const result = await approveMilestoneRelease({
      milestoneId,
      studentUserId: session.user.id,
    });

    revalidatePath('/panel');
    return {
      ok: true,
      message: result.providerApproved
        ? 'Onaylandı. Ücret koça aktarıldı.'
        : 'Onaylandı. Ücret aktarımı işleme alındı.',
    };
  } catch (error) {
    return { ok: false, message: milestoneErrorMessage(error) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispute / cancellation
// ─────────────────────────────────────────────────────────────────────────────

const disputeSchema = z.object({
  offerId: idSchema,
  milestoneId: idSchema.optional(),
  reason: z.enum(['COACH_NO_SHOW', 'QUALITY', 'SCOPE_NOT_DELIVERED', 'UNRESPONSIVE', 'OTHER']),
  detail: z.string().trim().min(10).max(2000),
});

export type OpenDisputeInput = z.input<typeof disputeSchema>;

/**
 * Student raises a dispute on an incomplete milestone.
 *
 * Delegates to the dispute service, which freezes every unreleased milestone and
 * routes the case to an admin. Released milestones are never clawed back.
 */
export async function raiseDispute(input: OpenDisputeInput): Promise<MilestoneResult> {
  const parsed = disputeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: 'Lütfen en az 10 karakterlik bir açıklama yaz.' };
  }

  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: 'Önce giriş yapman gerekiyor.' };

  try {
    await enforceRateLimit(`raise-dispute:${session.user.id}`, 5, 60_000);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { ok: false, message: 'Çok hızlı işlem yapıyorsun. Biraz yavaşla.' };
    }
    throw error;
  }

  const offer = await prisma.offer.findUnique({
    where: { id: parsed.data.offerId },
    select: {
      status: true,
      student: { select: { userId: true } },
      engagement: { select: { id: true } },
    },
  });
  if (!offer) return { ok: false, message: 'Teklif bulunamadı.' };
  if (offer.student.userId !== session.user.id) {
    return { ok: false, message: 'Bu teklif için itiraz açamazsın.' };
  }
  if (!offer.engagement) {
    return {
      ok: false,
      message: 'Bu teklif için henüz bir program yok. Ödeme öncesinde iptal talebi oluşturabilirsin.',
    };
  }

  try {
    await openDispute({
      engagementId: offer.engagement.id,
      milestoneId: parsed.data.milestoneId,
      openedByUserId: session.user.id,
      openedByRole: 'STUDENT',
      reason: parsed.data.reason,
      detail: parsed.data.detail,
    });

    revalidatePath(`/panel/teklifler/${parsed.data.offerId}`);
    revalidatePath('/panel');
    return {
      ok: true,
      message: 'İtirafın alındı. İlgili dilimler donduruldu; ekibimiz inceleyip sana dönecek.',
    };
  } catch (error) {
    if (error instanceof OfferTransitionError) {
      return { ok: false, message: 'Bu teklif şu anda itiraza uygun bir durumda değil.' };
    }
    console.error('[milestones] raiseDispute failed', error);
    return { ok: false, message: 'İtiraz oluşturulamadı. Tekrar dene.' };
  }
}

/**
 * Student asks to call the whole thing off.
 *
 * Before payment this is a plain offer cancellation. After payment it is a
 * dispute — a student cannot unilaterally pull funds out of escrow, so the
 * request goes to an admin with the money frozen in the meantime.
 */
export async function requestCancellation(
  offerId: string,
  detail: string,
): Promise<MilestoneResult> {
  try {
    idSchema.parse(offerId);
  } catch {
    return { ok: false, message: 'Geçersiz teklif.' };
  }

  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: 'Önce giriş yapman gerekiyor.' };

  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { status: true, student: { select: { userId: true } } },
  });
  if (!offer) return { ok: false, message: 'Teklif bulunamadı.' };
  if (offer.student.userId !== session.user.id) {
    return { ok: false, message: 'Bu teklif için talep oluşturamazsın.' };
  }

  if (['DRAFT', 'OFFERED', 'COUNTERED', 'ACCEPTED'].includes(offer.status)) {
    const result = await declineOffer(offerId);
    return result.ok
      ? { ok: true, message: 'Teklif iptal edildi.' }
      : { ok: false, message: result.message };
  }

  // Post-payment: route through the dispute service.
  return raiseDispute({
    offerId,
    reason: 'OTHER',
    detail: detail.trim().length >= 10 ? detail.trim() : 'Öğrenci programın iptalini talep ediyor.',
  });
}
