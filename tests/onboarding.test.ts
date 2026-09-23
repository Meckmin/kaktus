import { describe, expect, it } from 'vitest';
import {
  STEPS,
  firstIncompleteStep,
  isStepComplete,
  formatRanking,
  formatTry,
  type OnboardingAnswers,
} from '@/lib/onboarding/schema';
import { toCoachCard } from '@/lib/matching/present';
import type { CoachCandidate, MatchResult } from '@/lib/matching/types';

const base: OnboardingAnswers = { preferredStyles: [] };

describe('step gating', () => {
  it('requires both track and grade before leaving step 1', () => {
    expect(isStepComplete('alan', { ...base, track: 'SAYISAL' })).toBe(false);
    expect(isStepComplete('alan', { ...base, track: 'SAYISAL', gradeLevel: 'MEZUN' })).toBe(true);
  });

  it('accepts a target expressed as a department, with no ranking', () => {
    // A student who only knows "Tıp istiyorum" must not be blocked here.
    expect(isStepComplete('hedef', { ...base, targetDepartment: 'Tıp' })).toBe(true);
  });

  it('treats both TYT and AYT net as optional', () => {
    // A student who hasn't sat either exam yet must not be stuck here.
    expect(isStepComplete('net', { ...base })).toBe(true);
    expect(isStepComplete('net', { ...base, baselineTytNet: 55 })).toBe(true);
    expect(isStepComplete('net', { ...base, baselineAytNet: 20 })).toBe(true);
  });

  it('resumes at the first gap rather than the last step touched', () => {
    const answers: OnboardingAnswers = {
      track: 'SAYISAL',
      gradeLevel: 'MEZUN',
      baselineTytNet: 55,
      preferredStyles: ['STRICT'],
      budgetMaxMinor: 300_000,
    };
    expect(firstIncompleteStep(answers)).toBe('hedef');
  });

  it('has five steps with contiguous indices', () => {
    expect(STEPS.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('Turkish formatting', () => {
  it('formats rankings the way students say them', () => {
    expect(formatRanking(150_000)).toBe('150 bin');
    expect(formatRanking(850)).toBe('850');
  });

  it('formats lira with a Turkish thousands separator', () => {
    expect(formatTry(300_000)).toBe('3.000 ₺');
    expect(formatTry(null)).toBe('—');
  });
});

describe('match pills', () => {
  const coach = {
    id: 'c1',
    slug: 'ayse-y',
    displayName: 'Ayşe Y.',
    university: 'Boğaziçi Üniversitesi',
    department: 'EEM',
    tracks: ['SAYISAL'],
    subjects: [],
    styles: ['STRICT'],
    supportedGrades: ['MEZUN'],
    journey: {
      baselineNet: 72,
      finalNet: 98,
      baselineTytNet: 43,
      finalTytNet: 59,
      baselineAytNet: 29,
      finalAytNet: 39,
      baselineRank: 48_000,
      finalRank: 3100,
      wasMezun: true,
      track: 'SAYISAL',
      year: 2023,
    },
    specializations: [{ label: 'Mezunlukta 50binden ilk 5bine', fromRank: 50_000, toRank: 5_000 }],
    availability: [],
    pricing: [{ cadence: 'MONTHLY_STANDARD', priceMinor: 400_000 }],
    stats: {
      ratingAvg: 4.8,
      ratingCount: 24,
      completedEngagements: 18,
      activeEngagements: 4,
      maxActiveStudents: 10,
      responseP50Seconds: 3600,
      cancellationRate: 0.02,
      lastActiveAt: new Date('2026-09-01'),
      medianStudentNetGain: 22,
    },
  } as unknown as CoachCandidate;

  const result = {
    coachId: 'c1',
    rawScore: 0.82,
    displayScore: 94,
    reasons: ['Sayısal alanından'],
    caveats: [],
    weightsVersion: 'test',
    dimensions: [
      { dimension: 'trackDepth', score: 0.95, weight: 0.14, reason: 'Alan', surface: true },
      { dimension: 'trajectory', score: 0.88, weight: 0.22, reason: 'Çıkış', surface: true },
      { dimension: 'style', score: 0.6, weight: 0.17, reason: 'Tarz', surface: true },
      { dimension: 'availability', score: 0.1, weight: 0.15, reason: 'Saat', surface: true },
      { dimension: 'budget', score: 0.99, weight: 0.12, reason: 'Bütçe', surface: false },
      { dimension: 'reputation', score: 0.83, weight: 0.12, reason: 'Puan', surface: true },
      { dimension: 'gradeExperience', score: 0.4, weight: 0.08, reason: 'Mezun', surface: true },
    ],
  } as unknown as MatchResult;

  const card = toCoachCard(result, coach);

  it('shows percentages that are the scorer\'s own, not invented for display', () => {
    expect(card.pills.find((p) => p.dimension === 'trackDepth')?.percent).toBe(95);
  });

  it('drops dimensions too weak to be worth a pill', () => {
    expect(card.pills.some((p) => p.dimension === 'availability')).toBe(false);
  });

  it('never shows budget as a pill — the price is already on the card', () => {
    expect(card.pills.some((p) => p.dimension === 'budget')).toBe(false);
  });

  it('caps the pill count so a card stays scannable', () => {
    expect(card.pills.length).toBeLessThanOrEqual(4);
  });

  it('renders the coach journey as the number pair students recognise', () => {
    expect(card.journeyLabel).toBe('72 → 98 net');
  });

  it('omits the journey label when the coach reported no climb', () => {
    const flat = { ...coach, journey: { ...coach.journey, baselineNet: 98 } } as CoachCandidate;
    expect(toCoachCard(result, flat).journeyLabel).toBeNull();
  });
});
