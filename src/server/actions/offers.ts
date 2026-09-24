'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { createOffer } from '@/server/services/offer-service';
import { SlotUnavailableError } from '@/lib/booking/holds';
import { checkRateLimit, RateLimitError } from '@/lib/rate-limit';
import { claimOnboardingSessionFromCookie } from '@/lib/onboarding/session';
import {
  OFFER_DRAFT_COOKIE,
  OFFER_DRAFT_TTL_SECONDS,
  PACKAGE_CONFIG,
  type OfferDraft,
} from '@/lib/offers/draft';
import { belowFloorMessage, minOfferMinor } from '@/lib/offers/price-floor';

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

  try {
    checkRateLimit(`submit-offer:${session.user.id}`, 10, 60_000);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { ok: false, code: 'FAILED', message: 'Çok hızlı teklif gönderiyorsun. Biraz yavaşla.' };
    }
    throw error;
  }

  let student = await prisma.studentProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!student) {
    // The sign-in event's claim can miss its window (see session.ts) — retry
    // once from the still-present onboarding cookie before telling someone
    // who answered every question that they haven't.
    const claimed = await claimOnboardingSessionFromCookie(session.user.id);
    if (claimed) student = { id: claimed.id };
  }
  if (!student) {
    return {
      ok: false,
      code: 'NO_PROFILE',
      message: 'Öğrenci profilin henüz oluşmamış. Soruları tamamlayıp tekrar dene.',
    };
  }

  const coach = await prisma.coachProfile.findUnique({
    where: { slug: parsed.data.coachSlug },
    select: {
      id: true,
      verificationStatus: true,
      acceptingStudents: true,
      pricingTiers: {
        where: { active: true },
        select: { cadence: true, priceMinor: true, sessionsPerCycle: true },
      },
    },
  });
  if (!coach || coach.verificationStatus !== 'APPROVED' || !coach.acceptingStudents) {
    return { ok: false, code: 'INVALID', message: 'Bu koç şu anda yeni öğrenci almıyor.' };
  }

  const floor = minOfferMinor({
    packageType: parsed.data.packageType,
    tiers: coach.pricingTiers,
    role: 'STUDENT',
  });
  if (parsed.data.priceMinor < floor) {
    return { ok: false, code: 'INVALID', message: belowFloorMessage(floor) };
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
