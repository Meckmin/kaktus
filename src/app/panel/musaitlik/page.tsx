import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { rangesToCells } from '@/lib/availability/grid';
import { AvailabilityEditor } from '@/components/availability/AvailabilityEditor';

/**
 * Coach calendar management.
 *
 * The recurring weekly grid and the blackout-date list, both persisted through
 * server actions in `@/server/actions/availability`. This page is the source of
 * truth for a coach's availability after onboarding; the same `AvailabilityRule`
 * and `AvailabilityException` rows feed the public profile calendar and the
 * offer composer.
 */
export const dynamic = 'force-dynamic';

export default async function AvailabilityPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/giris?callbackUrl=/panel/musaitlik');

  const coach = await prisma.coachProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, timezone: true, verificationStatus: true },
  });
  if (!coach) redirect('/panel');

  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  const [rules, exceptions] = await Promise.all([
    prisma.availabilityRule.findMany({
      where: { coachProfileId: coach.id, active: true },
      select: { weekday: true, startMinute: true, endMinute: true },
    }),
    prisma.availabilityException.findMany({
      where: { coachProfileId: coach.id, date: { gte: startOfToday } },
      orderBy: { date: 'asc' },
      select: { id: true, date: true },
    }),
  ]);

  const cellKeys = [...rangesToCells(rules)];
  const blackouts = exceptions.map((e) => ({
    id: e.id,
    date: e.date.toISOString().slice(0, 10),
  }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 sm:px-8">
      <Link href="/panel" className="text-sm text-muted transition-colors hover:text-cactus">
        Panele dön
      </Link>
      <h1 className="mt-6 font-display text-question font-semibold">Müsaitlik</h1>
      <p className="mt-2 max-w-[56ch] leading-relaxed text-muted">
        Hangi saatlerde ders verebileceğini işaretle. Öğrenciler yalnızca bu saatlerden teklif
        gönderebilir.
      </p>

      {coach.verificationStatus !== 'APPROVED' && (
        <p className="mt-4 rounded-xl border border-dust/40 bg-dust/15 px-4 py-3 text-sm leading-relaxed">
          Başvurun henüz onaylanmadı. Müsaitliğini şimdiden düzenleyebilirsin; onaylandığında
          profilinde bu saatler görünür.
        </p>
      )}

      <AvailabilityEditor
        initialCellKeys={cellKeys}
        blackouts={blackouts}
        timezone={coach.timezone}
      />
    </main>
  );
}
