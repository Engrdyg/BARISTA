import { describe, expect, it } from 'vitest';
import {
  gainFromTen,
  overallCoverage,
  pacingAhead,
  pacingLabel,
  projectedGwa,
  rollup,
  subjectCoverage,
  weeklyMinutes,
  type GradedAttempt,
} from '../src/lib/calc';

const scores = { not_started: 0, read_once: 0.4, reviewed: 0.75, confident: 1 };

describe('coverage', () => {
  const nodes = [
    { id: 'a', parent_id: null, status: 'not_started' as const, subject_id: 's' },
    { id: 'a1', parent_id: 'a', status: 'confident' as const, subject_id: 's' },
    { id: 'a2', parent_id: 'a', status: 'read_once' as const, subject_id: 's' },
    { id: 'b', parent_id: null, status: 'reviewed' as const, subject_id: 's' },
  ];
  it('averages leaves only', () => {
    expect(subjectCoverage(nodes, scores)).toBeCloseTo((1 + 0.4 + 0.75) / 3);
    expect(rollup(nodes, scores).get('a')!.score).toBeCloseTo(0.7);
  });
  it('weights overall by subject', () => {
    const subjects = [
      { id: 'x', weight: 25 },
      { id: 'y', weight: 75 },
    ];
    expect(overallCoverage(subjects, new Map([['x', 1], ['y', 0.2]]))).toBeCloseTo(0.4);
  });
});

describe('projected GWA', () => {
  const subjects = [
    { id: 'rem', code: 'REM', weight: 25 },
    { id: 'lab', code: 'LAB', weight: 10 },
  ];
  const mock = (sid: string, day: number, s: number): GradedAttempt => ({
    subject_id: sid,
    mode: 'mock',
    submitted_at: `2027-03-0${day}T00:00:00Z`,
    items: Array.from({ length: 20 }, () => ({ score: s })),
  });
  it('averages the last 3 mocks and flags partial', () => {
    const p = projectedGwa(subjects, [mock('rem', 1, 1), mock('rem', 2, 4), mock('rem', 3, 4), mock('rem', 4, 4)]);
    expect(p.bySubject.get('rem')!.score).toBeCloseTo(80);
    expect(p.gwa).toBeCloseTo(80);
    expect(p.partial).toBe(true);
    expect(p.missing).toEqual(['LAB']);
  });
  it('falls back to the last 10 drill problems', () => {
    const drill: GradedAttempt = {
      subject_id: 'lab',
      mode: 'drill',
      submitted_at: '2027-01-01T00:00:00Z',
      items: [{ score: 5 }, { score: 2.5 }],
    };
    const p = projectedGwa(subjects, [drill, mock('rem', 1, 3)]);
    expect(p.bySubject.get('lab')!.score).toBeCloseTo(75);
    expect(p.gwa).toBeCloseTo((25 * 60 + 10 * 75) / 35);
  });
  it('gain from +10 points', () => {
    expect(gainFromTen(25)).toBe(2.5);
    expect(gainFromTen(10)).toBe(1);
  });
});

describe('pacing', () => {
  it('uses answered count', () => {
    expect(pacingAhead(8, 90 * 60, 12)).toBe(6);
    expect(pacingLabel(6)).toBe('6 min ahead');
    expect(pacingLabel(-3.4)).toBe('3 min behind');
  });
});

describe('planner shares', () => {
  it('matches weight × difficulty within one 30-minute block at 50 h/week', () => {
    const subjects = [
      { id: 'POL', weight: 15, difficulty: 'normal' as const },
      { id: 'COMTAX', weight: 20, difficulty: 'normal' as const },
      { id: 'CIV', weight: 20, difficulty: 'normal' as const },
      { id: 'LAB', weight: 10, difficulty: 'normal' as const },
      { id: 'CRIM', weight: 10, difficulty: 'normal' as const },
      { id: 'REM', weight: 25, difficulty: 'normal' as const },
    ];
    const m = weeklyMinutes(subjects, 50 * 60);
    for (const s of subjects) expect(Math.abs(m.get(s.id)! - (s.weight / 100) * 3000)).toBeLessThanOrEqual(30);
  });
});
