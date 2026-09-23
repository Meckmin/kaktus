import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getCoachProfile } from '@/server/queries/coach-profile';
import { getCoachCalendar } from '@/lib/booking/availability';
import { readOfferDraft } from '@/server/actions/offers';
import { AuthGateProvider } from '@/components/auth/AuthGate';
import { CoachProfileClient } from '@/components/coach/CoachProfileClient';
import { STYLE_LABELS, TRACK_LABELS } from '@/lib/onboarding/client-state';

/**
 * Coach profile.
 *
 * A Server Component end to end. The hero, credentials, bio and reviews are
 * plain HTML in the first response and ship no JavaScript; only the calendar
 * and composer are client components, mounted as a single island at the bottom.
 * That split is why this page is fast on the mid-range Android phones most of
 * these students are using.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const coach = await getCoachProfile(slug);
  if (!coach) return { title: 'Koç bulunamadı' };
  return {
    title: `${coach.displayName} — ${coach.university} | Kaktüs Koçluk`,
    description: coach.headline,
  };
}

export default async function CoachProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ teklif?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);

  const coach = await getCoachProfile(slug);
  if (!coach) notFound();

  const session = await auth();
  const authenticated = Boolean(session?.user?.id);

  // Needed so the calendar can distinguish this student's own holds from
  // everyone else's — a student must never see their own open offer as "taken".
  const viewer = session?.user?.id
    ? await prisma.studentProfile.findUnique({
        where: { userId: session.user.id },
        select: { id: true },
      })
    : null;

  const [calendar, draft] = await Promise.all([
    getCoachCalendar(coach.id, { days: 14, viewerStudentProfileId: viewer?.id ?? null }),
    query.teklif === '1' ? readOfferDraft() : Promise.resolve(null),
  ]);

  // Only resume a draft that belongs to this coach. A stale cookie from another
  // profile must not silently repopulate the composer here.
  const resumeDraft = draft && draft.coachSlug === slug ? draft : null;

  return (
    <AuthGateProvider authenticated={authenticated}>
      <main className="mx-auto max-w-3xl px-6 py-10 sm:px-8">
        <CoachHero coach={coach} />
        <Credentials coach={coach} />
        <Methodology coach={coach} />
        <Reviews coach={coach} />

        <CoachProfileClient
          coach={{
            id: coach.id,
            slug: coach.slug,
            displayName: coach.displayName,
            commissionBps: coach.commissionBps,
            pricingTiers: coach.pricingTiers,
          }}
          days={calendar.days}
          timezone={calendar.timezone}
          authenticated={authenticated}
          resumeDraft={resumeDraft}
        />
      </main>
    </AuthGateProvider>
  );
}

function CoachHero({ coach }: { coach: NonNullable<Awaited<ReturnType<typeof getCoachProfile>>> }) {
  const climbed =
    coach.journey.baselineNet != null && coach.journey.finalNet != null
      ? `${Math.round(coach.journey.baselineNet)} → ${Math.round(coach.journey.finalNet)} net`
      : null;

  return (
    <header>
      <h1 className="font-display text-question font-semibold text-balance">
        {coach.displayName}
      </h1>
      <p className="mt-2 text-lg leading-snug text-muted">{coach.headline}</p>

      {/* The trajectory is the headline claim, so it gets the display face and
          its own line rather than being buried in a badge row. */}
      {climbed && (
        <p className="mt-6 font-display text-2xl font-semibold tabular-nums">
          {climbed}
          <span className="ml-3 align-middle text-base font-normal text-muted">
            kendi YKS çıkışı
          </span>
        </p>
      )}
    </header>
  );
}

