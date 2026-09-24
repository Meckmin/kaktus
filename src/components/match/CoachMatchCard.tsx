'use client';

import { DIMENSION_LABELS, TRACK_SHORT_CODES, formatNetJourney, formatTry } from '@/lib/onboarding/client-state';
import type { CoachMatchView } from '@/lib/matching/view';
import { useAuthGate } from '@/components/auth/AuthGate';

/**
 * A matched coach.
 *
 * The score is the only place the bloom colour appears in the whole product.
 * Spending the boldest colour on the single number the student came for keeps
 * everything else quiet, and means the eye lands on the ranking before the
 * prose.
 *
 * `featured` renders the top match larger with its trajectory line visible.
 * Uniform cards would flatten the ranking the matcher just worked to produce.
 */
export function CoachMatchCard({
  coach,
  featured = false,
  position,
}: {
  coach: CoachMatchView;
  featured?: boolean;
  position: number;
}) {
  const { require } = useAuthGate();
  const profileUrl = `/koc/${coach.slug}`;

  return (
    <article
      className={[
        'rounded-2xl border bg-paper',
        featured ? 'border-cactus/40 p-6 sm:p-8' : 'border-stone/70 p-5 sm:p-6',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h3
            className={[
              'font-display font-semibold leading-tight',
              featured ? 'text-2xl' : 'text-lg',
            ].join(' ')}
          >
            {coach.displayName}
          </h3>
          <p className="mt-1 text-sm leading-snug text-muted">
            {coach.university} · {coach.department}
          </p>
          {coach.journey.finalRank && (
            <p className="mt-1 text-sm text-muted">
              {TRACK_SHORT_CODES[coach.journey.track]} {coach.journey.finalRank.toLocaleString('tr-TR')}
              {formatNetJourney(coach.journey) && (
                <>
                  {' · '}
                  <span className="tabular-nums text-ink">{formatNetJourney(coach.journey)}</span>
                </>
              )}
            </p>
          )}
        </div>

        <MatchScore value={coach.matchScore} featured={featured} position={position} />
      </div>

      {coach.reasons.length > 0 && (
        <ul className={['space-y-1.5', featured ? 'mt-5' : 'mt-4'].join(' ')}>
          {coach.reasons.slice(0, featured ? 3 : 2).map((reason) => (
            <li key={reason} className="flex gap-2.5 text-sm leading-snug">
              <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-cactus" />
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      )}

      <MatchBreakdown coach={coach} limit={featured ? 5 : 3} />

      {coach.caveats.length > 0 && (
        <p className="mt-4 rounded-lg border border-dust/50 bg-dust/10 px-3.5 py-2.5 text-sm leading-snug text-muted">
          {coach.caveats[0]}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => require({ action: 'Teklif göndermek', returnTo: `${profileUrl}?teklif=1` })}
          className="rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-cactus-deep"
        >
          Teklif iste
        </button>
        <button
          type="button"
          onClick={() => require({ action: 'Profili görmek', returnTo: profileUrl })}
          className="rounded-full border border-stone px-5 py-2.5 text-sm font-medium transition-colors hover:border-cactus hover:text-cactus"
        >
          Profili gör
        </button>

        <span className="ml-auto text-sm text-muted">
          {coach.priceFromMinor != null && (
            <>
              <span className="font-medium text-ink">{formatTry(coach.priceFromMinor)}</span>
              {coach.priceUnit === 'seans' ? ' /seans' : ' /ay’dan başlıyor'}
            </>
          )}
        </span>
      </div>
    </article>
  );
}

/**
 * The score.
 *
 * A ring or donut would imply a proportion of something; this is a compatibility
 * index, so it reads as a number with a unit. The rank marker next to it tells
 * the student where this coach sits in *their* list, which is information the
 * percentage alone does not carry.
 */
function MatchScore({
  value,
  featured,
  position,
}: {
  value: number;
  featured: boolean;
  position: number;
}) {
  return (
    <div className="shrink-0 text-right">
      <div
        className={[
          'font-display font-semibold tabular-nums leading-none text-bloom',
          featured ? 'text-score' : 'text-3xl',
        ].join(' ')}
      >
        {value}
        <span className={featured ? 'text-2xl' : 'text-lg'}>%</span>
      </div>
      <div className="mt-1.5 text-xs text-muted">
        {position === 1 ? 'en yüksek eşleşme' : `${position}. sırada`}
      </div>
    </div>
  );
}

/**
 * Breakdown pills.
 *
 * Each pill is a label, a percentage, and a hairline meter — enough for a
 * student to see *why* the headline number is what it is. Without this the
 * score is an unfalsifiable claim, and students are rightly sceptical of
 * unexplained rankings.
 */
function MatchBreakdown({ coach, limit }: { coach: CoachMatchView; limit: number }) {
  const items = coach.breakdown.slice(0, limit);
  if (items.length === 0) return null;

  return (
    <ul className="mt-5 flex flex-wrap gap-2">
      {items.map((item) => (
        <li
          key={item.key}
          className="rounded-lg border border-stone/70 bg-limestone/60 px-3 py-2"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-muted">
              {DIMENSION_LABELS[item.key] ?? item.label}
            </span>
            <span className="text-xs font-semibold tabular-nums">%{item.percent}</span>
          </div>
          <div
            aria-hidden
            className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-stone/70"
          >
            <div
              className="meter-fill h-full rounded-full bg-cactus"
              style={{ width: `${Math.max(item.percent, 4)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
