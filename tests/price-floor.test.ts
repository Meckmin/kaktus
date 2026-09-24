import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE_MIN_OFFER_MINOR,
  belowFloorMessage,
  minOfferMinor,
  packageTypeForCadence,
} from '@/lib/offers/price-floor';

const tiers = [
  { cadence: 'MONTHLY_STANDARD', priceMinor: 400_000, sessionsPerCycle: 4 },
  { cadence: 'SINGLE_SESSION', priceMinor: 120_000, sessionsPerCycle: 1 },
];

describe('minOfferMinor', () => {
  it('holds a student to half the coach\'s list price for the package', () => {
    expect(minOfferMinor({ packageType: 'MONTHLY_4W', tiers, role: 'STUDENT' })).toBe(200_000);
    expect(minOfferMinor({ packageType: 'EXPLORATORY', tiers, role: 'STUDENT' })).toBe(60_000);
  });

  it('rounds the half up to a whole 100 ₺', () => {
    const odd = [{ cadence: 'MONTHLY_STANDARD', priceMinor: 375_000, sessionsPerCycle: 4 }];
    // 1.875 ₺ → 1.900 ₺
    expect(minOfferMinor({ packageType: 'MONTHLY_4W', tiers: odd, role: 'STUDENT' })).toBe(190_000);
  });

  it('derives the trial floor from the monthly price when there is no trial tier', () => {
    const monthlyOnly = [tiers[0]];
    // 4.000 / 4 sessions = 1.000 ₺ per session → floor 500 ₺
    expect(minOfferMinor({ packageType: 'EXPLORATORY', tiers: monthlyOnly, role: 'STUDENT' })).toBe(50_000);
  });

  it('lets a coach discount freely down to the absolute floor', () => {
    expect(minOfferMinor({ packageType: 'MONTHLY_4W', tiers, role: 'COACH' })).toBe(ABSOLUTE_MIN_OFFER_MINOR);
  });

  it('never goes below the absolute floor, even for a very cheap coach', () => {
    const cheap = [{ cadence: 'SINGLE_SESSION', priceMinor: 12_000, sessionsPerCycle: 1 }];
    expect(minOfferMinor({ packageType: 'EXPLORATORY', tiers: cheap, role: 'STUDENT' })).toBe(ABSOLUTE_MIN_OFFER_MINOR);
  });

  it('falls back to the absolute floor when the coach has no pricing', () => {
    expect(minOfferMinor({ packageType: 'MONTHLY_4W', tiers: [], role: 'STUDENT' })).toBe(ABSOLUTE_MIN_OFFER_MINOR);
  });
});

describe('packageTypeForCadence', () => {
  it('maps a single session to the trial package and everything else to the program', () => {
    expect(packageTypeForCadence('SINGLE_SESSION')).toBe('EXPLORATORY');
    expect(packageTypeForCadence('MONTHLY_STANDARD')).toBe('MONTHLY_4W');
    expect(packageTypeForCadence(undefined)).toBe('MONTHLY_4W');
  });
});

describe('belowFloorMessage', () => {
  it('states the floor in lira', () => {
    expect(belowFloorMessage(200_000)).toBe('En az 2.000 ₺ teklif edebilirsin.');
  });
});
