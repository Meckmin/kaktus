'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { cellsToRanges, GRID_END_HOUR, GRID_START_HOUR } from '@/lib/availability/grid';

/**
 * Coach availability persistence for `/panel/musaitlik`.
 *
 * Recurring weekly availability is stored as `AvailabilityRule` rows (the whole
 * grid is replaced on every save — it is small and the coach is the only
 * writer). One-off blackout dates are `AvailabilityException` rows.
 */

async function requireCoachProfile() {
  const session = await auth();
  if (!session?.user?.id) throw new Error('UNAUTHENTICATED');
  const coach = await prisma.coachProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, slug: true, timezone: true },
  });
  if (!coach) throw new Error('NOT_A_COACH');
  return coach;
}

export type AvailabilityResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const cellSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  hour: z.number().int().min(GRID_START_HOUR).max(GRID_END_HOUR - 1),
});

const gridSchema = z.array(cellSchema).max(7 * (GRID_END_HOUR - GRID_START_HOUR));

export async function saveRecurringAvailability(
  cells: Array<{ weekday: number; hour: number }>,
): Promise<AvailabilityResult> {
  const parsed = gridSchema.safeParse(cells);
  if (!parsed.success) return { ok: false, message: 'Takvim bilgisi geçersiz.' };

  let coach: Awaited<ReturnType<typeof requireCoachProfile>>;
  try {
    coach = await requireCoachProfile();
  } catch {
    return { ok: false, message: 'Bu işlem için koç hesabın olmalı.' };
  }

  const ranges = cellsToRanges(parsed.data);

  await prisma.$transaction(async (tx) => {
    await tx.availabilityRule.deleteMany({ where: { coachProfileId: coach.id } });
    if (ranges.length > 0) {
      await tx.availabilityRule.createMany({
        data: ranges.map((r) => ({
          coachProfileId: coach.id,
          weekday: r.weekday,
          startMinute: r.startMinute,
          endMinute: r.endMinute,
          timezone: coach.timezone,
          active: true,
        })),
      });
    }
  });

  revalidatePath('/panel/musaitlik');
  revalidatePath(`/koc/${coach.slug}`);
  const hours = ranges.reduce((sum, r) => sum + (r.endMinute - r.startMinute) / 60, 0);
  return { ok: true, message: `Kaydedildi. Haftada ${hours} saatlik uygunluk tanımlı.` };
}

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih GG.AA.YYYY biçiminde olmalı.');

export async function addBlackoutDate(dateISO: string): Promise<AvailabilityResult> {
  const parsed = dateSchema.safeParse(dateISO);
  if (!parsed.success) return { ok: false, message: 'Geçersiz tarih.' };

  const date = new Date(`${parsed.data}T00:00:00.000Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (Number.isNaN(date.getTime()) || date < today) {
    return { ok: false, message: 'Geçmiş bir tarihi kapatamazsın.' };
  }

  let coach: Awaited<ReturnType<typeof requireCoachProfile>>;
  try {
    coach = await requireCoachProfile();
  } catch {
    return { ok: false, message: 'Bu işlem için koç hesabın olmalı.' };
  }

  const existing = await prisma.availabilityException.findFirst({
    where: { coachProfileId: coach.id, date },
    select: { id: true },
  });
  if (existing) return { ok: true, message: 'Bu tarih zaten kapalı.' };

  await prisma.availabilityException.create({
    data: { coachProfileId: coach.id, date, allDay: true, reason: 'Koç kapattı' },
  });

  revalidatePath('/panel/musaitlik');
  revalidatePath(`/koc/${coach.slug}`);
  return { ok: true, message: 'Tarih kapatıldı.' };
}

export async function removeBlackoutDate(exceptionId: string): Promise<AvailabilityResult> {
  if (!z.string().min(1).max(64).safeParse(exceptionId).success) {
    return { ok: false, message: 'Geçersiz kayıt.' };
  }

  let coach: Awaited<ReturnType<typeof requireCoachProfile>>;
  try {
    coach = await requireCoachProfile();
  } catch {
    return { ok: false, message: 'Bu işlem için koç hesabın olmalı.' };
  }

  await prisma.availabilityException.deleteMany({
    where: { id: exceptionId, coachProfileId: coach.id },
  });

  revalidatePath('/panel/musaitlik');
  revalidatePath(`/koc/${coach.slug}`);
  return { ok: true, message: 'Tarih yeniden açıldı.' };
}
