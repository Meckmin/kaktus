import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { DisputeCard } from '@/components/admin/DisputeCard';

/**
 * Dispute queue.
 *
 * Every row here is money frozen mid-flight: a student who paid and a coach who
 * may or may not have delivered. Both are waiting, and both lose trust with
 * every day it sits unresolved — so the queue shows the amount at stake and how
 * long it has been open, which are the two things that should drive triage.
 */
export const dynamic = 'force-dynamic';

export default async function DisputesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/giris?callbackUrl=/admin/itirazlar');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { roles: true },
  });
  if (!user?.roles.includes('ADMIN')) redirect('/panel');

  const disputes = await prisma.dispute.findMany({
    where: { status: { in: ['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'] } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      reason: true,
      detail: true,
      status: true,
      createdAt: true,
      openedByRole: true,
      engagement: {
        select: {
          id: true,
          totalMinor: true,
          startDate: true,
          coach: { select: { user: { select: { name: true } } } },
          student: { select: { user: { select: { name: true } } } },
          milestones: {
            orderBy: { index: 'asc' },
            select: { index: true, status: true, amountMinor: true },
          },
          bookings: {
            select: { status: true, startsAt: true },
            orderBy: { startsAt: 'asc' },
            take: 20,
          },
        },
      },
    },
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 sm:px-8">
      <Link href="/admin" className="text-sm text-muted hover:text-cactus">
        Doğrulama kuyruğuna dön
      </Link>
      <h1 className="mt-6 font-display text-question font-semibold">İtirazlar</h1>
      <p className="mt-3 max-w-[54ch] leading-relaxed text-muted">
        Aktarılmış dilimler geri alınmaz — yalnızca donmuş tutar üzerinde karar verebilirsin.
        Kararını yazarken iki taraf da okuyacakmış gibi yaz.
      </p>

      {disputes.length === 0 ? (
        <p className="mt-10 rounded-xl border border-stone/70 bg-paper px-5 py-5 text-muted">
          Açık itiraz yok.
        </p>
      ) : (
        <div className="mt-8 space-y-4">
          {disputes.map((dispute) => (
            <DisputeCard key={dispute.id} dispute={JSON.parse(JSON.stringify(dispute))} />
          ))}
        </div>
      )}
    </main>
  );
}
