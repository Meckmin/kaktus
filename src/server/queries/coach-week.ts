import { prisma } from '@/lib/db';
import { addDays, dateToDay, dayToDate } from '@/lib/planner/week';

/**
 * One week of a coach's work across every student: all meetings and pending
 * invites on one calendar, and how far each student got with this week's plan.
 *
 * Everything per student is keyed by conversation — a coach–student pair has
 * exactly one, and it is what the program and chat pages hang off.
 */

export interface CoachWeekMeeting {
  id: string;
  startsAt: Date;
  endsAt: Date;
  day: string;
  conversationId: string | null;
  studentName: string;
  /** Tied to a payment instalment; false for an extra meeting. */
  billed: boolean;
  status: 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW';
}

export interface CoachWeekInvite {
  id: string;
  startsAt: Date;
  endsAt: Date;
  day: string;
  conversationId: string | null;
  studentName: string;
  /** Proposes a new time for an existing session rather than an extra one. */
  moving: boolean;
}

export interface CoachWeekStudent {
  conversationId: string;
  studentName: string;
  /** Has a running program; false for someone who only shows up via an old meeting. */
  active: boolean;
  tasksTotal: number;
  tasksDone: number;
  questionsPlanned: number;
  questionsDone: number;
  /** Per day of the week, Monday first. */
  days: Array<{ day: string; total: number; done: number }>;
}

export interface CoachWeek {
  monday: string;
  meetings: CoachWeekMeeting[];
  invites: CoachWeekInvite[];
  students: CoachWeekStudent[];
}

const STUDENT_FALLBACK = 'Öğrenci';

/** Istanbul calendar day of an instant (UTC+3 year-round). */
function istanbulDay(at: Date): string {
  return new Date(at.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Midnight in Istanbul at the start of `day`. */
function istanbulMidnight(day: string): Date {
  return new Date(`${day}T00:00:00+03:00`);
}

export async function getCoachWeek(coachProfileId: string, monday: string): Promise<CoachWeek> {
  const from = istanbulMidnight(monday);
  const to = istanbulMidnight(addDays(monday, 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const [conversations, activeEngagements, bookings, invites] = await Promise.all([
    prisma.conversation.findMany({
      where: { coachProfileId },
      select: { id: true, studentProfileId: true, student: { select: { user: { select: { name: true } } } } },
    }),
    prisma.engagement.findMany({
      where: { coachProfileId, status: 'ACTIVE' },
      select: { studentProfileId: true },
    }),
    prisma.booking.findMany({
      where: {
        coachProfileId,
        engagementId: { not: null },
        status: { in: ['SCHEDULED', 'COMPLETED', 'NO_SHOW_STUDENT', 'NO_SHOW_COACH'] },
        startsAt: { gte: from, lt: to },
      },
      orderBy: { startsAt: 'asc' },
      select: { id: true, startsAt: true, endsAt: true, status: true, milestoneId: true, studentProfileId: true },
    }),
    prisma.meetingInvite.findMany({
      where: { status: 'PENDING', startsAt: { gte: from, lt: to }, engagement: { coachProfileId } },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        bookingId: true,
        engagement: { select: { studentProfileId: true } },
      },
    }),
  ]);

  const byStudent = new Map(conversations.map((c) => [c.studentProfileId, c]));
  const nameOf = (studentProfileId: string) =>
    byStudent.get(studentProfileId)?.student.user.name ?? STUDENT_FALLBACK;

  const meetings: CoachWeekMeeting[] = bookings.map((b) => ({
    id: b.id,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    day: istanbulDay(b.startsAt),
    conversationId: byStudent.get(b.studentProfileId)?.id ?? null,
    studentName: nameOf(b.studentProfileId),
    billed: b.milestoneId !== null,
    status: b.status === 'SCHEDULED' || b.status === 'COMPLETED' ? b.status : 'NO_SHOW',
  }));

  const pendingInvites: CoachWeekInvite[] = invites.map((i) => ({
    id: i.id,
    startsAt: i.startsAt,
    endsAt: i.endsAt,
    day: istanbulDay(i.startsAt),
    conversationId: byStudent.get(i.engagement.studentProfileId)?.id ?? null,
    studentName: nameOf(i.engagement.studentProfileId),
    moving: i.bookingId !== null,
  }));

  // Students in a running program, plus anyone met this week (a program that
  // just ended still had its last lesson here).
  const activeIds = new Set(activeEngagements.map((e) => e.studentProfileId));
  const listed = conversations.filter(
    (c) => activeIds.has(c.studentProfileId) || bookings.some((b) => b.studentProfileId === c.studentProfileId),
  );

  const tasks = listed.length
    ? await prisma.studyTask.findMany({
        where: {
          conversationId: { in: listed.map((c) => c.id) },
          day: { gte: dayToDate(monday), lte: dayToDate(addDays(monday, 6)) },
        },
        select: { conversationId: true, day: true, completedAt: true, quantity: true, unit: true },
      })
    : [];

  const students: CoachWeekStudent[] = listed
    .map((c) => {
      const own = tasks.filter((t) => t.conversationId === c.id);
      const questions = own.filter((t) => t.unit === 'SORU');
      return {
        conversationId: c.id,
        studentName: c.student.user.name ?? STUDENT_FALLBACK,
        active: activeIds.has(c.studentProfileId),
        tasksTotal: own.length,
        tasksDone: own.filter((t) => t.completedAt).length,
        questionsPlanned: questions.reduce((n, t) => n + (t.quantity ?? 0), 0),
        questionsDone: questions.filter((t) => t.completedAt).reduce((n, t) => n + (t.quantity ?? 0), 0),
        days: days.map((day) => {
          const onDay = own.filter((t) => dateToDay(t.day) === day);
          return { day, total: onDay.length, done: onDay.filter((t) => t.completedAt).length };
        }),
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.studentName.localeCompare(b.studentName, 'tr'));

  return { monday, meetings, invites: pendingInvites, students };
}
