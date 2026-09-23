import { z } from 'zod';
import type { CoachingStyle, GradeLevel, Track } from '@/lib/matching/types';

/**
 * Step definitions, shared by the client wizard and the server actions.
 *
 * One source of truth for what a step contains and when it is complete, so the
 * "Devam et" button and the server-side validation can never disagree — a
 * mismatch there produces the worst funnel bug there is: a button that does
 * nothing with no explanation.
 */

export const STEP_SLUGS = ['alan', 'hedef', 'net', 'tarz', 'butce'] as const;
export type StepSlug = (typeof STEP_SLUGS)[number];

export interface StepMeta {
  slug: StepSlug;
  index: number;
  /** The question, asked the way a student would ask it. */
  question: string;
  /** One line of help. Never marketing copy. */
  hint?: string;
}

export const STEPS: StepMeta[] = [
  {
    slug: 'alan',
    index: 0,
    question: 'Hangi alanda hazırlanıyorsun?',
    hint: 'Koçları önce alanına göre eliyoruz, sonra puanlıyoruz.',
  },
  {
    slug: 'hedef',
    index: 1,
    question: 'Hedefin ne?',
    hint: 'Sıralamayı bilmiyorsan bölüm yazman da yeter.',
  },
  {
    slug: 'net',
    index: 2,
    question: 'Şu an kaç net yapıyorsun?',
    hint: 'Son denemeni yaz. Tahmini olması sorun değil.',
  },
  { slug: 'tarz', index: 3, question: 'Nasıl bir koç seni daha iyi çalıştırır?' },
  {
    slug: 'butce',
    index: 4,
    question: 'Aylık bütçen ne kadar?',
    hint: 'Koçlar sana özel teklif verebilir, bu bir üst sınır değil.',
  },
];

export const stepBySlug = new Map(STEPS.map((s) => [s.slug, s]));

// ─────────────────────────────────────────────────────────────────────────────
// Answers
// ─────────────────────────────────────────────────────────────────────────────

export interface OnboardingAnswers {
  track?: Track;
  gradeLevel?: GradeLevel;
  targetRanking?: number | null;
  targetUniversity?: string | null;
  targetDepartment?: string | null;
  baselineTytNet?: number | null;
  baselineAytNet?: number | null;
  preferredStyles: CoachingStyle[];
  budgetMinMinor?: number | null;
  budgetMaxMinor?: number | null;
  weeklyHoursGoal?: number | null;
}

export const emptyAnswers: OnboardingAnswers = { preferredStyles: [] };

/** Whether a given step has enough to move on. Mirrors the server's checks. */
export function isStepComplete(slug: StepSlug, a: OnboardingAnswers): boolean {
  switch (slug) {
    case 'alan':
      return Boolean(a.track && a.gradeLevel);
    case 'hedef':
      // Either a ranking or a named target — a student who only knows "Tıp
      // istiyorum" should not be blocked here.
      return Boolean(a.targetRanking || a.targetDepartment || a.targetUniversity);
    case 'net':
      return a.baselineTytNet != null;
    case 'tarz':
      return a.preferredStyles.length > 0;
    case 'butce':
      return a.budgetMaxMinor != null;
  }
}

export function firstIncompleteStep(a: OnboardingAnswers): StepSlug {
  return STEPS.find((s) => !isStepComplete(s.slug, a))?.slug ?? 'butce';
}

