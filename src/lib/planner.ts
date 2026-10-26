import { DIFFICULTY_FACTOR, weeklyMinutes } from './calc';
import { addDays, daysBetween, startOfWeek, weekday } from './time';
import type { Difficulty, NodeStatus, PhaseDef, SessionKind } from './types';

export const PHASE_LABELS: Record<PhaseDef['key'], string> = {
  first_read: 'First read',
  second_read: 'Second read',
  mocks: 'Mocks',
  final: 'Final stretch',
};

/** Default phases: 45% / 30% / 15% / last 10% (at least 3 weeks) of the days until Day 1. */
export function defaultPhases(start: string, day1: string): PhaseDef[] {
  const total = Math.max(1, daysBetween(start, day1));
  const finalDays = Math.max(21, Math.round(total * 0.1));
  const rest = Math.max(0, total - finalDays);
  const fr = Math.round((rest * 45) / 90);
  const sr = Math.round((rest * 30) / 90);
  const mk = rest - fr - sr;
  const p1End = addDays(start, fr - 1);
  const p2End = addDays(p1End, sr);
  const p3End = addDays(p2End, mk);
  return [
    { key: 'first_read', label: 'First read', start, end: p1End },
    { key: 'second_read', label: 'Second read', start: addDays(p1End, 1), end: p2End },
    { key: 'mocks', label: 'Mocks', start: addDays(p2End, 1), end: p3End },
    { key: 'final', label: 'Final stretch', start: addDays(p3End, 1), end: addDays(day1, -1) },
  ].filter((p) => p.start <= p.end) as PhaseDef[];
}

export function phaseOn(phases: PhaseDef[], date: string): PhaseDef | undefined {
  return phases.find((p) => p.start <= date && date <= p.end) ?? (date > (phases.at(-1)?.end ?? '') ? phases.at(-1) : undefined);
}

/** The status a leaf should reach in a phase before the planner moves on. */
export function phaseTarget(phase: PhaseDef['key'] | undefined): NodeStatus {
  return phase === 'first_read' || !phase ? 'read_once' : phase === 'second_read' ? 'reviewed' : 'confident';
}

const ORDER: NodeStatus[] = ['not_started', 'read_once', 'reviewed', 'confident'];

export interface OutlineNode {
  id: string;
  parent_id: string | null;
  sort: number;
  status: NodeStatus;
  needs_work: boolean;
  title: string;
  marker: string;
}

/** Nodes in outline (depth-first) order. */
export function outlineOrder<T extends OutlineNode>(nodes: T[]): T[] {
  const kids = new Map<string | null, T[]>();
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    const p = n.parent_id && ids.has(n.parent_id) ? n.parent_id : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(n);
  }
  for (const l of kids.values()) l.sort((a, b) => a.sort - b.sort);
  const out: T[] = [];
  const walk = (p: string | null) => {
    for (const n of kids.get(p) ?? []) {
      out.push(n);
      walk(n.id);
    }
  };
  walk(null);
  return out;
}

/**
 * Where to continue: the first leaf in outline order below the phase target.
 * From the mocks phase on, Needs work leaves come first.
 */
export function continueNode<T extends OutlineNode>(nodes: T[], phase: PhaseDef['key'] | undefined): T | undefined {
  const ordered = outlineOrder(nodes);
  const parents = new Set(nodes.map((n) => n.parent_id));
  const leaves = ordered.filter((n) => !parents.has(n.id));
  const target = ORDER.indexOf(phaseTarget(phase));
  if (phase === 'mocks' || phase === 'final') {
    const nw = leaves.find((n) => n.needs_work);
    if (nw) return nw;
  }
  return leaves.find((n) => ORDER.indexOf(n.status) < target);
}

export function kindFor(phase: PhaseDef['key'] | undefined, slot: number): SessionKind {
  if (phase === 'mocks') return 'practice';
  if (phase === 'second_read' && slot % 3 === 2) return 'practice';
  return 'reading';
}

// Generation -----------------------------------------------------------------

export interface PlanInput {
  from: string; // generate from this date (inclusive)
  until: string; // up to this date (inclusive)
  hoursByWeekday: number[]; // index 0 = Sunday
  restDays: string[];
  halfDays: string[];
  maxSubjectsPerDay: number;
  phases: PhaseDef[];
  subjects: { id: string; code: string; weight: number; difficulty: Difficulty }[];
  /** Minutes taken by fixed events, per date. */
  eventMinutes: Record<string, number>;
  /** Dates on which nothing is planned (exam days). */
  blackout: string[];
  /** For a date, the subject codes allowed (exam-week order); undefined = all. */
  allowedOn?: (date: string) => string[] | undefined;
}

export interface GeneratedBlock {
  date: string;
  subject_id: string;
  minutes: number;
  kind: SessionKind;
}

const UNIT = 30;

