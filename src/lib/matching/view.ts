import { DIMENSION_LABELS } from '@/lib/onboarding/client-state';
import type { CoachCandidate, MatchResult, Track } from './types';

/**
 * What a guest sees of one matched coach on /kocbul.
 *
 * Kept pure and separate from the server action so the exact shape the card
 * renders can be tested without a database.
 *
 * Withheld until sign-in: exact availability windows, full surname, contact
 * surface. The score and its reasons are the hook; the specifics are what the
 * account is for.
 */

export interface MatchBreakdown {
  key: string;
  label: string;
  /** 0–100, for the pill. */
  percent: number;
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
  journey: {
    baselineTytNet: number | null;
    finalTytNet: number | null;
    baselineAytNet: number | null;
    finalAytNet: number | null;
    finalRank: number;
    track: Track;
  };
}

export function toCoachMatchView(result: MatchResult, coach: CoachCandidate): CoachMatchView {
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
      })),
    priceFromMinor: coach.pricing.length
      ? Math.min(...coach.pricing.map((p) => p.priceMinor))
      : null,
    ratingAvg: coach.stats.ratingAvg,
    ratingCount: coach.stats.ratingCount,
    journey: {
      baselineTytNet: coach.journey.baselineTytNet,
      finalTytNet: coach.journey.finalTytNet,
      baselineAytNet: coach.journey.baselineAytNet,
      finalAytNet: coach.journey.finalAytNet,
      finalRank: coach.journey.finalRank,
      track: coach.journey.track,
    },
  };
}
