import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { formatTry } from '@/lib/onboarding/client-state';
import { getCoachEarnings } from '@/server/queries/coach-earnings';

/**
 * Coach earnings.
 *
 * The available balance is the one number that matters here, and it comes
 * straight from the ledger every time the page loads — never a cached
 * `CoachProfile` column — for the same reason the escrow module itself never
 * trusts one: money shown must equal money that would actually move.
 */
export const dynamic = 'force-dynamic';

const PAYOUT_STATUS_TR: Record<string, string> = {
  PENDING: 'Hazırlanıyor',
  SUBMITTED: 'Gönderildi',
  PAID: 'Ödendi',
  FAILED: 'Başarısız',
};

export default async function CoachEarningsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/giris?callbackUrl=/panel/kazanc');

  const coach = await prisma.coachProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, verificationStatus: true },
  });
  if (!coach) redirect('/panel');

  const earnings =
    coach.verificationStatus === 'APPROVED'
      ? await getCoachEarnings(coach.id)
      : { availableBalanceMinor: 0, recentEarnings: [], payouts: [] };

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 sm:px-8">
      <Link href="/panel" className="text-sm text-muted transition-colors hover:text-cactus">
        Panele dön
      </Link>

      <h1 className="mt-6 font-display text-question font-semibold text-balance">
        Kazançların
      </h1>

      {coach.verificationStatus !== 'APPROVED' ? (
        <p className="mt-6 leading-relaxed text-muted">
          Koç başvurun onaylandığında kazançların burada görünecek.
        </p>
      ) : (
        <>
          <section className="mt-8 rounded-2xl border border-cactus/40 bg-cactus-pale/30 p-6">
            <p className="text-sm text-muted">Aktarılmayı bekleyen bakiye</p>
            <p className="mt-1 font-display text-3xl font-semibold tabular-nums">
              {formatTry(earnings.availableBalanceMinor)}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Bu tutar, öğrencilerin onayladığı ya da otomatik aktarılan derslerden birikir.
              Banka hesabına geçiş ayrı bir adımda işlenir; aşağıdaki liste hangi ödemelerin
              gönderildiğini gösterir.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="font-display text-lg font-semibold">Son kazançlar</h2>
            {earnings.recentEarnings.length === 0 ? (
              <p className="mt-3 text-muted">Henüz bir kazancın yok.</p>
            ) : (
              <ul className="mt-3 space-y-px overflow-hidden rounded-xl border border-stone/70 bg-stone/60">
                {earnings.recentEarnings.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-baseline justify-between gap-4 bg-paper px-5 py-4"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {entry.offerTitle ?? entry.description}
                      </span>
                      <span className="mt-0.5 block text-sm text-muted">
                        {new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(
                          entry.createdAt,
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums text-cactus-deep">
                      +{formatTry(entry.amountMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-10">
            <h2 className="font-display text-lg font-semibold">Banka aktarımları</h2>
            {earnings.payouts.length === 0 ? (
              <p className="mt-3 leading-relaxed text-muted">
                Henüz gönderilmiş bir aktarım yok. Bakiyen aktarıma hazır olduğunda burada
                listelenecek.
              </p>
            ) : (
              <ul className="mt-3 space-y-px overflow-hidden rounded-xl border border-stone/70 bg-stone/60">
                {earnings.payouts.map((payout) => (
                  <li
                    key={payout.id}
                    className="flex items-baseline justify-between gap-4 bg-paper px-5 py-4"
                  >
                    <span>
                      <span className="block font-medium">{formatTry(payout.amountMinor)}</span>
                      <span className="mt-0.5 block text-sm text-muted">
                        {new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(
                          payout.paidAt ?? payout.submittedAt ?? payout.createdAt,
                        )}
                      </span>
                    </span>
                    <span className="text-sm text-muted">
                      {PAYOUT_STATUS_TR[payout.status] ?? payout.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
