import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listConversations } from '@/server/queries/conversation';
import { formatTry } from '@/lib/onboarding/client-state';
import { OFFER_STATUS_TR } from '@/lib/offers/state-machine';
import { joinState } from '@/lib/meetings/rules';

/**
 * Dashboard.
 *
 * Organised by *what needs doing*, not by data type. The first thing on the
 * page is the list of conversations where the other side is waiting on you —
 * because in a marketplace the single biggest killer is a coach taking two days
 * to reply to an offer, and the dashboard's job is to make that hard to do
 * accidentally.
 *
 * A person can be both student and coach — a gap-year student who coaches an
 * 11th grader is exactly who this platform attracts — so both sections render
 * when both exist.
 */
export const dynamic = 'force-dynamic';

export default async function PanelPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/giris?callbackUrl=/panel');

  const [conversations, student, coach, isAdmin] = await Promise.all([
    listConversations(),
    prisma.studentProfile.findUnique({
      where: { userId: session.user.id },
      select: { id: true, engagements: { where: { status: 'ACTIVE' }, select: { id: true } } },
    }),
    prisma.coachProfile.findUnique({
      where: { userId: session.user.id },
      select: {
        id: true,
        slug: true,
        verificationStatus: true,
        activeEngagements: true,
        maxActiveStudents: true,
        acceptingStudents: true,
      },
    }),
    prisma.user
      .findUnique({ where: { id: session.user.id }, select: { roles: true } })
      .then((u) => u?.roles.includes('ADMIN') ?? false),
  ]);

  // The next meeting either side is part of, until its join window closes.
  const nextMeeting = await prisma.booking.findFirst({
    where: {
      status: 'SCHEDULED',
      engagementId: { not: null },
      endsAt: { gte: new Date(Date.now() - 30 * 60_000) },
      OR: [
        ...(coach ? [{ coachProfileId: coach.id }] : []),
        ...(student ? [{ studentProfileId: student.id }] : []),
      ],
    },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      coachProfileId: true,
      coach: { select: { user: { select: { name: true } } } },
      student: { select: { user: { select: { name: true } } } },
    },
  });
  const nextMeetingOpen = nextMeeting ? joinState(nextMeeting.startsAt, nextMeeting.endsAt) === 'OPEN' : false;

  const waiting = conversations.filter((c) => c.awaitingViewer);
  const rest = conversations.filter((c) => !c.awaitingViewer);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 sm:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Link href="/" className="text-sm text-muted transition-colors hover:text-cactus">
          Kaktüs Koçluk
        </Link>
        <div className="flex items-baseline gap-4">
          {isAdmin && (
            <Link href="/admin" className="text-sm text-cactus hover:text-cactus-deep">
              Yönetim
            </Link>
          )}
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/' });
            }}
          >
            <button type="submit" className="text-sm text-muted transition-colors hover:text-cactus">
              Çıkış yap
            </button>
          </form>
        </div>
      </div>

      <h1 className="mt-6 font-display text-question font-semibold">Panelin</h1>

      {coach && coach.verificationStatus !== 'APPROVED' && (
        <Link
          href="/koc-ol"
          className="mt-6 block rounded-xl border border-dust/60 bg-dust/10 px-5 py-4 transition-colors hover:border-cactus"
        >
          <p className="font-medium">Koç başvurun inceleniyor</p>
          <p className="mt-0.5 text-sm text-muted">Durumu görmek için dokun.</p>
        </Link>
      )}

      {nextMeeting && (coach || student) && (
        <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cactus/40 bg-cactus-pale/30 px-5 py-4">
          <div>
            <p className="text-sm text-muted">Yaklaşan görüşme</p>
            <p className="font-medium">
              {nextMeeting.coachProfileId === coach?.id
                ? (nextMeeting.student.user.name ?? 'Öğrenci')
                : (nextMeeting.coach.user.name ?? 'Koç')}{' '}
              ·{' '}
              {new Intl.DateTimeFormat('tr-TR', {
                timeZone: 'Europe/Istanbul',
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
              }).format(nextMeeting.startsAt)}
            </p>
          </div>
          <Link
            href={`/panel/gorusme/${nextMeeting.id}`}
            className={[
              'rounded-full px-4 py-2 text-sm font-medium',
              nextMeetingOpen ? 'bg-cactus text-paper hover:bg-cactus-deep' : 'border border-stone text-muted',
            ].join(' ')}
          >
            {nextMeetingOpen ? 'Görüşmeye gir' : 'Görüşme odası'}
          </Link>
        </section>
      )}

      {waiting.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-lg font-semibold">Seni bekleyenler</h2>
          <p className="mt-1 text-sm text-muted">
            Karşı taraf yanıtını bekliyor. Hızlı dönmek, anlaşma ihtimalini en çok artıran şey.
          </p>
          <ConversationList items={waiting} highlight />
        </section>
      )}

      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold">
          {waiting.length > 0 ? 'Diğer sohbetler' : 'Sohbetler'}
        </h2>
        {rest.length === 0 && waiting.length === 0 ? (
          <EmptyState hasCoach={Boolean(coach)} hasStudent={Boolean(student)} />
        ) : (
          <ConversationList items={rest} />
        )}
      </section>

      {coach?.verificationStatus === 'APPROVED' && (
        <section className="mt-12">
          <h2 className="font-display text-lg font-semibold">Koç durumun</h2>
          <dl className="mt-3 grid gap-px overflow-hidden rounded-xl border border-stone/70 bg-stone/60 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Aktif öğrenci"
              value={`${coach.activeEngagements} / ${coach.maxActiveStudents}`}
            />
            <Stat label="Yeni öğrenci" value={coach.acceptingStudents ? 'Alıyorsun' : 'Kapalı'} />
            <Stat label="Kazançların" value="Detay" href="/panel/kazanc" />
            <Stat label="Profilin" value="Yayında" href={`/koc/${coach.slug}`} />
          </dl>
        </section>
      )}
    </main>
  );
}

