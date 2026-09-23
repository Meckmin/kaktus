import type { ScoreDimension } from './types';

/**
 * Bump this on ANY change below. Every MatchRun records it, so a weighting
 * change can be attributed to a change in offer-send rate instead of being
 * argued about in a meeting.
 */
export const WEIGHTS_VERSION = '2026.09.01-a';

export const WEIGHTS: Record<ScoreDimension, number> = {
  trajectory: 0.22,
  style: 0.17,
  availability: 0.15,
  trackDepth: 0.14,
  budget: 0.12,
  reputation: 0.12,
  gradeExperience: 0.08,
};

// Fail loudly at import time rather than shipping a silently rescaled model.
const WEIGHT_SUM = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(WEIGHT_SUM - 1) > 1e-9) {
  throw new Error(`Matching weights must sum to 1, got ${WEIGHT_SUM}`);
}

export const REPUTATION = {
  /** Bayesian prior so a single 5★ doesn't outrank fifty 4.7★. */
  priorRating: 4.4,
  priorWeight: 8,
  /** Response time at or under this counts as perfect. */
  idealResponseSeconds: 2 * 3600,
  poorResponseSeconds: 48 * 3600,
} as const;

export const COLD_START = {
  /** Coaches below this many completed engagements get exposure support. */
  engagementThreshold: 3,
  /** Maximum bonus in display points. Enough to be seen, not enough to top the list. */
  maxBonusPoints: 4,
  /** Bonus decays to zero over this many days after approval. */
  decayDays: 45,
} as const;

export const CALIBRATION = {
  /**
   * Raw weighted scores realistically land in 0.45–0.85. Presenting "58% Match"
   * to a 17-year-old reads as a broken product, so we apply one documented
   * monotone curve here — never scattered fudge factors at call sites.
   * Ranking is unaffected: the curve is strictly increasing.
   */
  gamma: 0.62,
  displayFloor: 55,
  displayCeiling: 98,
  /** Candidates below this raw score are not shown at all. */
  minRawScore: 0.38,
} as const;

export const CAPACITY = {
  /** Coaches at >=90% capacity are slightly demoted; they convert worse. */
  nearFullThreshold: 0.9,
  nearFullMultiplier: 0.96,
} as const;
