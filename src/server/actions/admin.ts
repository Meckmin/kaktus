'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { resolveDispute } from '@/server/services/dispute-service';
import { getDocumentUrl } from '@/lib/storage/private-storage';
import { registerSubmerchant, SubmerchantRegistrationError } from '@/server/services/submerchant-service';

/**
 * Admin actions.
 *
 * Every one of these is gated by `requireAdmin`, which throws rather than
 * returning a flag — an admin check that can be accidentally ignored by not
 * reading the return value is not a check.
 *
 * These are deliberately thin. For the first dozen coaches you will verify
 * documents by eye and resolve disputes by talking to people; the tooling
 * exists to record the decision and move the money, not to make the decision
 * for you. What the tools should eventually automate will be obvious after
 * doing it manually twenty times, and not before.
 */

export type AdminResult = { ok: true } | { ok: false; message: string };

const reviewSchema = z.object({
  coachProfileId: z.string().min(1),
  note: z.string().max(1000).optional(),
});

/**
 * Approves a coach and makes them discoverable.
 *
 * Also flips their documents to APPROVED, so the verification queue empties as
 * decisions are made rather than accumulating rows nobody looks at again.
 */
export async function approveCoach(input: { coachProfileId: string; note?: string }): Promise<AdminResult> {
  const admin = await requireAdmin();
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Geçersiz istek.' };

  await prisma.$transaction(async (tx) => {
    const coach = await tx.coachProfile.update({
      where: { id: parsed.data.coachProfileId },
      data: {
        verificationStatus: 'APPROVED',
        verifiedAt: new Date(),
        verificationNote: parsed.data.note ?? null,
        // Submission parks this at false until a human approves (see
        // submitCoachApplication); approval is the moment it opens. Without
        // this, every newly approved coach stayed invisible to matching.
        acceptingStudents: true,
      },
      select: { userId: true },
    });

    await tx.verificationDocument.updateMany({
      where: { coachProfileId: parsed.data.coachProfileId, status: { in: ['PENDING', 'IN_REVIEW'] } },
      data: { status: 'APPROVED', reviewedById: admin.id, reviewedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        actorId: admin.id,
        actorRole: 'ADMIN',
        action: 'coach.approved',
        entityType: 'CoachProfile',
        entityId: parsed.data.coachProfileId,
        metadata: { note: parsed.data.note ?? null },
      },
    });

    void coach;
  });

  // Outside the approval transaction: this is a network call to Iyzico (or the
  // mock), and a provider hiccup must not roll back a decision the admin has
  // already made. A coach who is APPROVED but not yet payable is a recoverable,
  // visible state (payoutReadyAt stays null); re-running approval later retries
  // it, since registerSubmerchant is idempotent.
  try {
    await registerSubmerchant(parsed.data.coachProfileId);
  } catch (error) {
    const message = error instanceof SubmerchantRegistrationError ? error.message : String(error);
    console.error('[admin] submerchant registration failed', {
      coachProfileId: parsed.data.coachProfileId,
      error,
    });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        actorRole: 'ADMIN',
        action: 'coach.submerchant_registration_failed',
        entityType: 'CoachProfile',
        entityId: parsed.data.coachProfileId,
        metadata: { message },
      },
    });
  }

  revalidatePath('/admin');
  revalidatePath('/koc-ol');
  return { ok: true };
}

/**
 * Rejects an application.
 *
 * The note is required, not optional. A rejection without a reason produces a
 * support ticket and a confused person; most rejections here are an unreadable
 * document, which is entirely fixable if we say so.
 */
