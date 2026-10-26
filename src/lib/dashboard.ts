import { subjectCoverage } from './calc';
import { db } from './db';
import { continueNode, phaseOn } from './planner';
import { buildQueue, State } from './srs';
import { addDays, manilaDate, todayManila } from './time';
import type { Attempt, CardRow, Law, Plan, PlanBlock, Provision, SettingsData, Subject, SyllabusNode } from './types';

// Everything the Today dashboard shows, derived from stored records only.

export interface RecentItem {
  kind: 'provision' | 'node' | 'cards' | 'attempt';
  at: string;
  title: string;
  detail: string;
  subjectId: string | null;
  to: string;
  inProgress?: boolean;
}

export interface DayActivity {
  date: string;
  minutes: number;
  reviews: number;
}

export interface DashboardData {
  coverage: number | null;
  coverageBySubject: Map<string, number | null>;
  streak: number;
  studiedToday: boolean;
  accuracy: { value: number; delta: number | null; count: number } | null;
  due: { reviews: number; fresh: number; bySubject: Record<string, number>; totalCards: number };
  openMistakes: number;
  needsWork: SyllabusNode[];
  lowScored: number;
  upcoming7: number;
  plan: Plan | null;
  todayBlocks: PlanBlock[];
  missed: PlanBlock[];
  nodes: SyllabusNode[];
  phase: ReturnType<typeof phaseOn>;
  recent: RecentItem[];
  week: DayActivity[];
  hasAnyData: boolean;
}

function latestPlan(plans: Plan[]): Plan | null {
  return plans.filter((p) => !p.deleted_at).sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0] ?? null;
}

