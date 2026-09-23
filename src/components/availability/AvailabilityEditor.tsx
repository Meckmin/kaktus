'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { WEEKDAY_LABELS } from '@/lib/coach/application';
import { GRID_HOURS, cellKey, type Cell } from '@/lib/availability/grid';
import {
  addBlackoutDate,
  removeBlackoutDate,
  saveRecurringAvailability,
} from '@/server/actions/availability';

/**
 * The coach's weekly availability grid plus a blackout-date list.
 *
 * The grid is the source of truth for recurring availability: toggle the hours
 * you can teach, press save, and every `AvailabilityRule` row is rewritten from
 * what is on screen. Blackout dates are separate one-off `AvailabilityException`
 * rows — "I'm away that Tuesday" without disturbing the weekly pattern.
 */

// Monday-first display order; values are `AvailabilityRule.weekday` (0 = Sunday).
const DISPLAY_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

interface Blackout {
  id: string;
  date: string; // YYYY-MM-DD
}

export function AvailabilityEditor({
  initialCellKeys,
  blackouts: initialBlackouts,
  timezone,
}: {
  initialCellKeys: string[];
  blackouts: Blackout[];
  timezone: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialCellKeys));
  const [baseline] = useState<string>(() => [...initialCellKeys].sort().join(','));
  const [saving, startSave] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(
    () => [...selected].sort().join(',') !== baseline,
    [selected, baseline],
  );

  const toggle = (weekday: number, hour: number) => {
    const k = cellKey(weekday, hour);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const toggleColumn = (weekday: number) => {
    const keys = GRID_HOURS.map((h) => cellKey(weekday, h));
    const allOn = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (allOn ? next.delete(k) : next.add(k)));
      return next;
    });
  };

  const save = () => {
    setNote(null);
    setError(null);
    const cells: Cell[] = [...selected].map((k) => {
      const [weekday, hour] = k.split(':').map(Number);
      return { weekday, hour };
    });
    startSave(async () => {
      const result = await saveRecurringAvailability(cells);
      if (result.ok) {
        setNote(result.message);
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  };

  const selectedCount = selected.size;

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Saat dilimi: <span className="font-medium text-ink">{timezone}</span> · {selectedCount}{' '}
          saat seçili
        </p>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-full bg-cactus px-6 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-cactus-deep disabled:bg-stone disabled:text-muted"
        >
          {saving ? 'Kaydediliyor' : dirty ? 'Değişiklikleri kaydet' : 'Kayıtlı'}
        </button>
      </div>

      {note && (
        <p className="mt-3 rounded-lg bg-cactus-pale/60 px-3.5 py-2.5 text-sm text-ink">{note}</p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-bloom-pale px-3.5 py-2.5 text-sm text-ink">
          {error}
        </p>
      )}

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[560px] border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="w-14" />
              {DISPLAY_WEEKDAYS.map((weekday) => (
                <th key={weekday} className="px-1 pb-1 text-center">
                  <button
                    type="button"
                    onClick={() => toggleColumn(weekday)}
                    className="text-xs font-medium text-muted transition-colors hover:text-cactus"
                    title="Tüm günü seç / kaldır"
                  >
                    {WEEKDAY_LABELS[weekday].slice(0, 3)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GRID_HOURS.map((hour) => (
              <tr key={hour}>
                <td className="pr-2 text-right align-middle text-xs tabular-nums text-muted">
                  {String(hour).padStart(2, '0')}:00
                </td>
                {DISPLAY_WEEKDAYS.map((weekday) => {
                  const on = selected.has(cellKey(weekday, hour));
                  return (
                    <td key={weekday} className="p-0">
                      <button
                        type="button"
                        aria-pressed={on}
                        aria-label={`${WEEKDAY_LABELS[weekday]} ${hour}:00`}
                        onClick={() => toggle(weekday, hour)}
                        className={[
                          'h-8 w-full rounded-md border transition-colors',
                          on
                            ? 'border-cactus bg-cactus/80 hover:bg-cactus'
                            : 'border-stone/70 bg-paper hover:border-cactus/50',
                        ].join(' ')}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <BlackoutDates initial={initialBlackouts} />
    </div>
  );
}

function BlackoutDates({ initial }: { initial: Blackout[] }) {
  const router = useRouter();
  const [date, setDate] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const todayISO = new Date().toISOString().slice(0, 10);

  const add = () => {
    if (!date) return;
    setError(null);
    startTransition(async () => {
      const result = await addBlackoutDate(date);
      if (result.ok) {
        setDate('');
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const result = await removeBlackoutDate(id);
      if (result.ok) router.refresh();
      else setError(result.message);
    });
  };

  return (
    <section className="mt-12">
      <h2 className="font-display text-lg font-semibold">Kapalı günler</h2>
      <p className="mt-1 text-sm text-muted">
        Tatil, sınav, seyahat — o gün için hiç randevu alınmaz. Haftalık düzenin bozulmaz.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={date}
          min={todayISO}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-stone bg-paper px-4 py-2.5 text-sm outline-none focus:border-cactus"
        />
        <button
          type="button"
          onClick={add}
          disabled={!date || pending}
          className="rounded-full border border-stone px-5 py-2.5 text-sm font-medium transition-colors hover:border-cactus hover:text-cactus disabled:opacity-50"
        >
          Bu günü kapat
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-bloom-pale px-3.5 py-2.5 text-sm text-ink">
          {error}
        </p>
      )}

      {initial.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-2">
          {initial.map((b) => (
            <li
              key={b.id}
              className="flex items-center gap-2 rounded-full border border-stone bg-paper py-1 pl-3.5 pr-1.5 text-sm"
            >
              {new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long' }).format(
                new Date(`${b.date}T12:00:00`),
              )}
              <button
                type="button"
                onClick={() => remove(b.id)}
                disabled={pending}
                aria-label="Bu günü yeniden aç"
                className="rounded-full px-1.5 text-muted transition-colors hover:text-bloom"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted">Kapalı gün yok.</p>
      )}
    </section>
  );
}