function Credentials({
  coach,
}: {
  coach: NonNullable<Awaited<ReturnType<typeof getCoachProfile>>>;
}) {
  return (
    <section className="mt-8">
      <dl className="grid gap-px overflow-hidden rounded-2xl border border-stone/70 bg-stone/60 sm:grid-cols-3">
        <Fact label="YKS sıralaması" value={`${coach.yksRank.toLocaleString('tr-TR')}.`} note={`${coach.yksYear} yılı`} />
        <Fact label="Üniversite" value={coach.university} note={coach.department} />
        <Fact
          label="Öğrenci"
          value={`${coach.stats.completedEngagements} tamamlanan`}
          note={
            coach.stats.ratingCount > 0
              ? `${coach.stats.ratingAvg.toFixed(1)} puan · ${coach.stats.ratingCount} değerlendirme`
              : 'Henüz değerlendirme yok'
          }
        />
      </dl>

      {coach.verifiedAt && (
        <p className="mt-3 flex items-center gap-2 text-sm text-cactus-deep">
          <CheckMark />
          ÖSYM sonuç belgesi ve öğrenci belgesi Kaktüs tarafından doğrulandı
        </p>
      )}

      <ul className="mt-4 flex flex-wrap gap-2">
        {coach.tracks.map((track) => (
          <Tag key={track}>{TRACK_LABELS[track as keyof typeof TRACK_LABELS]?.short ?? track}</Tag>
        ))}
        {coach.styles.map((style) => (
          <Tag key={style}>{STYLE_LABELS[style as keyof typeof STYLE_LABELS]?.short ?? style}</Tag>
        ))}
      </ul>
    </section>
  );
}

function Methodology({
  coach,
}: {
  coach: NonNullable<Awaited<ReturnType<typeof getCoachProfile>>>;
}) {
  return (
    <section className="mt-12">
      <h2 className="font-display text-lg font-semibold">Nasıl çalışıyor</h2>
      <div className="mt-3 max-w-measure space-y-4 leading-relaxed">
        {coach.bio.split(/\n{2,}/).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>

      {coach.specializations.length > 0 && (
        <ul className="mt-6 space-y-2">
          {coach.specializations.map((spec) => (
            <li key={spec.label} className="flex gap-2.5 leading-snug">
              <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-cactus" />
              {spec.label}
            </li>
          ))}
        </ul>
      )}

      {coach.subjects.length > 0 && (
        <p className="mt-6 text-sm text-muted">Dersler: {coach.subjects.join(', ')}</p>
      )}
    </section>
  );
}

function Reviews({ coach }: { coach: NonNullable<Awaited<ReturnType<typeof getCoachProfile>>> }) {
  if (coach.reviews.length === 0) {
    return (
      <section className="mt-12">
        <h2 className="font-display text-lg font-semibold">Öğrenci yorumları</h2>
        <p className="mt-2 max-w-measure leading-relaxed text-muted">
          Bu koç Kaktüs'te yeni. Yorumlar yalnızca programı tamamlayan öğrencilerden gelir, bu
          yüzden ilk yorumlar birkaç hafta sürer.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-12">
      <h2 className="font-display text-lg font-semibold">Öğrenci yorumları</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {coach.reviews.map((review) => (
          <article key={review.id} className="rounded-2xl border border-stone/70 bg-paper p-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{review.studentInitials}</span>
              <span className="text-sm tabular-nums text-muted" aria-label={`${review.rating} / 5`}>
                {'★'.repeat(review.rating)}
                <span className="text-stone">{'★'.repeat(5 - review.rating)}</span>
              </span>
            </div>
            {review.netGainReported != null && (
              <p className="mt-2 font-display text-lg font-semibold tabular-nums text-cactus-deep">
                +{Math.round(review.netGainReported)} net
              </p>
            )}
            {review.body && <p className="mt-2 leading-relaxed">{review.body}</p>}
            <time
              dateTime={review.createdAt.toISOString()}
              className="mt-3 block text-sm text-muted"
            >
              {new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(
                review.createdAt,
              )}
            </time>
          </article>
        ))}
      </div>
    </section>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-paper px-5 py-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 font-medium leading-snug">{value}</dd>
      {note && <dd className="mt-0.5 text-sm text-muted">{note}</dd>}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <li className="rounded-full border border-stone/70 px-3 py-1 text-sm text-muted">{children}</li>
  );
}

function CheckMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M4.75 8.25 6.9 10.4l4.35-4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
