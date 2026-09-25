import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { emailHtml, sendEmail } from '@/lib/email';
import { isExclusionViolation } from '@/lib/booking/holds';
import { inviteTimeProblem } from '@/lib/meetings/rules';

/**
 * Meeting invites: the coach proposes a time, the student accepts or declines.
 *
 * An invite either moves an existing session (bookingId set — e.g. the
 * student can't make Tuesday) or adds an extra, unbilled one (bookingId null).
 * Accepting writes the Booking, so the database's booking_no_overlap
 * constraint is still what prevents a coach being double-booked.
 *
 * Moving a session does not touch money: its milestone stays the same, and
 * the milestone can only be marked done once the (moved) session has ended.
 */

export class InviteError extends Error {
  constructor(
    readonly userMessage: string,
    readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'WRONG_STATE' | 'INVALID' | 'SLOT_TAKEN',
  ) {
    super(userMessage);
    this.name = 'InviteError';
  }
}

const PARTIES = {
  id: true,
  status: true,
  coachProfileId: true,
  studentProfileId: true,
  coach: { select: { userId: true, user: { select: { name: true, email: true } } } },
  student: { select: { userId: true, user: { select: { name: true, email: true } } } },
  offer: { select: { conversationId: true } },
} as const;

const formatWhen = (date: Date) =>
  new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

async function notify(to: string | null, subject: string, body: string, conversationId: string) {
  if (!to) return;
  const url = `${env.APP_URL}/panel/sohbet/${conversationId}`;
  await sendEmail({ to, subject, text: `${body}\n\n${url}`, html: emailHtml(subject, body, url, 'Görüşmelere git') });
}

export async function createInvite(
  args: {
    actorUserId: string;
    engagementId: string;
    bookingId?: string | null;
    startsAt: Date;
    durationMinutes: number;
    message?: string | null;
  },
  now: Date = new Date(),
) {
  const engagement = await prisma.engagement.findUnique({ where: { id: args.engagementId }, select: PARTIES });
  if (!engagement) throw new InviteError('Program bulunamadı.', 'NOT_FOUND');
  if (engagement.coach.userId !== args.actorUserId) {
    throw new InviteError('Görüşme davetini yalnızca koç gönderebilir.', 'FORBIDDEN');
  }
  if (engagement.status !== 'ACTIVE') {
    throw new InviteError('Yalnızca devam eden programlar için görüşme planlanabilir.', 'WRONG_STATE');
  }

  const problem = inviteTimeProblem(args.startsAt, args.durationMinutes, now);
  if (problem) throw new InviteError(problem, 'INVALID');

  if (args.bookingId) {
    const booking = await prisma.booking.findUnique({
      where: { id: args.bookingId },
      select: { engagementId: true, status: true, startsAt: true },
    });
    if (!booking || booking.engagementId !== engagement.id) {
      throw new InviteError('Görüşme bulunamadı.', 'NOT_FOUND');
    }
    if (booking.status !== 'SCHEDULED' || booking.startsAt <= now) {
      throw new InviteError('Başlamış ya da geçmiş bir görüşmenin saati değiştirilemez.', 'WRONG_STATE');
    }
  }

  const endsAt = new Date(args.startsAt.getTime() + args.durationMinutes * 60_000);
  const invite = await prisma.$transaction(async (tx) => {
    // A newer proposal for the same session replaces the older one.
    if (args.bookingId) {
      await tx.meetingInvite.updateMany({
        where: { bookingId: args.bookingId, status: 'PENDING' },
        data: { status: 'CANCELLED', respondedAt: now },
      });
    }
    return tx.meetingInvite.create({
      data: {
        engagementId: engagement.id,
        bookingId: args.bookingId ?? null,
        startsAt: args.startsAt,
        endsAt,
        message: args.message?.trim() || null,
        createdById: args.actorUserId,
      },
    });
  });

  const coachName = engagement.coach.user.name ?? 'Koçun';
  await notify(
    engagement.student.user.email,
    'Yeni görüşme daveti',
    `${coachName} seni ${formatWhen(args.startsAt)} için ${args.durationMinutes} dakikalık bir görüşmeye davet etti. Uygunsan panelden daveti kabul et.`,
    engagement.offer.conversationId,
  );

  return invite;
}