export async function rejectCoach(input: { coachProfileId: string; note: string }): Promise<AdminResult> {
  const admin = await requireAdmin();
  if (!input.note || input.note.trim().length < 10) {
    return { ok: false, message: 'Gerekçe yaz — koç bunu görecek ve düzeltebilmeli.' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.coachProfile.update({
      where: { id: input.coachProfileId },
      data: { verificationStatus: 'REJECTED', verificationNote: input.note.trim() },
    });
    await tx.verificationDocument.updateMany({
      where: { coachProfileId: input.coachProfileId, status: { in: ['PENDING', 'IN_REVIEW'] } },
      data: { status: 'REJECTED', reviewedById: admin.id, reviewedAt: new Date(), reviewNote: input.note.trim() },
    });
    await tx.auditLog.create({
      data: {
        actorId: admin.id,
        actorRole: 'ADMIN',
        action: 'coach.rejected',
        entityType: 'CoachProfile',
        entityId: input.coachProfileId,
        metadata: { note: input.note.trim() },
      },
    });
  });

  revalidatePath('/admin');
  return { ok: true };
}

/** Suspends an approved coach. Existing engagements are untouched. */
export async function suspendCoach(input: { coachProfileId: string; note: string }): Promise<AdminResult> {
  const admin = await requireAdmin();
  if (!input.note?.trim()) return { ok: false, message: 'Gerekçe gerekli.' };

  await prisma.coachProfile.update({
    where: { id: input.coachProfileId },
    data: {
      verificationStatus: 'SUSPENDED',
      suspendedAt: new Date(),
      acceptingStudents: false,
      verificationNote: input.note.trim(),
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      actorRole: 'ADMIN',
      action: 'coach.suspended',
      entityType: 'CoachProfile',
      entityId: input.coachProfileId,
      metadata: { note: input.note.trim() },
    },
  });

  revalidatePath('/admin');
  return { ok: true };
}

/**
 * Short-lived link to a verification document. Admin only, never public.
 *
 * Its own result type rather than reusing `AdminResult`: unioning a success
 * shape that carries a URL with one that does not means callers cannot narrow
 * on `ok` alone, and the compiler rejects reading `message` off the failure
 * branch. Two different results deserve two different types.
 */
export type ViewDocumentResult =
  | { ok: true; url: string }
  | { ok: false; message: string };

export async function viewDocument(documentId: string): Promise<ViewDocumentResult> {
  await requireAdmin();
  const document = await prisma.verificationDocument.findUnique({
    where: { id: documentId },
    select: { storageKey: true },
  });
  if (!document) return { ok: false, message: 'Belge bulunamadı.' };

  try {
    const url = await getDocumentUrl(document.storageKey);
    return { ok: true, url };
  } catch (error) {
    console.error('[admin] could not sign document url', error);
    return { ok: false, message: 'Belge bağlantısı oluşturulamadı.' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Disputes
// ─────────────────────────────────────────────────────────────────────────────

const resolutionSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('RELEASE'), note: z.string().min(5).max(1000) }),
  z.object({ outcome: z.literal('REFUND'), note: z.string().min(5).max(1000) }),
  z.object({
    outcome: z.literal('SPLIT'),
    note: z.string().min(5).max(1000),
    coachShareMinor: z.number().int().min(0),
  }),
]);

/**
 * Records a dispute decision and moves the money.
 *
 * The actual accounting lives in the dispute service, which is the only thing
 * allowed to touch the ledger. This is a thin wrapper that checks the admin
 * role and validates the shape — deliberately, so there is exactly one code
 * path that can reverse a payment.
 */
export async function resolveDisputeAction(input: {
  disputeId: string;
  outcome: 'RELEASE' | 'REFUND' | 'SPLIT';
  note: string;
  coachShareMinor?: number;
}): Promise<AdminResult> {
  const admin = await requireAdmin();
  const parsed = resolutionSchema.safeParse(
    input.outcome === 'SPLIT'
      ? { outcome: 'SPLIT', note: input.note, coachShareMinor: input.coachShareMinor ?? 0 }
      : { outcome: input.outcome, note: input.note },
  );
  if (!parsed.success) {
    return { ok: false, message: 'Karar gerekçesi en az 5 karakter olmalı.' };
  }

  try {
    await resolveDispute({
      disputeId: input.disputeId,
      adminUserId: admin.id,
      resolution: parsed.data,
    });
    revalidatePath('/admin/itirazlar');
    return { ok: true };
  } catch (error) {
    console.error('[admin] dispute resolution failed', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Karar uygulanamadı.',
    };
  }
}
