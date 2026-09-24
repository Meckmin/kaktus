/**
 * Whether a student may review an engagement, and how the review is labelled.
 *
 * Completed programs get a normal review. A program that ended early can still
 * be reviewed when something real happened in it — at least one lesson's money
 * was released, or a dispute was decided — and the review is shown as
 * "Program yarıda kaldı". Without this, the students with the worst
 * experiences (a no-show, a refund) were exactly the ones who could never
 * leave a review, which skewed every coach's rating upward.
 *
 * A program cancelled before anything happened stays closed to reviews, so a
 * cancellation can't be turned into a free one-star.
 */
export type ReviewEligibility = 'COMPLETE' | 'INCOMPLETE' | null;

export function reviewEligibility(engagement: {
  status: string;
  releasedMilestones: number;
  resolvedDisputes: number;
}): ReviewEligibility {
  if (engagement.status === 'COMPLETED') return 'COMPLETE';
  if (engagement.status !== 'CANCELLED') return null;
  return engagement.releasedMilestones > 0 || engagement.resolvedDisputes > 0 ? 'INCOMPLETE' : null;
}

/** Dispute statuses that mean a decision was made (see Dispute.status). */
export const RESOLVED_DISPUTE_STATUSES = [
  'RESOLVED_RELEASE',
  'RESOLVED_REFUND',
  'RESOLVED_SPLIT',
] as const;
