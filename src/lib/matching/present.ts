import type { CoachCandidate, MatchResult, ScoreDimension } from './types';

/**
 * Turns a MatchResult into what the card renders.
 *
 * The pills come from the scorer's own per-dimension scores, not from copy
 * invented in the component. That matters: if a pill says "Alan uyumu %95" it
 * has to be the number that actually contributed to the ranking, otherwise the
 * explanation is decoration and students will eventually catch it out.
 *
 * Only dimensions the student can act on are surfaced. Budget fit is scored but
 * not shown as a pill — telling someone their match is 40% on budget is just
 * telling them the price, which the card already shows plainly.
 */

export const DIMENSION_LABEL: Record<ScoreDimension, string> = {
  trajectory: 'Hedef benzerliği',
  style: 'Çalışma tarzı',
  availability: 'Saat uyumu',
  trackDepth: 'Alan uyumu',
  budget: 'Bütçe',
  reputation: 'Öğrenci puanı',
  gradeExperience: 'Sınıf deneyimi',
};

/** Order the pills appear in. Highest-signal first, not highest-scoring. */
const PILL_ORDER: ScoreDimension[] = [
  'trackDepth',
  'trajectory',
  'style',
  'availability',
  'gradeExperience',
  'reputation',
];

export interface MatchPill {
  dimension: ScoreDimension;
  label: string;
  /** 0–100, rounded. */
  percent: number;
  /** The scorer's own explanation, in Turkish. */
  reason: string;
  tone: 'strong' | 'fair' | 'weak';
}

export interface CoachCardModel {
  coachId: string;
  slug: string;
  displayName: string;
  university: string;
  department: string;
  matchScore: number;
  headlineReasons: string[];
  caveats: string[];
  pills: MatchPill[];
  priceFromMinor: number | null;
  ratingAvg: number;
  ratingCount: number;
  completedEngagements: number;
  /** e.g. "72 → 98 net" — the single most persuasive fact we have. */
  journeyLabel: string | null;
  specializationLabel: string | null;
}

function tone(percent: number): MatchPill['tone'] {
  if (percent >= 80) return 'strong';
  if (percent >= 55) return 'fair';
  return 'weak';
}

export function toCoachCard(result: MatchResult, coach: CoachCandidate): CoachCardModel {
  const byDimension = new Map(result.dimensions.map((d) => [d.dimension, d]));

  const pills: MatchPill[] = PILL_ORDER.flatMap((dimension) => {
    const d = byDimension.get(dimension);
    if (!d) return [];
    const percent = Math.round(d.score * 100);
    // A near-zero dimension is noise on a card; the caveat line covers the
    // genuinely disqualifying cases (no shared hours, over budget).
    if (percent < 25) return [];
    return [{ dimension, label: DIMENSION_LABEL[dimension], percent, reason: d.reason, tone: tone(percent) }];
  }).slice(0, 4);

  const { baselineNet, finalNet } = coach.journey;
  const journeyLabel =
    baselineNet != null && finalNet != null && finalNet > baselineNet
      ? `${Math.round(baselineNet)} → ${Math.round(finalNet)} net`
      : null;

  const prices = coach.pricing.map((p) => p.priceMinor);

  return {
    coachId: result.coachId,
    slug: coach.slug,
    displayName: coach.displayName,
    university: coach.university,
    department: coach.department,
    matchScore: result.displayScore,
    headlineReasons: result.reasons,
    caveats: result.caveats,
    pills,
    priceFromMinor: prices.length > 0 ? Math.min(...prices) : null,
    ratingAvg: coach.stats.ratingAvg,
    ratingCount: coach.stats.ratingCount,
    completedEngagements: coach.stats.completedEngagements,
    journeyLabel,
    specializationLabel: coach.specializations[0]?.label ?? null,
  };
}
