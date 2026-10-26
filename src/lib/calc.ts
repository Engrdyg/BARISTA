import type { Difficulty, NodeStatus } from './types';

// §7.1 Coverage ---------------------------------------------------------------

export interface CoverageNode {
  id: string;
  parent_id: string | null;
  status: NodeStatus;
  subject_id: string;
}

export type LeafScores = Record<NodeStatus, number>;

export interface Progress {
  /** Average leaf score under this node (the node itself if it is a leaf), 0–1. */
  score: number;
  leaves: number;
}

/** Rolled-up progress for every node: a parent shows the average of its leaves. */
export function rollup(nodes: CoverageNode[], scores: LeafScores): Map<string, Progress> {
  const children = new Map<string, CoverageNode[]>();
  for (const n of nodes) {
    if (!n.parent_id) continue;
    if (!children.has(n.parent_id)) children.set(n.parent_id, []);
    children.get(n.parent_id)!.push(n);
  }
  const out = new Map<string, Progress>();
  const visit = (n: CoverageNode): { sum: number; leaves: number } => {
    const kids = children.get(n.id);
    let sum = 0;
    let leaves = 0;
    if (!kids?.length) {
      sum = scores[n.status] ?? 0;
      leaves = 1;
    } else {
      for (const k of kids) {
        const r = visit(k);
        sum += r.sum;
        leaves += r.leaves;
      }
    }
    out.set(n.id, { score: leaves ? sum / leaves : 0, leaves });
    return { sum, leaves };
  };
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) if (!n.parent_id || !ids.has(n.parent_id)) visit(n);
  return out;
}

export function isLeaf(id: string, nodes: CoverageNode[]): boolean {
  return !nodes.some((n) => n.parent_id === id);
}

/** Subject coverage = average leaf score in that subject (0–1), null with no syllabus. */
export function subjectCoverage(nodes: CoverageNode[], scores: LeafScores): number | null {
  const parents = new Set(nodes.map((n) => n.parent_id).filter(Boolean));
  const leaves = nodes.filter((n) => !parents.has(n.id));
  if (!leaves.length) return null;
  return leaves.reduce((s, n) => s + (scores[n.status] ?? 0), 0) / leaves.length;
}

/** Overall = Σ(weight × coverage) ÷ Σ weights (100 with the 2027 weights). Subjects without a syllabus count as 0. */
export function overallCoverage(subjects: { id: string; weight: number }[], bySubject: Map<string, number | null>): number {
  const total = subjects.reduce((s, x) => s + x.weight, 0);
  if (!total) return 0;
  return subjects.reduce((s, x) => s + x.weight * (bySubject.get(x.id) ?? 0), 0) / total;
}

// §7.2 Projected GWA ----------------------------------------------------------

export interface GradedAttempt {
  subject_id: string | null;
  mode: 'drill' | 'mock' | 'bar_day';
  submitted_at: string | null;
  items: { score: number | null; points?: number }[];
}

export interface SubjectScore {
  score: number;
  basis: 'mocks' | 'drills';
  count: number;
}

const PER_PROBLEM = 5;

/** Average of the last 3 graded full mocks; otherwise the last 10 graded drill problems. */
export function subjectScore(attempts: GradedAttempt[], subjectId: string): SubjectScore | null {
  const mine = attempts
    .filter((a) => a.subject_id === subjectId && a.submitted_at)
    .sort((a, b) => Date.parse(b.submitted_at!) - Date.parse(a.submitted_at!));
  const fullyGraded = (a: GradedAttempt) => a.items.length > 0 && a.items.every((i) => i.score !== null);
  const mocks = mine.filter((a) => (a.mode === 'mock' || a.mode === 'bar_day') && fullyGraded(a)).slice(0, 3);
  if (mocks.length) {
    let sum = 0;
    let n = 0;
    for (const a of mocks) for (const i of a.items) {
      sum += i.score!;
      n++;
    }
    return { score: (sum / (n * PER_PROBLEM)) * 100, basis: 'mocks', count: mocks.length };
  }
  const drillItems = mine
    .filter((a) => a.mode === 'drill')
    .flatMap((a) => a.items.filter((i) => i.score !== null))
    .slice(0, 10);
  if (!drillItems.length) return null;
  const sum = drillItems.reduce((s, i) => s + i.score!, 0);
  return { score: (sum / (drillItems.length * PER_PROBLEM)) * 100, basis: 'drills', count: drillItems.length };
}

export interface GwaProjection {
  gwa: number | null;
  partial: boolean;
  missing: string[];
  bySubject: Map<string, SubjectScore | null>;
}

export function projectedGwa(
  subjects: { id: string; code: string; weight: number }[],
  attempts: GradedAttempt[],
): GwaProjection {
  const bySubject = new Map<string, SubjectScore | null>();
  let num = 0;
  let den = 0;
  const missing: string[] = [];
  for (const s of subjects) {
    const sc = subjectScore(attempts, s.id);
    bySubject.set(s.id, sc);
    if (sc) {
      num += s.weight * sc.score;
      den += s.weight;
    } else missing.push(s.code);
  }
  return { gwa: den ? num / den : null, partial: missing.length > 0, missing, bySubject };
}

/** What +10 points in a subject adds to the GWA. */
export function gainFromTen(weight: number): number {
  return (weight * 10) / 100;
}

// §7.3 Pacing -----------------------------------------------------------------

export function minutesPerProblem(timeLimitSec: number, problems: number): number {
  return problems ? timeLimitSec / 60 / problems : 0;
}

/** Positive = ahead. Uses answered count, not the current problem number. */
export function pacingAhead(answered: number, elapsedSec: number, perProblemMin: number): number {
  return answered * perProblemMin - elapsedSec / 60;
}

export function pacingLabel(ahead: number): string {
  const m = Math.round(Math.abs(ahead));
  if (m === 0) return 'On pace';
  return ahead > 0 ? `${m} min ahead` : `${m} min behind`;
}

// §7.4 Planner shares ---------------------------------------------------------

export const DIFFICULTY_FACTOR: Record<Difficulty, number> = { easy: 0.8, normal: 1.0, hard: 1.3 };

export function plannerShares(subjects: { id: string; weight: number; difficulty: Difficulty }[]): Map<string, number> {
  const total = subjects.reduce((s, x) => s + x.weight * DIFFICULTY_FACTOR[x.difficulty], 0);
  return new Map(subjects.map((s) => [s.id, total ? (s.weight * DIFFICULTY_FACTOR[s.difficulty]) / total : 0]));
}

export function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step;
}

/** Weekly minutes per subject = share × available minutes, rounded to 30. */
export function weeklyMinutes(
  subjects: { id: string; weight: number; difficulty: Difficulty }[],
  availableMinutes: number,
): Map<string, number> {
  const shares = plannerShares(subjects);
  return new Map([...shares].map(([id, sh]) => [id, roundTo(sh * availableMinutes, 30)]));
}

// §7.6 Leeches -----------------------------------------------------------------

export const LEECH_LAPSES = 4;
export const isLeech = (lapses: number) => lapses >= LEECH_LAPSES;