export async function loadDashboard(settings: SettingsData, subjects: Subject[]): Promise<DashboardData> {
  const today = todayManila();
  const [nodes, sessions, logs, attempts, items, plans, mistakes, provisions, laws, cards, questions] = await Promise.all([
    db.syllabus_nodes.filter((n) => !n.deleted_at && !n.unmatched).toArray(),
    db.study_sessions.filter((s) => !s.deleted_at).toArray(),
    db.review_logs.filter((l) => !l.deleted_at).toArray(),
    db.attempts.filter((a) => !a.deleted_at).toArray(),
    db.attempt_items.filter((i) => !i.deleted_at).toArray(),
    db.plans.toArray(),
    db.mistakes.filter((m) => !m.deleted_at && m.status === 'open').toArray(),
    db.provisions.filter((p) => !p.deleted_at && !!p.last_read_at).toArray(),
    db.laws.filter((l) => !l.deleted_at).toArray(),
    db.cards.filter((c) => !c.deleted_at).toArray(),
    db.questions.filter((q) => !q.deleted_at).count(),
  ]);

  // Coverage
  const coverageBySubject = new Map(subjects.map((s) => [s.id, subjectCoverage(nodes.filter((n) => n.subject_id === s.id), settings.leafScores)]));
  const withSyllabus = subjects.filter((s) => coverageBySubject.get(s.id) !== null);
  const coverage = withSyllabus.length
    ? subjects.reduce((t, s) => t + s.weight * (coverageBySubject.get(s.id) ?? 0), 0) / subjects.reduce((t, s) => t + s.weight, 0)
    : null;

  // Streak: consecutive days with study time, reviews or a submitted attempt.
  // Planned rest days never break it.
  const plan = latestPlan(plans);
  const rest = new Set(plan?.rest_rules.restDays ?? []);
  const active = new Set<string>();
  for (const s of sessions) if (s.duration_sec > 0 || !s.ended_at) active.add(manilaDate(s.started_at));
  for (const l of logs) active.add(manilaDate(l.reviewed_at));
  for (const a of attempts) if (a.submitted_at) active.add(manilaDate(a.submitted_at));
  const studiedToday = active.has(today);
  let streak = 0;
  let d = studiedToday ? today : addDays(today, -1);
  for (let guard = 0; guard < 1000; guard++) {
    if (active.has(d)) streak++;
    else if (!rest.has(d)) break;
    d = addDays(d, -1);
  }

  // Practice: average self-graded score of the last 10 graded problems vs the 10 before.
  const attemptTime = new Map(attempts.map((a) => [a.id, a.submitted_at ?? a.started_at]));
  const graded = items
    .filter((i) => i.score !== null)
    .sort((a, b) => (attemptTime.get(b.attempt_id) ?? '').localeCompare(attemptTime.get(a.attempt_id) ?? ''));
  const avg = (xs: typeof graded) => (xs.reduce((t, i) => t + i.score!, 0) / (xs.length * 5)) * 100;
  const last = graded.slice(0, 10);
  const prev = graded.slice(10, 20);
  const accuracy = last.length ? { value: avg(last), delta: prev.length >= 3 ? avg(last) - avg(prev) : null, count: graded.length } : null;

  // Review queue
  const queue = await buildQueue(settings);
  const bySubject: Record<string, number> = {};
  let reviews = 0;
  let fresh = 0;
  for (const e of queue) {
    if (e.item.state === State.New) fresh++;
    else {
      reviews++;
      const k = e.card.subject_id ?? 'none';
      bySubject[k] = (bySubject[k] ?? 0) + 1;
    }
  }
  const weekAhead = addDays(today, 7);
  const upcoming7 = (await db.card_items.toArray()).filter(
    (i) => !i.deleted_at && i.state !== State.New && manilaDate(i.due) > today && manilaDate(i.due) <= weekAhead,
  ).length;
  const lastScore = new Map<string, number>();
  for (const i of [...graded].reverse()) lastScore.set(i.question_id, i.score!);
  const lowScored = [...lastScore.values()].filter((s) => s < 3).length;

  // Plan
  const blocks = plan ? (await db.plan_blocks.where('plan_id').equals(plan.id).toArray()).filter((b) => !b.deleted_at) : [];
  const todayBlocks = blocks.filter((b) => b.date === today && b.status !== 'moved');
  const missed = blocks.filter((b) => b.date < today && b.status === 'planned' && b.date >= addDays(today, -14));

  // Recent activity, newest first
  const recent: RecentItem[] = [];
  const lawById = new Map<string, Law>(laws.map((l) => [l.id, l]));
  const lastProv = provisions.sort((a, b) => b.last_read_at!.localeCompare(a.last_read_at!))[0] as Provision | undefined;
  if (lastProv) {
    const law = lawById.get(lastProv.law_id);
    recent.push({
      kind: 'provision',
      at: lastProv.last_read_at!,
      title: `${lastProv.label}${law?.short_name ? ` ${law.short_name}` : ''}`,
      detail: law?.title ?? 'Codal provision',
      subjectId: law?.primary_subject_id ?? null,
      to: `/codals/${lastProv.law_id}#p-${lastProv.id}`,
    });
  }
  const lastNode = nodes.filter((n) => n.last_studied_at).sort((a, b) => b.last_studied_at!.localeCompare(a.last_studied_at!))[0];
  if (lastNode) {
    const s = subjects.find((x) => x.id === lastNode.subject_id);
    recent.push({ kind: 'node', at: lastNode.last_studied_at!, title: lastNode.title, detail: `${s?.code ?? ''} syllabus`, subjectId: lastNode.subject_id, to: `/syllabus/${s?.code}` });
  }
  const lastLog = logs.sort((a, b) => b.reviewed_at.localeCompare(a.reviewed_at))[0];
  if (lastLog) {
    const item = await db.card_items.get(lastLog.card_item_id);
    const card = item ? ((await db.cards.get(item.card_id)) as CardRow | undefined) : undefined;
    const s = subjects.find((x) => x.id === card?.subject_id);
    const todayReviews = logs.filter((l) => manilaDate(l.reviewed_at) === manilaDate(lastLog.reviewed_at)).length;
    recent.push({
      kind: 'cards',
      at: lastLog.reviewed_at,
      title: `${s ? `${s.code} ` : ''}flashcards`,
      detail: `${todayReviews} reviews that day`,
      subjectId: card?.subject_id ?? null,
      to: `/cards/review${card?.subject_id ? `?subject=${card.subject_id}` : ''}`,
    });
  }
  const lastAttempt = [...attempts].sort((a, b) => b.started_at.localeCompare(a.started_at))[0] as Attempt | undefined;
  if (lastAttempt) {
    const s = subjects.find((x) => x.id === lastAttempt.subject_id);
    const n = items.filter((i) => i.attempt_id === lastAttempt.id).length;
    const mode = lastAttempt.mode === 'drill' ? 'Drill' : lastAttempt.mode === 'mock' ? 'Full mock' : 'Mock Bar day';
    recent.push({
      kind: 'attempt',
      at: lastAttempt.submitted_at ?? lastAttempt.started_at,
      title: `${s ? `${s.code} ` : ''}${mode}`,
      detail: lastAttempt.status === 'in_progress' ? `${n} problems · in progress` : lastAttempt.status === 'graded' ? `${n} problems · graded` : `${n} problems · ready to grade`,
      subjectId: lastAttempt.subject_id,
      to: lastAttempt.status === 'in_progress' ? `/practice/attempt/${lastAttempt.id}` : `/practice/grade/${lastAttempt.id}`,
      inProgress: lastAttempt.status === 'in_progress',
    });
  }
  recent.sort((a, b) => Number(!!b.inProgress) - Number(!!a.inProgress) || b.at.localeCompare(a.at));

  // Last 7 days of study
  const week: DayActivity[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = addDays(today, -i);
    week.push({
      date,
      minutes: Math.round(sessions.filter((s) => s.ended_at && manilaDate(s.started_at) === date).reduce((t, s) => t + s.duration_sec, 0) / 60),
      reviews: logs.filter((l) => manilaDate(l.reviewed_at) === date).length,
    });
  }

  return {
    coverage,
    coverageBySubject,
    streak,
    studiedToday,
    accuracy,
    due: { reviews, fresh, bySubject, totalCards: cards.length },
    openMistakes: mistakes.length,
    needsWork: nodes.filter((n) => n.needs_work).slice(0, 5),
    lowScored,
    upcoming7,
    plan,
    todayBlocks,
    missed,
    nodes,
    phase: plan ? phaseOn(plan.phases, today) : undefined,
    recent,
    week,
    hasAnyData: nodes.length + cards.length + sessions.length + questions + provisions.length > 0,
  };
}

/** Where to continue in a subject for the current phase. */
export function nextFor(data: DashboardData, subjectId: string) {
  return continueNode(
    data.nodes.filter((n) => n.subject_id === subjectId),
    data.phase?.key,
  );
}
