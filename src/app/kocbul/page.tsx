import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { auth } from '@/lib/auth';
import { getMatches, loadOnboardingDraft } from '@/server/actions/onboarding';
import {
  GRADE_LABELS,
  TRACK_LABELS,
  formatTry,
  type OnboardingDraft,
} from '@/lib/onboarding/client-state';
import { AuthGateProvider } from '@/components/auth/AuthGate';
import { CoachMatchCard } from '@/components/match/CoachMatchCard';

/**
 * Match results.
 *
 * A server component: the matcher runs on the server against the guest's cookie
 * session, and the ranked list is in the first HTML response. No loading
 * spinner, no client-side fetch, no flash of an empty list — which matters
 * because this page is the moment the product either earns the next click or
 * does not.
 */

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 12;
const MAX_LIMIT = 60;

export default async function KocBulPage({
  searchParams,
}: {
  searchParams: Promise<{ limit?: string }>;
}) {
  const draft = await loadOnboardingDraft();
  if (!draft.track || !draft.gradeLevel) redirect('/onboarding/alan');

  const session = await auth();
  const requested = Number.parseInt((await searchParams).limit ?? '', 10);
  const limit =
    Number.isFinite(requested) && requested > 0
      ? Math.min(requested, MAX_LIMIT)
      : PAGE_SIZE;

  return (
    <AuthGateProvider authenticated={Boolean(session?.user?.id)}>
      <main className="mx-auto max-w-4xl px-6 py-10 sm:px-8">
        <header>
          <Link href="/onboarding/butce" className="text-sm text-muted hover:text-cactus">
            Cevapları değiştir
          </Link>
          <h1 className="mt-6 font-display text-question font-semibold text-balance">
            Sana en çok uyan koçlar
          </h1>
          <FilterSummary draft={draft} />
        </header>

        <Suspense fallback={<MatchSkeleton />}>
          <MatchList limit={limit} />
        </Suspense>
      </main>
    </AuthGateProvider>
  );
}

async function MatchList({ limit }: { limit: number }) {
  const { ready, coaches, totalConsidered } = await getMatches(limit);

  if (!ready) redirect('/onboarding/alan');

  if (coaches.length === 0) {
    // An empty screen is an invitation to act, not an apology. Name the two
    // filters most likely to be responsible and link straight to them.
    return (
      <section className="mt-10 rounded-2xl border border-stone/70 bg-paper p-8">
        <h2 className="font-display text-xl font-semibold">
          Bu kriterlerle şu an uygun koç yok
        </h2>
        <p className="mt-2 max-w-[52ch] leading-relaxed text-muted">
          Genelde bütçe aralığı ya da hedef sıralama daraltıyor. İkisinden birini
          gevşetirsen listede koç çıkması çok olası.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/onboarding/butce"
            className="rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper hover:bg-cactus-deep"
          >
            Bütçeyi düzenle
          </Link>
          <Link
            href="/onboarding/hedef"
            className="rounded-full border border-stone px-5 py-2.5 text-sm font-medium hover:border-cactus hover:text-cactus"
          >
            Hedefi düzenle
          </Link>
        </div>
      </section>
    );
  }

  const [top, ...rest] = coaches;

  return (
    <>
      <p className="mt-4 text-sm text-muted">
        {totalConsidered} koç değerlendirildi, {coaches.length} tanesi eşleşti.
      </p>

      <section className="mt-8 space-y-4">
        <CoachMatchCard coach={top} featured position={1} />
        {rest.map((coach, index) => (
          <CoachMatchCard key={coach.coachId} coach={coach} position={index + 2} />
        ))}
      </section>

      {/* A full slice means the ranker may have had more candidates past the
          visibility floor than we asked for — an undersized slice means we
          already have every qualifying coach, so there is nothing more to load. */}
      {coaches.length === limit && limit < MAX_LIMIT && (
        <div className="mt-8 text-center">
          <Link
            href={`/kocbul?limit=${Math.min(limit + PAGE_SIZE, MAX_LIMIT)}`}
            className="inline-block rounded-full border border-stone px-6 py-2.5 text-sm font-medium transition-colors hover:border-cactus hover:text-cactus"
          >
            Daha fazla koç göster
          </Link>
        </div>
      )}

      <p className="mt-10 max-w-[56ch] text-sm leading-relaxed text-muted">
        Eşleşme puanı; hedef benzerliği, çalışma tarzı, saat uyumu, alan derinliği ve
        öğrenci geri bildirimlerinden hesaplanır. Ağırlıkları koçlar satın alamaz.
      </p>
    </>
  );
}

function FilterSummary({ draft }: { draft: OnboardingDraft }) {
  const chips = [
    draft.track && TRACK_LABELS[draft.track].short,
    draft.gradeLevel && GRADE_LABELS[draft.gradeLevel].short,
    draft.targetRanking && `İlk ${draft.targetRanking.toLocaleString('tr-TR')}`,
    draft.baselineTytNet != null && `TYT ${draft.baselineTytNet} net`,
    draft.budgetMaxMinor != null && `En fazla ${formatTry(draft.budgetMaxMinor)}`,
  ].filter(Boolean) as string[];

  return (
    <ul className="mt-4 flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li
          key={chip}
          className="rounded-full border border-stone/70 px-3 py-1 text-sm text-muted"
        >
          {chip}
        </li>
      ))}
    </ul>
  );
}

function MatchSkeleton() {
  return (
    <div className="mt-8 space-y-4" aria-busy="true" aria-label="Koçlar eşleştiriliyor">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-44 rounded-2xl border border-stone/70 bg-paper/60"
          style={{ opacity: 1 - i * 0.25 }}
        />
      ))}
    </div>
  );
}