export function dayCapacity(input: PlanInput, date: string): number {
  if (input.restDays.includes(date) || input.blackout.includes(date)) return 0;
  let min = (input.hoursByWeekday[weekday(date)] ?? 0) * 60;
  if (input.halfDays.includes(date)) min /= 2;
  min -= input.eventMinutes[date] ?? 0;
  return Math.max(0, Math.floor(min / UNIT) * UNIT);
}

/**
 * Lays each week's subject time out like a strip: subjects in order of their
 * weekly minutes, cut into days by capacity, at most N subjects a day. Units
 * that don't fit go into spare capacity on days that already have that subject
 * or room for one more. Same order every week keeps gaps under 7 days.
 */
export function generateBlocks(input: PlanInput): GeneratedBlock[] {
  const out: GeneratedBlock[] = [];
  const maxPerDay = Math.max(1, input.maxSubjectsPerDay);
  let weekStart = startOfWeek(input.from);
  while (weekStart <= input.until) {
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      if (d >= input.from && d <= input.until) days.push(d);
    }
    const cap = new Map(days.map((d) => [d, dayCapacity(input, d) / UNIT]));
    const alloc = new Map<string, Map<string, number>>(days.map((d) => [d, new Map()]));

    // Exam-week days: split the day among that day's allowed subjects.
    const normalDays: string[] = [];
    for (const d of days) {
      const allowed = input.allowedOn?.(d);
      if (!allowed) {
        normalDays.push(d);
        continue;
      }
      const subs = input.subjects.filter((s) => allowed.includes(s.code)).slice(0, maxPerDay);
      let c = cap.get(d)!;
      let i = 0;
      while (c > 0 && subs.length) {
        const id = subs[i++ % subs.length].id;
        alloc.get(d)!.set(id, (alloc.get(d)!.get(id) ?? 0) + 1);
        c--;
      }
    }

    const totalUnits = normalDays.reduce((s, d) => s + cap.get(d)!, 0);
    const weekly = weeklyMinutes(input.subjects, totalUnits * UNIT);
    const remaining = new Map(input.subjects.map((s) => [s.id, (weekly.get(s.id) ?? 0) / UNIT]));
    let sum = [...remaining.values()].reduce((a, b) => a + b, 0);
    while (sum > totalUnits) {
      const [id] = [...remaining].sort((a, b) => b[1] - a[1])[0];
      remaining.set(id, remaining.get(id)! - 1);
      sum--;
    }
    const order = [...input.subjects].sort(
      (a, b) =>
        b.weight * DIFFICULTY_FACTOR[b.difficulty] - a.weight * DIFFICULTY_FACTOR[a.difficulty] || a.code.localeCompare(b.code),
    );

    // First pass: the strip.
    let qi = 0;
    for (const d of normalDays) {
      let c = cap.get(d)!;
      const day = alloc.get(d)!;
      while (c > 0 && qi < order.length) {
        const id = order[qi].id;
        const r = remaining.get(id)!;
        if (r <= 0) {
          qi++;
          continue;
        }
        if (!day.has(id) && day.size >= maxPerDay) break;
        const take = Math.min(r, c);
        day.set(id, (day.get(id) ?? 0) + take);
        remaining.set(id, r - take);
        c -= take;
        if (r - take <= 0) qi++;
      }
      cap.set(d, c);
    }
    // Second pass: leftovers into spare capacity.
    for (const s of order) {
      for (const d of normalDays) {
        let r = remaining.get(s.id)!;
        if (r <= 0) break;
        const day = alloc.get(d)!;
        const c = cap.get(d)!;
        if (!c || (!day.has(s.id) && day.size >= maxPerDay)) continue;
        const take = Math.min(r, c);
        day.set(s.id, (day.get(s.id) ?? 0) + take);
        r -= take;
        remaining.set(s.id, r);
        cap.set(d, c - take);
      }
    }

    for (const d of days) {
      const phase = phaseOn(input.phases, d)?.key;
      let slot = 0;
      for (const s of order) {
        const units = alloc.get(d)!.get(s.id);
        if (!units) continue;
        out.push({ date: d, subject_id: s.id, minutes: units * UNIT, kind: kindFor(phase, slot++ + daysBetween(input.from, d)) });
      }
    }
    weekStart = addDays(weekStart, 7);
  }
  return out;
}

/**
 * Exam-week order: the days just before Day 1 for Day 1's subjects, the days
 * between Day 1 and Day 2 for Day 2's, and between Day 2 and Day 3 for Day 3's.
 */
export function examWeekAllowed(
  day1: string,
  day2: string,
  day3: string,
  subjects: { code: string; exam_day: number }[],
  daysBeforeDay1 = 3,
): (date: string) => string[] | undefined {
  const by = (n: number) => subjects.filter((s) => s.exam_day === n).map((s) => s.code);
  return (date) => {
    if (date >= addDays(day1, -daysBeforeDay1) && date < day1) return by(1);
    if (date > day1 && date < day2) return by(2);
    if (date > day2 && date < day3) return by(3);
    return undefined;
  };
}
