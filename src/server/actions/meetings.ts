'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { istanbulLocalToDate, isAllowedMeetingUrl } from '@/lib/meetings/rules';
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
