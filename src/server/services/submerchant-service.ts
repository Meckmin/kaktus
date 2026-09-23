import { prisma } from '@/lib/db';
import { decryptField } from '@/lib/crypto/field';
import { getPaymentProvider } from '@/lib/payments/provider';

/**
 * Registers a coach's Iyzico sub-merchant account.
 *
 * The application form collects and encrypts payout details long before a
 * coach is approved — a draft application shouldn't have to survive Iyzico
 * being down. This is the other half: the point where that data actually
 * leaves our database, at the moment it's first needed (approval), not before.
 *
 * Idempotent — a coach who is already payable is left untouched, so calling
 * this again after a partial failure (approved, but the provider call failed)
 * is always safe to retry.
 */
export class SubmerchantRegistrationError extends Error {
  constructor(
    readonly code: 'NO_PAYOUT_PROFILE' | 'PROVIDER_REJECTED',
    message: string,
  ) {
    super(message);
    this.name = 'SubmerchantRegistrationError';
  }
}

export async function registerSubmerchant(
  coachProfileId: string,
): Promise<{ submerchantKey: string; alreadyRegistered: boolean }> {
  const coach = await prisma.coachProfile.findUniqueOrThrow({
    where: { id: coachProfileId },
    select: {
      submerchantKey: true,
      user: { select: { email: true } },
      payoutProfile: true,
    },
  });

  if (coach.submerchantKey) {
    return { submerchantKey: coach.submerchantKey, alreadyRegistered: true };
  }

  const payout = coach.payoutProfile;
  if (!payout || !payout.ibanEncrypted || !payout.identityEncrypted || payout.purgedAt) {
    throw new SubmerchantRegistrationError(
      'NO_PAYOUT_PROFILE',
      'Bu koç için ödeme bilgisi bulunamadı. Koçun başvuruyu tamamlaması gerekiyor.',
    );
  }
  if (!coach.user.email) {
    throw new SubmerchantRegistrationError('NO_PAYOUT_PROFILE', 'Koçun e-posta adresi eksik.');
  }

  const provider = getPaymentProvider();

  let result;
  try {
    result = await provider.createSubmerchant({
      coachProfileId,
      externalId: coachProfileId,
      type: payout.submerchantType as 'PERSONAL' | 'PRIVATE_COMPANY' | 'LIMITED_COMPANY',
      name: payout.legalName,
      email: coach.user.email,
      gsmNumber: payout.phone,
      address: `${payout.address}, ${payout.city}`,
      identityNumber: decryptField(payout.identityEncrypted),
      legalCompanyTitle: payout.submerchantType === 'PERSONAL' ? undefined : payout.legalName,
      taxOffice: payout.taxOffice ?? undefined,
      iban: decryptField(payout.ibanEncrypted),
      currency: 'TRY',
    });
  } catch (error) {
    throw new SubmerchantRegistrationError(
      'PROVIDER_REJECTED',
      error instanceof Error ? error.message : String(error),
    );
  }

  await prisma.$transaction([
    prisma.coachProfile.update({
      where: { id: coachProfileId },
      data: { submerchantKey: result.submerchantKey, payoutReadyAt: new Date() },
    }),
    // The source IBAN/identity are no longer needed once Iyzico holds them —
    // see the design note on CoachPayoutProfile. ibanLast4 stays for the admin
    // UI; everything sensitive is cleared.
    prisma.coachPayoutProfile.update({
      where: { coachProfileId },
      data: { ibanEncrypted: null, identityEncrypted: null, purgedAt: new Date() },
    }),
  ]);

  return { submerchantKey: result.submerchantKey, alreadyRegistered: false };
}
