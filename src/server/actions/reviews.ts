'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { ReviewActionError, submitReview } from '@/server/services/review-service';

export type SubmitReviewResult = { ok: true } | { ok: false; message: string };

const inputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().max(2000).optional(),
  netGainReported: z.number().min(-120).max(120).optional(),
});

/** Student leaves a rating (and optionally a note) on a completed engagement. */
export async function submitReviewAction(
  engagementId: string,
  input: { rating: number; body?: string; netGainReported?: number },
): Promise<SubmitReviewResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Geçerli bir puan seç.' };

  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: 'Önce giriş yapman gerekiyor.' };

  try {
    const result = await submitReview({
      engagementId,
      studentUserId: session.user.id,
      rating: parsed.data.rating,
      body: parsed.data.body,
      netGainReported: parsed.data.netGainReported,
    });

    // Paths to revalidate come back from the service, derived from the
    // engagement itself — never from client-supplied arguments, so a caller
    // cannot point a revalidation at a page it has no business touching.
    revalidatePath(`/koc/${result.coachSlug}`);
    revalidatePath(`/panel/sohbet/${result.conversationId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ReviewActionError) return { ok: false, message: error.userMessage };
    console.error('[reviews] submit failed', error);
    return { ok: false, message: 'Değerlendirme gönderilemedi. Tekrar dene.' };
  }
}
