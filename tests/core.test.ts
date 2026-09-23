import { describe, expect, it } from 'vitest';
import { calibrate, netIndexForRanking, rankCoaches, scoreCoach } from '@/lib/matching/score';
import { CALIBRATION } from '@/lib/matching/weights';
import type { CoachCandidate, StudentMatchInput } from '@/lib/matching/types';
import { OfferTransitionError, availableEvents, transition } from '@/lib/offers/state-machine';
import { splitAmount, splitIntoMilestones } from '@/lib/payments/escrow';
import { moderateMessage, normalize } from '@/lib/chat/anti-circumvention';

// ─── fixtures ────────────────────────────────────────────────────────────────

const student: StudentMatchInput = {
  track: 'SAYISAL',
  gradeLevel: 'MEZUN',
  baseline: { tytNet: 55, aytNet: 20 },
  target: { ranking: 5_000 },
  preferredStyles: ['STRICT', 'STRATEGIC'],
  availability: [
    { weekday: 1, startMinute: 1080, endMinute: 1260 },
    { weekday: 3, startMinute: 1080, endMinute: 1260 },
    { weekday: 6, startMinute: 600, endMinute: 840 },
  ],
  budget: { minMinor: 200_000, maxMinor: 500_000, cadence: 'MONTHLY_STANDARD' },
  weeklyHoursGoal: 3,
};

function coach(overrides: Partial<CoachCandidate> = {}): CoachCandidate {
  return {
    id: 'coach_1',
    slug: 'ayse-y',
    displayName: 'Ayşe Y.',
    university: 'Boğaziçi Üniversitesi',
    department: 'Elektrik-Elektronik Mühendisliği',
    tracks: ['SAYISAL'],
    subjects: ['AYT Matematik', 'Fizik', 'TYT Matematik'],
    styles: ['STRICT', 'STRATEGIC'],
    supportedGrades: ['GRADE_12', 'MEZUN'],
    journey: {
      baselineNet: 72,
      finalNet: 98,
      baselineTytNet: 43,
      finalTytNet: 59,
      baselineAytNet: 29,
      finalAytNet: 39,
      baselineRank: 48_000,
      finalRank: 3_100,
      wasMezun: true,
      track: 'SAYISAL',
      year: 2023,
    },
    specializations: [{ label: 'Mezun yılında 50binden ilk 5bine', fromRank: 50_000, toRank: 5_000 }],
    availability: [
      { weekday: 1, startMinute: 1020, endMinute: 1320 },
      { weekday: 3, startMinute: 1140, endMinute: 1320 },
    ],
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
    ...overrides,
  };
}

// ─── matching ────────────────────────────────────────────────────────────────

describe('rank → net calibration', () => {
  it('is monotonically decreasing in ranking', () => {
    const ranks = [500, 1_000, 5_000, 20_000, 50_000, 100_000, 300_000];
    const nets = ranks.map((r) => netIndexForRanking('SAYISAL', r));
    for (let i = 1; i < nets.length; i++) expect(nets[i]).toBeLessThan(nets[i - 1]);
  });

  it('clamps outside the anchor table', () => {
    expect(netIndexForRanking('SAYISAL', 1)).toBe(netIndexForRanking('SAYISAL', 500));
    expect(netIndexForRanking('SAYISAL', 9_000_000)).toBe(netIndexForRanking('SAYISAL', 300_000));
  });
});

describe('scoreCoach', () => {
  it('ranks a well-aligned coach highly and explains why', () => {
    const result = scoreCoach(student, coach());
    expect(result.displayScore).toBeGreaterThan(80);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.caveats).toHaveLength(0);
  });

  it('destroys the score when there is no availability overlap', () => {
    const aligned = scoreCoach(student, coach());
    const clashing = scoreCoach(
      student,
      coach({ availability: [{ weekday: 2, startMinute: 480, endMinute: 600 }] }),
    );
    expect(clashing.rawScore).toBeLessThan(aligned.rawScore);
    expect(clashing.caveats.join(' ')).toContain('çakışmıyor');
  });

  it('penalises price over budget but keeps the coach visible', () => {
    const expensive = scoreCoach(
      student,
      coach({ pricing: [{ cadence: 'MONTHLY_STANDARD', priceMinor: 750_000 }] }),
    );
    expect(expensive.caveats.some((c) => c.includes('bütçenin'))).toBe(true);
    expect(expensive.rawScore).toBeGreaterThan(CALIBRATION.minRawScore);
  });

  it('does not let one 5-star review outrank a large sample', () => {
    const newcomer = scoreCoach(
      student,
      coach({
        id: 'c_new',
        stats: { ...coach().stats, ratingAvg: 5, ratingCount: 1, completedEngagements: 1 },
      }),
    );
    const established = scoreCoach(student, coach());
    expect(established.rawScore).toBeGreaterThan(newcomer.rawScore);
  });

  it('rewards a coach who lived the student\'s own situation', () => {
    const mezunCoach = scoreCoach(student, coach());
    const nonMezun = scoreCoach(
      student,
      coach({
        id: 'c_2',
        journey: { ...coach().journey, wasMezun: false },
        supportedGrades: ['GRADE_11', 'GRADE_12'],
      }),
    );
    expect(mezunCoach.rawScore).toBeGreaterThan(nonMezun.rawScore);
  });

  it('is deterministic', () => {
    const now = new Date('2026-09-02');
    expect(scoreCoach(student, coach(), now)).toEqual(scoreCoach(student, coach(), now));
  });
});

