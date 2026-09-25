import { env } from '@/lib/env';

/**
 * The legal identity behind the site, as the footer and legal texts show it.
 *
 * Read from env (see .env.example → "Legal identity") so the details can be
 * filled in once the company is registered. In production every required field
 * is enforced at boot by lib/env.ts; in development missing values render as a
 * visible "[… eklenecek]" marker instead of silently disappearing.
 */
export interface CompanyInfo {
  title: string;
  address: string;
  taxOffice: string;
  taxNumber: string;
  mersis: string | null;
  email: string;
  phone: string | null;
  kep: string | null;
  etbisUrl: string | null;
  siteUrl: string;
}

const missing = (label: string) => `[${label} eklenecek]`;

export function companyInfo(): CompanyInfo {
  return {
    title: env.COMPANY_TITLE ?? missing('Şirket unvanı'),
    address: env.COMPANY_ADDRESS ?? missing('Adres'),
    taxOffice: env.COMPANY_TAX_OFFICE ?? missing('Vergi dairesi'),
    taxNumber: env.COMPANY_TAX_NUMBER ?? missing('Vergi numarası'),
    mersis: env.COMPANY_MERSIS ?? null,
    email: env.COMPANY_EMAIL ?? missing('E-posta'),
    phone: env.COMPANY_PHONE ?? null,
    kep: env.COMPANY_KEP ?? null,
    etbisUrl: env.ETBIS_URL ?? null,
    siteUrl: env.APP_URL,
  };
}
