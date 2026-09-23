import { prisma } from '@/lib/db';
import type { TimeWindow } from '@/lib/time/windows';
import { coveredWeekdays } from '@/lib/time/windows';
import { rankCoaches } from './score';
import { WEIGHTS_VERSION } from './weights';
import type { CoachCandidate, MatchResult, StudentMatchInput } from './types';

/**
 * Two-phase matching.
 *
 * Phase 1 (this file, in SQL): eliminate on hard constraints — cheap, indexed,
 * and safe to run against the whole coach table.
 * Phase 2 (score.ts, pure TS): rank the survivors in memory.
 *
 * The split matters. Hard constraints are business rules that must never be
 * traded away by a high score elsewhere: an unverified coach is not a 91% match
 * with a caveat, they are not a match. Everything soft belongs in the scorer.
 */

const HARD_FILTERS = [
  'coach must be APPROVED',
  'coach must be accepting students',
  'coach must support the student track',
  'coach must have at least one active pricing tier',
  'coach must share at least one available weekday with the student',
  'price must not exceed budget ceiling × tolerance',
] as const;

/** Students see coaches up to 40% over their stated ceiling — they negotiate. */
const BUDGET_TOLERANCE = 1.4;

export interface MatchOptions {
  limit?: number;
  now?: Date;
  /** Records a MatchRun row for weighting analysis. */
  onboardingSessionId?: string;
  studentProfileId?: string;
  persist?: boolean;
}

export async function findMatches(
  student: StudentMatchInput,
  options: MatchOptions = {},
): Promise<{ results: MatchResult[]; coaches: Map<string, CoachCandidate> }> {
  const startedAt = Date.now();
  const weekdays = coveredWeekdays(student.availability);
  const priceCeiling =
    student.budget.maxMinor != null
      ? Math.round(student.budget.maxMinor * BUDGET_TOLERANCE)
      : undefined;

  const rows = await prisma.coachProfile.findMany({
    where: {
      verificationStatus: 'APPROVED',
      acceptingStudents: true,
      tracks: { has: student.track },
      pricingTiers: {
        some: {
          active: true,
          ...(priceCeiling != null ? { priceMinor: { lte: priceCeiling } } : {}),
        },
      },
      ...(weekdays.length > 0
        ? { availabilityRules: { some: { active: true, weekday: { in: weekdays } } } }
        : {}),
    },
    select: {
      id: true,
      slug: true,
      university: true,
      department: true,
      tracks: true,
      subjects: true,
      styles: true,
      supportedGrades: true,
      yksRank: true,
      yksYear: true,
      yksTrack: true,
      ownBaselineNet: true,
      ownFinalNet: true,
      ownBaselineRank: true,
      wasMezun: true,
      ratingAvg: true,
      ratingCount: true,
      completedEngagements: true,
      activeEngagements: true,
      maxActiveStudents: true,
      responseP50Seconds: true,
      cancellationRate: true,
      lastActiveAt: true,
      user: { select: { name: true } },
      specializations: { select: { label: true, fromRank: true, toRank: true } },
      pricingTiers: {
        where: { active: true },
        select: { cadence: true, priceMinor: true },
      },
      availabilityRules: {
        where: { active: true },
        select: { weekday: true, startMinute: true, endMinute: true },
      },
      reviews: {
        where: { published: true, netGainReported: { not: null } },
        select: { netGainReported: true },
        take: 50,
        orderBy: { createdAt: 'desc' },
      },
    },
    // Bound the in-memory scoring set. Rating order is a proxy, not the ranking.
    take: 400,
    orderBy: { ratingAvg: 'desc' },
  });

  const coaches = new Map<string, CoachCandidate>();
  for (const row of rows) {
    coaches.set(row.id, {
      id: row.id,
      slug: row.slug,
      displayName: row.user.name ?? 'Koç',
      university: row.university,
      department: row.department,
      tracks: row.tracks,
      subjects: row.subjects,
      styles: row.styles,
      supportedGrades: row.supportedGrades,
      journey: {
        baselineNet: row.ownBaselineNet,
        finalNet: row.ownFinalNet,
        baselineRank: row.ownBaselineRank,
        finalRank: row.yksRank,
        wasMezun: row.wasMezun,
        track: row.yksTrack,
        year: row.yksYear,
      },
      specializations: row.specializations,
      availability: row.availabilityRules as TimeWindow[],
      pricing: row.pricingTiers,
      stats: {
        ratingAvg: row.ratingAvg,
        ratingCount: row.ratingCount,
        completedEngagements: row.completedEngagements,
        activeEngagements: row.activeEngagements,
        maxActiveStudents: row.maxActiveStudents,
        responseP50Seconds: row.responseP50Seconds,
        cancellationRate: row.cancellationRate,
        lastActiveAt: row.lastActiveAt,
        medianStudentNetGain: median(
          row.reviews.map((r) => r.netGainReported).filter((n): n is number => n != null),
        ),
      },
    });
  }

  const results = rankCoaches(student, [...coaches.values()], {
    limit: options.limit ?? 20,
    now: options.now,
  });

  if (options.persist !== false) {
    // Fire-and-forget: analytics must never fail a page render.
    void prisma.matchRun
      .create({
        data: {
          onboardingSessionId: options.onboardingSessionId,
          studentProfileId: options.studentProfileId,
          weightsVersion: WEIGHTS_VERSION,
          candidateCount: rows.length,
          latencyMs: Date.now() - startedAt,
          results: results.map((r, i) => ({
            coachProfileId: r.coachId,
            rawScore: Number(r.rawScore.toFixed(4)),
            displayScore: r.displayScore,
            position: i + 1,
            reasons: r.reasons,
          })),
        },
      })
      .catch(() => undefined);
  }

  return { results, coaches };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export { HARD_FILTERS };