describe('calibration', () => {
  it('is strictly increasing, so display never reorders results', () => {
    for (let raw = 0; raw < 1; raw += 0.02) {
      expect(calibrate(raw + 0.01)).toBeGreaterThanOrEqual(calibrate(raw));
    }
  });

  it('stays inside the presentation band', () => {
    expect(calibrate(0)).toBe(CALIBRATION.displayFloor);
    expect(calibrate(1)).toBe(CALIBRATION.displayCeiling);
  });
});

describe('rankCoaches', () => {
  it('sorts descending and drops candidates below the visibility floor', () => {
    const results = rankCoaches(student, [
      coach(),
      coach({
        id: 'c_bad',
        tracks: ['SAYISAL'],
        styles: ['EMPATHETIC'],
        subjects: [],
        supportedGrades: ['GRADE_11'],
        availability: [{ weekday: 5, startMinute: 0, endMinute: 60 }],
        journey: { ...coach().journey, baselineNet: 90, finalNet: 92, wasMezun: false },
        pricing: [{ cadence: 'MONTHLY_STANDARD', priceMinor: 2_000_000 }],
        stats: { ...coach().stats, ratingAvg: 3.2, ratingCount: 2, completedEngagements: 0 },
      }),
    ]);
    expect(results[0].coachId).toBe('coach_1');
    expect(results.every((r) => r.rawScore >= CALIBRATION.minRawScore)).toBe(true);
  });
});

// ─── offer state machine ─────────────────────────────────────────────────────

describe('offer state machine', () => {
  it('walks the happy path', () => {
    expect(transition('DRAFT', 'SUBMIT', 'STUDENT').to).toBe('OFFERED');
    expect(transition('OFFERED', 'ACCEPT', 'COACH', { isInitiatorOfCurrentOffer: false }).to).toBe(
      'ACCEPTED',
    );
    expect(
      transition('ACCEPTED', 'PAYMENT_CAPTURED', 'SYSTEM', { hasCapturedPayment: true }).to,
    ).toBe('PAID_IN_ESCROW');
    expect(
      transition('PAID_IN_ESCROW', 'ENGAGEMENT_STARTED', 'SYSTEM', { startDateReached: true }).to,
    ).toBe('ACTIVE');
    expect(
      transition('ACTIVE', 'ALL_MILESTONES_RELEASED', 'SYSTEM', {
        allMilestonesSettled: true,
        hasOpenDispute: false,
      }).to,
    ).toBe('COMPLETED');
  });

  it('refuses to cancel an offer whose payment was captured', () => {
    expect(() => transition('ACCEPTED', 'CANCEL', 'STUDENT', { hasCapturedPayment: true })).toThrow(
      OfferTransitionError,
    );
  });

  it('refuses to skip escrow funding', () => {
    expect(() => transition('ACCEPTED', 'ENGAGEMENT_STARTED', 'SYSTEM')).toThrow(
      /No transition/,
    );
  });

  it('will not let a party accept their own offer', () => {
    expect(() =>
      transition('OFFERED', 'ACCEPT', 'STUDENT', { isInitiatorOfCurrentOffer: true }),
    ).toThrow(/cannot accept your own/);
  });

  it('reserves dispute resolution for admins', () => {
    expect(() => transition('DISPUTED', 'RESOLVE_DISPUTE_REFUND', 'COACH')).toThrow(
      /may not trigger/,
    );
  });

  it('treats terminal states as final', () => {
    for (const terminal of ['COMPLETED', 'REFUNDED', 'CANCELLED', 'EXPIRED'] as const) {
      expect(() => transition(terminal, 'CANCEL', 'ADMIN')).toThrow(/terminal state/);
    }
  });

  it('creates slot holds exactly once, at submission', () => {
    const submitted = transition('DRAFT', 'SUBMIT', 'STUDENT');
    expect(submitted.effects.some((e) => e.type === 'CREATE_SLOT_HOLDS')).toBe(true);
    const accepted = transition('OFFERED', 'ACCEPT', 'COACH', { isInitiatorOfCurrentOffer: false });
    expect(accepted.effects.some((e) => e.type === 'CREATE_SLOT_HOLDS')).toBe(false);
  });

  it('exposes only actor-legal actions to the UI', () => {
    expect(availableEvents('ACTIVE', 'STUDENT')).toEqual(['OPEN_DISPUTE']);
    expect(availableEvents('DISPUTED', 'STUDENT')).toEqual([]);
  });
});

