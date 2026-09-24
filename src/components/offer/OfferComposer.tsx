'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PACKAGE_CONFIG,
  computeBreakdown,
  suggestedPriceMinor,
  type PackageType,
} from '@/lib/offers/draft';
import { formatTry } from '@/lib/onboarding/client-state';
import type { CalendarDay } from '@/lib/booking/availability';
import { AvailabilityCalendar } from '@/components/coach/AvailabilityCalendar';

/**
 * Offer composer.
 *
 * A drawer rather than a modal: it needs to be tall, scrollable, and reachable
 * with a thumb, and most students are on a phone. It also keeps the coach's
 * profile visible behind it on desktop, which matters while they are deciding
 * how much to offer.
 */

export interface ComposerCoach {
  id: string;
  slug: string;
  displayName: string;
  commissionBps: number;
  pricingTiers: Array<{
    cadence: string;
    priceMinor: number;
    sessionsPerCycle: number;
    minutesPerSession: number;
  }>;
}

export interface ComposerState {
  packageType: PackageType;
  slots: string[];
  priceMinor: number;
  note: string;
}

export function OfferComposer({
  open,
  coach,
  days,
  timezone,
  state,
  onChange,
  onClose,
  onSubmit,
  submitting,
  error,
  authenticated,
}: {
  open: boolean;
  coach: ComposerCoach;
  days: CalendarDay[];
  timezone: string;
  state: ComposerState;
  onChange: (patch: Partial<ComposerState>) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
  authenticated: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const config = PACKAGE_CONFIG[state.packageType];
  const breakdown = computeBreakdown(state.priceMinor, coach.commissionBps);
  const slotsNeeded = config.sessions;
  const ready = state.slots.length === slotsNeeded && state.priceMinor > 0;

  // Read onClose through a ref so the effect below runs only when the dialog
  // opens or closes. Callers pass an inline arrow, which is a new function
  // every render; with it as a dependency, each keystroke re-ran the effect and
  // `focus()` pulled focus off the price input after the first digit.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onCloseRef.current();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  const toggleSlot = (startsAt: string) => {
    const current = state.slots;
    if (current.includes(startsAt)) {
      onChange({ slots: current.filter((s) => s !== startsAt) });
      return;
    }
    // At capacity, replace the oldest pick rather than ignoring the tap.
    const next =
      current.length >= slotsNeeded ? [...current.slice(1), startsAt] : [...current, startsAt];
    onChange({ slots: next.sort() });
  };

  const changePackage = (packageType: PackageType) => {
    const suggested = suggestedPriceMinor(packageType, coach.pricingTiers);
    onChange({
      packageType,
      // Trim selections that no longer fit, and reprice to the new default —
      // but only if the student has not typed their own number.
      slots: state.slots.slice(0, PACKAGE_CONFIG[packageType].sessions),
      priceMinor: suggested ?? state.priceMinor,
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 backdrop-blur-[2px] sm:items-center sm:p-6"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-title"
        tabIndex={-1}
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-limestone sm:max-h-[88dvh] sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-stone/70 px-6 py-5">
          <div>
            <h2 id="composer-title" className="font-display text-xl font-semibold">
              {coach.displayName} için teklif
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              Şartları sen belirle. Koç kabul edebilir ya da karşı teklif verir.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="-m-2 rounded-full p-2 text-muted hover:text-ink"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-8 overflow-y-auto px-6 py-6">
          <section>
            <h3 className="font-medium">Kapsam</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(Object.keys(PACKAGE_CONFIG) as PackageType[]).map((type) => {
                const option = PACKAGE_CONFIG[type];
                const active = state.packageType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => changePackage(type)}
                    aria-pressed={active}
                    className={[
                      'rounded-xl border p-4 text-left transition-colors',
                      active ? 'border-cactus bg-cactus-pale/60' : 'border-stone bg-paper hover:border-cactus/50',
                    ].join(' ')}
                  >
                    <span className="block font-medium">{option.label}</span>
                    <span className="mt-1 block text-sm leading-snug text-muted">
                      {option.summary}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <AvailabilityCalendar
              days={days}
              timezone={timezone}
              selected={state.slots}
              onToggle={toggleSlot}
              maxSelections={slotsNeeded}
              disabled={submitting}
            />
            {state.slots.length < slotsNeeded && (
              <p className="mt-3 text-sm text-muted">
                {slotsNeeded - state.slots.length} seans daha seç.
              </p>
            )}
          </section>

          <section>
            <h3 className="font-medium">Teklif ettiğin ücret</h3>
            <label className="mt-3 flex max-w-xs items-baseline gap-2 rounded-xl border border-stone bg-paper px-4 py-3 focus-within:border-cactus">
              <input
                type="text"
                inputMode="numeric"
                value={state.priceMinor ? String(Math.round(state.priceMinor / 100)) : ''}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, '');
                  onChange({ priceMinor: digits ? Number.parseInt(digits, 10) * 100 : 0 });
                }}
                className="w-full bg-transparent font-display text-2xl font-semibold tabular-nums outline-none"
                aria-label="Teklif ettiğin ücret"
              />
              <span className="shrink-0 text-sm text-muted">
                ₺ {state.packageType === 'MONTHLY_4W' ? '/ 4 hafta' : '/ seans'}
              </span>
            </label>

            <PriceBreakdown breakdown={breakdown} />
          </section>

          <section>
            <label className="block">
              <span className="font-medium">Koça not</span>
              <span className="mt-0.5 block text-sm text-muted">
                Nerede zorlandığını yaz; koçun kabul etme ihtimalini en çok bu artırıyor.
              </span>
              <textarea
                value={state.note}
                onChange={(event) => onChange({ note: event.target.value.slice(0, 1000) })}
                rows={3}
                placeholder="AYT matematikte 12 nette takıldım, özellikle limit ve türev..."
                className="mt-2 w-full resize-none rounded-xl border border-stone bg-paper px-4 py-3 outline-none placeholder:text-stone focus:border-cactus"
              />
            </label>
          </section>
        </div>

        <footer className="border-t border-stone/70 px-6 py-4">
          {error && (
            <p role="alert" className="mb-3 rounded-lg bg-bloom-pale px-3.5 py-2.5 text-sm text-ink">
              {error}
            </p>
          )}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onSubmit}
              disabled={!ready || submitting}
              className="rounded-full bg-cactus px-6 py-3 font-medium text-paper transition-colors hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
            >
              {submitting ? 'Gönderiliyor' : authenticated ? 'Teklifi gönder' : 'Devam et'}
            </button>
            <p className="text-sm leading-snug text-muted">
              {authenticated
                ? 'Şimdi ödeme yapmıyorsun. Koç kabul ettikten sonra ödersin.'
                : 'Giriş yaptıktan sonra teklifin aynen burada olacak.'}
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Where the money goes.
 *
 * Shown in full, unprompted, including our own cut. A marketplace that hides
 * its commission until the receipt teaches students to negotiate off-platform —
 * which is precisely the behaviour the chat filter spends its life fighting.
 * Stating it plainly, next to what the escrow buys them, is the cheaper defence.
 */
function PriceBreakdown({
  breakdown,
}: {
  breakdown: ReturnType<typeof computeBreakdown>;
}) {
  if (breakdown.totalMinor <= 0) return null;

  return (
    <div className="mt-4 max-w-sm rounded-xl border border-stone/70 bg-paper">
      <dl className="divide-y divide-stone/60 text-sm">
        <Row label="Ödeyeceğin tutar" value={formatTry(breakdown.totalMinor)} strong />
        <Row label="Koça giden" value={formatTry(breakdown.coachReceivesMinor)} />
        <Row
          label={`Kaktüs hizmet payı (%${(breakdown.commissionBps / 100).toFixed(0)})`}
          value={formatTry(breakdown.platformFeeMinor)}
        />
      </dl>
      <p className="border-t border-stone/60 px-4 py-3 text-xs leading-relaxed text-muted">
        Ödemen Kaktüs'te tutulur. Koça, dersler yapıldıkça haftalık dilimler hâlinde aktarılır.
        Koç gelmezse iade talep edebilirsin.
      </p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className={strong ? 'font-medium' : 'text-muted'}>{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-display text-lg font-semibold' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
