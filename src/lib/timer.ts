import { db } from './db';
import { create, patch, putRows } from './repo';
import { nowIso, startOfManilaDay, todayManila } from './time';
import type { SessionKind, SessionSource, StudySession } from './types';

/** The open timer (a synced row with no ended_at), if any. */
export async function runningTimer(): Promise<StudySession | undefined> {
  const rows = await db.study_sessions.filter((s) => !s.deleted_at && !s.ended_at && s.source === 'timer').toArray();
  return rows.sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
}

export function elapsedSec(s: StudySession, now = Date.now()): number {
  const end = s.ended_at ? Date.parse(s.ended_at) : now;
  const pausedNow = s.paused_at && !s.ended_at ? now - Date.parse(s.paused_at) : 0;
  return Math.max(0, (end - Date.parse(s.started_at) - pausedNow) / 1000 - s.paused_sec);
}

export async function startTimer(fields: {
  subject_id: string | null;
  node_id: string | null;
  kind: SessionKind;
}): Promise<StudySession> {
  const open = await runningTimer();
  if (open) await stopTimer(open.id);
  return create('study_sessions', {
    ...fields,
    source: 'timer',
    started_at: nowIso(),
    ended_at: null,
    duration_sec: 0,
    paused_sec: 0,
    paused_at: null,
    note: '',
  });
}

export async function stopTimer(id: string): Promise<StudySession | undefined> {
  const s = await db.study_sessions.get(id);
  if (!s || s.ended_at) return s;
  const now = Date.now();
  const resumed = resumeFields(s, now);
  const done = { ...s, ...resumed, ended_at: new Date(now).toISOString() };
  done.duration_sec = Math.round(elapsedSec(done, now));
  await putRows('study_sessions', [done]);
  if (done.node_id) await markStudied(done.node_id);
  return done;
}

function resumeFields(s: StudySession, now: number) {
  if (!s.paused_at) return {};
  return { paused_sec: s.paused_sec + (now - Date.parse(s.paused_at)) / 1000, paused_at: null };
}

/** Pauses the open timer (while cards or an exam log their own time). */
export async function pauseTimer(): Promise<string | null> {
  const s = await runningTimer();
  if (!s || s.paused_at) return null;
  await patch('study_sessions', s.id, { paused_at: nowIso() });
  return s.id;
}

export async function resumeTimer(id: string | null): Promise<void> {
  if (!id) return;
  const s = await db.study_sessions.get(id);
  if (!s || s.ended_at || !s.paused_at) return;
  await putRows('study_sessions', [{ ...s, ...resumeFields(s, Date.now()) }]);
}

export async function markStudied(nodeId: string): Promise<void> {
  const n = await db.syllabus_nodes.get(nodeId);
  if (!n) return;
  await patch('syllabus_nodes', nodeId, { last_studied_at: nowIso(), times_studied: (n.times_studied ?? 0) + 1 });
}

/** Records a finished block of time (cards, exam, manual entry). */
export async function logSession(fields: {
  subject_id: string | null;
  node_id?: string | null;
  kind: SessionKind;
  source: SessionSource;
  started_at: string;
  ended_at: string;
  note?: string;
}): Promise<StudySession> {
  const duration = Math.max(0, Math.round((Date.parse(fields.ended_at) - Date.parse(fields.started_at)) / 1000));
  return create('study_sessions', {
    subject_id: fields.subject_id,
    node_id: fields.node_id ?? null,
    kind: fields.kind,
    source: fields.source,
    started_at: fields.started_at,
    ended_at: fields.ended_at,
    duration_sec: duration,
    paused_sec: 0,
    paused_at: null,
    note: fields.note ?? '',
  });
}

/** Seconds studied today (Manila), finished sessions plus the open timer. */
export async function secondsToday(): Promise<number> {
  const from = startOfManilaDay(todayManila()).toISOString();
  const rows = await db.study_sessions.where('started_at').aboveOrEqual(from).filter((s) => !s.deleted_at).toArray();
  return rows.reduce((sum, s) => sum + (s.ended_at ? s.duration_sec : elapsedSec(s)), 0);
}
