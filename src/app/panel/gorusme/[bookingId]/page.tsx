import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { dateToDay, mondayOf } from '@/lib/planner/week';
import { listWeek, plannerAccess } from '@/server/services/planner-service';
import { MeetingRoom } from '@/components/meetings/MeetingRoom';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Görüşme — Kaktüs Koçluk' };

export default async function MeetingPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/giris?callbackUrl=/panel/gorusme/${bookingId}`);

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { startsAt: true, endsAt: true, status: true, coachProfileId: true, studentProfileId: true },
  });
  if (!booking) notFound();

  const conversation = await prisma.conversation.findUnique({
    where: {
      coachProfileId_studentProfileId: {
        coachProfileId: booking.coachProfileId,
        studentProfileId: booking.studentProfileId,
      },
    },
    select: { id: true },
  });
  if (!conversation) notFound();

  // Also the party check: throws for anyone who isn't coach or student here.
  const access = await plannerAccess(conversation.id, session.user.id).catch(() => null);
  if (!access) notFound();

  // Open on the week the meeting falls in (Istanbul date of its start).
  const monday = mondayOf(dateToDay(new Date(booking.startsAt.getTime() + 3 * 3_600_000)));
  const tasks = await listWeek(access, monday);

  return (
    <main className="mx-auto max-w-7xl px-6 py-6 sm:px-8">
      <MeetingRoom
        bookingId={bookingId}
        startsAt={booking.startsAt}
        endsAt={booking.endsAt}
        status={booking.status}
        counterpartyName={access.counterpartyName}
        conversationId={conversation.id}
        role={access.role}
        monday={monday}
        tasks={tasks}
      />
    </main>
  );
}
