import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import {
  onboardingSchema,
  readOnboardingSession,
  toMatchInput,
  upsertOnboardingSession,
} from '@/lib/onboarding/session';
import { findMatches } from '@/lib/matching/engine';

/**
 * Saves one step of the guest questionnaire. Called on every step so a student
 * who drops out at step 3 still leaves a usable signal — and so returning
 * later resumes where they stopped.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = onboardingSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const session = await upsertOnboardingSession(parsed.data, {
    ipHash: forwarded ? createHash('sha256').update(forwarded).digest('hex').slice(0, 32) : undefined,
    userAgent: request.headers.get('user-agent') ?? undefined,
    referrer: request.headers.get('referer') ?? undefined,
  });

  return NextResponse.json({
    ok: true,
    completedStep: session.completedStep,
    ready: Boolean(session.track && session.gradeLevel),
  });
}

/** Returns the saved answers plus a live match preview. */
export async function GET() {
  const session = await readOnboardingSession();
  if (!session) return NextResponse.json({ session: null, matches: [] });

  const input = toMatchInput(session);
  if (!input) return NextResponse.json({ session, matches: [] });

  const { results, coaches } = await findMatches(input, {
    limit: 12,
    onboardingSessionId: session.id,
  });

  return NextResponse.json({
    session,
    matches: results.map((r) => {
      const coach = coaches.get(r.coachId)!;
      return {
        coachId: r.coachId,
        slug: coach.slug,
        displayName: coach.displayName,
        university: coach.university,
        department: coach.department,
        matchScore: r.displayScore,
        reasons: r.reasons,
        caveats: r.caveats,
        priceFromMinor: Math.min(...coach.pricing.map((p) => p.priceMinor)),
        // Exact availability and contact surface stay behind the auth gate.
        ratingAvg: coach.stats.ratingAvg,
        ratingCount: coach.stats.ratingCount,
      };
    }),
  });
}
