'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  STEPS,
  type OnboardingDraft,
  type StepSlug,
  readDraft,
  writeDraft,
} from '@/lib/onboarding/client-state';
import { saveOnboardingStep } from '@/server/actions/onboarding';

/**
 * Guest onboarding state.
 *
 * Three copies of the answers exist and they have different jobs:
 *
 *   React state    — what the UI renders. Updates instantly on tap.
 *   sessionStorage — survives a refresh and the trip through the auth modal.
 *   OnboardingSession row — the record. Survives everything, including a
 *                    magic link opened in a different browser.
 *
 * The server copy is authoritative and seeds the other two on mount. Writes go
 * the other way: local first so nothing ever waits on the network, then a
 * background save. If that save fails we keep the local copy and retry on the
 * next step rather than blocking a 17-year-old mid-funnel on a flaky connection.
 */

interface OnboardingContextValue {
  draft: OnboardingDraft;
  /** Merges a patch, caches locally, and persists in the background. */
  update: (patch: OnboardingDraft) => void;
  /** Persists and navigates. Awaits the save so results are never stale. */
  advance: (from: StepSlug) => Promise<void>;
  goBack: (from: StepSlug) => void;
  saving: boolean;
  saveFailed: boolean;
  hydrated: boolean;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const value = useContext(OnboardingContext);
  if (!value) throw new Error('useOnboarding must be used inside <OnboardingProvider>');
  return value;
}

export function OnboardingProvider({
  children,
  serverDraft,
}: {
  children: React.ReactNode;
  /** Read on the server from the httpOnly-cookie session. */
  serverDraft: OnboardingDraft;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<OnboardingDraft>(serverDraft);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const pending = useRef<OnboardingDraft>({});

  // Hydrate once, on mount. The server copy wins where both exist; the local
  // cache fills gaps, which is what covers the case where a step was answered
  // but its background save never landed.
  useEffect(() => {
    const local = readDraft();
    const merged: OnboardingDraft = { ...local, ...stripEmpty(serverDraft) };
    setDraft(merged);
    writeDraft(merged);
    setHydrated(true);
    // serverDraft is a server-rendered prop; re-running on identity change
    // would clobber answers the student just typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback((patch: OnboardingDraft) => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      writeDraft(next);
      pending.current = { ...pending.current, ...patch };
      return next;
    });
  }, []);

  const advance = useCallback(
    async (from: StepSlug) => {
      const index = STEPS.indexOf(from);
      const next = STEPS[index + 1];

      setSaving(true);
      setSaveFailed(false);
      try {
        const result = await saveOnboardingStep({
          ...pending.current,
          completedStep: index + 1,
        });
        if (!result.ok) throw new Error('validation');
        pending.current = {};
      } catch {
        // Non-blocking by design: the answers are safe in sessionStorage and
        // the next step retries the whole pending patch. Stopping the funnel
        // here would cost more students than a delayed save ever will.
        setSaveFailed(true);
      } finally {
        setSaving(false);
      }

      router.push(next ? `/onboarding/${next}` : '/kocbul');
    },
    [router],
  );

  const goBack = useCallback(
    (from: StepSlug) => {
      const index = STEPS.indexOf(from);
      if (index <= 0) {
        router.push('/');
        return;
      }
      router.push(`/onboarding/${STEPS[index - 1]}`);
    },
    [router],
  );

  return (
    <OnboardingContext.Provider
      value={{ draft, update, advance, goBack, saving, saveFailed, hydrated }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

/** Drops null/undefined so a sparse server row cannot erase a local answer. */
function stripEmpty(draft: OnboardingDraft): OnboardingDraft {
  return Object.fromEntries(
    Object.entries(draft).filter(([, v]) => v !== null && v !== undefined),
  ) as OnboardingDraft;
}
