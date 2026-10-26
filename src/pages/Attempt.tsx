import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Markdown } from '../components/ui';
import { minutesPerProblem, pacingAhead, pacingLabel } from '../lib/calc';
import { db, getMeta, setMeta } from '../lib/db';
import { attemptItems, createAttempt, pickQuestions, submitAttempt, timeLeftSec } from '../lib/exam';
import { getSettings, useSubjects } from '../lib/hooks';
import { getDeviceId } from '../lib/identity';
import { patch, putRows } from '../lib/repo';
import { formatClock } from '../lib/time';
import type { Attempt as AttemptRow, AttemptItem, Question } from '../lib/types';

const WARN_AT = [30, 10, 5, 1];

function words(s: string): number {
  return (s.trim().match(/\S+/g) ?? []).length;
}

export default function Attempt() {
  const { id } = useParams();
  const nav = useNavigate();
  const subjects = useSubjects();
  const [attempt, setAttempt] = useState<AttemptRow | null | undefined>(undefined);
  const [items, setItems] = useState<AttemptItem[]>([]);
  const [questions, setQuestions] = useState<Map<string, Question>>(new Map());
  const [pos, setPos] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [warning, setWarning] = useState<string | null>(null);
  const [allowPaste, setAllowPaste] = useState(false);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [breakFor, setBreakFor] = useState<AttemptRow | null>(null);
  const dirty = useRef<Set<string>>(new Set());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const itemsRef = useRef<AttemptItem[]>([]);
  const lastTick = useRef(Date.now());
  const warned = useRef<Set<number>>(new Set());
  const submitting = useRef(false);
  itemsRef.current = items;

  // Load once; the exam screen keeps its own state so autosave never fights typing.
  useEffect(() => {
    let live = true;
    (async () => {
      const a = await db.attempts.get(id!);
      if (!live) return;
      if (!a || a.deleted_at) return setAttempt(null);
      if (a.status !== 'in_progress') return nav(`/practice/grade/${a.id}`, { replace: true });
      const its = await attemptItems(a.id);
      const qs = await db.questions.bulkGet(its.map((i) => i.question_id));
      const s = await getSettings();
      const p = await getMeta<number | null>(`pause:${a.id}`, null);
      if (!live) return;
      setAllowPaste(s.allowPasteInExam);
      setQuestions(new Map(qs.filter(Boolean).map((q) => [q!.id, q!])));
      setItems(its);
      setPausedAt(p);
      setAttempt(a);
      const left = timeLeftSec(a);
      for (const m of WARN_AT) if (left < m * 60) warned.current.add(m);
    })();
    return () => {
      live = false;
    };
  }, [id, nav]);

  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const ids = [...dirty.current];
    dirty.current.clear();
    const rows = itemsRef.current.filter((i) => ids.includes(i.id));
    if (rows.length) await putRows('attempt_items', rows);
  }, []);

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), 500);
  }, [flush]);

  const update = useCallback(
    (itemId: string, change: Partial<AttemptItem>) => {
      setItems((list) => list.map((i) => (i.id === itemId ? { ...i, ...change } : i)));
      dirty.current.add(itemId);
      scheduleSave();
    },
    [scheduleSave],
  );

  const doSubmit = useCallback(async () => {
    if (!attempt || submitting.current) return;
    submitting.current = true;
    await flush();
    await submitAttempt(attempt.id);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    if (attempt.mode === 'bar_day' && attempt.bar_day_group_id) {
      const subj = subjects.find((s) => s.id === attempt.subject_id);
      if (subj?.session === 'AM') {
        setBreakFor(attempt);
        return;
      }
    }
    nav(`/practice/grade/${attempt.id}`, { replace: true });
  }, [attempt, flush, nav, subjects]);

  // Clock: time left, warnings, per-problem time, auto-submit.
  useEffect(() => {
    if (!attempt || breakFor) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      const dt = (n - lastTick.current) / 1000;
      lastTick.current = n;
      if (pausedAt) return;
      if (document.visibilityState === 'visible' && dt < 5) {
        const it = itemsRef.current[pos];
        if (it) {
          it.time_spent_sec = Math.round((it.time_spent_sec + dt) * 10) / 10;
          dirty.current.add(it.id);
        }
      }
      const left = timeLeftSec(attempt, n);
      for (const m of WARN_AT) {
        if (left <= m * 60 && !warned.current.has(m)) {
          warned.current.add(m);
          setWarning(m === 1 ? '1 minute left' : `${m} minutes left`);
          navigator.vibrate?.(200);
          setTimeout(() => setWarning(null), 8000);
        }
      }
      if (left <= 0) void doSubmit();
    }, 1000);
    const periodic = setInterval(() => void flush(), 10_000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(t);
      clearInterval(periodic);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      void flush();
    };
  }, [attempt, pos, pausedAt, doSubmit, flush, breakFor]);

  // Keyboard: Alt+←/→ previous/next problem.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowRight') setPos((p) => Math.min(itemsRef.current.length - 1, p + 1));
      if (e.altKey && e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (breakFor) return <BreakScreen am={breakFor} />;
  if (attempt === undefined) return <div className="exam p-6">Loading…</div>;
  if (attempt === null)
    return (
      <div className="exam p-6">
        Attempt not found. <Link to="/practice" className="underline">Back to practice</Link>
      </div>
    );
  if (attempt.device_id !== getDeviceId())
    return (
      <div className="exam mx-auto max-w-md p-6">
        <h1 className="text-xl font-semibold">This attempt is open on another device</h1>
        <p className="mt-2 text-muted">To keep answers safe, an attempt can only be answered on the device that started it. Finish it there; it will sync here for grading.</p>
        <Link to="/practice" className="btn mt-4">
          Back to practice
        </Link>
      </div>
    );

  const subject = subjects.find((s) => s.id === attempt.subject_id);
  const effectiveNow = pausedAt ?? now;
  const left = timeLeftSec(attempt, effectiveNow);
  const elapsed = attempt.time_limit_sec - left;
  const answered = items.filter((i) => i.answer.trim()).length;
  const perProblem = minutesPerProblem(attempt.time_limit_sec, items.length);
  const ahead = pacingAhead(answered, elapsed, perProblem);
  const item = items[pos];
  const q = item ? questions.get(item.question_id) : undefined;
  const canPause = attempt.mode === 'drill';
  const modeLabel = attempt.mode === 'drill' ? 'Drill' : attempt.mode === 'mock' ? 'Full mock' : `Mock Bar day`;

  return (
    <div className="exam flex h-dvh flex-col bg-paper text-ink">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule bg-surface px-3 py-2 text-sm">
        <span className="font-semibold">
          {subject?.name ?? 'Practice'}, {modeLabel}
        </span>
        <span className={`ml-auto font-semibold tabular-nums ${left < 300 ? 'text-danger' : ''}`} aria-live="polite">
          {formatClock(left)} left
        </span>
        <span className="tabular-nums">
          Q{pos + 1} of {items.length}
        </span>
        <span className="tabular-nums">{pacingLabel(ahead)}</span>
        <span className="tabular-nums">{words(item?.answer ?? '')} words</span>
        <button className={`btn btn-sm ${item?.flagged ? 'btn-primary' : ''}`} onClick={() => item && update(item.id, { flagged: !item.flagged })} aria-pressed={item?.flagged}>
          {item?.flagged ? 'Flagged' : 'Flag'}
        </button>
        {canPause && (
          <button
            className="btn btn-sm"
            onClick={async () => {
              if (pausedAt) {
                const shift = Date.now() - pausedAt;
                const started_at = new Date(Date.parse(attempt.started_at) + shift).toISOString();
                const a = await patch('attempts', attempt.id, { started_at });
                await setMeta(`pause:${attempt.id}`, null);
                setPausedAt(null);
                if (a) setAttempt(a);
              } else {
                const t = Date.now();
                await flush();
                await setMeta(`pause:${attempt.id}`, t);
                setPausedAt(t);
              }
            }}
          >
            {pausedAt ? 'Resume' : 'Pause'}
          </button>
        )}
        <button
          className="btn btn-sm"
          onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen?.().catch(() => {}))}
        >
          Fullscreen
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => setConfirmSubmit(true)}>
          Submit
        </button>
      </header>
      {warning && (
        <div className="bg-[#FFE14D] px-3 py-1.5 text-center text-sm font-semibold text-[#1D2130]" role="alert">
          {warning}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <nav className="w-14 shrink-0 overflow-y-auto border-r border-rule bg-surface py-1 sm:w-16" aria-label="Problems">
          {items.map((it, i) => (
            <button
              key={it.id}
              onClick={() => setPos(i)}
              className={`flex w-full items-center justify-between px-2 py-1.5 text-sm tabular-nums ${i === pos ? 'bg-[color-mix(in_srgb,var(--ink)_12%,transparent)] font-bold' : ''}`}
              aria-current={i === pos}
              aria-label={`Problem ${i + 1}, ${it.flagged ? 'flagged' : it.answer.trim() ? 'answered' : 'unanswered'}`}
            >
              <span>{i + 1}</span>
              <span aria-hidden>{it.flagged ? '⚑' : it.answer.trim() ? '●' : '○'}</span>
            </button>
          ))}
        </nav>
        {pausedAt ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center">
            <div>
              <p className="text-xl font-semibold">Paused</p>
              <p className="mt-1 text-muted">The clock is stopped. Problems are hidden while paused.</p>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <section className="min-h-0 overflow-y-auto border-b border-rule p-4 md:w-1/2 md:border-r md:border-b-0" aria-label="Problem">
              <h2 className="mb-2 font-semibold">Problem {pos + 1}</h2>
              {q ? <Markdown>{q.text}</Markdown> : <p className="text-muted">This problem was deleted from the bank.</p>}
            </section>
            <section className="flex min-h-0 flex-1 flex-col p-4 md:w-1/2" aria-label="Answer">
              <label htmlFor="answer" className="mb-2 font-semibold">
                Answer
              </label>
              <textarea
                id="answer"
                key={item?.id}
                className="min-h-[10rem] w-full flex-1 resize-none overflow-y-auto rounded border border-rule bg-surface p-3 text-base leading-relaxed text-ink"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                value={item?.answer ?? ''}
                onChange={(e) => item && update(item.id, { answer: e.target.value })}
                onPaste={(e) => {
                  if (!allowPaste) e.preventDefault();
                }}
                onDrop={(e) => {
                  if (!allowPaste) e.preventDefault();
                }}
                autoFocus
              />
              <div className="mt-2 flex justify-between">
                <button className="btn btn-sm" disabled={pos === 0} onClick={() => setPos(pos - 1)}>
                  Previous
                </button>
                <button className="btn btn-sm" disabled={pos >= items.length - 1} onClick={() => setPos(pos + 1)}>
                  Next
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
      {confirmSubmit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="submit-title">
          <div className="w-full max-w-sm rounded-xl border border-rule bg-surface p-5">
            <h2 id="submit-title" className="text-lg font-semibold">
              Submit now?
            </h2>
            <p className="mt-1 text-sm text-muted">
              {answered} of {items.length} answered, {items.filter((i) => i.flagged).length} flagged, {formatClock(left)} left.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn" onClick={() => setConfirmSubmit(false)} autoFocus>
                Keep writing
              </button>
              <button className="btn btn-primary" onClick={() => void doSubmit()}>
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Two-hour break between the morning and afternoon of a mock Bar day. */
export function BreakScreen({ am }: { am: AttemptRow }) {
  const nav = useNavigate();
  const subjects = useSubjects();
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const amSubject = subjects.find((s) => s.id === am.subject_id);
  const pm = subjects.find((s) => s.exam_day === amSubject?.exam_day && s.session === 'PM');
  const breakEnd = Date.parse(am.submitted_at ?? new Date().toISOString()) + 2 * 3600_000;
  const left = Math.max(0, (breakEnd - now) / 1000);
  async function startPm() {
    if (!pm) return;
    const ids = await pickQuestions({ subjectId: pm.id, count: 20 });
    if (!ids.length) return setErr(`Add ${pm.code} problems to the bank first.`);
    const a = await createAttempt({ mode: 'bar_day', subjectId: pm.id, questionIds: ids, timeLimitSec: 240 * 60, barDayGroupId: am.bar_day_group_id });
    nav(`/practice/attempt/${a.id}`, { replace: true });
  }
  return (
    <div className="exam flex min-h-dvh items-center justify-center p-6 text-center">
      <div className="max-w-md">
        <p className="text-sm text-muted">Morning done: {amSubject?.name}</p>
        <h1 className="mt-2 text-3xl font-semibold">Break</h1>
        <p className="mt-2 text-5xl font-bold tabular-nums">{formatClock(left)}</p>
        <p className="mt-3 text-muted">Eat, walk, rest your eyes. Don't review — like the real day.</p>
        <p className="mt-1 text-sm">Afternoon: {pm?.name}</p>
        {err && <p className="mt-2 text-sm text-danger">{err}</p>}
        <div className="mt-6 flex justify-center gap-2">
          <button className="btn btn-primary" onClick={() => void startPm()}>
            {left > 0 ? 'Start afternoon now' : 'Start afternoon'}
          </button>
          <Link to={`/practice/grade/${am.id}`} className="btn">
            Stop here and grade
          </Link>
        </div>
      </div>
    </div>
  );
}
