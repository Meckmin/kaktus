import { describe, expect, it } from 'vitest';
import {
  STEPS,
  STEP_TITLES,
  isStepComplete,
  formatNetJourney,
  formatTry,
  type OnboardingDraft,
} from '@/lib/onboarding/client-state';
import { toCoachMatchView } from '@/lib/matching/view';
import type { CoachCandidate, MatchResult } from '@/lib/matching/types';

const base: OnboardingDraft = { preferredStyles: [] };

describe('step gating', () => {
  it('requires both track and grade before leaving step 1', () => {
    expect(isStepComplete({ ...base, track: 'SAYISAL' }, 'alan')).toBe(false);
    expect(isStepComplete({ ...base, track: 'SAYISAL', gradeLevel: 'MEZUN' }, 'alan')).toBe(true);
  });

  it('accepts a target expressed as a department, with no ranking', () => {
    // A student who only knows "Tıp istiyorum" must not be blocked here.
    expect(isStepComplete({ ...base, targetDepartment: 'Tıp' }, 'hedef')).toBe(true);
    expect(isStepComplete({ ...base, targetUniversity: 'Boğaziçi' }, 'hedef')).toBe(true);
    expect(isStepComplete({ ...base, targetRanking: 5_000 }, 'hedef')).toBe(true);
  });

  it('does not accept a blank target', () => {
    expect(isStepComplete({ ...base }, 'hedef')).toBe(false);
    expect(isStepComplete({ ...base, targetDepartment: '   ' }, 'hedef')).toBe(false);
  });

  it('treats both TYT and AYT net as optional', () => {
    // A student who hasn't sat either exam yet must not be stuck here.
    expect(isStepComplete({ ...base }, 'net')).toBe(true);
    expect(isStepComplete({ ...base, baselineTytNet: 55 }, 'net')).toBe(true);
    expect(isStepComplete({ ...base, baselineAytNet: 20 }, 'net')).toBe(true);
  });

  it('requires at least one coaching style', () => {
    expect(isStepComplete({ ...base }, 'tarz')).toBe(false);
    expect(isStepComplete({ ...base, preferredStyles: ['STRICT'] }, 'tarz')).toBe(true);
  });

  it('requires a budget ceiling', () => {
    expect(isStepComplete({ ...base, budgetMinMinor: 100_000 }, 'butce')).toBe(false);
    expect(isStepComplete({ ...base, budgetMaxMinor: 300_000 }, 'butce')).toBe(true);
  });

  it('has five steps, each with a title', () => {
    expect(STEPS).toEqual(['alan', 'hedef', 'net', 'tarz', 'butce']);
    expect(STEPS.every((s) => STEP_TITLES[s].length > 0)).toBe(true);
  });
});

describe('Turkish formatting', () => {
  it('formats lira with a Turkish thousands separator', () => {
    expect(formatTry(300_000)).toBe('3.000 ₺');
    expect(formatTry(null)).toBe('—');
  });

  it('shows TYT and AYT climbs separately', () => {
    expect(
      formatNetJourney({ baselineTytNet: 68, finalTytNet: 108, baselineAytNet: 40, finalAytNet: 65 }),
    ).toBe('TYT 68 → 108 · AYT 40 → 65 net');
  });

  it('shows only the exam that has both ends set', () => {
    expect(
      formatNetJourney({ baselineTytNet: 68, finalTytNet: 108, baselineAytNet: 40, finalAytNet: null }),
    ).toBe('TYT 68 → 108 net');
    expect(
      formatNetJourney({ baselineTytNet: null, finalTytNet: null, baselineAytNet: null, finalAytNet: null }),
    ).toBeNull();
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

  const view = toCoachMatchView(result, coach);

  it('shows percentages that are the scorer\'s own, not invented for display', () => {
    expect(view.breakdown.find((p) => p.key === 'trackDepth')?.percent).toBe(95);
    expect(view.breakdown.find((p) => p.key === 'availability')?.percent).toBe(10);
  });

  it('never shows budget as a pill — the price is already on the card', () => {
    expect(view.breakdown.some((p) => p.key === 'budget')).toBe(false);
  });

  it('orders pills by contribution to the score, strongest first', () => {
    expect(view.breakdown.map((p) => p.key)).toEqual([
      'trajectory',
      'trackDepth',
      'style',
      'reputation',
      'gradeExperience',
      'availability',
    ]);
  });

  it('labels pills in Turkish', () => {
    expect(view.breakdown[0].label).toBe('Hedef benzerliği');
  });

  it('passes both TYT and AYT climbs through for the card', () => {
    expect(view.journey).toMatchObject({
      baselineTytNet: 43,
      finalTytNet: 59,
      baselineAytNet: 29,
      finalAytNet: 39,
      finalRank: 3100,
      track: 'SAYISAL',
    });
  });

  it('shows the cheapest package as the starting price', () => {
    const multi = {
      ...coach,
      pricing: [
        { cadence: 'MONTHLY_STANDARD', priceMinor: 400_000 },
        { cadence: 'WEEKLY_SYNC', priceMinor: 120_000 },
      ],
    } as CoachCandidate;
    expect(toCoachMatchView(result, multi).priceFromMinor).toBe(120_000);
  });

  it('has no starting price when the coach has no packages', () => {
    const none = { ...coach, pricing: [] } as unknown as CoachCandidate;
    expect(toCoachMatchView(result, none).priceFromMinor).toBeNull();
  });
});
