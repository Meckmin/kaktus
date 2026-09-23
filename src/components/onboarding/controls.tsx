'use client';

/**
 * Onboarding controls.
 *
 * Deliberately not a card kit. Choices are wide rows with a hairline that
 * thickens on selection, so a selected answer reads as *committed* rather than
 * merely highlighted — this matters on a form where students routinely change
 * their mind about their own target three times.
 */

export function ChoiceRow({
  label,
  hint,
  selected,
  onSelect,
  multi = false,
  rank,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
  multi?: boolean;
  /** For ordered multi-select, shows priority. */
  rank?: number;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={selected}
      className={[
        'group flex w-full items-center gap-4 rounded-xl border px-5 py-4 text-left transition-colors',
        selected
          ? 'border-cactus bg-cactus-pale/60 text-ink'
          : 'border-stone bg-paper hover:border-cactus/50',
      ].join(' ')}
    >
      <span
        aria-hidden
        className={[
          'grid size-5 shrink-0 place-items-center border transition-colors',
          multi ? 'rounded-[5px]' : 'rounded-full',
          selected ? 'border-cactus bg-cactus' : 'border-stone bg-transparent',
        ].join(' ')}
      >
        {selected && rank != null ? (
          <span className="text-[11px] font-semibold leading-none text-paper">{rank}</span>
        ) : selected ? (
          <span className="size-2 rounded-full bg-paper" />
        ) : null}
      </span>

      <span className="min-w-0">
        <span className="block font-medium leading-snug">{label}</span>
        {hint && <span className="mt-0.5 block text-sm leading-snug text-muted">{hint}</span>}
      </span>
    </button>
  );
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  max,
  suffix,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  max?: number;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block font-medium">{label}</span>
      {hint && <span className="mt-0.5 block text-sm text-muted">{hint}</span>}
      <span className="mt-2 flex items-baseline gap-2 rounded-xl border border-stone bg-paper px-4 py-3 focus-within:border-cactus">
        <input
          type="number"
          inputMode="decimal"
          value={value ?? ''}
          max={max}
          min={0}
          step="0.25"
          placeholder={placeholder}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === '') return onChange(null);
            const parsed = Number.parseFloat(raw);
            if (Number.isNaN(parsed)) return;
            onChange(max != null ? Math.min(parsed, max) : parsed);
          }}
          className="w-full bg-transparent font-display text-2xl font-semibold tabular-nums outline-none placeholder:font-sans placeholder:text-lg placeholder:font-normal placeholder:text-stone"
        />
        {suffix && <span className="shrink-0 text-sm text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block font-medium">{label}</span>
      {hint && <span className="mt-0.5 block text-sm text-muted">{hint}</span>}
      <input
        type="text"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value || null)}
        className="mt-2 w-full rounded-xl border border-stone bg-paper px-4 py-3 text-base outline-none placeholder:text-stone focus:border-cactus"
      />
    </label>
  );
}

/**
 * Budget input as a pair of bounds rather than a slider.
 *
 * A slider forces a student to pick a number they do not have, and its default
 * position anchors them. Two optional fields let "en fazla 3.000" be a complete
 * answer, which is how people actually think about a budget they are asking a
 * parent to cover.
 */
export function BudgetRange({
  minMinor,
  maxMinor,
  onChange,
}: {
  minMinor: number | null | undefined;
  maxMinor: number | null | undefined;
  onChange: (patch: { budgetMinMinor?: number | null; budgetMaxMinor?: number | null }) => void;
}) {
  const toMinor = (lira: string) => {
    if (lira === '') return null;
    const parsed = Number.parseInt(lira.replace(/\D/g, ''), 10);
    return Number.isNaN(parsed) ? null : parsed * 100;
  };
  const toLira = (minor: number | null | undefined) =>
    minor == null ? '' : String(Math.round(minor / 100));

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(
        [
          ['En az', minMinor, (v: number | null) => onChange({ budgetMinMinor: v })],
          ['En fazla', maxMinor, (v: number | null) => onChange({ budgetMaxMinor: v })],
        ] as const
      ).map(([label, value, setter]) => (
        <label key={label} className="block">
          <span className="block text-sm text-muted">{label}</span>
          <span className="mt-1.5 flex items-baseline gap-2 rounded-xl border border-stone bg-paper px-4 py-3 focus-within:border-cactus">
            <input
              type="text"
              inputMode="numeric"
              value={toLira(value)}
              placeholder="0"
              onChange={(event) => setter(toMinor(event.target.value))}
              className="w-full bg-transparent font-display text-2xl font-semibold tabular-nums outline-none placeholder:text-stone"
            />
            <span className="shrink-0 text-sm text-muted">₺ / ay</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function QuickPick({
  options,
  onPick,
  active,
}: {
  options: Array<{ label: string; value: number }>;
  onPick: (value: number) => void;
  active?: number | null;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onPick(option.value)}
          className={[
            'rounded-full border px-4 py-2 text-sm transition-colors',
            active === option.value
              ? 'border-cactus bg-cactus text-paper'
              : 'border-stone bg-paper text-muted hover:border-cactus hover:text-cactus',
          ].join(' ')}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
