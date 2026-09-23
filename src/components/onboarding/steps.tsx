'use client';

import {
  GRADE_LABELS,
  STEPS,
  STEP_TITLES,
  STYLE_LABELS,
  TRACK_LABELS,
  isStepComplete,
  type StepSlug,
} from '@/lib/onboarding/client-state';
import type { CoachingStyle, GradeLevel, Track } from '@/lib/matching/types';
import { useOnboarding } from './OnboardingProvider';
import { AnswerRail } from './AnswerRail';
import { BudgetRange, ChoiceRow, NumberField, QuickPick, TextField } from './controls';

/**
 * Step shell: question, answer area, navigation, and the rail.
 *
 * One question per screen. The question is the largest thing on the page and
 * the answers sit directly under it — no card, no chrome between the two.
 */
export function StepShell({
  step,
  subtitle,
  children,
}: {
  step: StepSlug;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const { draft, advance, goBack, saving } = useOnboarding();
  const index = STEPS.indexOf(step);
  const complete = isStepComplete(draft, step);
  const isLast = index === STEPS.length - 1;

  return (
    <main className="mx-auto grid max-w-5xl gap-12 px-6 py-10 sm:px-8 lg:grid-cols-[1fr_18rem] lg:gap-16">
      <div>
        <nav className="flex items-center gap-3 text-sm text-muted">
          <button
            type="button"
            onClick={() => goBack(step)}
            className="rounded-full px-2 py-1 transition-colors hover:text-cactus"
          >
            Geri
          </button>
          <span aria-hidden className="text-stone">
            /
          </span>
          <span>
            {index + 1}/{STEPS.length}
          </span>
        </nav>

        <h1 className="mt-8 max-w-measure font-display text-question font-semibold text-balance">
          {STEP_TITLES[step]}
        </h1>
        {subtitle && <p className="mt-3 max-w-[48ch] leading-relaxed text-muted">{subtitle}</p>}

        <div className="mt-8 space-y-8">{children}</div>

        <div className="mt-10 flex items-center gap-4">
          <button
            type="button"
            disabled={!complete || saving}
            onClick={() => advance(step)}
            className="rounded-full bg-cactus px-7 py-3.5 font-medium text-paper transition-colors hover:bg-cactus-deep disabled:cursor-not-allowed disabled:bg-stone disabled:text-muted"
          >
            {saving ? 'Kaydediliyor' : isLast ? 'Koçlarımı göster' : 'Devam et'}
          </button>
          {!complete && (
            <p className="text-sm text-muted">Devam etmek için bu soruyu yanıtla.</p>
          )}
        </div>
      </div>

      <AnswerRail draft={draft} current={step} />
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Track (and grade level)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grade level shares this screen with track.
 *
 * The brief listed five steps without it, but `StudentProfile.gradeLevel` is
 * required and the matcher weights coach experience with that exact cohort at
 * 8%. Rather than adding a sixth step or defaulting it silently — a mezun
 * student matched as though they were in 11th grade gets visibly wrong results
 * — it rides along here. Two taps, one screen, still five steps.
 */
export function StepTrack() {
  const { draft, update } = useOnboarding();

  return (
    <StepShell step="alan" subtitle="Eşleşmenin temeli burası">
      <fieldset>
        <legend className="mb-3 font-medium">Alanın</legend>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(TRACK_LABELS) as Track[]).map((track) => (
            <ChoiceRow
              key={track}
              label={TRACK_LABELS[track].full}
              hint={TRACK_LABELS[track].hint}
              selected={draft.track === track}
              onSelect={() => update({ track })}
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 font-medium">Sınıfın</legend>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(GRADE_LABELS) as GradeLevel[]).map((grade) => (
            <ChoiceRow
              key={grade}
              label={GRADE_LABELS[grade].short}
              hint={GRADE_LABELS[grade].hint}
              selected={draft.gradeLevel === grade}
              onSelect={() => update({ gradeLevel: grade })}
            />
          ))}
        </div>
      </fieldset>
    </StepShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Target
// ─────────────────────────────────────────────────────────────────────────────

const RANK_PRESETS = [
  { label: 'İlk 1.000', value: 1_000 },
  { label: 'İlk 5.000', value: 5_000 },
  { label: 'İlk 20.000', value: 20_000 },
  { label: 'İlk 50.000', value: 50_000 },
  { label: 'İlk 100.000', value: 100_000 },
];

export function StepTarget() {
  const { draft, update } = useOnboarding();

  return (
    <StepShell
      step="hedef"
      subtitle="Sıralama hedefin, koçun kendi çıkışıyla karşılaştırılır. Eşleşmedeki en ağırlıklı ölçüt bu."
    >
      <div>
        <p className="mb-3 font-medium">Hedef sıralaman</p>
        <QuickPick
          options={RANK_PRESETS}
          active={draft.targetRanking ?? null}
          onPick={(value) => update({ targetRanking: value })}
        />
        <div className="mt-4 max-w-xs">
          <NumberField
            label="Ya da kendin yaz"
            value={draft.targetRanking}
            onChange={(value) => update({ targetRanking: value ? Math.round(value) : null })}
            placeholder="12500"
            suffix="sıralama"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Hedef üniversite"
          hint="İstersen boş bırak"
          value={draft.targetUniversity}
          onChange={(value) => update({ targetUniversity: value })}
          placeholder="Boğaziçi Üniversitesi"
        />
        <TextField
          label="Hedef bölüm"
          hint="İstersen boş bırak"
          value={draft.targetDepartment}
          onChange={(value) => update({ targetDepartment: value })}
          placeholder="Bilgisayar Mühendisliği"
        />
      </div>
    </StepShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Baseline nets
// ─────────────────────────────────────────────────────────────────────────────

export function StepBaseline() {
  const { draft, update } = useOnboarding();

  return (
    <StepShell
      step="net"
      subtitle="Son denemendeki netlerin yeter. Kimse görmüyor; sadece hangi koçun senin başladığın yerden başladığını bulmak için kullanılıyor."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <NumberField
          label="TYT neti"
          hint="120 üzerinden — henüz bilmiyorsan boş bırak"
          max={120}
          value={draft.baselineTytNet}
          onChange={(value) => update({ baselineTytNet: value })}
          placeholder="0"
          suffix="net"
        />
        <NumberField
          label="AYT neti"
          hint="Henüz bilmiyorsan boş bırak"
          max={80}
          value={draft.baselineAytNet}
          onChange={(value) => update({ baselineAytNet: value })}
          placeholder="0"
          suffix="net"
        />
      </div>

      <p className="max-w-[52ch] rounded-xl border border-stone/70 bg-paper px-4 py-3 text-sm leading-relaxed text-muted">
        Düşük net eşleşmeni kötüleştirmez. Tersine: senin bulunduğun noktadan başlayıp
        hedefine ulaşmış koçlar öne çıkar.
      </p>
    </StepShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 — Coaching style
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ordered multi-select. The scorer weights preferences by rank — first choice
 * counts double the second — so the order genuinely changes results, and the
 * numbered markers here reflect real priority rather than decoration.
 */
export function StepStyle() {
  const { draft, update } = useOnboarding();
  const selected = draft.preferredStyles ?? [];

  const toggle = (style: CoachingStyle) => {
    const next = selected.includes(style)
      ? selected.filter((s) => s !== style)
      : [...selected, style].slice(0, 3);
    update({ preferredStyles: next });
  };

  return (
    <StepShell
      step="tarz"
      subtitle="En çok istediğinden başlayarak seç. İlk seçimin eşleşmede en ağır basan."
    >
      <div role="group" className="grid gap-2">
        {(Object.keys(STYLE_LABELS) as CoachingStyle[]).map((style) => {
          const position = selected.indexOf(style);
          return (
            <ChoiceRow
              key={style}
              multi
              label={STYLE_LABELS[style].short}
              hint={STYLE_LABELS[style].hint}
              selected={position !== -1}
              rank={position === -1 ? undefined : position + 1}
              onSelect={() => toggle(style)}
            />
          );
        })}
      </div>
      {selected.length >= 3 && (
        <p className="text-sm text-muted">En fazla üç tarz seçebilirsin.</p>
      )}
    </StepShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5 — Budget
// ─────────────────────────────────────────────────────────────────────────────

const BUDGET_PRESETS = [
  { label: '2.000 ₺’ye kadar', value: 200_000 },
  { label: '3.500 ₺’ye kadar', value: 350_000 },
  { label: '5.000 ₺’ye kadar', value: 500_000 },
  { label: '5.000 ₺ üzeri', value: 900_000 },
];

export function StepBudget() {
  const { draft, update } = useOnboarding();

  return (
    <StepShell
      step="butce"
      subtitle="Bütçenin biraz üzerindeki koçlar da listelenir — kapsamı küçülterek kendi teklifini gönderebilirsin."
    >
      <div>
        <p className="mb-3 font-medium">Aylık bütçen</p>
        <QuickPick
          options={BUDGET_PRESETS}
          active={draft.budgetMaxMinor ?? null}
          onPick={(value) => update({ budgetMaxMinor: value })}
        />
      </div>

      <BudgetRange
        minMinor={draft.budgetMinMinor}
        maxMinor={draft.budgetMaxMinor}
        onChange={update}
      />

      <p className="max-w-[52ch] text-sm leading-relaxed text-muted">
        Ödeme, koçla anlaştıktan sonra Kaktüs'te tutulur ve dersler tamamlandıkça koça
        aktarılır. Şimdi hiçbir ödeme yapmıyorsun.
      </p>
    </StepShell>
  );
}

/**
 * There is deliberately no STEP_COMPONENTS map exported from this file.
 *
 * This is a `'use client'` module, so every export crossing into a Server
 * Component becomes a client-reference stub. A component stub renders fine; an
 * object stub does not — indexing it server-side returns `undefined` and React
 * fails with "Element type is invalid". The slug → component mapping therefore
 * lives in the server route (`app/onboarding/[step]/page.tsx`), which holds the
 * real imported references.
 */
