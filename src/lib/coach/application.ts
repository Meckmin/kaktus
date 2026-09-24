import { z } from 'zod';

/**
 * Coach application: shared shape for the client form and the server action.
 *
 * No server-only imports here — this module is bundled to the browser so the
 * form can validate before submitting. The server re-validates with the same
 * schema, because client-side validation is a courtesy and never a control.
 */

export const APPLY_STEPS = ['kimlik', 'yontem', 'ucret', 'takvim', 'odeme'] as const;
export type ApplyStep = (typeof APPLY_STEPS)[number];

export const APPLY_STEP_TITLES: Record<ApplyStep, string> = {
  kimlik: 'Sınav geçmişin ve okulun',
  yontem: 'Nasıl çalışıyorsun?',
  ucret: 'Ücretlendirme ve kapasite',
  takvim: 'Haftalık müsaitliğin',
  odeme: 'Ödeme bilgilerin',
};

export const APPLY_STEP_HINTS: Record<ApplyStep, string> = {
  kimlik: 'Sıralaman doğrulanmadan profilin yayına alınmıyor.',
  yontem: 'Öğrenciler en çok bu bölümü okuyup karar veriyor.',
  ucret: 'Sonradan değiştirebilirsin. Öğrenciler yine de kendi teklifini gönderebilir.',
  takvim: '',
  odeme: 'Bu bilgiler yalnızca ödeme kuruluşuna iletilir; öğrenciler görmez.',
};

const trackEnum = z.enum(['SAYISAL', 'ESIT_AGIRLIK', 'SOZEL', 'DIL']);
const styleEnum = z.enum(['STRICT', 'EMPATHETIC', 'STRATEGIC', 'HIGH_TOUCH']);
const gradeEnum = z.enum(['GRADE_11', 'GRADE_12', 'MEZUN']);

export const weeklyWindowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1440),
  endMinute: z.number().int().min(0).max(1440),
});

export const coachApplicationSchema = z.object({
  // ── Credentials ──
  // What students see on cards, the profile and in chat. Separate from
  // legalName, which is a payout detail and must never reach a public page
  // (it used to seed the profile URL slug).
  displayName: z
    .string()
    .trim()
    .min(2, 'Profilde görünecek adını yaz')
    .max(60, 'En fazla 60 karakter'),
  university: z.string().min(2, 'Üniversite gerekli').max(120),
  department: z.string().min(2, 'Bölüm gerekli').max(120),
  graduationYear: z.number().int().min(1990).max(2100).nullable().optional(),
  yksTrack: trackEnum,
  yksRank: z.number().int().min(1, 'Sıralama gerekli').max(3_000_000),
  yksYear: z.number().int().min(2000).max(2100),
  ownBaselineTytNet: z.number().min(0).max(120).nullable().optional(),
  ownFinalTytNet: z.number().min(0).max(120).nullable().optional(),
  ownBaselineAytNet: z.number().min(0).max(80).nullable().optional(),
  ownFinalAytNet: z.number().min(0).max(80).nullable().optional(),
  wasMezun: z.boolean().default(false),

  // ── Method ──
  headline: z.string().min(10, 'Kısa bir tanıtım yaz').max(120),
  bio: z.string().min(120, 'En az 120 karakter yaz — öğrenciler bunu okuyor').max(4000),
  styles: z.array(styleEnum).min(1, 'En az bir çalışma tarzı seç').max(4),
  tracks: z.array(trackEnum).min(1, 'En az bir alan seç'),
  subjects: z.array(z.string().max(60)).max(20).default([]),
  supportedGrades: z.array(gradeEnum).min(1, 'En az bir sınıf seviyesi seç'),

  // Target student criteria — becomes a CoachSpecialization row, which the
  // matcher already reads when scoring trajectory similarity.
  targetRankFrom: z.number().int().min(1).max(3_000_000).nullable().optional(),
  targetRankTo: z.number().int().min(1).max(3_000_000).nullable().optional(),
  specializationLabel: z.string().max(120).nullable().optional(),

  // ── Pricing & capacity ──
  monthlyPriceMinor: z.number().int().min(50_000, 'Aylık ücret en az 500 ₺ olmalı').max(5_000_000),
  sessionPriceMinor: z.number().int().min(10_000).max(1_000_000).nullable().optional(),
  sessionsPerMonth: z.number().int().min(1).max(30).default(4),
  minutesPerSession: z.number().int().min(30).max(180).default(60),
  maxActiveStudents: z.number().int().min(1).max(50).default(8),
  weeklyCapacityHours: z.number().int().min(1).max(60).nullable().optional(),

  // ── Availability ──
  availability: z.array(weeklyWindowSchema).min(1, 'En az bir müsait aralık ekle').max(40),

  // ── Payout ──
  submerchantType: z.enum(['PERSONAL', 'PRIVATE_COMPANY', 'LIMITED_COMPANY']),
  legalName: z.string().min(3, 'Ad soyad / unvan gerekli').max(160),
  identityNumber: z.string().min(10).max(11),
  iban: z.string().min(26).max(34),
  taxOffice: z.string().max(120).nullable().optional(),
  address: z.string().min(10, 'Adres gerekli').max(400),
  city: z.string().min(2, 'Şehir gerekli').max(80),
  phone: z.string().min(10).max(20),

  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'Devam etmek için sözleşmeyi onaylaman gerekiyor' }),
  }),
});

export type CoachApplicationInput = z.input<typeof coachApplicationSchema>;
export type CoachApplication = z.output<typeof coachApplicationSchema>;

/** Per-step field lists, so the wizard can validate one step at a time. */
export const STEP_FIELDS: Record<ApplyStep, Array<keyof CoachApplication>> = {
  kimlik: ['displayName', 'university', 'department', 'yksTrack', 'yksRank', 'yksYear'],
  yontem: ['headline', 'bio', 'styles', 'tracks', 'supportedGrades'],
  ucret: ['monthlyPriceMinor', 'maxActiveStudents'],
  takvim: ['availability'],
  odeme: ['submerchantType', 'legalName', 'identityNumber', 'iban', 'address', 'city', 'phone', 'acceptedTerms'],
};

export const SUBMERCHANT_TYPE_LABELS: Record<string, { label: string; hint: string }> = {
  PERSONAL: { label: 'Bireysel', hint: 'Şirketin yok. TC kimlik numaranla kaydolursun.' },
  PRIVATE_COMPANY: { label: 'Şahıs şirketi', hint: 'Vergi numaran ve vergi dairen gerekir.' },
  LIMITED_COMPANY: { label: 'Limited / A.Ş.', hint: 'Şirket unvanı ve vergi bilgileri gerekir.' },
};

export const WEEKDAY_LABELS = [
  'Pazar',
  'Pazartesi',
  'Salı',
  'Çarşamba',
  'Perşembe',
  'Cuma',
  'Cumartesi',
];

/** "18:00" → 1080 */
export function timeToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Slug from the coach's display name, with Turkish characters folded. */
export function slugify(input: string): string {
  const map: Record<string, string> = {
    ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u',
    Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u',
  };
  return input
    .split('')
    .map((c) => map[c] ?? c)
    .join('')
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
