import type { CoachingStyle, GradeLevel, PricingCadence, ScoreDimension, Track } from './types';

/**
 * Turkish surface copy for the matching model.
 *
 * Lives beside the scorer rather than in the components because the dimension
 * names are domain vocabulary, not UI strings: when a weight changes in
 * weights.ts, the label that explains it to a student should be one file away,
 * not scattered across three components.
 */

export const DIMENSION_LABEL_TR: Record<ScoreDimension, string> = {
  trajectory: 'Hedef benzerliği',
  style: 'Çalışma tarzı',
  availability: 'Saat uyumu',
  trackDepth: 'Alan uyumu',
  budget: 'Bütçe uyumu',
  reputation: 'Öğrenci puanı',
  gradeExperience: 'Sınıf deneyimi',
};

/** One-line explanation shown when a student expands a pill. */
export const DIMENSION_HELP_TR: Record<ScoreDimension, string> = {
  trajectory:
    'Koçun kendi net çıkışı ve öğrencilerinin ilerlemesi, senin hedefine ulaşmak için gereken artışla karşılaştırılır.',
  style: 'Seçtiğin çalışma tarzı tercihleriyle koçun çalışma biçiminin örtüşmesi.',
  availability: 'Boş saatlerinle koçun müsait saatlerinin kesişimi.',
  trackDepth: 'Koçun senin alanındaki dersleri kapsaması.',
  budget: 'Koçun paket fiyatının belirttiğin bütçe aralığına uzaklığı.',
  reputation: 'Değerlendirme ortalaması, tamamlanan koçluk sayısı ve dönüş hızı.',
  gradeExperience: 'Koçun senin sınıf seviyendeki öğrencilerle çalışma geçmişi.',
};

export const TRACK_LABEL_TR: Record<Track, string> = {
  SAYISAL: 'Sayısal',
  ESIT_AGIRLIK: 'Eşit Ağırlık',
  SOZEL: 'Sözel',
  DIL: 'Dil',
};

export const TRACK_BLURB_TR: Record<Track, string> = {
  SAYISAL: 'Matematik, Fizik, Kimya, Biyoloji',
  ESIT_AGIRLIK: 'Matematik, Edebiyat, Tarih, Coğrafya',
  SOZEL: 'Edebiyat, Tarih, Coğrafya, Felsefe',
  DIL: 'YDT — İngilizce, Almanca, Fransızca',
};

export const GRADE_LABEL_TR: Record<GradeLevel, string> = {
  GRADE_11: '11. sınıf',
  GRADE_12: '12. sınıf',
  MEZUN: 'Mezun',
};

export const STYLE_LABEL_TR: Record<CoachingStyle, string> = {
  STRICT: 'Disiplinli takip',
  EMPATHETIC: 'Mentor yaklaşımı',
  STRATEGIC: 'Strateji odaklı',
  HIGH_TOUCH: 'Sık check-in',
};

export const STYLE_BLURB_TR: Record<CoachingStyle, string> = {
  STRICT:
    'Program net, teslim saatleri belli. Aksatırsan üstüne gelir. "Bugün neden yapmadın" sorusunu soran koç.',
  EMPATHETIC:
    'Önce moral, sonra program. Kötü deneme sonrası konuşabileceğin, tükenmişliği ciddiye alan koç.',
  STRATEGIC:
    'Deneme analizi, net hedefi, konu önceliklendirme. Nereye çalışacağını rakamla gösteren koç.',
  HIGH_TOUCH:
    'Günlük kısa temas. Haftada bir uzun görüşme yerine her gün beş dakika ilerleme kontrolü.',
};

export const CADENCE_LABEL_TR: Record<PricingCadence, string> = {
  WEEKLY_SYNC: 'Haftalık görüşme',
  MONTHLY_STANDARD: 'Aylık standart',
  INTENSIVE: 'Yoğun program',
  SINGLE_SESSION: 'Tek seans',
};

/** 400000 → "4.000 ₺" */
export function formatTry(minor: number): string {
  return `${Math.round(minor / 100).toLocaleString('tr-TR')} ₺`;
}

export function formatRanking(rank: number): string {
  return rank.toLocaleString('tr-TR');
}
