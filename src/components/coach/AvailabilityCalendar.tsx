'use client';

import { useMemo, useState } from 'react';
import type { CalendarDay, CalendarSlot, SlotState } from '@/lib/booking/availability';

/**
 * Weekly availability grid.
 *
 * Renders four states, and shows HELD as a distinct, *explained* state rather
 * than hiding it. A student comparing coaches needs to know the difference
 * between "booked until June" and "someone is deciding, free again by 19:00" —
 * collapsing both into "unavailable" makes a coach look unreachable and sends
 * the student to a worse match.
 *
 * Selection is capped at the package's session count. Rather than silently
 * ignoring the extra tap, picking one more replaces the oldest selection, which
 * is what people expect from a small fixed-size picker.
 */

const WEEKDAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

export function AvailabilityCalendar({
  days,
  timezone,
  selected,
  onToggle,
  maxSelections,
  disabled = false,
}: {
  days: CalendarDay[];
  timezone: string;
  selected: string[];
  onToggle: (startsAt: string) => void;
  maxSelections: number;
  disabled?: boolean;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const perPage = 7;
  const pages = Math.max(1, Math.ceil(days.length / perPage));
  const visible = days.slice(weekOffset * perPage, weekOffset * perPage + perPage);

  const totalOpen = useMemo(
    () => days.reduce((n, d) => n + d.slots.filter((s) => s.state === 'AVAILABLE').length, 0),
    [days],
  );

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: timezone,
      }),
    [timezone],
  );
  const dayFormatter = useMemo(
    () => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: timezone }),
    [timezone],
  );

  if (totalOpen === 0) {
    return (
      <div className="rounded-2xl border border-stone/70 bg-paper p-6">
        <p className="font-medium">Önümüzdeki iki hafta için açık saat yok.</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Yine de teklif gönderebilirsin — koç kendi takvimine göre alternatif saat önerir.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-display text-lg font-semibold">Uygun saatler</h3>
        {pages > 1 && (
          <div className="flex items-center gap-1 text-sm">
            <button
              type="button"
              onClick={() => setWeekOffset((w) => Math.max(0, w - 1))}
              disabled={weekOffset === 0}
              className="rounded-full px-3 py-1.5 text-muted transition-colors hover:text-cactus disabled:opacity-40"
            >
              Önceki hafta
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset((w) => Math.min(pages - 1, w + 1))}
              disabled={weekOffset >= pages - 1}
              className="rounded-full px-3 py-1.5 text-muted transition-colors hover:text-cactus disabled:opacity-40"
            >
              Sonraki hafta
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {visible.map((day) => (
          <div key={day.date}>
            <div className="pb-2 text-sm">
              <span className="font-medium">{WEEKDAYS[day.weekday]}</span>{' '}
              <span className="text-muted">
                {dayFormatter.format(new Date(`${day.date}T12:00:00Z`))}
              </span>
            </div>

            <div className="space-y-1.5">
              {day.slots.length === 0 && <p className="text-xs text-stone">—</p>}
              {day.slots.map((slot) => (
                <SlotButton
                  key={slot.startsAt}
                  slot={slot}
                  label={timeFormatter.format(new Date(slot.startsAt))}
                  selected={selected.includes(slot.startsAt)}
                  disabled={disabled}
                  onToggle={() => onToggle(slot.startsAt)}
                  freeAt={
                    slot.heldUntil ? timeFormatter.format(new Date(slot.heldUntil)) : undefined
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
        <Legend swatch="border-stone bg-paper" label="Uygun" />
        <Legend swatch="border-cactus bg-cactus" label="Seçtiklerin" solid />
        <Legend swatch="border-dust bg-dust/25" label="Başka bir teklifte bekliyor" />
        <Legend swatch="border-stone/60 bg-stone/40" label="Dolu" />
        <span className="ml-auto">
          {selected.length}/{maxSelections} seans seçildi
        </span>
      </div>
    </div>
  );
}

function SlotButton({
  slot,
  label,
  selected,
  disabled,
  onToggle,
  freeAt,
}: {
  slot: CalendarSlot;
  label: string;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  freeAt?: string;
}) {
  const selectable = slot.state === 'AVAILABLE' || slot.state === 'MINE';
  const title = TITLES[slot.state](freeAt);

  return (
    <button
      type="button"
      onClick={selectable ? onToggle : undefined}
      disabled={!selectable || disabled}
      aria-pressed={selected}
      title={title}
      className={[
        'w-full rounded-lg border px-2 py-2 text-sm tabular-nums transition-colors',
        selected
          ? 'border-cactus bg-cactus font-medium text-paper'
          : slot.state === 'AVAILABLE'
            ? 'border-stone bg-paper hover:border-cactus hover:text-cactus'
            : slot.state === 'MINE'
              ? 'border-cactus/50 bg-cactus-pale text-cactus-deep'
              : slot.state === 'HELD'
                ? 'cursor-not-allowed border-dust bg-dust/25 text-muted'
                : 'cursor-not-allowed border-stone/60 bg-stone/40 text-muted line-through',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

const TITLES: Record<SlotState, (freeAt?: string) => string> = {
  AVAILABLE: () => 'Uygun',
  MINE: () => 'Senin açık teklifinde tutuluyor',
  HELD: (freeAt) =>
    freeAt
      ? `Başka bir öğrencinin açık teklifinde. ${freeAt} sonrasında boşalabilir.`
      : 'Başka bir teklifte bekliyor',
  BOOKED: () => 'Dolu',
};

function Legend({ swatch, label, solid }: { swatch: string; label: string; solid?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={`size-3 rounded border ${swatch} ${solid ? '' : ''}`} />
      {label}
    </span>
  );
}
