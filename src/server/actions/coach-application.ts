'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { TX_OPTIONS } from '@/lib/tx';
import {
  coachApplicationSchema,
  slugify,
  type CoachApplicationInput,
} from '@/lib/coach/application';
import { encryptField } from '@/lib/crypto/field';
import { ibanLast4, isValidTckn, isValidTrIban, isValidVkn } from '@/lib/coach/identifiers';
import {
  DocumentRejected,
  getPrivateStorage,
  validateDocument,
} from '@/lib/storage/private-storage';

/**
 * Coach application.
 *
 * Unlike the student funnel, this requires an account *before* the form rather
 * than after. Two reasons: the application carries a national ID and an IBAN,
 * which must never sit in a guest cookie the way a draft offer does; and a
 * coach signing up is making a considered decision, so an account is not the
 * friction that loses them.
 */

export type ApplyResult =
  | { ok: true; coachProfileId: string; slug: string }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'ALREADY_APPLIED' | 'VALIDATION' | 'FAILED';
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

/**
 * Creates (or returns) a DRAFT profile so verification documents have something
 * to attach to before the application is complete. A coach uploads their ÖSYM
 * document early and finishes the rest later; without a row to hang it on, the
 * upload would have to be held in memory across steps.
 */
export async function ensureCoachDraft(): Promise<
  { ok: true; coachProfileId: string } | { ok: false; code: 'UNAUTHENTICATED' | 'ALREADY_APPLIED' }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: 'UNAUTHENTICATED' };

  const existing = await prisma.coachProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, verificationStatus: true },
  });

  if (existing) {
    if (existing.verificationStatus !== 'DRAFT') {
      return { ok: false, code: 'ALREADY_APPLIED' };
    }
    return { ok: true, coachProfileId: existing.id };
  }

  const created = await prisma.coachProfile.create({
    data: {
      userId: session.user.id,
      slug: `taslak-${randomBytes(6).toString('hex')}`,
      headline: '',
      bio: '',
      university: '',
      department: '',
      yksRank: 1,
      yksYear: new Date().getFullYear(),
      yksTrack: 'SAYISAL',
      verificationStatus: 'DRAFT',
      acceptingStudents: false,
    },
    select: { id: true },
  });

  return { ok: true, coachProfileId: created.id };
}

export type UploadResult =
  | { ok: true; documentId: string; filename: string; sizeBytes: number }
  | { ok: false; message: string };

/**
 * Stores a verification document in the private bucket.
 *
 * Server Actions cap request bodies at 1 MB by default, which silently breaks
 * on a phone photo of an ÖSYM printout. `next.config.ts` raises it to 8 MB to
 * match `MAX_DOCUMENT_BYTES`.
 */
export async function uploadVerificationDocument(formData: FormData): Promise<UploadResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: 'Önce giriş yapman gerekiyor.' };

  const file = formData.get('file');
  const type = String(formData.get('type') ?? 'YKS_RESULT');
  if (!(file instanceof File)) return { ok: false, message: 'Dosya bulunamadı.' };

  const draft = await ensureCoachDraft();
  if (!draft.ok) {
    return {
      ok: false,
      message:
        draft.code === 'ALREADY_APPLIED'
          ? 'Başvurun zaten inceleniyor.'
          : 'Önce giriş yapman gerekiyor.',
    };
  }

  try {
    const body = Buffer.from(await file.arrayBuffer());
    validateDocument({ size: file.size, type: file.type }, body);

    const stored = await getPrivateStorage().put({
      prefix: `verification/${draft.coachProfileId}`,
      filename: file.name,
      contentType: file.type,
      body,
    });

    const document = await prisma.verificationDocument.create({
      data: {
        coachProfileId: draft.coachProfileId,
        type: type as never,
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        status: 'PENDING',
      },
      select: { id: true },
    });

    return {
      ok: true,
      documentId: document.id,
      filename: file.name,
      sizeBytes: stored.sizeBytes,
    };
  } catch (error) {
    if (error instanceof DocumentRejected) return { ok: false, message: error.message };
    console.error('[coach-apply] upload failed', error);
    return { ok: false, message: 'Dosya yüklenemedi. Tekrar dene.' };
  }
}

