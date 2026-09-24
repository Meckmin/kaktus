import { suggestedPriceMinor, type PackageType } from './draft';

/**
 * The lowest price an offer may carry.
 *
 * Two rules. Every offer, from either side, must clear an absolute floor —
 * a 3 ₺ offer is a typo or a joke, never a negotiation, and it still ties up
 * the coach's hours. On top of that, a *student's* offer must be at least half
 * the coach's own list price for that package: below that the coach almost
 * always declines, so accepting it just wastes both sides' time and holds the
 * slots for nothing. Coaches are exempt from the share rule — discounting their
 * own price is their call.
 */
export const ABSOLUTE_MIN_OFFER_MINOR = 10_000; // 100 ₺
export const STUDENT_MIN_SHARE_OF_LIST = 0.5;

type Tier = { cadence: string; priceMinor: number; sessionsPerCycle: number };

export function packageTypeForCadence(cadence: unknown): PackageType {
  return cadence === 'SINGLE_SESSION' ? 'EXPLORATORY' : 'MONTHLY_4W';
}

export function minOfferMinor(args: {
  packageType: PackageType;
  tiers: Tier[];
  role: 'STUDENT' | 'COACH';
}): number {
  if (args.role === 'COACH') return ABSOLUTE_MIN_OFFER_MINOR;
  const list = suggestedPriceMinor(args.packageType, args.tiers);
  if (list == null) return ABSOLUTE_MIN_OFFER_MINOR;
  // Rounded up to a whole 100 ₺ so the number reads like a price, not a formula.
  const share = Math.ceil((list * STUDENT_MIN_SHARE_OF_LIST) / 10_000) * 10_000;
  return Math.max(ABSOLUTE_MIN_OFFER_MINOR, share);
}

export function belowFloorMessage(minMinor: number): string {
  return `En az ${Math.round(minMinor / 100).toLocaleString('tr-TR')} ₺ teklif edebilirsin.`;
}
