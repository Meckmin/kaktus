import { coveredWeekdays, intersectWindows, totalMinutes } from '@/lib/time/windows';
import {
  CALIBRATION,
  CAPACITY,
  COLD_START,
  REPUTATION,
  WEIGHTS,
  WEIGHTS_VERSION,
} from './weights';
import type {
  CoachCandidate,
  DimensionScore,
  MatchResult,
  StudentMatchInput,
  Track,
} from './types';

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// ─────────────────────────────────────────────────────────────────────────────
// Ranking ⇄ net calibration
//
// Converts a target university ranking into an approximate net requirement so
// "hedefim ilk 5000" and "şu an 42 netim" become comparable numbers.
//
// These anchors are illustrative. Recalibrate every September from published
// ÖSYM sıralama/net tables — treat this table as configuration, not as truth.
// ─────────────────────────────────────────────────────────────────────────────

type Anchor = readonly [rank: number, netIndex: number];

const RANK_TO_NET: Record<Track, readonly Anchor[]> = {
  SAYISAL: [
    [500, 112], [1_000, 106], [5_000, 94], [20_000, 80],
    [50_000, 68], [100_000, 57], [300_000, 41],
  ],
  ESIT_AGIRLIK: [
    [500, 108], [1_000, 103], [5_000, 91], [20_000, 78],
    [50_000, 66], [100_000, 55], [300_000, 39],
  ],
  SOZEL: [
    [500, 105], [1_000, 100], [5_000, 88], [20_000, 75],
    [50_000, 64], [100_000, 53], [300_000, 38],
  ],
  DIL: [
    [500, 100], [1_000, 95], [5_000, 84], [20_000, 71],
    [50_000, 60], [100_000, 50], [300_000, 36],
  ],
};

