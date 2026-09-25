import { describe, expect, it } from 'vitest';
import { addDays, dayLabel, isIsoDate, istanbulToday, mondayOf, weekDays } from '@/lib/planner/week';
import { studyTaskInputSchema } from '@/lib/planner/task-schema';
import { CURRICULUM } from '@/lib/planner/curriculum';
import { dateToIstanbulLocal, inviteTimeProblem, istanbulLocalToDate, isAllowedMeetingUrl, joinState } from '@/lib/meetings/rules';

describe('planner week arithmetic', () => {
  it('finds Monday for every day of the week, including Sunday', () => {
    // 2026-09-21 is a Monday.
    for (let i = 0; i < 7; i++) expect(mondayOf(addDays('2026-09-21', i))).toBe('2026-09-21');
    expect(mondayOf('2026-09-28')).toBe('2026-09-28');
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(weekDays('2026-12-28')).toEqual([
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
    ]);
  });

  it('reads "today" in Istanbul, where 22:30 UTC is already the next day', () => {
    expect(istanbulToday(new Date('2026-09-25T22:30:00Z'))).toBe('2026-09-26');
    expect(istanbulToday(new Date('2026-09-25T20:30:00Z'))).toBe('2026-09-25');
  });

  it('rejects impossible dates', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-9-1')).toBe(false);
    expect(isIsoDate('2026-09-01')).toBe(true);
  });

  it('labels days in Turkish', () => {
    expect(dayLabel('2026-09-21')).toEqual({ weekday: 'Pazartesi', date: '21 Eyl' });
  });
});

describe('study task input', () => {
  const base = { day: '2026-09-21', kind: 'SORU_BANKASI' as const };

  it("accepts a coach's free-text task with no catalog entry", () => {
    const parsed = studyTaskInputSchema.parse({ ...base, description: 'Türev 1–4. testler' });
    expect(parsed.subject).toBeNull();
    expect(parsed.description).toBe('Türev 1–4. testler');
  });

  it('requires at least a subject, a resource or a description', () => {
    expect(studyTaskInputSchema.safeParse({ ...base, description: '  ' }).success).toBe(false);
    expect(studyTaskInputSchema.safeParse({ ...base, subject: 'Matematik' }).success).toBe(true);
  });

  it('requires a unit when a quantity is given', () => {
    expect(studyTaskInputSchema.safeParse({ ...base, subject: 'Fizik', quantity: 40 }).success).toBe(false);
    expect(studyTaskInputSchema.safeParse({ ...base, subject: 'Fizik', quantity: 40, unit: 'SORU' }).success).toBe(true);
  });
});

describe('curriculum', () => {
  it('has no duplicate subjects within an exam part, and no duplicate topics within a subject', () => {
    for (const subjects of Object.values(CURRICULUM)) {
      const names = subjects.map((s) => s.name);
      expect(new Set(names).size).toBe(names.length);
      for (const subject of subjects) expect(new Set(subject.topics).size).toBe(subject.topics.length);
    }
  });
});

describe('meeting rules', () => {
  const now = new Date('2026-09-26T10:00:00Z');
  const start = new Date('2026-09-26T16:00:00Z');
  const end = new Date('2026-09-26T17:00:00Z');

  it('opens the join button 10 minutes early and closes it 30 minutes after the end', () => {
    expect(joinState(start, end, new Date('2026-09-26T15:49:00Z'))).toBe('TOO_EARLY');
    expect(joinState(start, end, new Date('2026-09-26T15:50:00Z'))).toBe('OPEN');
    expect(joinState(start, end, new Date('2026-09-26T17:30:00Z'))).toBe('OPEN');
    expect(joinState(start, end, new Date('2026-09-26T17:31:00Z'))).toBe('ENDED');
  });

  it('reads datetime-local input as Istanbul time and back', () => {
    const date = istanbulLocalToDate('2026-09-26T19:00');
    expect(date?.toISOString()).toBe('2026-09-26T16:00:00.000Z');
    expect(dateToIstanbulLocal(date!)).toBe('2026-09-26T19:00');
    expect(istanbulLocalToDate('26.09.2026 19:00')).toBeNull();
  });

  it('checks lead time, horizon and duration', () => {
    expect(inviteTimeProblem(new Date(now.getTime() + 10 * 60_000), 60, now)).toMatch(/30 dakika/);
    expect(inviteTimeProblem(new Date(now.getTime() + 61 * 86_400_000), 60, now)).toMatch(/60 gün/);
    expect(inviteTimeProblem(start, 50, now)).toMatch(/30, 45, 60/);
    expect(inviteTimeProblem(start, 45, now)).toBeNull();
  });

  it('allows only https Zoom, Meet and Teams links', () => {
    expect(isAllowedMeetingUrl('https://meet.google.com/abc-defg-hij')).toBe(true);
    expect(isAllowedMeetingUrl('https://us02web.zoom.us/j/1')).toBe(true);
    expect(isAllowedMeetingUrl('http://zoom.us/j/1')).toBe(false);
    expect(isAllowedMeetingUrl('https://zoom.us.evil.com/j/1')).toBe(false);
    expect(isAllowedMeetingUrl('https://wa.me/905551112233')).toBe(false);
  });
});
