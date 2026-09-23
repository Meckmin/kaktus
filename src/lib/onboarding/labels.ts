import type { CoachingStyle, GradeLevel, PricingCadence, ScoreDimension, Track } from '@/lib/matching/types';

/**
 * Turkish copy for every enum the student sees.
 *
 * Centralised because the same label has to appear identically in the wizard,
 * the summary rail, the coach card, and the offer — and because a student who
 * picks "Sayısal" in step 1 and then reads "SAY" in the summary loses trust in
 * a product that is asking for their money.
 */

export const TRACKS: Array<{
  value: Track;
  label: string;
  short: string;
  blurb: string;
}> = [
  {
    value: 'SAYISAL',
    label: 'Sayısal',
    short: 'SAY',
    blurb: 'Mühendislik, tıp, mimarlık',
  },
  {
    value: 'ESIT_AGIRLIK',
    label: 'Eşit Ağırlık',
    short: 'EA',
    blurb: 'Hukuk, psikoloji, işletme',
  },
  {
    value: 'SOZEL',
    label: 'Sözel',
    short: 'SÖZ',
    blurb: 'Öğretmenlik, tarih, iletişim',
  },
  {
    value: 'DIL',
    label: 'Dil',
    short: 'DİL',
    blurb: 'Mütercim tercümanlık, dil öğretmenliği',
  },
];

export const GRADE_LEVELS: Array<{ value: GradeLevel; label: string; blurb: string }> = [
  { value: 'GRADE_11', label: '11. sınıf', blurb: 'Bir sonraki yıl için hazırlanıyorum' },
  { value: 'GRADE_12', label: '12. sınıf', blurb: 'Bu yıl sınava gireceğim' },
  { value: 'MEZUN', label: 'Mezun', blurb: 'Tekrar gireceğim' },
];

/**
 * Coaching styles, written as behaviour rather than as personality labels.
 *
 * "Disiplinli" alone tells a student nothing about what will happen to them on
 * a Tuesday night. What they need to know is whether someone will message them
 * when they skip a session.
 */
export const COACHING_STYLES: Array<{
  value: CoachingStyle;
  label: string;
  blurb: string;
}> = [
  {
    value: 'STRICT',
    label: 'Sıkı takip',
    blurb: 'Program net, ödev takibi var. Aksattığımda üstüme gelmesini istiyorum.',
  },
  {
    value: 'EMPATHETIC',
    label: 'Anlayışlı mentor',
    blurb: 'Kötü günlerimde motivasyon veren, baskı kurmayan biri olsun.',
  },
  {
    value: 'STRATEGIC',
    label: 'Strateji odaklı',
    blurb: 'Hangi konudan kaç net, neyi bırakmalıyım — sayılarla çalışsın.',
  },
  {
    value: 'HIGH_TOUCH',
    label: 'Sık görüşme',
    blurb: 'Haftada bir yetmez, sık sık konuşmak beni ayakta tutuyor.',
  },
];

export const CADENCES: Array<{ value: PricingCadence; label: string }> = [
  { value: 'WEEKLY_SYNC', label: 'Haftalık görüşme' },
  { value: 'MONTHLY_STANDARD', label: 'Aylık standart' },
  { value: 'INTENSIVE', label: 'Yoğun program' },
  { value: 'SINGLE_SESSION', label: 'Tek seans' },
];

/**
 * Match breakdown labels.
 *
 * Every score the student sees has to be answerable if they ask "why?". These
 * name the actual comparison being made, not the internal dimension key.
 */
export const DIMENSION_LABELS: Record<ScoreDimension, string> = {
  trajectory: 'Hedef benzerliği',
  style: 'Çalışma tarzı',
  availability: 'Saat uyumu',
  trackDepth: 'Alan uyumu',
  budget: 'Bütçe uyumu',
  reputation: 'Öğrenci puanı',
  gradeExperience: 'Sınıf deneyimi',
};

/** Which dimensions are worth showing as pills, in display order. */
export const PILL_DIMENSIONS: ScoreDimension[] = [
  'trackDepth',
  'trajectory',
  'style',
  'gradeExperience',
  'availability',
];

export function trackLabel(track: Track | null | undefined): string {
  return TRACKS.find((t) => t.value === track)?.label ?? '';
}

export function gradeLabel(grade: GradeLevel | null | undefined): string {
  return GRADE_LEVELS.find((g) => g.value === grade)?.label ?? '';
}

export function styleLabel(style: CoachingStyle): string {
  return COACHING_STYLES.find((s) => s.value === style)?.label ?? '';
}

/** 400000 (kuruş) → "4.000 ₺" */
export function formatTry(minor: number | null | undefined): string {
  if (minor == null) return '—';
  return `${Math.round(minor / 100).toLocaleString('tr-TR')} ₺`;
}

export function formatRanking(rank: number | null | undefined): string {
  if (rank == null) return '—';
  if (rank >= 1000) return `${(rank / 1000).toLocaleString('tr-TR')} bin`;
  return rank.toLocaleString('tr-TR');
}
