import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { OFFER_STATUS_TR } from '@/lib/offers/state-machine';
import { formatTry } from '@/lib/onboarding/client-state';
import { computeBreakdown } from '@/lib/offers/draft';

/**
 * Offer detail.
 *
 * Where the composer lands after submitting, and where the payment pages send
 * people afterwards. Read-only for now: accept, counter and pay are the
 * negotiation view's job, and shipping half-wired buttons that call nothing
 * would be worse than showing an honest status.
 */
export const dynamic = 'force-dynamic';

export default async function OfferDetailPage({
  params,
}: {
  params: Promise<{ offerId: string }>;
}) {
  const { offerId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/giris?callbackUrl=/panel/teklifler/${offerId}`);

  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      title: true,
      status: true,
      priceMinor: true,
      commissionBps: true,
      startDate: true,
      endDate: true,
      milestoneCount: true,
      scope: true,
      createdAt: true,
      conversationId: true,
      coach: { select: { slug: true, userId: true, user: { select: { name: true } } } },
      student: { select: { userId: true, user: { select: { name: true } } } },
      engagement: {
        select: {
          status: true,
          milestones: {
            orderBy: { index: 'asc' },
            select: { index: true, status: true, amountMinor: true, periodStart: true },
          },
        },
      },
    },
  });

  if (!offer) notFound();

  // Authorisation, not just authentication. An offer id is guessable enough
  // that "logged in" is not the same as "allowed to read this negotiation".
  const isParty =
    offer.coach.userId === session.user.id || offer.student.userId === session.user.id;
  if (!isParty) notFound();

  const viewerIsCoach = offer.coach.userId === session.user.id;
  const counterparty = viewerIsCoach ? offer.student.user.name : offer.coach.user.name;
  const breakdown = computeBreakdown(offer.priceMinor, offer.commissionBps);
  const scope = offer.scope as { sessionsPerCycle?: number; minutesPerSession?: number; notes?: string };

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 sm:px-8">
      <Link href="/panel" className="text-sm text-muted transition-colors hover:text-cactus">
        Panele dön
      </Link>

      <h1 className="mt-6 font-display text-question font-semibold text-balance">{offer.title}</h1>
      <p className="mt-2 text-lg text-muted">
        {counterparty ?? (viewerIsCoach ? 'Öğrenci' : 'Koç')} ile
      </p>

      <p className="mt-6 inline-block rounded-full border border-stone px-4 py-1.5 text-sm">
        {OFFER_STATUS_TR[offer.status as keyof typeof OFFER_STATUS_TR] ?? offer.status}
      </p>

      <dl className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-stone/70 bg-stone/60 sm:grid-cols-2">
        <Fact label="Tutar" value={formatTry(offer.priceMinor)} />
        <Fact
          label={viewerIsCoach ? 'Sana geçecek' : 'Koça giden'}
          value={formatTry(breakdown.coachReceivesMinor)}
          note={`Kaktüs payı ${formatTry(breakdown.platformFeeMinor)}`}
        />
        <Fact
          label="Başlangıç"
          value={new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long' }).format(offer.startDate)}
        />
        <Fact
          label="Kapsam"
          value={`${scope.sessionsPerCycle ?? offer.milestoneCount} seans`}
          note={scope.minutesPerSession ? `${scope.minutesPerSession} dakika` : undefined}
        />
      </dl>

      {scope.notes && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-semibold">Not</h2>
          <p className="mt-2 leading-relaxed">{scope.notes}</p>
        </section>
      )}

      {offer.engagement && (
        <section className="mt-10">
          <h2 className="font-display text-lg font-semibold">Ödeme dilimleri</h2>
          <ul className="mt-3 space-y-px overflow-hidden rounded-xl border border-stone/70 bg-stone/60">
            {offer.engagement.milestones.map((milestone) => (
              <li
                key={milestone.index}
                className="flex items-baseline justify-between gap-4 bg-paper px-5 py-3.5"
              >
                <span>
                  {milestone.index + 1}. dilim
                  <span className="ml-2 text-sm text-muted">
                    {new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(
                      milestone.periodStart,
                    )}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block tabular-nums">{formatTry(milestone.amountMinor)}</span>
                  <span className="mt-0.5 block text-sm text-muted">
                    {MILESTONE_TR[milestone.status] ?? milestone.status}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-10">
        <Link
          href={`/panel/sohbet/${offer.conversationId}`}
          className="rounded-full bg-cactus px-6 py-3 font-medium text-paper hover:bg-cactus-deep"
        >
          Sohbete git
        </Link>
      </div>
    </main>
  );
}

const MILESTONE_TR: Record<string, string> = {
  SCHEDULED: 'Planlandı',
  IN_PROGRESS: 'Devam ediyor',
  PENDING_CONFIRMATION: 'Onay bekliyor',
  RELEASED: 'Aktarıldı',
  DISPUTED: 'İtiraz sürecinde',
  REFUNDED: 'İade edildi',
};

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-paper px-5 py-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
      {note && <dd className="mt-0.5 text-sm text-muted">{note}</dd>}
    </div>
  );
}