export function completionRatio(a: OnboardingAnswers): number {
  const done = STEPS.filter((s) => isStepComplete(s.slug, a)).length;
  return done / STEPS.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Option data
// ─────────────────────────────────────────────────────────────────────────────

export const TRACK_OPTIONS: Array<{
  value: Track;
  label: string;
  short: string;
  detail: string;
}> = [
  { value: 'SAYISAL', label: 'Sayısal', short: 'SAY', detail: 'Matematik, Fizik, Kimya, Biyoloji' },
  { value: 'ESIT_AGIRLIK', label: 'Eşit Ağırlık', short: 'EA', detail: 'Matematik, Edebiyat, Tarih, Coğrafya' },
  { value: 'SOZEL', label: 'Sözel', short: 'SÖZ', detail: 'Edebiyat, Tarih, Coğrafya, Felsefe' },
  { value: 'DIL', label: 'Dil', short: 'DİL', detail: 'YDT İngilizce, Almanca, Fransızca' },
];

export const GRADE_OPTIONS: Array<{ value: GradeLevel; label: string; detail: string }> = [
  { value: 'GRADE_11', label: '11. sınıf', detail: 'Erken başlıyorum' },
  { value: 'GRADE_12', label: '12. sınıf', detail: 'Bu yıl gireceğim' },
  { value: 'MEZUN', label: 'Mezun', detail: 'Tekrar gireceğim' },
];

export const STYLE_OPTIONS: Array<{
  value: CoachingStyle;
  label: string;
  detail: string;
}> = [
  {
    value: 'STRICT',
    label: 'Sıkı takip',
    detail: 'Program verir, uymadığında üstüne gelir. Disiplini dışarıdan kurar.',
  },
  {
    value: 'EMPATHETIC',
    label: 'Mentor gibi',
    detail: 'Önce motivasyonunla ilgilenir. Kötü geçen haftada seni ayağa kaldırır.',
  },
  {
    value: 'STRATEGIC',
    label: 'Strateji odaklı',
    detail: 'Net analizi, deneme taktiği, hangi konuya kaç saat. Sayılarla konuşur.',
  },
  {
    value: 'HIGH_TOUCH',
    label: 'Sık görüşme',
    detail: 'Haftada birden fazla temas, günlük mesajlaşma. Yalnız bırakmaz.',
  },
];

/** Budget bands in kuruş. Anchored to what coaching actually costs in TR. */
export const BUDGET_BANDS: Array<{ label: string; minMinor: number; maxMinor: number }> = [
  { label: "1.500 ₺'ye kadar", minMinor: 0, maxMinor: 150_000 },
  { label: '1.500 – 3.000 ₺', minMinor: 150_000, maxMinor: 300_000 },
  { label: '3.000 – 5.000 ₺', minMinor: 300_000, maxMinor: 500_000 },
  { label: '5.000 ₺ ve üzeri', minMinor: 500_000, maxMinor: 1_200_000 },
];

export const TRACK_LABEL: Record<Track, string> = {
  SAYISAL: 'Sayısal',
  ESIT_AGIRLIK: 'Eşit Ağırlık',
  SOZEL: 'Sözel',
  DIL: 'Dil',
};

export const GRADE_LABEL: Record<GradeLevel, string> = {
  GRADE_11: '11. sınıf',
  GRADE_12: '12. sınıf',
  MEZUN: 'Mezun',
};

export const STYLE_LABEL: Record<CoachingStyle, string> = {
  STRICT: 'Sıkı takip',
  EMPATHETIC: 'Mentor gibi',
  STRATEGIC: 'Strateji odaklı',
  HIGH_TOUCH: 'Sık görüşme',
};

/** AYT net ceiling differs by track; the input must not allow impossible values. */
export const AYT_MAX_NET: Record<Track, number> = {
  SAYISAL: 80,
  ESIT_AGIRLIK: 80,
  SOZEL: 80,
  DIL: 80,
};

export const TYT_MAX_NET = 120;

export function aytLabel(track?: Track): string {
  switch (track) {
    case 'SAYISAL':
      return 'AYT neti (Mat, Fiz, Kim, Biyo)';
    case 'ESIT_AGIRLIK':
      return 'AYT neti (Mat, Edebiyat, Tarih, Coğrafya)';
    case 'SOZEL':
      return 'AYT neti (Edebiyat, Tarih, Coğrafya, Felsefe)';
    case 'DIL':
      return 'YDT neti';
    default:
      return 'AYT neti';
  }
}

export function formatTry(minor?: number | null): string {
  if (minor == null) return '—';
  return `${Math.round(minor / 100).toLocaleString('tr-TR')} ₺`;
}

export function formatRanking(rank?: number | null): string {
  if (rank == null) return '—';
  if (rank >= 1000) return `${Math.round(rank / 1000).toLocaleString('tr-TR')} bin`;
  return rank.toLocaleString('tr-TR');
}

// ─────────────────────────────────────────────────────────────────────────────
// Wire schema — what the client may send to the server action
// ─────────────────────────────────────────────────────────────────────────────

export const answersPatchSchema = z.object({
  track: z.enum(['SAYISAL', 'ESIT_AGIRLIK', 'SOZEL', 'DIL']).optional(),
  gradeLevel: z.enum(['GRADE_11', 'GRADE_12', 'MEZUN']).optional(),
  targetRanking: z.number().int().min(1).max(3_000_000).nullable().optional(),
  targetUniversity: z.string().max(120).nullable().optional(),
  targetDepartment: z.string().max(120).nullable().optional(),
  baselineTytNet: z.number().min(0).max(TYT_MAX_NET).nullable().optional(),
  baselineAytNet: z.number().min(0).max(80).nullable().optional(),
  preferredStyles: z
    .array(z.enum(['STRICT', 'EMPATHETIC', 'STRATEGIC', 'HIGH_TOUCH']))
    .max(4)
    .optional(),
  budgetMinMinor: z.number().int().min(0).nullable().optional(),
  budgetMaxMinor: z.number().int().min(0).nullable().optional(),
  weeklyHoursGoal: z.number().int().min(1).max(40).nullable().optional(),
  completedStep: z.number().int().min(0).max(5).optional(),
});

export type AnswersPatch = z.infer<typeof answersPatchSchema>;
