'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { istanbulLocalToDate, isAllowedMeetingUrl, joinState, joinWindow } from '@/lib/meetings/rules';
import { createMeetingToken, dailyConfigured, roomNameForBooking, roomPresence, upsertRoom } from '@/lib/meetings/daily';
import {
  InviteError,
  cancelInvite,
  createInvite,
  respondToInvite,
} from '@/server/services/meeting-invite-service';

/**
 * Meeting invites and fallback links, as callable server actions.
 * Every rule lives in the service; this layer authenticates and translates
 * errors into messages the UI can show.
 */

export type MeetingActionResult = { ok: true } | { ok: false; message: string };

async function viewer(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

async function conversationPathForEngagement(engagementId: string): Promise<string | null> {
  const engagement = await prisma.engagement.findUnique({
    where: { id: engagementId },
    select: { offer: { select: { conversationId: true } } },
  });
  return engagement ? `/panel/sohbet/${engagement.offer.conversationId}` : null;
}

function failure(error: unknown, fallback: string): MeetingActionResult {
  if (error instanceof InviteError) return { ok: false, message: error.userMessage };
  console.error('[meetings]', error);
  return { ok: false, message: fallback };
}

export async function sendMeetingInvite(input: {
  engagementId: string;
  bookingId?: string | null;
  /** "YYYY-MM-DDTHH:mm", Istanbul time. */
  startsAtLocal: string;
  durationMinutes: number;
  message?: string;
}): Promise<MeetingActionResult> {
  const userId = await viewer();
  if (!userId) return { ok: false, message: 'Önce giriş yapman gerekiyor.' };
  const startsAt = istanbulLocalToDate(input.startsAtLocal);
  if (!startsAt) return { ok: false, message: 'Geçerli bir tarih ve saat seç.' };

  try {
    await createInvite({
      actorUserId: userId,
      engagementId: input.engagementId,
      bookingId: input.bookingId ?? null,
      startsAt,
      durationMinutes: input.durationMinutes,
      message: input.message?.slice(0, 500),
    });
  } catch (error) {
    return failure(error, 'Davet gönderilemedi.');
  }
  const path = await conversationPathForEngagement(input.engagementId);
  if (path) revalidatePath(path);
  return { ok: true };
}

export async function answerMeetingInvite(inviteId: string, accept: boolean): Promise<MeetingActionResult> {
  const userId = await viewer();
  if (!userId) return { ok: false, message: 'Önce giriş yapman gerekiyor.' };
  try {
    await respondToInvite({ actorUserId: userId, inviteId, accept });
  } catch (error) {
    return failure(error, 'Davet yanıtlanamadı.');
  }
  return { ok: true };
}

export async function withdrawMeetingInvite(inviteId: string): Promise<MeetingActionResult> {
  const userId = await viewer();
  if (!userId) return { ok: false, message: 'Önce giriş yapman gerekiyor.' };
  try {
    await cancelInvite({ actorUserId: userId, inviteId });
  } catch (error) {
    return failure(error, 'Davet geri çekilemedi.');
  }
  return { ok: true };
}

/** Coach sets (or clears) an external Zoom/Meet/Teams link as a fallback. */
export async function setExternalMeetingLink(bookingId: string, url: string): Promise<MeetingActionResult> {
  const userId = await viewer();
  if (!userId) return { ok: false, message: 'Önce giriş yapman gerekiyor.' };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { coach: { select: { userId: true } } },
  });
  if (!booking || booking.coach.userId !== userId) {
    return { ok: false, message: 'Bu görüşmenin bağlantısını yalnızca koç değiştirebilir.' };
  }
  const trimmed = url.trim();
  if (trimmed && !isAllowedMeetingUrl(trimmed)) {
    return { ok: false, message: 'Yalnızca Zoom, Google Meet ya da Teams bağlantısı eklenebilir (https ile).' };
  }
  await prisma.booking.update({ where: { id: bookingId }, data: { meetingUrl: trimmed || null } });
  return { ok: true };
}

export type JoinResult =
  | { ok: true; roomUrl: string; token: string }
  | { ok: false; message: string; fallbackUrl: string | null };

