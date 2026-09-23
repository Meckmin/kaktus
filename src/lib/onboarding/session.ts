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
