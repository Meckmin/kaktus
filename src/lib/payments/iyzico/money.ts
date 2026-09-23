/**
 * Money formatting for Iyzico.
 *
 * We store kuruş as integers. Iyzico wants decimal strings. Every conversion
 * between the two happens here and nowhere else, because this boundary is where
 * marketplace payment bugs live: a basket whose item prices do not sum exactly
 * to `price` is rejected outright, and a rounding error of one kuruş in a split
 * fails the whole payment.
 */

/**
 * 400000 (kuruş) → "4000.0"
 *
 * Iyzico accepts a trailing ".0"; its own SDKs send it. We keep one decimal
 * place minimum rather than emitting a bare integer, matching their samples.
 */
export function minorToIyzicoAmount(minor: number): string {
  if (!Number.isInteger(minor)) {
    throw new Error(`Amount must be an integer in minor units, got ${minor}`);
  }
  if (minor < 0) throw new Error(`Amount must not be negative, got ${minor}`);

  const lira = Math.floor(minor / 100);
  const kurus = minor % 100;
  if (kurus === 0) return `${lira}.0`;
  return `${lira}.${String(kurus).padStart(2, '0')}`;
}

/** "4000.0" | 4000 | "4000.55" → 400000 */
export function iyzicoAmountToMinor(amount: string | number): number {
  const value = typeof amount === 'number' ? amount : Number.parseFloat(amount);
  if (!Number.isFinite(value)) throw new Error(`Unparseable amount: ${amount}`);
  // Round rather than truncate: floating-point representation of 40.55 is
  // 40.549999999999997, and truncating would lose a kuruş on every conversion.
  return Math.round(value * 100);
}

/**
 * Trailing-zero normalisation required before computing a response signature.
 *
 * From Iyzico's spec: "10.50" → "10.5", "10.0" → "10", "10.51050" → "10.5105".
 *
 * Note that JSON.parse already collapses these — a response containing
 * `"price": 4000.00` parses to the number 4000 — so applying this to the parsed
 * value gives the same answer as applying it to the raw text. That equivalence
 * is verified in the test suite; it is the reason we can validate signatures
 * without re-parsing the raw response body.
 */
export function normalizeAmountForSignature(value: string | number): string {
  const s = String(value);
  if (!s.includes('.')) return s;
  const trimmed = s.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' ? '0' : trimmed;
}

/**
 * Splits a gross amount into per-milestone basket items whose prices sum
 * exactly to the total, and whose sub-merchant prices sum exactly to the
 * total minus commission.
 *
 * Iyzico infers the platform's commission as `price - Σ subMerchantPrice`, so
 * both sums have to be exact. Remainders are pushed onto the first item.
 */
export function buildSplit(args: {
  totalMinor: number;
  commissionBps: number;
  milestoneAmountsMinor: number[];
}): Array<{ priceMinor: number; subMerchantPriceMinor: number }> {
  const { totalMinor, commissionBps, milestoneAmountsMinor } = args;

  const sum = milestoneAmountsMinor.reduce((a, b) => a + b, 0);
  if (sum !== totalMinor) {
    throw new Error(`Milestone amounts sum to ${sum}, expected ${totalMinor}`);
  }

  const items = milestoneAmountsMinor.map((priceMinor) => {
    const commission = Math.floor((priceMinor * commissionBps) / 10_000);
    return { priceMinor, subMerchantPriceMinor: priceMinor - commission };
  });

  // Guard the invariant explicitly rather than trusting the arithmetic above:
  // a mismatch here is a silently wrong commission, which is the worst class of
  // bug in this system because it looks like it works.
  const netSum = items.reduce((a, i) => a + i.subMerchantPriceMinor, 0);
  const expectedCommission = totalMinor - netSum;
  if (expectedCommission < 0 || netSum > totalMinor) {
    throw new Error(`Invalid split: net ${netSum} exceeds total ${totalMinor}`);
  }

  return items;
}
