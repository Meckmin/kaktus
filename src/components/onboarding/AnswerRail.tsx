'use client';

import {
  GRADE_LABELS,
  STEPS,
  STYLE_LABELS,
  TRACK_LABELS,
  formatTry,
  type OnboardingDraft,
  type StepSlug,
} from '@/lib/onboarding/client-state';

/**
 * The answer rail.
 *
 * This replaces a progress bar, and does more work than one. A bar tells a
 * student how much form is left — which is discouraging. The rail shows the
 * profile they are building, growing line by line, so the funnel reads as
 * *assembling something* rather than *filling something in*.
 *
 * It also makes the state-preservation promise legible: when the auth modal
 * appears later, the student has already watched these five lines accumulate
 * and can see they are still there.
 */
export function AnswerRail({ draft, current }: { draft: OnboardingDraft; current: StepSlug }) {
  const rows = buildRows(draft);
  const currentIndex = STEPS.indexOf(current);

  return (
    <aside className="lg:sticky lg:top-10">
      <h2 className="font-display text-sm font-semibold text-muted">Profilin</h2>

      <dl className="mt-4 space-y-px overflow-hidden rounded-xl border border-stone/70 bg-paper">
        {STEPS.map((slug, index) => {
          const row = rows[slug];
          const isCurrent = index === currentIndex;
          const isAnswered = Boolean(row);

          return (
            <div
              key={slug}
              className={[
                'flex items-baseline justify-between gap-4 px-4 py-3 text-sm',
                isCurrent ? 'bg-cactus-pale/50' : '',
                index > 0 ? 'border-t border-stone/60' : '',
              ].join(' ')}
            >
              <dt className={isAnswered || isCurrent ? 'text-muted' : 'text-stone'}>
                {RAIL_LABELS[slug]}
              </dt>
              <dd
                key={row ?? 'empty'}
                className={[
                  'min-w-0 truncate text-right font-medium',
                  isAnswered ? 'answer-settle text-ink' : 'text-stone',
                ].join(' ')}
              >
                {row ?? '—'}
              </dd>
            </div>
          );
        })}
      </dl>

      <p className="mt-3 text-xs leading-relaxed text-muted">
        Cevapların kaydedildi. Üye olduğunda bu profil hesabına taşınır.
      </p>
    </aside>
  );
}

const RAIL_LABELS: Record<StepSlug, string> = {
  alan: 'Alan',
  hedef: 'Hedef',
  net: 'Şu anki net',
  tarz: 'Koç tarzı',
  butce: 'Bütçe',
};

function buildRows(draft: OnboardingDraft): Record<StepSlug, string | null> {
  const track = draft.track ? TRACK_LABELS[draft.track].short : null;
  const grade = draft.gradeLevel ? GRADE_LABELS[draft.gradeLevel].short : null;

  const target = draft.targetRanking
    ? `İlk ${draft.targetRanking.toLocaleString('tr-TR')}`
    : draft.targetUniversity
      ? draft.targetUniversity
      : null;

  const nets =
    draft.baselineTytNet != null
      ? draft.baselineAytNet != null
        ? `TYT ${draft.baselineTytNet} · AYT ${draft.baselineAytNet}`
        : `TYT ${draft.baselineTytNet}`
      : null;

  const styles = draft.preferredStyles?.length
    ? draft.preferredStyles.map((s) => STYLE_LABELS[s].short).join(', ')
    : null;

  const budget =
    draft.budgetMaxMinor != null
      ? draft.budgetMinMinor != null
        ? `${formatTry(draft.budgetMinMinor)} – ${formatTry(draft.budgetMaxMinor)}`
        : `En fazla ${formatTry(draft.budgetMaxMinor)}`
      : null;

  return {
    alan: track && grade ? `${track} · ${grade}` : track,
    hedef: target,
    net: nets,
    tarz: styles,
    butce: budget,
  };
}
