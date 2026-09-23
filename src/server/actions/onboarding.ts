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
import type { OnboardingDraft } from '@/lib/onboarding/client-state';
import { toCoachMatchView, type CoachMatchView } from '@/lib/matching/view';

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
 * is shaping each result into what a guest may see (see toCoachMatchView).
 */
export async function getMatches(limit = 12): Promise<MatchesResult> {
  const session = await readOnboardingSession();
  const input = session ? toMatchInput(session) : null;
  if (!session || !input) return { ready: false, coaches: [], totalConsidered: 0 };

  const { results, coaches } = await findMatches(input, {
    limit,
    onboardingSessionId: session.id,
  });

  const view = results.map((result) => toCoachMatchView(result, coaches.get(result.coachId)!));

  return { ready: true, coaches: view, totalConsidered: coaches.size };
}

/** Called after the last step; refreshes the results page cache. */
export async function completeOnboarding(patch: OnboardingDraft) {
  await saveOnboardingStep({ ...patch, completedStep: 5 });
  revalidatePath('/kocbul');
}
