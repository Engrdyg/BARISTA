import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import CardEditor from '../components/CardEditor';
import { Bar, Markdown, SubjectTag } from '../components/ui';
import { isLeech } from '../lib/calc';
import { renderCloze } from '../lib/cloze';
import { db } from '../lib/db';
import { getSettings, useSubjects } from '../lib/hooks';
import { create } from '../lib/repo';
import {
  buildQueue,
  cardFields,
  GRADES,
  gradeItem,
  itemToCard,
  learningSoon,
  previewIntervals,
  scheduler,
  State,
  undoGrade,
  type Grade,
  type QueueEntry,
  type QueueFilter,
  type UndoInfo,
} from '../lib/srs';
import { logSession, pauseTimer, resumeTimer } from '../lib/timer';
import type { CardRow, SettingsData } from '../lib/types';

export default function Review() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const subjects = useSubjects();
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [queue, setQueue] = useState<QueueEntry[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);
  const [undo, setUndo] = useState<{ info: UndoInfo | null; entry: QueueEntry }[]>([]);
  const [editing, setEditing] = useState<CardRow | null>(null);
  const [leech, setLeech] = useState<QueueEntry | null>(null);
  const shownAt = useRef(Date.now());
  const sessionStart = useRef(new Date().toISOString());
  const pausedTimer = useRef<string | null>(null);
  const reviewed = useRef(0);

  const cram = params.get('cram') === '1';
  const filter: QueueFilter = {
    subjectId: params.get('subject'),
    tag: params.get('tag'),
    dueOnly: params.get('due') === '1',
    cram,
  };

  useEffect(() => {
    let live = true;
    (async () => {
      const s = await getSettings();
      const q = await buildQueue(s, filter);
      if (!live) return;
      setSettings(s);
      setQueue(q);
      pausedTimer.current = await pauseTimer();
    })();
    return () => {
      live = false;
      // Log the time spent reviewing, then resume any timer we paused.
      const end = new Date().toISOString();
      if (reviewed.current > 0) {
        void logSession({
          subject_id: filter.subjectId ?? null,
          kind: 'cards',
          source: 'cards',
          started_at: sessionStart.current,
          ended_at: end,
          note: `${reviewed.current} reviews${cram ? ' (cram)' : ''}`,
        });
      }
      void resumeTimer(pausedTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = queue?.[0];

  const grade = useCallback(
    (rating: Grade) => {
      if (!current || !settings || !revealed) return;
      const reschedule = !cram || settings.cramReschedules;
      const duration = Date.now() - shownAt.current;
      // Compute the next state synchronously so the next card shows at once;
      // the write happens in the background.
      let nextItem = current.item;
      const now = new Date();
      const result = reschedule ? scheduler(settings.desiredRetention).next(itemToCard(current.item), now, rating) : undefined;
      if (result) nextItem = { ...current.item, ...cardFields(result.card) };
      const rest = queue!.slice(1);
      const again =
        reschedule && (nextItem.state === State.Learning || nextItem.state === State.Relearning) && Date.parse(nextItem.due) - Date.now() < 30 * 60_000;
      const reinsertAt = Math.min(rest.length, 3);
      const nextQueue = again ? [...rest.slice(0, reinsertAt), { ...current, item: nextItem }, ...rest.slice(reinsertAt)] : cram && rating === 1 ? [...rest, current] : rest;
      setQueue(nextQueue);
      setRevealed(false);
      setDone((d) => d + 1);
      reviewed.current++;
      shownAt.current = Date.now();
      const entry = current;
      void gradeItem(current.item, rating, settings.desiredRetention, duration, { reschedule }, result && { result, now }).then(({ undo: u, updated }) => {
        setUndo((s) => [...s.slice(-20), { info: u, entry }]);
        if (reschedule && isLeech(updated.lapses) && rating === 1) setLeech({ ...entry, item: updated });
      });
    },
    [current, settings, revealed, queue, cram],
  );

  const doUndo = useCallback(async () => {
    const last = undo[undo.length - 1];
    if (!last) return;
    if (last.info) await undoGrade(last.info);
    const restored = last.info ? last.info.before : last.entry.item;
    setQueue((q) => [{ ...last.entry, item: restored }, ...(q ?? []).filter((e) => e.item.id !== restored.id)]);
    setUndo((s) => s.slice(0, -1));
    setRevealed(false);
    setDone((d) => Math.max(0, d - 1));
    reviewed.current = Math.max(0, reviewed.current - 1);
  }, [undo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || (e.target as HTMLElement).closest('input, textarea, select, dialog')) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (!revealed) setRevealed(true);
        else grade(3);
      } else if (['1', '2', '3', '4'].includes(e.key) && revealed) grade(Number(e.key) as Grade);
      else if (e.key.toLowerCase() === 'u') void doUndo();
      else if (e.key.toLowerCase() === 'e' && current) setEditing(current.card);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, grade, doUndo, current, editing]);

  // When the queue empties, offer learning cards coming due soon.
  useEffect(() => {
    if (queue && queue.length === 0 && !cram) {
      void learningSoon(filter).then((soon) => {
        if (soon.length) setQueue(soon);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue?.length]);

  if (!queue || !settings) return <p className="text-muted">Loading cards…</p>;

  if (!current) {
    return (
      <div className="mx-auto max-w-xl py-10 text-center">
        <h1 className="text-2xl font-semibold">{done ? 'Done for now' : 'No cards due'}</h1>
        <p className="mt-2 text-muted">
          {done ? `${done} reviews this session.` : 'No cards due. Make cards from a provision or a digest.'}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          {undo.length > 0 && (
            <button className="btn" onClick={() => void doUndo()}>
              Undo last
            </button>
          )}
          <button className="btn btn-primary" onClick={() => nav('/today')}>
            Back to Today
          </button>
        </div>
      </div>
    );
  }

  const subject = subjects.find((s) => s.id === current.card.subject_id);
  const intervals = previewIntervals(current.item, settings.desiredRetention);
  const isCloze = current.card.type === 'cloze' && current.item.cloze_index !== null;
  const front = isCloze ? renderCloze(current.card.cloze_text, current.item.cloze_index!, 'front') : current.card.front;
  const back = isCloze ? renderCloze(current.card.cloze_text, current.item.cloze_index!, 'back') : current.card.back;

  return (
    <div className="mx-auto flex max-w-2xl flex-col">
      <div className="mb-3 flex items-center justify-between gap-3 text-sm text-muted">
        <Link to="/cards" className="btn btn-ghost btn-sm -ml-2">
          <X /> End session
        </Link>
        <span className="tabular-nums">
          {cram && 'Cram · '}
          {done} done · {queue.length} left
        </span>
      </div>
      <div className="mb-4">
        <Bar value={done / Math.max(1, done + queue.length)} size="sm" label="Session progress" />
      </div>
      <article key={`${current.item.id}-${revealed}`} className={`panel reading-surface min-h-[16rem] p-6 shadow-[var(--shadow-md)] lg:p-8 ${revealed ? 'flip-in' : 'page-in'}`}>
        <div className="mb-3 flex items-center gap-2 text-xs text-muted">
          <SubjectTag subject={subject} />
          {current.item.state === State.New ? 'New' : current.item.state === State.Review ? 'Review' : 'Learning'}
          {isCloze && ` · c${current.item.cloze_index}`}
        </div>
        <Markdown className="reading">{front}</Markdown>
        {revealed && (
          <>
            <hr className="my-4 border-rule" />
            {isCloze ? <Markdown className="reading">{back}</Markdown> : <Markdown className="reading">{back}</Markdown>}
            {isCloze && current.card.back && <Markdown className="reading mt-3 text-muted">{current.card.back}</Markdown>}
          </>
        )}
      </article>

      <div className="sticky bottom-16 mt-4 bg-paper pt-2 pb-2 lg:bottom-0">
        {!revealed ? (
          <button className="btn btn-primary h-14 w-full text-lg" onClick={() => setRevealed(true)}>
            Show answer <span className="ml-2 hidden text-sm opacity-70 lg:inline">Space</span>
          </button>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {GRADES.map((g) => (
              <button
                key={g.rating}
                className={`btn h-16 flex-col gap-0 ${g.rating === 3 ? 'btn-primary' : ''}`}
                style={g.rating === 3 ? undefined : { borderColor: `color-mix(in srgb, ${['', 'var(--danger)', 'var(--warn)', '', 'var(--ok)'][g.rating]} 45%, var(--rule))` }}
                onClick={() => grade(g.rating)}
                aria-keyshortcuts={g.key}
              >
                <span className="font-semibold">{g.label}</span>
                <span className="text-xs opacity-75">{cram && !settings.cramReschedules ? g.key : intervals[g.rating]}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 hidden justify-center gap-5 text-xs text-muted lg:flex">
          <span><kbd className="kbd">Space</kbd> reveal</span>
          <span><kbd className="kbd">1</kbd>–<kbd className="kbd">4</kbd> grade</span>
          <span><kbd className="kbd">U</kbd> undo</span>
          <span><kbd className="kbd">E</kbd> edit</span>
        </div>
        <div className="mt-2 flex justify-center gap-2 lg:hidden">
          <button className="btn btn-sm btn-ghost" onClick={() => void doUndo()} disabled={!undo.length}>
            Undo
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setEditing(current.card)}>
            Edit
          </button>
        </div>
      </div>

      {leech && (
        <div className="fixed inset-x-4 bottom-36 z-40 mx-auto max-w-md rounded-xl border border-rule bg-surface p-4 shadow-lg lg:bottom-8">
          <p className="font-semibold">This card keeps slipping</p>
          <p className="mt-1 text-sm text-muted">It has lapsed {leech.item.lapses} times. Rewrite it, or log the rule as a mistake to fix.</p>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-sm" onClick={() => { setEditing(leech.card); setLeech(null); }}>
              Rewrite
            </button>
            <button
              className="btn btn-sm"
              onClick={async () => {
                await create('mistakes', {
                  subject_id: leech.card.subject_id,
                  node_id: null,
                  source_type: 'card',
                  source_id: leech.card.id,
                  what_went_wrong: 'Card keeps lapsing',
                  correct_rule: leech.card.type === 'cloze' ? leech.card.cloze_text : `${leech.card.front}\n\n${leech.card.back}`,
                  error_type: 'Card lapse',
                  status: 'open',
                  card_id: leech.card.id,
                });
                setLeech(null);
              }}
            >
              Add to mistake log
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setLeech(null)}>
              Not now
            </button>
          </div>
        </div>
      )}
      <CardEditor
        open={!!editing}
        card={editing}
        onClose={() => setEditing(null)}
        onSaved={async (c) => {
          const items = await db.card_items.where('card_id').equals(c.id).toArray();
          setQueue((q) => (q ?? []).map((e) => (e.card.id === c.id ? { card: c, item: items.find((i) => i.id === e.item.id) ?? e.item } : e)).filter((e) => !e.item.deleted_at));
        }}
      />
    </div>
  );
}
