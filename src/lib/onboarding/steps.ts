import { z } from 'zod';
import type { CoachingStyle, GradeLevel, PricingCadence, Track } from '@/lib/matching/types';

/**
 * The funnel, defined once.
 *
 * Step order, URL slugs, validation, and copy all live here so the wizard, the
 * route handler, the progress indicator, and the server action cannot disagree
 * about what step 3 is. Turkish slugs because the URL is user-facing.
 */

export const STEP_SLUGS = ['alan', 'hedef', 'net', 'tarz', 'butce'] as const;
export type StepSlug = (typeof STEP_SLUGS)[number];

export function isStepSlug(value: string): value is StepSlug {
  return (STEP_SLUGS as readonly string[]).includes(value);
}

export function stepIndex(slug: StepSlug): number {
  return STEP_SLUGS.indexOf(slug);
}

export function nextStep(slug: StepSlug): StepSlug | null {
  return STEP_SLUGS[stepIndex(slug) + 1] ?? null;
}

export function previousStep(slug: StepSlug): StepSlug | null {
  const i = stepIndex(slug);
  return i > 0 ? STEP_SLUGS[i - 1] : null;
}

export const STEP_META: Record<StepSlug, { title: string; help: string }> = {
  alan: {
    title: 'Hangi alanda hazırlanıyorsun?',
    help: 'Koçları önce alanına göre süzüyoruz, o yüzden burada doğru seçim önemli.',
  },
  hedef: {
    title: 'Hedefin ne?',
    help: 'Sıralama hedefin, koçun kendi çıkışıyla ne kadar örtüşüyor diye bakacağız.',
  },
  net: {
    title: 'Şu an nerede duruyorsun?',
    help: 'Son denemendeki netlerin yeterli. Kimse bunları görmüyor, sadece eşleştirmede kullanıyoruz.',
  },
  tarz: {
    title: 'Nasıl bir koç sana iyi gelir?',
    help: 'En çok istediğini ilk sıraya koy. Birden fazla seçebilirsin.',
  },
  butce: {
    title: 'Aylık bütçen ne kadar?',
    help: 'Bütçenin biraz üstündeki koçları da göstereceğiz — kapsamı küçültüp teklif verebilirsin.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────────────────

export const TRACK_OPTIONS: Array<{
  value: Track;
  short: string;
  label: string;
  detail: string;
}> = [
  { value: 'SAYISAL', short: 'SAY', label: 'Sayısal', detail: 'Matematik, Fizik, Kimya, Biyoloji' },
  { value: 'ESIT_AGIRLIK', short: 'EA', label: 'Eşit Ağırlık', detail: 'Matematik, Edebiyat, Tarih, Coğrafya' },
  { value: 'SOZEL', short: 'SÖZ', label: 'Sözel', detail: 'Edebiyat, Tarih, Coğrafya, Felsefe' },
  { value: 'DIL', short: 'DİL', label: 'Dil', detail: 'YDT İngilizce, Türkçe' },
];

export const GRADE_OPTIONS: Array<{ value: GradeLevel; label: string; detail: string }> = [
  { value: 'GRADE_11', label: '11. sınıf', detail: 'Uzun vadeli plan kurma zamanı' },
  { value: 'GRADE_12', label: '12. sınıf', detail: 'Okul ve sınav aynı anda' },
  { value: 'MEZUN', label: 'Mezun', detail: 'Tüm gün sınava ayrılmış bir yıl' },
];

/**
 * Coaching styles, written as the student would experience them rather than as
 * the enum names. "STRICT" is a database value; "Beni sıkı takip etsin" is what
 * a 17-year-old actually recognises about themselves.
 */
export const STYLE_OPTIONS: Array<{
  value: CoachingStyle;
  label: string;
  detail: string;
}> = [
  {
    value: 'STRICT',
    label: 'Sıkı takip etsin',
    detail: 'Program net, ödev kontrol edilir, kaçırdığın gün konuşulur.',
  },
  {
    value: 'EMPATHETIC',
    label: 'Moralimi toparlasın',
    detail: 'Kötü deneme sonrası konuşulacak biri; baskı değil destek.',
  },
  {
    value: 'STRATEGIC',
    label: 'Strateji kursun',
    detail: 'Hangi konu kaç net getirir, neyi bırakmak mantıklı — sayılarla çalışır.',
  },
  {
    value: 'HIGH_TOUCH',
    label: 'Sık sık görüşelim',
    detail: 'Haftada birkaç kez kısa temas, uzun aralar yok.',
  },
];

/** Ranking bands, phrased the way students talk about targets. */
export const RANKING_OPTIONS: Array<{ value: number; label: string; detail: string }> = [
  { value: 1_000, label: 'İlk 1.000', detail: 'Tıp, Boğaziçi/ODTÜ mühendislik' },
  { value: 5_000, label: 'İlk 5.000', detail: 'Devlet üniversitesi güçlü bölümler' },
  { value: 20_000, label: 'İlk 20.000', detail: 'İyi bir 4 yıllık bölüm' },
  { value: 50_000, label: 'İlk 50.000', detail: 'Hedefi netleştirme aşamasındayım' },
  { value: 150_000, label: 'İlk 150.000', detail: 'Önce sağlam bir temel' },
];

export const BUDGET_BOUNDS = {
  minMinor: 50_000, // 500 ₺
  maxMinor: 1_000_000, // 10.000 ₺
  stepMinor: 25_000, // 250 ₺
} as const;

export const DEFAULT_BUDGET = { minMinor: 150_000, maxMinor: 400_000 } as const;

export const CADENCE_OPTIONS: Array<{ value: PricingCadence; label: string }> = [
  { value: 'MONTHLY_STANDARD', label: 'Aylık paket' },
  { value: 'WEEKLY_SYNC', label: 'Haftalık görüşme' },
  { value: 'INTENSIVE', label: 'Yoğun program' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Per-step validation
// ─────────────────────────────────────────────────────────────────────────────

const trackSchema = z.object({
  track: z.enum(['SAYISAL', 'ESIT_AGIRLIK', 'SOZEL', 'DIL']),
  gradeLevel: z.enum(['GRADE_11', 'GRADE_12', 'MEZUN']),
});

const targetSchema = z.object({
  targetRanking: z.number().int().min(1).max(3_000_000),
  targetUniversity: z.string().trim().max(120).optional().or(z.literal('')),
  targetDepartment: z.string().trim().max(120).optional().or(z.literal('')),
});

/**
 * Nets are optional on purpose.
 *
 * A student who has not taken a deneme yet, or who is embarrassed by their
 * score, must not be blocked here — the matcher treats missing baselines as
 * neutral rather than as zero. Requiring a number we do not strictly need is
 * how you lose the exact students who need a coach most.
 */
const baselineSchema = z.object({
  baselineTytNet: z.number().min(0).max(120).nullable().optional(),
  baselineAytNet: z.number().min(0).max(80).nullable().optional(),
});

const styleSchema = z.object({
  preferredStyles: z
    .array(z.enum(['STRICT', 'EMPATHETIC', 'STRATEGIC', 'HIGH_TOUCH']))
    .min(1, 'En az bir tarz seç.')
    .max(4),
});

const budgetSchema = z
  .object({
    budgetMinMinor: z.number().int().min(0),
    budgetMaxMinor: z.number().int().min(0),
    budgetCadence: z.enum(['WEEKLY_SYNC', 'MONTHLY_STANDARD', 'INTENSIVE', 'SINGLE_SESSION']),
  })
  .refine((v) => v.budgetMaxMinor >= v.budgetMinMinor, {
    message: 'Üst sınır alt sınırdan küçük olamaz.',
    path: ['budgetMaxMinor'],
  });

export const STEP_SCHEMAS = {
  alan: trackSchema,
  hedef: targetSchema,
  net: baselineSchema,
  tarz: styleSchema,
  butce: budgetSchema,
} as const;

export type StepValues = {
  alan: z.infer<typeof trackSchema>;
  hedef: z.infer<typeof targetSchema>;
  net: z.infer<typeof baselineSchema>;
  tarz: z.infer<typeof styleSchema>;
  butce: z.infer<typeof budgetSchema>;
};

/** Everything the wizard holds client-side, all optional mid-funnel. */
export type OnboardingDraft = Partial<
  StepValues['alan'] &
    StepValues['hedef'] &
    StepValues['net'] &
    StepValues['tarz'] &
    StepValues['butce']
> & { completedStep?: number };

export function formatTry(minor: number): string {
  return `${Math.round(minor / 100).toLocaleString('tr-TR')} ₺`;
}
