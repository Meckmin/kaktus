import { z } from 'zod';
import { isValidTckn } from '@/lib/coach/identifiers';

/**
 * Who is paying, as Iyzico requires it on every checkout.
 *
 * Collected on the payment screen and passed straight through to the provider —
 * never written to our database (Payment.rawRequest only keeps basket items).
 * Labelled as "the person paying", not "the student": most students are minors,
 * and a parent paying under their own identity is the expected case.
 *
 * No node imports: the payment form validates with this same schema before it
 * calls the server, so errors show per field instead of as one generic message.
 */

/** "0555 111 22 33", "5551112233", "+90 555…" → "+905551112233"; anything else → null. */
export function normalizeTrMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const national = digits.startsWith('90') ? digits.slice(2) : digits.startsWith('0') ? digits.slice(1) : digits;
  return /^5\d{9}$/.test(national) ? `+90${national}` : null;
}

export const buyerDetailsSchema = z.object({
  name: z.string().trim().min(2, 'Adını yaz').max(60),
  surname: z.string().trim().min(2, 'Soyadını yaz').max(60),
  identityNumber: z
    .string()
    .trim()
    .refine(isValidTckn, 'TC kimlik numarası geçersiz görünüyor'),
  gsmNumber: z
    .string()
    .trim()
    .refine((v) => normalizeTrMobile(v) !== null, 'Cep telefonunu 05XX XXX XX XX biçiminde yaz')
    .transform((v) => normalizeTrMobile(v)!),
  city: z.string().trim().min(2, 'Şehir gerekli').max(60),
  address: z.string().trim().min(10, 'Açık adresini yaz').max(300),
});

export type BuyerDetailsInput = z.input<typeof buyerDetailsSchema>;
export type BuyerDetails = z.output<typeof buyerDetailsSchema>;