/**
 * "Görüşmeye gir": checks the caller is a party and the window is open, makes
 * sure the session's Daily room exists with the right times, and returns a
 * room URL and a personal, expiring token (kept out of the URL, so it never
 * lands in browser history). When Daily isn't configured or is down, returns
 * the coach's fallback link instead, if there is one.
 */
export async function joinMeeting(bookingId: string): Promise<JoinResult> {
  const userId = await viewer();
  if (!userId) return { ok: false, message: 'Önce giriş yapman gerekiyor.', fallbackUrl: null };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      meetingUrl: true,
      videoRoomName: true,
      coach: { select: { userId: true, user: { select: { name: true } } } },
      student: { select: { userId: true, user: { select: { name: true } } } },
    },
  });
  const isCoach = booking?.coach.userId === userId;
  const isStudent = booking?.student.userId === userId;
  if (!booking || (!isCoach && !isStudent)) {
    return { ok: false, message: 'Görüşme bulunamadı.', fallbackUrl: null };
  }
  const fallbackUrl = booking.meetingUrl;
  if (booking.status !== 'SCHEDULED') {
    return { ok: false, message: 'Bu görüşme iptal edilmiş.', fallbackUrl: null };
  }

  const state = joinState(booking.startsAt, booking.endsAt);
  if (state === 'TOO_EARLY') {
    return { ok: false, message: 'Görüşme odası, görüşme saatinden 10 dakika önce açılır.', fallbackUrl: null };
  }
  if (state === 'ENDED') return { ok: false, message: 'Bu görüşmenin süresi doldu.', fallbackUrl: null };

  if (!dailyConfigured()) {
    return {
      ok: false,
      message: fallbackUrl
        ? 'Uygulama içi görüşme şu an kullanılamıyor; koçunun eklediği bağlantıdan katılabilirsin.'
        : 'Uygulama içi görüşme şu an kullanılamıyor. Koçundan bir Zoom ya da Meet bağlantısı eklemesini iste.',
      fallbackUrl,
    };
  }

  const { opensAt, closesAt } = joinWindow(booking.startsAt, booking.endsAt);
  try {
    const room = await upsertRoom({
      name: booking.videoRoomName ?? roomNameForBooking(booking.id),
      // A little slack either side of the button's own window.
      opensAt: new Date(opensAt.getTime() - 5 * 60_000),
      closesAt: new Date(closesAt.getTime() + 15 * 60_000),
    });
    if (booking.videoRoomName !== room.name) {
      await prisma.booking.update({ where: { id: booking.id }, data: { videoRoomName: room.name } });
    }
    const token = await createMeetingToken({
      roomName: room.name,
      userId,
      userName: (isCoach ? booking.coach.user.name : booking.student.user.name) ?? (isCoach ? 'Koç' : 'Öğrenci'),
      isOwner: isCoach,
      expiresAt: closesAt,
    });
    return { ok: true, roomUrl: room.url, token };
  } catch (error) {
    console.error('[meetings] daily join failed', error);
    return {
      ok: false,
      message: fallbackUrl
        ? 'Görüşme odası açılamadı; koçunun eklediği bağlantıdan katılabilirsin.'
        : 'Görüşme odası açılamadı. Birkaç saniye sonra tekrar dene.',
      fallbackUrl,
    };
  }
}

/**
 * Whether the other person is already in the room — for the waiting screen
 * ("Koçun odada, seni bekliyor"). Quietly false whenever it can't tell.
 */
export async function meetingPresence(bookingId: string): Promise<{ counterpartPresent: boolean }> {
  const none = { counterpartPresent: false };
  const userId = await viewer();
  if (!userId || !dailyConfigured()) return none;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      status: true,
      startsAt: true,
      endsAt: true,
      videoRoomName: true,
      coach: { select: { userId: true } },
      student: { select: { userId: true } },
    },
  });
  if (!booking || booking.status !== 'SCHEDULED' || !booking.videoRoomName) return none;
  const counterpart =
    booking.coach.userId === userId ? booking.student.userId : booking.student.userId === userId ? booking.coach.userId : null;
  if (!counterpart || joinState(booking.startsAt, booking.endsAt) !== 'OPEN') return none;

  try {
    return { counterpartPresent: (await roomPresence(booking.videoRoomName)).includes(counterpart) };
  } catch (error) {
    console.error('[meetings] presence failed', error);
    return none;
  }
}