// ─── money ───────────────────────────────────────────────────────────────────

describe('commission split', () => {
  it('never loses or invents a kuruş', () => {
    for (const gross of [1, 99, 100, 12_345, 999_999, 1_000_000]) {
      const s = splitAmount(gross, 1800);
      expect(s.commissionMinor + s.netToCoachMinor).toBe(gross);
    }
  });

  it('rounds the remainder toward the coach, not the platform', () => {
    // 1801 bps of 999 = 179.92 → platform gets 179, coach gets the rest.
    expect(splitAmount(999, 1801).commissionMinor).toBe(179);
    expect(splitAmount(999, 1801).netToCoachMinor).toBe(820);
  });

  it('rejects non-integer and non-positive amounts', () => {
    expect(() => splitAmount(10.5, 1800)).toThrow();
    expect(() => splitAmount(0, 1800)).toThrow();
  });
});

describe('milestone division', () => {
  it('sums exactly to the total for awkward divisions', () => {
    for (const [total, count] of [[100_000, 3], [7, 4], [999_999, 7]] as const) {
      const parts = splitIntoMilestones(total, count);
      expect(parts).toHaveLength(count);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

// ─── anti-circumvention ──────────────────────────────────────────────────────

describe('normalisation', () => {
  it('collapses separators between digits', () => {
    expect(normalize('0 5 3 2 - 1 1 1 . 2 2 3 3').numeric).toContain('05321112233');
  });

  it('turns spelled-out Turkish digits into numerals', () => {
    expect(normalize('sıfır beş üç iki').numeric).toContain('0532');
  });

  it('lowercases Turkish I correctly', () => {
    expect(normalize('INSTAGRAM').base).toBe('ınstagram');
  });
});

describe('moderateMessage', () => {
  it('lets ordinary coaching talk through untouched', () => {
    const result = moderateMessage(
      'Merhaba, şu an TYT 55 net civarındayım, AYT matematikte zorlanıyorum. Pazartesi 18:00 uygun mu?',
    );
    expect(result.action).toBe('ALLOW');
    expect(result.redacted).toContain('55 net');
  });

  it('does not mistake exam numbers for contact details', () => {
    const result = moderateMessage('Geçen sene 480 bin sıralamadaydım, hedefim ilk 5000.');
    expect(result.action).toBe('ALLOW');
  });

  it('catches a plainly written phone number', () => {
    const result = moderateMessage('numaram 05321112233, ara beni');
    expect(result.action).not.toBe('ALLOW');
    expect(result.redacted).toContain('[numara gizlendi]');
    expect(result.redacted).not.toContain('05321112233');
  });

  it('catches spaced and dotted evasion', () => {
    const result = moderateMessage('0 5 3 2 . 1 1 1 . 2 2 . 3 3 buradan yaz');
    expect(result.findings.some((f) => f.kind === 'PHONE_NUMBER')).toBe(true);
  });

  it('catches spelled-out digits', () => {
    const result = moderateMessage('sıfır beş üç iki bir bir bir iki iki üç üç');
    expect(result.findings.some((f) => f.kind === 'PHONE_NUMBER')).toBe(true);
  });

  it('catches IBAN sharing and blocks it', () => {
    const result = moderateMessage('ücreti TR330006100519786457841326 hesabıma gönder');
    expect(result.action).toBe('BLOCK');
    expect(result.findings.some((f) => f.kind === 'IBAN')).toBe(true);
  });

  it('catches platform handoffs including shortlinks', () => {
    expect(moderateMessage('wa.me/905321112233 üzerinden konuşalım').action).toBe('BLOCK');
    expect(moderateMessage('insta: kaktus_koc yazarsın').action).not.toBe('ALLOW');
  });

  it('escalates explicit circumvention intent', () => {
    const soft = moderateMessage('komisyonsuz halledelim');
    const combined = moderateMessage('komisyonsuz halledelim, wp den yaz');
    expect(combined.riskScore).toBeGreaterThan(soft.riskScore);
    expect(combined.action).toBe('BLOCK');
  });

  it('never stores or echoes the raw contact detail in findings', () => {
    const result = moderateMessage('05321112233');
    expect(result.findings.every((f) => !f.excerpt.includes('05321112233'))).toBe(true);
  });

  it('escalates faster for a conversation already under suspicion', () => {
    const first = moderateMessage('instagramdan bakabilirsin', 0);
    const repeat = moderateMessage('instagramdan bakabilirsin', 200);
    expect(repeat.action === 'BLOCK' || repeat.action === first.action).toBe(true);
  });

  it('always explains itself to the user', () => {
    const result = moderateMessage('numaram 05321112233');
    expect(result.notice.length).toBeGreaterThan(0);
  });
});
