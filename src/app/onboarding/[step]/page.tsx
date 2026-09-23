import { notFound } from 'next/navigation';
import { STEPS, type StepSlug } from '@/lib/onboarding/client-state';
import { loadOnboardingDraft } from '@/server/actions/onboarding';
import { OnboardingProvider } from '@/components/onboarding/OnboardingProvider';
import {
  StepBaseline,
  StepBudget,
  StepStyle,
  StepTarget,
  StepTrack,
} from '@/components/onboarding/steps';

/**
 * A route per step rather than one page with client-side step state.
 *
 * The back button has to work. Students compare coaches, go back to widen the
 * budget, come forward again — and a funnel where "back" exits to the landing
 * page loses them. Real URLs also mean a student can be sent a link to the
 * exact step they abandoned.
 */

/**
 * This page reads an httpOnly cookie to resume the guest's answers, so it can
 * never be prerendered. Saying so explicitly is better than letting Next
 * discover it: with `generateStaticParams` and no opt-out, the build tries to
 * statically render all five steps and fails on the first `cookies()` call.
 */
export const dynamic = 'force-dynamic';

/**
 * Steps are resolved with an explicit switch, NOT by indexing a map.
 *
 * `steps.tsx` is a `'use client'` module. When a Server Component imports from
 * one, Next.js replaces every export with a client-reference stub — a pointer
 * the bundler resolves on the client. Individual components survive that
 * translation and can be rendered directly. A plain object does not: importing
 * a `Record<Slug, Component>` here yields a stub whose properties are all
 * `undefined`, and `<Step />` then throws "Element type is invalid... but got:
 * undefined".
 *
 * So the mapping has to live on whichever side actually holds the values. Doing
 * it here, over directly-imported components, keeps routing in the Server
 * Component and gives the compiler an exhaustiveness check for free — a new
 * step added to STEPS without a case is a type error, not a 500 in production.
 */
function resolveStep(step: StepSlug) {
  switch (step) {
    case 'alan':
      return StepTrack;
    case 'hedef':
      return StepTarget;
    case 'net':
      return StepBaseline;
    case 'tarz':
      return StepStyle;
    case 'butce':
      return StepBudget;
    default: {
      const exhaustive: never = step;
      throw new Error(`Unhandled onboarding step: ${String(exhaustive)}`);
    }
  }
}

function isStepSlug(value: string): value is StepSlug {
  return (STEPS as readonly string[]).includes(value);
}

export default async function OnboardingStepPage({
  params,
}: {
  params: Promise<{ step: string }>;
}) {
  const { step } = await params;
  if (!isStepSlug(step)) notFound();

  // Server-side read from the httpOnly cookie session. This is what makes the
  // funnel resumable across devices and across the magic-link round trip; the
  // client cache is only a fast path on top of it.
  const serverDraft = await loadOnboardingDraft();
  const Step = resolveStep(step);

  return (
    <OnboardingProvider serverDraft={serverDraft}>
      <Step />
    </OnboardingProvider>
  );
}
