'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CalendarDay } from '@/lib/booking/availability';
import {
  PACKAGE_CONFIG,
  suggestedPriceMinor,
  type OfferDraft,
  type PackageType,
} from '@/lib/offers/draft';
import { saveOfferDraft, submitOffer } from '@/server/actions/offers';
import { useAuthGate } from '@/components/auth/AuthGate';
import { AvailabilityCalendar } from '@/components/coach/AvailabilityCalendar';
import { OfferComposer, type ComposerCoach, type ComposerState } from '@/components/offer/OfferComposer';

/**
 * The interactive island on the coach profile.
 *
 * Everything above it — hero, bio, reviews — is a Server Component and ships no
 * JavaScript. This owns the only state that has to be interactive: which slots
 * are picked, which package, what price.
 *
 * The interception is the interesting part. A guest can configure an entire
 * offer; when they submit, the draft is parked in an httpOnly cookie *before*
 * the auth gate opens, and the return URL points back to this page with
 * `?teklif=1`. On return the server reads the cookie, passes it down as
 * `resumeDraft`, and the composer reopens exactly as they left it — same slots,
 * same price, same note.
 *
 * Then it submits automatically. Making someone re-press a button they already
 * pressed is a small insult at the exact moment they have just done the thing
 * we asked for.
 */
export function CoachProfileClient({
  coach,
  days,
  timezone,
  authenticated,
  resumeDraft,
}: {
  coach: ComposerCoach;
  days: CalendarDay[];
  timezone: string;
  authenticated: boolean;
  resumeDraft: OfferDraft | null;
}) {
  const router = useRouter();
  const { require } = useAuthGate();
  const autoSubmitted = useRef(false);

  const defaultPackage: PackageType = resumeDraft?.packageType ?? 'EXPLORATORY';
  const [open, setOpen] = useState(Boolean(resumeDraft));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<ComposerState>({
    packageType: defaultPackage,
    slots: resumeDraft?.slots ?? [],
    priceMinor:
      resumeDraft?.priceMinor ?? suggestedPriceMinor(defaultPackage, coach.pricingTiers) ?? 0,
    note: resumeDraft?.note ?? '',
  });

  const update = useCallback(
    (patch: Partial<ComposerState>) => setState((current) => ({ ...current, ...patch })),
    [],
  );

  const buildDraft = useCallback(
    (): OfferDraft => ({
      coachProfileId: coach.id,
      coachSlug: coach.slug,
      packageType: state.packageType,
      slots: state.slots,
      priceMinor: state.priceMinor,
      note: state.note || undefined,
      createdAt: new Date().toISOString(),
    }),
    [coach.id, coach.slug, state],
  );

  const send = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    const draft = buildDraft();

    if (!authenticated) {
      // Park the draft first, then open the gate. If this order were reversed
      // and the student signed in fast, the redirect could beat the write.
      await saveOfferDraft(draft);
      setSubmitting(false);
      require({
        action: 'Teklif göndermek',
        returnTo: `/koc/${coach.slug}?teklif=1`,
      });
      return;
    }

    const result = await submitOffer(draft);
    setSubmitting(false);

    if (result.ok) {
      // Straight into the conversation, not the read-only offer page: the
      // student has just made a proposal and the next thing they want is the
      // place where the coach will answer it.
      router.push(`/panel/sohbet/${result.conversationId}`);
      return;
    }
    setError(result.message);
    // A taken slot invalidates the calendar we rendered; refetch so the student
    // is choosing from reality rather than from a stale grid.
    if (result.code === 'SLOT_TAKEN') {
      update({ slots: [] });
      router.refresh();
    }
  }, [authenticated, buildDraft, coach.slug, require, router, update]);

  // Resume-and-send after sign-in.
  useEffect(() => {
    if (!resumeDraft || !authenticated || autoSubmitted.current) return;
    autoSubmitted.current = true;
    void send();
  }, [resumeDraft, authenticated, send]);

  const startOffer = (packageType: PackageType) => {
    const suggested = suggestedPriceMinor(packageType, coach.pricingTiers);
    setState((current) => ({
      ...current,
      packageType,
      slots: current.slots.slice(0, PACKAGE_CONFIG[packageType].sessions),
      priceMinor: current.priceMinor || suggested || 0,
    }));
    setOpen(true);
  };

  return (
    <>
      <section id="takvim" className="mt-12">
        <AvailabilityCalendar
          days={days}
          timezone={timezone}
          selected={state.slots}
          onToggle={(startsAt) => {
            update({
              slots: state.slots.includes(startsAt)
                ? state.slots.filter((s) => s !== startsAt)
                : [...state.slots, startsAt].slice(-PACKAGE_CONFIG[state.packageType].sessions),
            });
            setOpen(true);
          }}
          maxSelections={PACKAGE_CONFIG[state.packageType].sessions}
        />
      </section>

      {/* Sticky on mobile: the calendar is long, and the action should never
          scroll out of reach. */}
      <div className="sticky bottom-0 z-20 -mx-6 mt-10 border-t border-stone/70 bg-limestone/95 px-6 py-4 backdrop-blur sm:-mx-8 sm:px-8 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => startOffer('MONTHLY_4W')}
            className="rounded-full bg-cactus px-6 py-3 font-medium text-paper transition-colors hover:bg-cactus-deep"
          >
            Teklif gönder
          </button>
          <button
            type="button"
            onClick={() => startOffer('EXPLORATORY')}
            className="rounded-full border border-stone px-6 py-3 font-medium transition-colors hover:border-cactus hover:text-cactus"
          >
            Önce tanışma seansı
          </button>
        </div>
      </div>

      <OfferComposer
        open={open}
        coach={coach}
        days={days}
        timezone={timezone}
        state={state}
        onChange={update}
        onClose={() => setOpen(false)}
        onSubmit={send}
        submitting={submitting}
        error={error}
        authenticated={authenticated}
      />
    </>
  );
}
