import { db } from './db';
import { getDeviceId, uuid } from './identity';
import { dedupeBank } from './bank';
import { makeRow, patch, putRows } from './repo';
import { logSession, pauseTimer } from './timer';
import { nowIso } from './time';
import type { Attempt, AttemptItem, AttemptMode } from './types';

export async function createAttempt(opts: {
  mode: AttemptMode;
  subjectId: string | null;
  questionIds: string[];
  timeLimitSec: number;
  barDayGroupId?: string | null;
  startNow?: boolean;
}): Promise<Attempt> {
  const attempt = makeRow('attempts', {
    mode: opts.mode,
    subject_id: opts.subjectId,
    started_at: nowIso(),
    time_limit_sec: opts.timeLimitSec,
    submitted_at: null,
    status: 'in_progress',
    device_id: getDeviceId(),
    bar_day_group_id: opts.barDayGroupId ?? null,
  });
  const items = opts.questionIds.map((qid, i) =>
    makeRow('attempt_items', {
      attempt_id: attempt.id,
      question_id: qid,
      position: i + 1,
      answer: '',
      time_spent_sec: 0,
      flagged: false,
      score: null,
      structure: null,
      error_tags: [],
      checklist: null,
      grader_notes: '',
      ai_notes: null,
    }),
  );
  await putRows('attempts', [attempt]);
  await putRows('attempt_items', items);
  await pauseTimer();
  return attempt;
}

export function newGroupId(): string {
  return uuid();
}

export function timeLeftSec(a: Attempt, now = Date.now()): number {
  return Math.max(0, a.time_limit_sec - (now - Date.parse(a.started_at)) / 1000);
}

export async function submitAttempt(id: string): Promise<void> {
  const a = await db.attempts.get(id);
  if (!a || a.status !== 'in_progress') return;
  const end = Math.min(Date.now(), Date.parse(a.started_at) + a.time_limit_sec * 1000);
  const submittedAt = new Date(end).toISOString();
  await patch('attempts', id, { status: 'submitted', submitted_at: submittedAt });
  await logSession({
    subject_id: a.subject_id,
    kind: 'practice',
    source: 'exam',
    started_at: a.started_at,
    ended_at: submittedAt,
    note: a.mode === 'drill' ? 'Drill' : a.mode === 'mock' ? 'Full mock' : 'Mock Bar day',
  });
}

export async function attemptItems(attemptId: string): Promise<AttemptItem[]> {
  return (await db.attempt_items.where('attempt_id').equals(attemptId).toArray())
    .filter((i) => !i.deleted_at)
    .sort((a, b) => a.position - b.position);
}

/** Picks problems for a drill or mock from the bank. */
export async function pickQuestions(opts: {
  subjectId: string | null;
  count: number;
  nodeId?: string | null;
  source?: string | null;
  filter?: 'any' | 'never' | 'low';
}): Promise<string[]> {
  let qs = dedupeBank(await db.questions.toArray()).filter(
    (q) => !q.deleted_at && (!opts.subjectId || q.subject_id === opts.subjectId) && (!opts.source || q.source_label === opts.source),
  );
  if (opts.nodeId) {
    const ids = new Set(
      (await db.node_links.where('node_id').equals(opts.nodeId).toArray())
        .filter((l) => !l.deleted_at && l.target_type === 'question')
        .map((l) => l.target_id),
    );
    qs = qs.filter((q) => ids.has(q.id));
  }
  const items = (await db.attempt_items.toArray()).filter((i) => !i.deleted_at);
  const attempts = new Map((await db.attempts.toArray()).map((a) => [a.id, a]));
  const last = new Map<string, { at: string; score: number | null }>();
  for (const i of items) {
    const at = attempts.get(i.attempt_id)?.started_at ?? i.created_at;
    const prev = last.get(i.question_id);
    if (!prev || prev.at < at) last.set(i.question_id, { at, score: i.score });
  }
  if (opts.filter === 'never') qs = qs.filter((q) => !last.has(q.id));
  if (opts.filter === 'low') qs = qs.filter((q) => (last.get(q.id)?.score ?? 99) < 3);
  // Least recently attempted first, then shuffle within ties.
  qs.sort((a, b) => (last.get(a.id)?.at ?? '').localeCompare(last.get(b.id)?.at ?? '') || Math.random() - 0.5);
  return qs.slice(0, opts.count).map((q) => q.id);
}
