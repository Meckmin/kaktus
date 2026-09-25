import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export interface MeetingInviteView {
  id: string;
  bookingId: string | null;
  startsAt: Date;
  endsAt: Date;
  message: string | null;
}

export interface MeetingBookingView {
  id: string;
  startsAt: Date;
  endsAt: Date;
  /** Part of the paid program (tied to a payment instalment) or an extra meeting. */
  billed: boolean;
  meetingUrl: string | null;
  pendingInvite: MeetingInviteView | null;
}

export interface MeetingsView {
  viewerRole: 'COACH' | 'STUDENT';
  /** The running program new invites attach to; null when nothing is active. */
  activeEngagementId: string | null;
  bookings: MeetingBookingView[];
  /** Invites for extra meetings (not moving an existing one). */
  extraInvites: MeetingInviteView[];
}

/**
 * Upcoming and in-progress meetings for one coach–student pair, with any
 * pending invites. Returns null for anyone who isn't a party, so a stranger
 * gets the same answer as a missing conversation.
 */
export async function getMeetings(conversationId: string, now: Date = new Date()): Promise<MeetingsView | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      coachProfileId: true,
      studentProfileId: true,
      coach: { select: { userId: true } },
      student: { select: { userId: true } },
    },
  });
  if (!conversation) return null;
  const isCoach = conversation.coach.userId === session.user.id;
  const isStudent = conversation.student.userId === session.user.id;
  if (!isCoach && !isStudent) return null;

  // Meetings stay listed until the join window has closed (end + 30 min),
  // then drop off; a day's slack keeps a just-finished one visible.
  const since = new Date(now.getTime() - 24 * 60 * 60_000);
  const [engagement, bookings, extraInvites] = await Promise.all([
    prisma.engagement.findFirst({
      where: {
        coachProfileId: conversation.coachProfileId,
        studentProfileId: conversation.studentProfileId,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }),
    prisma.booking.findMany({
      where: {
        coachProfileId: conversation.coachProfileId,
        studentProfileId: conversation.studentProfileId,
        engagementId: { not: null },
        status: 'SCHEDULED',
        endsAt: { gte: since },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        milestoneId: true,
        meetingUrl: true,
        invites: {
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, bookingId: true, startsAt: true, endsAt: true, message: true },
        },
      },
    }),
    prisma.meetingInvite.findMany({
      where: {
        bookingId: null,
        status: 'PENDING',
        engagement: {
          coachProfileId: conversation.coachProfileId,
          studentProfileId: conversation.studentProfileId,
        },
      },
      orderBy: { startsAt: 'asc' },
      select: { id: true, bookingId: true, startsAt: true, endsAt: true, message: true },
    }),
  ]);

  return {
    viewerRole: isCoach ? 'COACH' : 'STUDENT',
    activeEngagementId: engagement?.id ?? null,
    bookings: bookings.map((b) => ({
      id: b.id,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      billed: Boolean(b.milestoneId),
      meetingUrl: b.meetingUrl,
      pendingInvite: b.invites[0] ?? null,
    })),
    extraInvites,
  };
}