/**
 * Submits the application.
 *
 * Everything lands in one transaction: the profile, its pricing tiers, its
 * availability rules, the specialization, and the encrypted payout details. A
 * partial application would appear in the admin queue looking complete while
 * being unpayable, which is exactly the kind of half-state that wastes a
 * reviewer's afternoon.
 */
export async function submitCoachApplication(
  input: CoachApplicationInput,
): Promise<ApplyResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Önce giriş yapman gerekiyor.' };
  }

  const parsed = coachApplicationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'Bazı alanlar eksik ya da hatalı.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const data = parsed.data;

  // Identity and bank checks run server-side too. The client validates the same
  // rules for fast feedback, but a malformed IBAN reaching Iyzico produces an
  // opaque rejection days later, so this is the copy that counts.
  const identityValid =
    data.submerchantType === 'PERSONAL'
      ? isValidTckn(data.identityNumber)
      : isValidVkn(data.identityNumber);
  if (!identityValid) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'Kimlik/vergi numarası doğrulanamadı.',
      fieldErrors: { identityNumber: ['Numara geçersiz görünüyor.'] },
    };
  }
  if (!isValidTrIban(data.iban)) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'IBAN doğrulanamadı.',
      fieldErrors: { iban: ['TR ile başlayan 26 haneli bir IBAN gir.'] },
    };
  }

  const existing = await prisma.coachProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, verificationStatus: true },
  });
  if (existing && existing.verificationStatus !== 'DRAFT') {
    return {
      ok: false,
      code: 'ALREADY_APPLIED',
      message: 'Başvurun zaten alındı. Sonucu e-posta ile bildireceğiz.',
    };
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { name: true },
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const slug = await uniqueSlug(tx, user.name ?? data.legalName);

      const coach = existing
        ? await tx.coachProfile.update({
            where: { id: existing.id },
            data: profileFields(data, slug),
            select: { id: true, slug: true },
          })
        : await tx.coachProfile.create({
            data: { userId: session.user.id!, ...profileFields(data, slug) },
            select: { id: true, slug: true },
          });

      // Replace rather than merge: resubmitting a draft must not leave stale
      // prices or availability windows from an earlier attempt.
      await tx.pricingTier.deleteMany({ where: { coachProfileId: coach.id } });
      await tx.availabilityRule.deleteMany({ where: { coachProfileId: coach.id } });
      await tx.coachSpecialization.deleteMany({ where: { coachProfileId: coach.id } });

      await tx.pricingTier.create({
        data: {
          coachProfileId: coach.id,
          name: 'Aylık program',
          cadence: 'MONTHLY_STANDARD',
          priceMinor: data.monthlyPriceMinor,
          sessionsPerCycle: data.sessionsPerMonth,
          minutesPerSession: data.minutesPerSession,
          sortOrder: 0,
        },
      });

      if (data.sessionPriceMinor) {
        await tx.pricingTier.create({
          data: {
            coachProfileId: coach.id,
            name: 'Tanışma seansı',
            cadence: 'SINGLE_SESSION',
            priceMinor: data.sessionPriceMinor,
            sessionsPerCycle: 1,
            minutesPerSession: data.minutesPerSession,
            sortOrder: 1,
          },
        });
      }

      await tx.availabilityRule.createMany({
        data: data.availability.map((window) => ({
          coachProfileId: coach.id,
          weekday: window.weekday,
          startMinute: window.startMinute,
          endMinute: window.endMinute,
          active: true,
        })),
      });

      if (data.specializationLabel) {
        await tx.coachSpecialization.create({
          data: {
            coachProfileId: coach.id,
            label: data.specializationLabel,
            slug: slugify(data.specializationLabel) || 'uzmanlik',
            fromRank: data.targetRankFrom ?? null,
            toRank: data.targetRankTo ?? null,
          },
        });
      }

      await tx.coachPayoutProfile.upsert({
        where: { coachProfileId: coach.id },
        create: {
          coachProfileId: coach.id,
          submerchantType: data.submerchantType,
          legalName: data.legalName,
          ibanEncrypted: encryptField(data.iban.replace(/\s/g, '').toUpperCase()),
          ibanLast4: ibanLast4(data.iban),
          identityEncrypted: encryptField(data.identityNumber.replace(/\D/g, '')),
          taxOffice: data.taxOffice ?? null,
          address: data.address,
          city: data.city,
          phone: data.phone,
        },
        update: {
          submerchantType: data.submerchantType,
          legalName: data.legalName,
          ibanEncrypted: encryptField(data.iban.replace(/\s/g, '').toUpperCase()),
          ibanLast4: ibanLast4(data.iban),
          identityEncrypted: encryptField(data.identityNumber.replace(/\D/g, '')),
          taxOffice: data.taxOffice ?? null,
          address: data.address,
          city: data.city,
          phone: data.phone,
        },
      });

      await tx.user.update({
        where: { id: session.user.id! },
        data: { roles: { set: ['STUDENT', 'COACH'] } },
      });

      await tx.auditLog.create({
        data: {
          actorId: session.user.id,
          actorRole: 'COACH',
          action: 'coach.applied',
          entityType: 'CoachProfile',
          entityId: coach.id,
          // Deliberately no payout fields in the audit metadata: an audit log is
          // widely readable and must not become a second copy of the IBAN.
          metadata: { slug: coach.slug, submerchantType: data.submerchantType },
        },
      });

      return coach;
    }, TX_OPTIONS);

    revalidatePath('/koc-ol');
    return { ok: true, coachProfileId: result.id, slug: result.slug };
  } catch (error) {
    console.error('[coach-apply] submit failed', error);
    return { ok: false, code: 'FAILED', message: 'Başvuru kaydedilemedi. Tekrar dene.' };
  }
}

