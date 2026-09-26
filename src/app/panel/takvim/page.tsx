import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { addDays, dayLabel, isIsoDate, istanbulToday, mondayOf, weekDays } from '@/lib/planner/week';
import { getCoachWeek, type CoachWeekStudent } from '@/server/queries/coach-week';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Takvim — Kaktüs Koçluk' };

/**
 * The coach's week across all students: every meeting and pending invite on
 * one calendar, and below it how far each student got with this week's plan —
 * so a coach with eight students can see who is behind without opening eight
 * programs.
 */

const time = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });

export default async function CoachCalendarPage({ searchParams }: { searchParams: Promise<{ hafta?: string }> }) {
  const { hafta } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect('/giris?callbackUrl=/panel/takvim');

  const coach = await prisma.coachProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, verificationStatus: true },
  });
  if (!coach || coach.verificationStatus !== 'APPROVED') redirect('/panel');

  const today = istanbulToday();
  const thisMonday = mondayOf(today);
  const monday = mondayOf(hafta && isIsoDate(hafta) ? hafta : today);
  const week = await getCoachWeek(coach.id, monday);
  const days = weekDays(monday);
  const weekHref = (m: string) => (m === thisMonday ? '/panel/takvim' : `/panel/takvim?hafta=${m}`);

  const upcoming = week.meetings.filter((m) => m.status === 'SCHEDULED').length;

  return (
    <main className="mx-auto max-w-7xl px-6 py-8 sm:px-8">
      <Link href="/panel" className="text-sm text-muted transition-colors hover:text-cactus">
        Panele dön
      </Link>
      <h1 className="mt-3 font-display text-2xl font-semibold">Takvim</h1>
      <p className="mt-1 text-sm text-muted">
        {week.meetings.length === 0
          ? 'Bu hafta görüşme yok.'
          : `Bu hafta ${week.meetings.length} görüşme${upcoming < week.meetings.length ? `, ${upcoming} tanesi önünde` : ''}.`}
        {week.invites.length > 0 && ` ${week.invites.length} davet öğrencinin yanıtını bekliyor.`}
      </p>

      <nav className="mt-5 flex items-center gap-1 text-sm">
        <Link href={weekHref(addDays(monday, -7))} className="rounded-full px-3 py-1.5 hover:bg-limestone">
          ← Önceki
        </Link>
        <Link href={weekHref(thisMonday)} className="rounded-full px-3 py-1.5 font-medium hover:bg-limestone">
          {dayLabel(monday).date} – {dayLabel(addDays(monday, 6)).date}
        </Link>
        <Link href={weekHref(addDays(monday, 7))} className="rounded-full px-3 py-1.5 hover:bg-limestone">
          Sonraki →
        </Link>
      </nav>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
        {days.map((day) => {
          const label = dayLabel(day);
          const meetings = week.meetings.filter((m) => m.day === day);
          const invites = week.invites.filter((i) => i.day === day);
          const empty = meetings.length === 0 && invites.length === 0;
          return (
            <section
              key={day}
              // On a phone an empty day is just scroll; on the grid it keeps the week's shape.
              className={[
                'min-h-32 flex-col rounded-xl border p-3',
                empty ? 'hidden md:flex' : 'flex',
                day === today ? 'border-cactus/60 bg-cactus-pale/30' : 'border-stone/70 bg-paper',
              ].join(' ')}
            >
              <h2 className="text-sm">
                <span className="font-medium">{label.weekday}</span> <span className="text-muted">{label.date}</span>
              </h2>
              <ul className="mt-2 space-y-2">
                {meetings.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/panel/gorusme/${m.id}`}
                      className={[
                        'block rounded-lg border border-stone/60 bg-paper p-2.5 text-sm transition-colors hover:border-cactus',
                        m.status === 'SCHEDULED' ? '' : 'opacity-60',
                      ].join(' ')}
                    >
                      <span className="block font-medium tabular-nums">
                        {time.format(m.startsAt)}–{time.format(m.endsAt)}
                      </span>
                      <span className="block truncate">{m.studentName}</span>
                      <span className="block text-xs text-muted">
                        {m.status === 'COMPLETED'
                          ? 'Yapıldı'
                          : m.status === 'NO_SHOW'
                            ? 'Katılım olmadı'
                            : m.billed
                              ? 'Program dersi'
                              : 'Ek görüşme'}
                      </span>
                    </Link>
                  </li>
                ))}
                {invites.map((i) => (
                  <li key={i.id}>
                    <Link
                      href={i.conversationId ? `/panel/sohbet/${i.conversationId}` : '/panel'}
                      className="block rounded-lg border border-dashed border-stone p-2.5 text-sm text-muted transition-colors hover:border-cactus"
                    >
                      <span className="block tabular-nums">
                        {time.format(i.startsAt)}–{time.format(i.endsAt)}
                      </span>
                      <span className="block truncate text-ink">{i.studentName}</span>
                      <span className="block text-xs">
                        {i.moving ? 'Yeni saat önerdin · yanıt bekliyor' : 'Davet · yanıt bekliyor'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <section className="mt-12">
        <h2 className="font-display text-lg font-semibold">Öğrencilerin bu hafta</h2>
        <p className="mt-1 text-sm text-muted">Haftalık programda işaretlenen görevler. Geride kalanı buradan görürsün.</p>
        {week.students.length === 0 ? (
          <p className="mt-4 text-muted">Devam eden programın yok.</p>
        ) : (
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {week.students.map((s) => (
              <StudentRow key={s.conversationId} student={s} monday={monday} today={today} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function StudentRow({ student, monday, today }: { student: CoachWeekStudent; monday: string; today: string }) {
  const share = student.tasksTotal ? student.tasksDone / student.tasksTotal : 0;
  const programHref = `/panel/program/${student.conversationId}${monday === mondayOf(today) ? '' : `?hafta=${monday}`}`;

  return (
    <li className="rounded-xl border border-stone/70 bg-paper p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-medium">
          {student.studentName}
          {!student.active && <span className="ml-2 text-xs font-normal text-muted">Program bitti</span>}
        </p>
        <div className="flex gap-4 text-sm">
          <Link href={programHref} className="text-cactus hover:text-cactus-deep">
            Program
          </Link>
          <Link href={`/panel/sohbet/${student.conversationId}`} className="text-muted hover:text-cactus">
            Sohbet
          </Link>
        </div>
      </div>

      {student.tasksTotal === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Bu hafta için görev yok.{' '}
          {student.active && (
            <Link href={programHref} className="text-cactus hover:text-cactus-deep">
              Programı hazırla
            </Link>
          )}
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted tabular-nums">
            {student.tasksDone}/{student.tasksTotal} görev
            {student.questionsPlanned > 0 &&
              ` · ${student.questionsDone.toLocaleString('tr-TR')}/${student.questionsPlanned.toLocaleString('tr-TR')} soru`}
          </p>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-limestone"
            role="progressbar"
            aria-label="Tamamlanan görevler"
            aria-valuenow={Math.round(share * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-cactus" style={{ width: `${share * 100}%` }} />
          </div>
          <ol className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px]">
            {student.days.map((d) => {
              const behind = d.total > 0 && d.done < d.total && d.day < today;
              return (
                <li
                  key={d.day}
                  title={`${dayLabel(d.day).weekday}: ${d.done}/${d.total}`}
                  className={[
                    'rounded-md px-1 py-1',
                    d.total === 0
                      ? 'bg-limestone/60 text-muted'
                      : d.done === d.total
                        ? 'bg-cactus text-paper'
                        : behind
                          ? 'bg-bloom-pale text-ink'
                          : 'bg-cactus-pale text-ink',
                    d.day === today ? 'ring-1 ring-cactus' : '',
                  ].join(' ')}
                >
                  <span className="block">{dayLabel(d.day).short}</span>
                  <span className="block tabular-nums">{d.total ? `${d.done}/${d.total}` : '–'}</span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </li>
  );
}
