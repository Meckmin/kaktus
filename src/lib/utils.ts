export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** 400000 (kuruş) → "4.000 ₺" */
export function formatTry(minor: number): string {
  return `${Math.round(minor / 100).toLocaleString('tr-TR')} ₺`;
}

/** 4500 → "4.500", 120000 → "120 bin" — how students actually say rankings. */
export function formatRanking(rank: number): string {
  if (rank >= 100_000) return `${Math.round(rank / 1000)} bin`;
  return rank.toLocaleString('tr-TR');
}