/** Log-linear interpolation between anchors; clamps outside the table. */
export function netIndexForRanking(track: Track, ranking: number): number {
  const anchors = RANK_TO_NET[track];
  const r = Math.max(1, ranking);

  if (r <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (r >= last[0]) return last[1];

  for (let i = 0; i < anchors.length - 1; i++) {
    const [r0, n0] = anchors[i];
    const [r1, n1] = anchors[i + 1];
    if (r >= r0 && r <= r1) {
      const t = (Math.log(r) - Math.log(r0)) / (Math.log(r1) - Math.log(r0));
      return n0 + t * (n1 - n0);
    }
  }
  return last[1];
}

/** Student's current position as a single comparable net index. */
function baselineNetIndex(student: StudentMatchInput): number | null {
  const { tytNet, aytNet } = student.baseline;
  if (tytNet == null && aytNet == null) return null;
  return (tytNet ?? 0) + (aytNet ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dimension scorers. Each returns 0..1 plus a Turkish, user-facing reason.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trajectory similarity — the product thesis.
 *
 * A coach who personally climbed 45 → 95 net is evidence for a student who
 * needs 40 → 90. Rewards demonstrated climb of at least the required size,
 * with a bonus when the coach *started* somewhere near where the student is
 * now (they remember the problem), and when past students report similar gains.
 */
function scoreTrajectory(
  student: StudentMatchInput,
  coach: CoachCandidate,
): { score: number; reason: string } {
  const base = baselineNetIndex(student);
  const required =
    student.target.ranking != null && base != null
      ? netIndexForRanking(student.track, student.target.ranking) - base
      : null;

  const { baselineNet, finalNet } = coach.journey;
  const demonstrated =
    baselineNet != null && finalNet != null ? finalNet - baselineNet : null;

  // No trajectory data at all → neutral, so unverified journeys neither win
  // nor are punished into invisibility.
  if (required == null && demonstrated == null && coach.stats.medianStudentNetGain == null) {
    return { score: 0.5, reason: 'Gelişim verisi henüz yok' };
  }

  let score = 0.5;
  let reason = '';

  if (required != null && demonstrated != null) {
    // Meeting the required climb = 1.0; exceeding it adds a little, halved,
    // because 3x the needed climb is not 3x the evidence.
    const ratio = required <= 0 ? 1 : demonstrated / required;
    score = ratio >= 1 ? clamp01(0.85 + Math.min(ratio - 1, 1) * 0.15) : clamp01(ratio * 0.85);
    reason = `Kendisi ${Math.round(baselineNet!)} netten ${Math.round(finalNet!)} nete çıkmış; senin hedefin ${Math.round(required)} net artış`;
  } else if (demonstrated != null && demonstrated > 0) {
    score = clamp01(0.45 + Math.min(demonstrated / 50, 1) * 0.4);
    reason = `${Math.round(demonstrated)} netlik kendi çıkışını yapmış`;
  }

  // Familiarity bonus: coach started within ~12 net of where the student is.
  if (base != null && baselineNet != null) {
    const distance = Math.abs(baselineNet - base);
    if (distance <= 12) {
      score = clamp01(score + 0.08);
      if (!reason) reason = 'Senin bulunduğun noktadan başlamış';
    }
  }

  // Specialization band explicitly covering the student's starting rank.
  const band = coach.specializations.find(
    (s) =>
      student.target.ranking != null &&
      s.toRank != null &&
      s.toRank <= student.target.ranking * 1.5,
  );
  if (band) {
    score = clamp01(score + 0.06);
    reason = band.label;
  }

  // Outcome evidence from real students beats self-reported history.
  const median = coach.stats.medianStudentNetGain;
  if (median != null && required != null && required > 0) {
    const outcomeRatio = clamp01(median / required);
    score = clamp01(score * 0.7 + outcomeRatio * 0.3);
    if (median >= required * 0.8) {
      reason = `Öğrencileri ortalama ${Math.round(median)} net artışı bildirmiş`;
    }
  }

  return { score, reason: reason || 'Benzer bir çıkış hikâyesi var' };
}

/**
 * Style fit, rank-weighted: the student's first choice matters most.
 * Weights 1, 1/2, 1/3… over their ordered preferences.
 */
function scoreStyle(
  student: StudentMatchInput,
  coach: CoachCandidate,
): { score: number; reason: string } {
  if (student.preferredStyles.length === 0) {
    return { score: 0.5, reason: 'Çalışma stili tercihi belirtilmemiş' };
  }

  const coachStyles = new Set(coach.styles);
  let earned = 0;
  let possible = 0;
  const matched: string[] = [];

  student.preferredStyles.forEach((style, index) => {
    const weight = 1 / (index + 1);
    possible += weight;
    if (coachStyles.has(style)) {
      earned += weight;
      matched.push(STYLE_TR[style]);
    }
  });

  const score = possible === 0 ? 0.5 : clamp01(earned / possible);
  const reason =
    matched.length > 0
      ? `${matched.join(' + ')} çalışıyor — tam aradığın tarz`
      : 'Çalışma stili tercihinden farklı';

  return { score, reason };
}

const STYLE_TR: Record<string, string> = {
  STRICT: 'Disiplinli takip',
  EMPATHETIC: 'Mentor yaklaşımı',
  STRATEGIC: 'Strateji odaklı',
  HIGH_TOUCH: 'Sık check-in',
};

/**
 * Availability overlap. Scored against what the student actually needs
 * (weeklyHoursGoal), not against their total free time — a coach available
 * for all 20 declared free hours is not 4x better than one available for the
 * 5 hours the student wants.
 */
function scoreAvailability(
  student: StudentMatchInput,
  coach: CoachCandidate,
): { score: number; reason: string } {
  if (student.availability.length === 0) {
    return { score: 0.5, reason: 'Müsaitlik belirtilmemiş' };
  }

  const shared = intersectWindows(student.availability, coach.availability);
  const sharedMinutes = totalMinutes(shared);
  if (sharedMinutes === 0) {
    return { score: 0, reason: 'Ortak müsait saat yok' };
  }

  const neededMinutes = Math.max(60, (student.weeklyHoursGoal ?? 2) * 60);
  const coverage = clamp01(sharedMinutes / neededMinutes);
  // Spread across days matters as much as raw minutes for weekly check-ins.
  const days = coveredWeekdays(shared).length;
  const spread = clamp01(days / 3);
  const score = clamp01(coverage * 0.7 + spread * 0.3);

  return {
    score,
    reason: `Haftada ${days} gün, toplam ${Math.round(sharedMinutes / 60)} saat ortak müsaitlik`,
  };
}

/** Track match plus subject depth for that track. */
function scoreTrackDepth(
  student: StudentMatchInput,
  coach: CoachCandidate,
): { score: number; reason: string } {
  const primary = coach.journey.track === student.track;
  const supports = coach.tracks.includes(student.track);
  if (!supports) return { score: 0, reason: 'Farklı alan' };

  const needed = CRITICAL_SUBJECTS[student.track];
  const covered = needed.filter((s) =>
    coach.subjects.some((cs) => cs.toLocaleLowerCase('tr').includes(s.toLocaleLowerCase('tr'))),
  );
  const depth = needed.length === 0 ? 1 : covered.length / needed.length;

  const score = clamp01((primary ? 0.6 : 0.42) + depth * 0.4);
  const reason = primary
    ? `${TRACK_TR[student.track]} alanından, ${covered.length > 0 ? covered.join(' ve ') + ' dahil' : 'aynı alan'}`
    : `${TRACK_TR[student.track]} desteği veriyor`;

  return { score, reason };
}

const TRACK_TR: Record<Track, string> = {
  SAYISAL: 'Sayısal',
  ESIT_AGIRLIK: 'Eşit Ağırlık',
  SOZEL: 'Sözel',
  DIL: 'Dil',
};

const CRITICAL_SUBJECTS: Record<Track, string[]> = {
  SAYISAL: ['AYT Matematik', 'Fizik', 'Kimya', 'Biyoloji'],
  ESIT_AGIRLIK: ['AYT Matematik', 'Edebiyat', 'Tarih', 'Coğrafya'],
  SOZEL: ['Edebiyat', 'Tarih', 'Coğrafya', 'Felsefe'],
  DIL: ['YDT İngilizce', 'TYT Türkçe'],
};

/**
 * Budget fit, deliberately asymmetric. Cheaper than the student's floor costs
 * nothing; more expensive than their ceiling decays sharply, because price is
 * the most common reason a promising match dies at the offer stage.
 */
function scoreBudget(
  student: StudentMatchInput,
  coach: CoachCandidate,
): { score: number; reason: string; caveat?: string } {
  const max = student.budget.maxMinor;
  if (max == null) return { score: 0.6, reason: 'Bütçe belirtilmemiş' };

  const preferred = coach.pricing.find((p) => p.cadence === student.budget.cadence);
  const cheapest = coach.pricing.reduce<number | null>(
    (min, p) => (min == null || p.priceMinor < min ? p.priceMinor : min),
    null,
  );
  const price = preferred?.priceMinor ?? cheapest;
  if (price == null) return { score: 0.4, reason: 'Fiyatlandırma tanımlanmamış' };

  const tl = (minor: number) => Math.round(minor / 100).toLocaleString('tr-TR');

  if (price <= max) {
    const headroom = (max - price) / max;
    return {
      score: clamp01(0.85 + headroom * 0.15),
      reason: `${tl(price)} ₺ — bütçenin içinde`,
    };
  }

  const overBy = (price - max) / max;
  return {
    score: clamp01(Math.exp(-overBy * 3.2)),
    reason: `${tl(price)} ₺ — bütçenin %${Math.round(overBy * 100)} üzerinde`,
    caveat: `Bu koçun paketi belirttiğin bütçenin üzerinde. Kapsamı küçülterek teklif verebilirsin.`,
  };
}

/** Bayesian-smoothed reputation blended with volume, responsiveness, reliability. */
function scoreReputation(coach: CoachCandidate): { score: number; reason: string } {
  const { ratingAvg, ratingCount, completedEngagements, responseP50Seconds, cancellationRate } =
    coach.stats;

  const smoothed =
    (ratingAvg * ratingCount + REPUTATION.priorRating * REPUTATION.priorWeight) /
    (ratingCount + REPUTATION.priorWeight);
  const ratingScore = clamp01((smoothed - 3) / 2);

  const volumeScore = clamp01(Math.log10(completedEngagements + 1) / Math.log10(21));

  let responseScore = 0.6;
  if (responseP50Seconds != null) {
    const { idealResponseSeconds: ideal, poorResponseSeconds: poor } = REPUTATION;
    responseScore = clamp01(1 - (responseP50Seconds - ideal) / (poor - ideal));
  }

  const reliability = clamp01(1 - cancellationRate * 2.5);

  const score = clamp01(
    ratingScore * 0.45 + volumeScore * 0.2 + responseScore * 0.15 + reliability * 0.2,
  );

  const reason =
    ratingCount >= 3
      ? `${ratingAvg.toFixed(1)} puan, ${ratingCount} değerlendirme`
      : 'Platformda yeni — henüz az değerlendirme';

  return { score, reason };
}

function scoreGradeExperience(
  student: StudentMatchInput,
  coach: CoachCandidate,
): { score: number; reason: string } {
  const supports = coach.supportedGrades.includes(student.gradeLevel);
  let score = supports ? 0.8 : 0.35;
  let reason = supports
    ? `${GRADE_TR[student.gradeLevel]} öğrencileriyle çalışıyor`
    : `Ağırlıklı olarak farklı sınıf seviyesiyle çalışıyor`;

  if (student.gradeLevel === 'MEZUN' && coach.journey.wasMezun) {
    score = clamp01(score + 0.2);
    reason = 'Kendisi de mezun yılında çalışmış — o süreci yaşamış';
  }

  return { score, reason };
}

const GRADE_TR: Record<string, string> = {
  GRADE_11: '11. sınıf',
  GRADE_12: '12. sınıf',
  MEZUN: 'Mezun',
};

// ─────────────────────────────────────────────────────────────────────────────
// Composition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps raw 0..1 to the displayed 0..100. Strictly increasing, so it can never
 * reorder results — it only changes how the same ranking is presented.
 */
export function calibrate(raw: number): number {
  const curved = Math.pow(clamp01(raw), CALIBRATION.gamma);
  const spread = CALIBRATION.displayCeiling - CALIBRATION.displayFloor;
  return Math.round(CALIBRATION.displayFloor + curved * spread);
}

function coldStartBonus(coach: CoachCandidate, now: Date): number {
  if (coach.stats.completedEngagements >= COLD_START.engagementThreshold) return 0;
  const ageDays =
    (now.getTime() - coach.stats.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24);
  const decay = clamp01(1 - ageDays / COLD_START.decayDays);
  return COLD_START.maxBonusPoints * decay;
}

/**
 * Scores one coach against one student. Pure: no I/O, no clock reads except the
 * injected `now`, fully unit-testable.
 */
export function scoreCoach(
  student: StudentMatchInput,
  coach: CoachCandidate,
  now: Date = new Date(),
): MatchResult {
  const trajectory = scoreTrajectory(student, coach);
  const style = scoreStyle(student, coach);
  const availability = scoreAvailability(student, coach);
  const trackDepth = scoreTrackDepth(student, coach);
  const budget = scoreBudget(student, coach);
  const reputation = scoreReputation(coach);
  const gradeExperience = scoreGradeExperience(student, coach);

  const dimension = (
    dimension: DimensionScore['dimension'],
    part: { score: number; reason: string },
    surface: boolean,
  ): DimensionScore => ({
    dimension,
    score: part.score,
    reason: part.reason,
    weight: WEIGHTS[dimension],
    surface,
  });

  const dimensions: DimensionScore[] = [
    dimension('trajectory', trajectory, true),
    dimension('style', style, true),
    dimension('availability', availability, true),
    dimension('trackDepth', trackDepth, true),
    dimension('budget', budget, false),
    dimension('reputation', reputation, true),
    dimension('gradeExperience', gradeExperience, true),
  ];

  let raw = dimensions.reduce((sum, d) => sum + d.score * d.weight, 0);

  // Capacity demotion — near-full coaches convert worse and reply slower.
  const utilisation =
    coach.stats.maxActiveStudents > 0
      ? coach.stats.activeEngagements / coach.stats.maxActiveStudents
      : 0;
  if (utilisation >= CAPACITY.nearFullThreshold) raw *= CAPACITY.nearFullMultiplier;

  raw = clamp01(raw);

  const displayScore = Math.min(
    CALIBRATION.displayCeiling,
    calibrate(raw) + Math.round(coldStartBonus(coach, now)),
  );

  const reasons = dimensions
    // trackDepth's reason restates the track, which the card already shows on
    // its own — a real scoring signal, but a redundant headline sentence.
    .filter((d) => d.surface && d.dimension !== 'trackDepth' && d.score >= 0.62 && d.reason)
    .sort((a, b) => b.score * b.weight - a.score * a.weight)
    .slice(0, 3)
    .map((d) => d.reason);

  const caveats: string[] = [];
  if (budget.caveat) caveats.push(budget.caveat);
  if (availability.score < 0.25) {
    caveats.push('Müsait saatleriniz büyük ölçüde çakışmıyor.');
  }
  if (utilisation >= 1) caveats.push('Şu anda kontenjanı dolu.');

  return {
    coachId: coach.id,
    rawScore: raw,
    displayScore,
    dimensions,
    reasons,
    caveats,
    weightsVersion: WEIGHTS_VERSION,
  };
}

/** Scores, filters below the visibility floor, and ranks. Deterministic. */
export function rankCoaches(
  student: StudentMatchInput,
  candidates: CoachCandidate[],
  options: { limit?: number; now?: Date } = {},
): MatchResult[] {
  const now = options.now ?? new Date();
  return candidates
    .map((c) => scoreCoach(student, c, now))
    .filter((r) => r.rawScore >= CALIBRATION.minRawScore)
    .sort((a, b) => b.displayScore - a.displayScore || a.coachId.localeCompare(b.coachId))
    .slice(0, options.limit ?? 20);
}