function profileFields(
  data: Awaited<ReturnType<typeof coachApplicationSchema.parse>>,
  slug: string,
) {
  return {
    slug,
    headline: data.headline,
    bio: data.bio,
    university: data.university,
    department: data.department,
    graduationYear: data.graduationYear ?? null,
    yksRank: data.yksRank,
    yksYear: data.yksYear,
    yksTrack: data.yksTrack,
    ownBaselineTytNet: data.ownBaselineTytNet ?? null,
    ownFinalTytNet: data.ownFinalTytNet ?? null,
    ownBaselineAytNet: data.ownBaselineAytNet ?? null,
    ownFinalAytNet: data.ownFinalAytNet ?? null,
    wasMezun: data.wasMezun,
    tracks: data.tracks,
    subjects: data.subjects,
    styles: data.styles,
    supportedGrades: data.supportedGrades,
    maxActiveStudents: data.maxActiveStudents,
    weeklyCapacityHours: data.weeklyCapacityHours ?? null,
    city: data.city,
    // PENDING is the enum's name for what the brief calls PENDING_VERIFICATION.
    verificationStatus: 'PENDING' as const,
    // Not accepting students until a human approves. The discovery query filters
    // on APPROVED anyway, but leaving this true would make an unreviewed coach
    // one enum change away from being live.
    acceptingStudents: false,
  };
}

/** Appends a short suffix on collision rather than failing the submission. */
async function uniqueSlug(tx: Prisma.TransactionClient, name: string): Promise<string> {
  const base = slugify(name) || 'koc';
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
    const taken = await tx.coachProfile.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return `${base}-${randomBytes(4).toString('hex')}`;
}

/** Status for the landing/success screen. */
export async function getApplicationStatus() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return prisma.coachProfile.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      slug: true,
      verificationStatus: true,
      verificationNote: true,
      createdAt: true,
      documents: { select: { id: true, type: true, status: true } },
    },
  });
}
