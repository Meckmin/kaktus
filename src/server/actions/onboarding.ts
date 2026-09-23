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
