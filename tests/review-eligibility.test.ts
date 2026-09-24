import { describe, expect, it } from 'vitest';
import { reviewEligibility } from '@/lib/reviews/eligibility';

describe('reviewEligibility', () => {
  it('opens a normal review on a completed program', () => {
    expect(reviewEligibility({ status: 'COMPLETED', releasedMilestones: 4, resolvedDisputes: 0 })).toBe('COMPLETE');
  });

  it('opens a labelled review on a cancelled program after a released lesson', () => {
    expect(reviewEligibility({ status: 'CANCELLED', releasedMilestones: 1, resolvedDisputes: 0 })).toBe('INCOMPLETE');
  });

  it('opens a labelled review on a cancelled program closed by a dispute', () => {
    // e.g. the coach never showed and the student got a full refund.
    expect(reviewEligibility({ status: 'CANCELLED', releasedMilestones: 0, resolvedDisputes: 1 })).toBe('INCOMPLETE');
  });

  it('keeps reviews closed on a program cancelled before anything happened', () => {
    expect(reviewEligibility({ status: 'CANCELLED', releasedMilestones: 0, resolvedDisputes: 0 })).toBeNull();
  });

  it('keeps reviews closed while a program is still running', () => {
    expect(reviewEligibility({ status: 'ACTIVE', releasedMilestones: 2, resolvedDisputes: 0 })).toBeNull();
  });
});
