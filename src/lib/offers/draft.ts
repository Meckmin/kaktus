/**
 * Draft offers that survive the auth wall.
 *
 * A guest configures a whole offer — package type, four slots, a price they
 * negotiated down in their head — and only then hits the wall. Losing that is
 * losing the sale, and asking them to rebuild it after sign-in is worse than
 * asking for the account up front.
 *
 * So the draft goes into an httpOnly cookie with `sameSite: lax`, which is the
 * one storage that survives the Google OAuth redirect. It is deliberately small
 * and non-sensitive: coach id, package type, ISO slot strings, a price. No
 * personal data, so a stolen cookie is worth nothing.
 *
 * Limitation, stated plainly: a magic link opened in a *different browser* will
 * not carry the cookie. The return URL therefore also encodes the coach slug
 * and package type, so the worst case rebuilds the scope and loses only the
 * slot selection — not the whole offer.
 */

export const OFFER_DRAFT_COOKIE = 'kk_offer_draft';
export const OFFER_DRAFT_TTL_SECONDS = 60 * 60 * 6;

export type PackageType = 'EXPLORATORY' | 'MONTHLY_4W';

export interface OfferDraft {
  coachProfileId: string;
  coachSlug: string;
  packageType: PackageType;
  /** ISO start times, in selection order. */
  slots: string[];
  priceMinor: number;
  note?: string;
  /** Only used when the account has no name yet (magic-link sign-ups). */
  studentName?: string;
  createdAt: string;
}

export const PACKAGE_CONFIG: Record<
  PackageType,
  {
    label: string;
    summary: string;
    sessions: number;
    weeks: number;
    minutesPerSession: number;
    cadence: 'SINGLE_SESSION' | 'MONTHLY_STANDARD';
    milestoneCount: number;
  }
> = {
  EXPLORATORY: {
    label: 'Tanışma seansı',
    summary: 'Tek seans. Anlaşamazsanız devam etme zorunluluğu yok.',
    sessions: 1,
    weeks: 1,
    minutesPerSession: 60,
    cadence: 'SINGLE_SESSION',
    milestoneCount: 1,
  },
  MONTHLY_4W: {
    label: '4 haftalık program',
    summary: 'Haftada bir görüşme, arada mesajlaşma. Ödeme haftalık dilimler hâlinde aktarılır.',
    sessions: 4,
    weeks: 4,
    minutesPerSession: 60,
    cadence: 'MONTHLY_STANDARD',
    milestoneCount: 4,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Pricing
// ─────────────────────────────────────────────────────────────────────────────

export interface PriceBreakdownView {
  totalMinor: number;
  platformFeeMinor: number;
  coachReceivesMinor: number;
  perSessionMinor: number;
  commissionBps: number;
}

/**
 * What the student pays, and where it goes.
 *
 * The student's total is the number they chose; the commission comes out of the
 * coach's side, matching `splitAmount` in the ledger exactly (floor on the
 * commission, remainder to the coach). Showing a fee *added on top* would be a
 * different product and a different price — so this mirrors the accounting
 * rather than reimplementing it.
 */
export function computeBreakdown(totalMinor: number, commissionBps: number): PriceBreakdownView {
  const platformFeeMinor = Math.floor((totalMinor * commissionBps) / 10_000);
  return {
    totalMinor,
    platformFeeMinor,
    coachReceivesMinor: totalMinor - platformFeeMinor,
    perSessionMinor: totalMinor,
    commissionBps,
  };
}

export function suggestedPriceMinor(
  packageType: PackageType,
  tiers: Array<{ cadence: string; priceMinor: number; sessionsPerCycle: number }>,
): number | null {
  const config = PACKAGE_CONFIG[packageType];
  const exact = tiers.find((tier) => tier.cadence === config.cadence);
  if (exact) return exact.priceMinor;

  // No exact tier: derive from the monthly rate rather than showing nothing.
  // An empty price field makes students guess wildly and send offers that get
  // declined, which wastes both sides' time.
  const monthly = tiers.find((tier) => tier.cadence === 'MONTHLY_STANDARD');
  if (!monthly) return null;

  if (packageType === 'EXPLORATORY') {
    const perSession = Math.round(monthly.priceMinor / Math.max(monthly.sessionsPerCycle, 1));
    return Math.round(perSession / 100) * 100;
  }
  return monthly.priceMinor;
}

export function isDraftComplete(draft: Partial<OfferDraft>): draft is OfferDraft {
  const required = draft.packageType ? PACKAGE_CONFIG[draft.packageType].sessions : 0;
  return Boolean(
    draft.coachProfileId &&
      draft.packageType &&
      draft.priceMinor &&
      draft.priceMinor > 0 &&
      draft.slots &&
      draft.slots.length === required,
  );
}
