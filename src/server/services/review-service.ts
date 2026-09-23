import { prisma } from '@/lib/db';
import { TX_OPTIONS, acquireAdvisoryLock } from '@/lib/tx';

/**
 * Student reviews, written once an engagement completes.
 *
 * One review per engagement (`Review.engagementId` is unique), so there is no
 * edit or delete path here — a review is a statement about a specific finished
 * program, not a mutable rating that drifts with the relationship.
 */

export class ReviewActionError extends Error {
  constructor(
    readonly userMessage: string,
    readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'WRONG_STATE' | 'ALREADY_REVIEWED',
  ) {
    super(userMessage);
    this.name = 'ReviewActionError';
  }
}

export interface SubmitReviewInput {
  engagementId: string;
  studentUserId: string;
  rating: number;
  body?: string;
  netGainReported?: number;
}

/**
 * Creates the review and folds it into `CoachProfile.ratingAvg`/`ratingCount`
 * as a running average rather than a recompute over every review — the
 * average is a live signal the matching engine and coach profile page read on
 * every request, and rescanning `Review` for it would not scale.
 *
 * The advisory lock serialises concurrent reviews for the *same coach* — two
 * students finishing engagements around the same moment must not both read the
 * same `ratingCount` and each apply a lost update.
 */
export interface SubmittedReview {
  id: string;
  coachSlug: string;
  conversationId: string;
}

export async function submitReview(input: SubmitReviewInput): Promise<SubmittedReview> {
  const engagement = await prisma.engagement.findUnique({
    where: { id: input.engagementId },
    select: {
      id: true,
      status: true,
      coachProfileId: true,
      studentProfileId: true,
      student: { select: { userId: true } },
      review: { select: { id: true } },
      coach: { select: { slug: true } },
      offer: { select: { conversationId: true } },
    },
  });
  if (!engagement) throw new ReviewActionError('Program bulunamadı.', 'NOT_FOUND');
  if (engagement.student.userId !== input.studentUserId) {
    throw new ReviewActionError('Bu program için değerlendirme yazamazsın.', 'FORBIDDEN');
  }
  if (engagement.status !== 'COMPLETED') {
    throw new ReviewActionError(
      'Değerlendirme yalnızca program tamamlandıktan sonra yazılabilir.',
      'WRONG_STATE',
    );
  }
  if (engagement.review) {
    throw new ReviewActionError('Bu program için zaten bir değerlendirme yazdın.', 'ALREADY_REVIEWED');
  }

  try {
    const review = await prisma.$transaction(async (tx) => {
      await acquireAdvisoryLock(tx, `review:coach:${engagement.coachProfileId}`);

      const created = await tx.review.create({
        data: {
          engagementId: engagement.id,
          coachProfileId: engagement.coachProfileId,
          studentProfileId: engagement.studentProfileId,
          rating: input.rating,
          body: input.body ?? null,
          netGainReported: input.netGainReported ?? null,
        },
      });

      const coach = await tx.coachProfile.findUniqueOrThrow({
        where: { id: engagement.coachProfileId },
        select: { ratingAvg: true, ratingCount: true },
      });
      const ratingCount = coach.ratingCount + 1;
      const ratingAvg = (coach.ratingAvg * coach.ratingCount + input.rating) / ratingCount;
      await tx.coachProfile.update({
        where: { id: engagement.coachProfileId },
        data: { ratingAvg, ratingCount },
      });

      return created;
    }, TX_OPTIONS);

    return { id: review.id, coachSlug: engagement.coach.slug, conversationId: engagement.offer.conversationId };
  } catch (error) {
    // A double-submit racing the read above: the unique index on
    // `engagementId` is the real guard, this check above is just the fast path.
    if (String(error).includes('Unique constraint')) {
      throw new ReviewActionError('Bu program için zaten bir değerlendirme yazdın.', 'ALREADY_REVIEWED');
    }
    throw error;
  }
}
