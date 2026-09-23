/**
 * Turkish identifier validation.
 *
 * Deliberately in its own module with NO node imports, because both the
 * browser form and the server action need it. It previously lived in
 * `crypto/field.ts` alongside the AES helpers — which meant the client form
 * imported `node:crypto` transitively and the browser bundle failed to build.
 *
 * Validating properly rather than checking length is worth the twenty lines: a
 * mistyped IBAN is otherwise not caught until Iyzico rejects the sub-merchant
 * registration days later, by which point the coach is approved, has students,
 * and cannot be paid.
 */

export function isValidTckn(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11 || digits[0] === '0') return false;

  const n = digits.split('').map(Number);
  const oddSum = n[0] + n[2] + n[4] + n[6] + n[8];
  const evenSum = n[1] + n[3] + n[5] + n[7];

  if ((oddSum * 7 - evenSum) % 10 !== n[9]) return false;
  const total = n.slice(0, 10).reduce((a, b) => a + b, 0);
  return total % 10 === n[10];
}

/** VKN (10-digit tax number) checksum. */
export function isValidVkn(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 10) return false;

  const n = digits.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const tmp = (n[i] + 10 - (i + 1)) % 10;
    sum +=
      tmp === 9 ? tmp : (tmp * 2 ** (10 - (i + 1))) % 9 === 0 && tmp !== 0
        ? 9
        : (tmp * 2 ** (10 - (i + 1))) % 9;
  }
  return (10 - (sum % 10)) % 10 === n[9];
}

/** TR IBAN: 26 chars, mod-97 check. */
export function isValidTrIban(value: string): boolean {
  const iban = value.replace(/\s/g, '').toUpperCase();
  if (!/^TR\d{24}$/.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

  // Chunked mod-97: the full number exceeds Number.MAX_SAFE_INTEGER.
  let remainder = 0;
  for (const digit of numeric) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export function ibanLast4(value: string): string {
  return value.replace(/\s/g, '').slice(-4);
}
