import type { CoachingStyle, GradeLevel, Track } from '@/lib/matching/types';

/**
 * Guest onboarding state, client side.
 *
 * ── Why this is not "just sessionStorage" ──
 *
 * The brief asks for sessionStorage so answers survive until the auth modal.
 * That covers the common case and misses the one that actually loses students:
 * the magic-link sign-in. The student starts in Chrome, the email opens in the
 * iOS Mail in-app browser, and sessionStorage is gone along with the five
 * answers they just gave.
 *
 * So this layer is a fast local cache, not the record. Every step also writes
 * server-side to `OnboardingSession`, keyed by an httpOnly cookie that survives
 * the OAuth redirect, with the token additionally embedded in the magic-link
 * callback. sessionStorage exists so the UI never waits on a round trip and so
 * a refresh mid-funnel is instant; the server copy is what gets claimed into a
 * StudentProfile at sign-in.
 *
 * Read order on mount: server session (authoritative) → sessionStorage (fast
 * path when the server has nothing yet) → empty.
 */

export const ONBOARDING_STORAGE_KEY = 'kaktus.onboarding.v1';

export interface OnboardingDraft {
  track?: Track;
  gradeLevel?: GradeLevel;
  targetRanking?: number | null;
  targetUniversity?: string | null;
  targetDepartment?: string | null;
  baselineTytNet?: number | null;
  baselineAytNet?: number | null;
  preferredStyles?: CoachingStyle[];
  budgetMinMinor?: number | null;
  budgetMaxMinor?: number | null;
  completedStep?: number;
}

export const STEPS = ['alan', 'hedef', 'net', 'tarz', 'butce'] as const;
export type StepSlug = (typeof STEPS)[number];

export const STEP_TITLES: Record<StepSlug, string> = {
  alan: 'Hangi alanda hazırlanıyorsun?',
  hedef: 'Hedefin ne?',
  net: 'Güncel netlerin ne?',
  tarz: 'Nasıl bir koç seni ileri taşır?',
  butce: 'Aylık ne kadar ayırabilirsin?',
};

export function stepIndex(slug: string): number {
  const i = (STEPS as readonly string[]).indexOf(slug);
  return i === -1 ? 0 : i;
}

export function isStepComplete(draft: OnboardingDraft, slug: StepSlug): boolean {
  switch (slug) {
    case 'alan':
      return Boolean(draft.track && draft.gradeLevel);
    case 'hedef':
      // A ranking or a named target — a student who only knows "Tıp istiyorum"
      // must not be blocked here.
      return (
        draft.targetRanking != null ||
        Boolean(draft.targetUniversity?.trim()) ||
        Boolean(draft.targetDepartment?.trim())
      );
    case 'net':
      // Both TYT and AYT nets are optional — a student who hasn't sat either
      // exam yet still needs to be able to move on.
      return true;
    case 'tarz':
      return (draft.preferredStyles?.length ?? 0) > 0;
    case 'butce':
      return draft.budgetMaxMinor != null;
  }
}

/** The matcher needs these two; everything else degrades to a neutral score. */
export function canMatch(draft: OnboardingDraft): boolean {
  return Boolean(draft.track && draft.gradeLevel);
}

// ─────────────────────────────────────────────────────────────────────────────
// Local cache
// ─────────────────────────────────────────────────────────────────────────────

export function readDraft(): OnboardingDraft {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(ONBOARDING_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OnboardingDraft) : {};
  } catch {
    // Private mode, quota, or corrupted JSON. The server copy still has it.
    return {};
  }
}

export function writeDraft(draft: OnboardingDraft): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* non-fatal, see above */
  }
}

export function clearDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(ONBOARDING_STORAGE_KEY);
  } catch {
    /* non-fatal */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

export const TRACK_LABELS: Record<Track, { short: string; full: string; hint: string }> = {
  SAYISAL: { short: 'Sayısal', full: 'Sayısal', hint: '' },
  ESIT_AGIRLIK: { short: 'Eşit Ağırlık', full: 'Eşit Ağırlık', hint: '' },
  SOZEL: { short: 'Sözel', full: 'Sözel', hint: '' },
  DIL: { short: 'Dil', full: 'Dil', hint: '' },
};

// GRADE_11's label covers 9th, 10th and 11th grade together — the underlying
// value stays GRADE_11 (matching engine and DB are unaffected), only the
// wording changed to stop implying 9th/10th graders can't use it.
export const GRADE_LABELS: Record<GradeLevel, { short: string; hint: string }> = {
  GRADE_11: { short: '9-10-11. sınıf', hint: '' },
  GRADE_12: { short: '12. sınıf', hint: '' },
  MEZUN: { short: 'Mezun', hint: '' },
};

/** e.g. "SAY 890" — [ALAN] [YERLEŞTİRME SIRASI] on coach cards and profiles. */
export const TRACK_SHORT_CODES: Record<Track, string> = {
  SAYISAL: 'SAY',
  ESIT_AGIRLIK: 'EA',
  SOZEL: 'SÖZ',
  DIL: 'DİL',
};

export const STYLE_LABELS: Record<CoachingStyle, { short: string; hint: string }> = {
  STRICT: { short: 'Disiplinli takip', hint: 'Program net, teslim saatleri belli, mazeret az' },
  EMPATHETIC: { short: 'Destekleyici mentor', hint: 'Önce motivasyon, kötü haftalarda yanında' },
  STRATEGIC: { short: 'Strateji odaklı', hint: 'Net analizi, deneme taktiği, zaman yönetimi' },
  HIGH_TOUCH: { short: 'Sık temas', hint: 'Neredeyse her gün kısa kontrol' },
};

export const DIMENSION_LABELS: Record<string, string> = {
  trajectory: 'Hedef benzerliği',
  style: 'Çalışma tarzı',
  availability: 'Saat uyumu',
  trackDepth: 'Alan uyumu',
  budget: 'Bütçe uyumu',
  reputation: 'Öğrenci geri bildirimi',
  gradeExperience: 'Sınıf deneyimi',
};

export function formatTry(minor: number | null | undefined): string {
  if (minor == null) return '—';
  return `${Math.round(minor / 100).toLocaleString('tr-TR')} ₺`;
}

/** "TYT 68 → 108 · AYT 40 → 65 net" — only the exams that have both ends set. */
export function formatNetJourney(journey: {
  baselineTytNet: number | null;
  finalTytNet: number | null;
  baselineAytNet: number | null;
  finalAytNet: number | null;
}): string | null {
  const parts: string[] = [];
  if (journey.baselineTytNet != null && journey.finalTytNet != null) {
    parts.push(`TYT ${Math.round(journey.baselineTytNet)} → ${Math.round(journey.finalTytNet)}`);
  }
  if (journey.baselineAytNet != null && journey.finalAytNet != null) {
    parts.push(`AYT ${Math.round(journey.baselineAytNet)} → ${Math.round(journey.finalAytNet)}`);
  }
  return parts.length > 0 ? `${parts.join(' · ')} net` : null;
}