function ConversationList({
  items,
  highlight = false,
}: {
  items: Awaited<ReturnType<typeof listConversations>>;
  highlight?: boolean;
}) {
  if (items.length === 0) {
    return <p className="mt-3 text-muted">Henüz sohbet yok.</p>;
  }

  return (
    <ul className="mt-3 space-y-px overflow-hidden rounded-xl border border-stone/70 bg-stone/60">
      {items.map((item) => (
        <li key={item.id} className="bg-paper">
          <Link
            href={`/panel/sohbet/${item.id}`}
            className={[
              'flex items-baseline justify-between gap-4 px-5 py-4 transition-colors hover:bg-cactus-pale/40',
              highlight ? 'border-l-2 border-l-bloom' : '',
            ].join(' ')}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{item.counterpartyName}</span>
              <span className="mt-0.5 block truncate text-sm text-muted">
                {item.lastMessage ?? 'Henüz mesaj yok'}
              </span>
            </span>
            <span className="shrink-0 text-right text-sm">
              {item.liveOfferPriceMinor != null && (
                <span className="block tabular-nums">{formatTry(item.liveOfferPriceMinor)}</span>
              )}
              {item.liveOfferStatus && (
                <span className="mt-0.5 block text-muted">
                  {OFFER_STATUS_TR[item.liveOfferStatus as keyof typeof OFFER_STATUS_TR] ??
                    item.liveOfferStatus}
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ hasCoach, hasStudent }: { hasCoach: boolean; hasStudent: boolean }) {
  return (
    <div className="mt-3 rounded-xl border border-stone/70 bg-paper px-5 py-5">
      <p className="leading-relaxed text-muted">
        {hasCoach
          ? 'Henüz teklif almadın. Takvimini güncel tutmak, gelen teklif sayısını en çok artıran şey.'
          : 'Henüz bir koçla konuşmaya başlamadın.'}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {hasStudent && (
          <Link
            href="/kocbul"
            className="rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper hover:bg-cactus-deep"
          >
            Koçları gör
          </Link>
        )}
        {!hasStudent && !hasCoach && (
          <>
            <Link
              href="/onboarding/alan"
              className="rounded-full bg-cactus px-5 py-2.5 text-sm font-medium text-paper hover:bg-cactus-deep"
            >
              Koç ara
            </Link>
            <Link
              href="/koc-ol"
              className="rounded-full border border-stone px-5 py-2.5 text-sm font-medium hover:border-cactus hover:text-cactus"
            >
              Koç ol
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = (
    <div className="bg-paper px-5 py-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
  return href ? (
    <Link href={href} className="transition-colors hover:bg-cactus-pale/40">
      {body}
    </Link>
  ) : (
    body
  );
}