export async function respondToInvite(
  args: { actorUserId: string; inviteId: string; accept: boolean },
  now: Date = new Date(),
) {
  const invite = await prisma.meetingInvite.findUnique({
    where: { id: args.inviteId },
    include: { engagement: { select: PARTIES } },
  });
  if (!invite) throw new InviteError('Davet bulunamadı.', 'NOT_FOUND');
  const { engagement } = invite;
  if (engagement.student.userId !== args.actorUserId) {
    throw new InviteError('Bu daveti yalnızca öğrenci yanıtlayabilir.', 'FORBIDDEN');
  }
  if (invite.status !== 'PENDING') {
    throw new InviteError('Bu davet artık geçerli değil.', 'WRONG_STATE');
  }
  if (invite.startsAt <= now) {
    await prisma.meetingInvite.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } });
    throw new InviteError('Bu davetin saati geçti.', 'WRONG_STATE');
  }

  if (!args.accept) {
    await prisma.meetingInvite.update({
      where: { id: invite.id },
      data: { status: 'DECLINED', respondedAt: now },
    });
    await notify(
      engagement.coach.user.email,
      'Görüşme daveti reddedildi',
      `${formatWhen(invite.startsAt)} için gönderdiğin görüşme daveti reddedildi. Öğrencine mesaj atıp başka bir saat önerebilirsin.`,
      engagement.offer.conversationId,
    );
    return { status: 'DECLINED' as const };
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (invite.bookingId) {
        const moved = await tx.booking.updateMany({
          where: { id: invite.bookingId, status: 'SCHEDULED' },
          // The old Daily room was created for the old time window.
          data: { startsAt: invite.startsAt, endsAt: invite.endsAt, videoRoomName: null },
        });
        if (moved.count === 0) throw new InviteError('Bu görüşme artık taşınamaz.', 'WRONG_STATE');
      } else {
        await tx.booking.create({
          data: {
            coachProfileId: engagement.coachProfileId,
            studentProfileId: engagement.studentProfileId,
            engagementId: engagement.id,
            startsAt: invite.startsAt,
            endsAt: invite.endsAt,
            status: 'SCHEDULED',
          },
        });
      }
      await tx.meetingInvite.update({
        where: { id: invite.id },
        data: { status: 'ACCEPTED', respondedAt: now },
      });
    });
  } catch (error) {
    if (error instanceof InviteError) throw error;
    if (isExclusionViolation(error)) {
      throw new InviteError(
        'Koçun bu saatte başka bir görüşmesi var. Koçuna mesaj atıp yeni bir saat iste.',
        'SLOT_TAKEN',
      );
    }
    throw error;
  }

  await notify(
    engagement.coach.user.email,
    'Görüşme daveti kabul edildi',
    `${formatWhen(invite.startsAt)} görüşmesi onaylandı. Saati gelince panelden “Görüşmeye gir”e bas.`,
    engagement.offer.conversationId,
  );
  return { status: 'ACCEPTED' as const };
}

export async function cancelInvite(args: { actorUserId: string; inviteId: string }, now: Date = new Date()) {
  const invite = await prisma.meetingInvite.findUnique({
    where: { id: args.inviteId },
    include: { engagement: { select: { coach: { select: { userId: true } } } } },
  });
  if (!invite) throw new InviteError('Davet bulunamadı.', 'NOT_FOUND');
  if (invite.engagement.coach.userId !== args.actorUserId) {
    throw new InviteError('Bu daveti yalnızca gönderen koç geri çekebilir.', 'FORBIDDEN');
  }
  if (invite.status !== 'PENDING') throw new InviteError('Bu davet artık geçerli değil.', 'WRONG_STATE');
  await prisma.meetingInvite.update({ where: { id: invite.id }, data: { status: 'CANCELLED', respondedAt: now } });
}

/** Unanswered invites whose time has come expire. Run by the 5-minute job. */
export async function expireInvites(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.meetingInvite.updateMany({
    where: { status: 'PENDING', startsAt: { lte: now } },
    data: { status: 'EXPIRED' },
  });
  return count;
}
