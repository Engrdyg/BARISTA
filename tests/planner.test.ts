import { describe, expect, it } from 'vitest';
import { continueNode, defaultPhases, generateBlocks, type PlanInput } from '../src/lib/planner';
import { addDays, daysBetween, startOfWeek } from '../src/lib/time';

const subjects = [
  { id: 'POL', code: 'POL', weight: 15, difficulty: 'normal' as const },
  { id: 'COMTAX', code: 'COMTAX', weight: 20, difficulty: 'normal' as const },
  { id: 'CIV', code: 'CIV', weight: 20, difficulty: 'normal' as const },
  { id: 'LAB', code: 'LAB', weight: 10, difficulty: 'normal' as const },
  { id: 'CRIM', code: 'CRIM', weight: 10, difficulty: 'normal' as const },
  { id: 'REM', code: 'REM', weight: 25, difficulty: 'normal' as const },
];

function input(over: Partial<PlanInput> = {}): PlanInput {
  const from = '2026-11-02'; // a Monday
  return {
    from,
    until: addDays(from, 7 * 8 - 1),
    // 50 hours a week: 10h Mon–Fri, rest on weekends.
    hoursByWeekday: [0, 10, 10, 10, 10, 10, 0],
    restDays: [],
    halfDays: [],
    maxSubjectsPerDay: 2,
    phases: defaultPhases(from, '2027-09-05'),
    subjects,
    eventMinutes: {},
    blackout: [],
    ...over,
  };
}

describe('generateBlocks', () => {
  it('weekly minutes match weight × difficulty shares within one 30-minute block', () => {
    const blocks = generateBlocks(input());
    const weeks = new Map<string, Map<string, number>>();
    for (const b of blocks) {
      const w = startOfWeek(b.date);
      if (!weeks.has(w)) weeks.set(w, new Map());
      weeks.get(w)!.set(b.subject_id, (weeks.get(w)!.get(b.subject_id) ?? 0) + b.minutes);
    }
    expect(weeks.size).toBe(8);
    for (const m of weeks.values()) {
      for (const s of subjects) expect(Math.abs((m.get(s.id) ?? 0) - (s.weight / 100) * 3000)).toBeLessThanOrEqual(30);
    }
  });

  it('every subject appears at least once every 7 days, at most 2 a day', () => {
    const blocks = generateBlocks(input({ hoursByWeekday: [4, 8, 8, 8, 8, 8, 6] }));
    const byDay = new Map<string, Set<string>>();
    for (const b of blocks) {
      if (!byDay.has(b.date)) byDay.set(b.date, new Set());
      byDay.get(b.date)!.add(b.subject_id);
    }
    for (const set of byDay.values()) expect(set.size).toBeLessThanOrEqual(2);
    for (const s of subjects) {
      const dates = blocks.filter((b) => b.subject_id === s.id).map((b) => b.date).sort();
      expect(daysBetween('2026-11-02', dates[0])).toBeLessThan(7);
      for (let i = 1; i < dates.length; i++) expect(daysBetween(dates[i - 1], dates[i])).toBeLessThanOrEqual(7);
    }
  });

  it('respects rest days and fixed events', () => {
    const blocks = generateBlocks(input({ restDays: ['2026-11-03'], eventMinutes: { '2026-11-04': 180 } }));
    expect(blocks.filter((b) => b.date === '2026-11-03')).toHaveLength(0);
    const wed = blocks.filter((b) => b.date === '2026-11-04').reduce((s, b) => s + b.minutes, 0);
    expect(wed).toBeLessThanOrEqual(420);
  });
});

describe('phases and continue node', () => {
  it('splits 45/30/15/10 with at least 3 final weeks', () => {
    const p = defaultPhases('2026-11-01', '2027-09-05');
    expect(p.map((x) => x.key)).toEqual(['first_read', 'second_read', 'mocks', 'final']);
    expect(daysBetween(p[3].start, '2027-09-05')).toBeGreaterThanOrEqual(21);
    expect(p[3].end).toBe('2027-09-04');
  });
  it('finds the first leaf below target', () => {
    const nodes = [
      { id: 'a', parent_id: null, sort: 0, status: 'not_started' as const, needs_work: false, title: 'A', marker: 'I.' },
      { id: 'a1', parent_id: 'a', sort: 0, status: 'read_once' as const, needs_work: false, title: 'A1', marker: 'A.' },
      { id: 'a2', parent_id: 'a', sort: 1, status: 'not_started' as const, needs_work: true, title: 'A2', marker: 'B.' },
      { id: 'b', parent_id: null, sort: 1, status: 'not_started' as const, needs_work: false, title: 'B', marker: 'II.' },
    ];
    expect(continueNode(nodes, 'first_read')!.id).toBe('a2');
    expect(continueNode(nodes, 'second_read')!.id).toBe('a1');
    expect(continueNode(nodes, 'mocks')!.id).toBe('a2');
  });
});
