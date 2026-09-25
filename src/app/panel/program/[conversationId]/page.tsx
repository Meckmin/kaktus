import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { isIsoDate, istanbulToday, mondayOf } from '@/lib/planner/week';
import { PlannerError, listWeek, plannerAccess } from '@/server/services/planner-service';
import { WeeklyPlanner } from '@/components/planner/WeeklyPlanner';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Haftalık program — Kaktüs Koçluk' };

export default async function ProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ hafta?: string }>;
}) {
  const [{ conversationId }, { hafta }] = await Promise.all([params, searchParams]);
  const session = await auth();
  if (!session?.user?.id) redirect(`/giris?callbackUrl=/panel/program/${conversationId}`);

  let access;
  try {
    access = await plannerAccess(conversationId, session.user.id);
  } catch (error) {
    if (error instanceof PlannerError && error.code === 'FORBIDDEN') {
      return (
        <main className="mx-auto max-w-2xl px-6 py-10 sm:px-8">
          <Link href={`/panel/sohbet/${conversationId}`} className="text-sm text-muted hover:text-cactus">
            Sohbete dön
          </Link>
          <p className="mt-6 leading-relaxed">{error.userMessage}</p>
        </main>
      );
    }
    notFound();
  }

  const monday = mondayOf(hafta && isIsoDate(hafta) ? hafta : istanbulToday());
  const tasks = await listWeek(access, monday);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8 sm:px-8">
      <Link href={`/panel/sohbet/${conversationId}`} className="text-sm text-muted transition-colors hover:text-cactus">
        Sohbete dön
      </Link>
      <h1 className="mt-3 font-display text-2xl font-semibold">
        Haftalık program · {access.counterpartyName}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {access.role === 'COACH'
          ? 'Görevleri gün gün ekle; öğrencin yaptıklarını işaretledikçe burada görürsün.'
          : 'Koçunla birlikte planladığınız görevler. Yaptıkça işaretle.'}
      </p>
      <div className="mt-6">
        <WeeklyPlanner
          conversationId={conversationId}
          role={access.role}
          initialMonday={monday}
          initialTasks={tasks}
        />
      </div>
    </main>
  );
}
