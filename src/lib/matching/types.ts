import type { TimeWindow } from '@/lib/time/windows';

export type Track = 'SAYISAL' | 'ESIT_AGIRLIK' | 'SOZEL' | 'DIL';
export type GradeLevel = 'GRADE_11' | 'GRADE_12' | 'MEZUN';
export type CoachingStyle = 'STRICT' | 'EMPATHETIC' | 'STRATEGIC' | 'HIGH_TOUCH';
export type PricingCadence =
  | 'WEEKLY_SYNC'
  | 'MONTHLY_STANDARD'
  | 'INTENSIVE'
  | 'SINGLE_SESSION';

/** Everything the guest questionnaire produces. No user id required. */
export interface StudentMatchInput {
  track: Track;
  gradeLevel: GradeLevel;
  baseline: {
    tytNet: number | null;
    aytNet: number | null;
  };
  target: {
    ranking: number | null;
    university?: string | null;
    department?: string | null;
  };
  /** Ordered — index 0 is the strongest preference. */
  preferredStyles: CoachingStyle[];
  availability: TimeWindow[];
  budget: {
    minMinor: number | null;
    maxMinor: number | null;
    cadence: PricingCadence;
  };
  weeklyHoursGoal?: number | null;
}

export interface CoachJourney {
  /** TYT + AYT combined — the scale the trajectory scorer works in. */
  baselineNet: number | null;
  finalNet: number | null;
  /** Same journey, split by exam — for display only; the scorer never reads these. */
  baselineTytNet: number | null;
  finalTytNet: number | null;
  baselineAytNet: number | null;
  finalAytNet: number | null;
  baselineRank: number | null;
  finalRank: number;
  wasMezun: boolean;
  track: Track;
  year: number;
}

export interface CoachStats {
  ratingAvg: number;
  ratingCount: number;
  completedEngagements: number;
  activeEngagements: number;
  maxActiveStudents: number;
  responseP50Seconds: number | null;
  cancellationRate: number;
  lastActiveAt: Date;
  /** Median net gain reported by past students. Strongest evidence we have. */
  medianStudentNetGain: number | null;
}

export interface CoachCandidate {
  id: string;
  slug: string;
  displayName: string;
  university: string;
  department: string;
  tracks: Track[];
  subjects: string[];
  styles: CoachingStyle[];
  supportedGrades: GradeLevel[];
  journey: CoachJourney;
  specializations: Array<{ label: string; fromRank: number | null; toRank: number | null }>;
  availability: TimeWindow[];
  pricing: Array<{ cadence: PricingCadence; priceMinor: number }>;
  stats: CoachStats;
}

export type ScoreDimension =
  | 'trajectory'
  | 'style'
  | 'availability'
  | 'trackDepth'
  | 'budget'
  | 'reputation'
  | 'gradeExperience';

export interface DimensionScore {
  dimension: ScoreDimension;
  /** 0..1 */
  score: number;
  weight: number;
  /** Turkish, user-facing when `surface` is true. */
  reason: string;
  surface: boolean;
}

export interface MatchResult {
  coachId: string;
  /** 0..1, uncalibrated. Persist this one. */
  rawScore: number;
  /** 0..100 integer, what the UI shows. */
  displayScore: number;
  dimensions: DimensionScore[];
  /** Top user-facing reasons, already sorted by contribution. */
  reasons: string[];
  /** Non-fatal mismatches worth disclosing, e.g. price above budget. */
  caveats: string[];
  weightsVersion: string;
}

export interface RejectedCandidate {
  coachId: string;
  rule: string;
}
