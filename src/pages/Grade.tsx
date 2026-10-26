import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import CardEditor, { type CardDraft } from '../components/CardEditor';
import { Field, Markdown, Modal, PageHeader, Section, SubjectTag } from '../components/ui';
import { db } from '../lib/db';
import { createAttempt, pickQuestions } from '../lib/exam';
import { useLive, useSettings, useSubjects } from '../lib/hooks';
import { cloudEnabled, supabase } from '../lib/supabase';
import { create, patch } from '../lib/repo';
import { formatDuration, manilaDate, shortDate } from '../lib/time';
import type { AttemptItem, Question, StructureMark } from '../lib/types';

const MARKS: StructureMark[] = ['yes', 'partly', 'no'];
const MARK_LABEL: Record<StructureMark, string> = { yes: 'Yes', partly: 'Partly', no: 'No' };
const STRUCT_KEYS = ['a', 's', 'd', 'f', 'g', 'h'];
const TAG_KEYS = ['z', 'x', 'c', 'v', 'b', 'n', 'm'];

function MistakeModal({ item, q, subjectId, onClose }: { item: AttemptItem; q: Question | undefined; subjectId: string | null; onClose: () => void }) {
  const links = useLive(() => (q ? db.node_links.where('target_id').equals(q.id).filter((l) => !l.deleted_at).toArray() : []), [q?.id]) ?? [];
  const [what, setWhat] = useState(item.error_tags.join(', '));
  const [rule, setRule] = useState('');
  const settings = useSettings();
  const [type, setType] = useState(item.error_tags[0] ?? settings.errorTags[0] ?? '');
  return (
    <Modal open onClose={onClose} title="Add to mistake log">
      <div className="space-y-3">
        <Field label="What went wrong" htmlFor="mk-what">
          <textarea id="mk-what" className="textarea" value={what} onChange={(e) => setWhat(e.target.value)} />
        </Field>
        <Field label="Correct rule" htmlFor="mk-rule">
          <textarea id="mk-rule" className="textarea reading" value={rule} onChange={(e) => setRule(e.target.value)} />
        </Field>
        <Field label="Error type" htmlFor="mk-type">
          <select id="mk-type" className="select" value={type} onChange={(e) => setType(e.target.value)}>
            {settings.errorTags.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <button
          className="btn btn-primary"
          disabled={!what.trim()}
          onClick={async () => {
            await create('mistakes', {
              subject_id: q?.subject_id ?? subjectId,
              node_id: links[0]?.node_id ?? null,
              source_type: 'attempt',
              source_id: item.id,
              what_went_wrong: what.trim(),
              correct_rule: rule.trim(),
              error_type: type,
              status: 'open',
              card_id: null,
            });
            onClose();
          }}
        >
          Save mistake
        </button>
      </div>
    </Modal>
  );
}

function AiNotes({ item, q }: { item: AttemptItem; q: Question | undefined }) {
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const used = useLive(async () => {
    const month = manilaDate(new Date()).slice(0, 7);
    return (await db.attempt_items.toArray()).filter((i) => i.ai_notes && (i.ai_notes as { at?: string }).at?.startsWith(month)).length;
  });
  if (!cloudEnabled || !settings.aiNotesEnabled) return null;
  const notes = item.ai_notes as null | {
    at: string;
    structure?: { part: string; mark: string; reason: string }[];
    missingPoints?: string[];
    conflicts?: string[];
    suggestedScore?: number;
    notes?: string;
  };
  return (
    <div className="rounded-lg border border-dashed border-rule p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold">AI notes — check against the reference</h4>
        {!notes && (
          <button
            className="btn btn-sm"
            disabled={busy || !q?.reference_answer || !item.answer.trim() || (used ?? 0) >= settings.aiMonthlyCap}
            title={!q?.reference_answer ? 'Needs a reference answer' : undefined}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              const { data, error } = await supabase!.functions.invoke('essay-feedback', {
                body: { problem: q!.text, answer: item.answer, reference: q!.reference_answer, template: settings.structureTemplate },
              });
              setBusy(false);
              if (error) return setErr(error.message);
              await patch('attempt_items', item.id, { ai_notes: { ...data, at: new Date().toISOString() } });
            }}
          >
            {busy ? 'Asking…' : 'Get AI notes'}
          </button>
        )}
      </div>
      {!q?.reference_answer && <p className="mt-1 text-muted">Add a reference answer to this problem to compare against.</p>}
      {(used ?? 0) >= settings.aiMonthlyCap && !notes && <p className="mt-1 text-muted">Monthly limit reached ({settings.aiMonthlyCap}).</p>}
      {err && <p className="mt-1 text-danger">{err}</p>}
      {notes && (
        <div className="mt-2 space-y-2">
          {notes.structure?.map((s) => (
            <p key={s.part}>
              <strong>{s.part}:</strong> {s.mark} — {s.reason}
            </p>
          ))}
          {!!notes.missingPoints?.length && (
            <div>
              <strong>Missing points</strong>
              <ul className="list-disc pl-5">
                {notes.missingPoints.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {!!notes.conflicts?.length && (
            <div>
              <strong>Conflicts with the reference</strong>
              <ul className="list-disc pl-5">
                {notes.conflicts.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {notes.suggestedScore !== undefined && <p>Suggested score: {notes.suggestedScore}/5 (yours stays the official score)</p>}
          {notes.notes && <p>{notes.notes}</p>}
        </div>
      )}
    </div>
  );
}

export default function Grade() {
  const { id } = useParams();
  const nav = useNavigate();
  const subjects = useSubjects();
  const settings = useSettings();
  const [pos, setPos] = useState(0);
  const [mistakeFor, setMistakeFor] = useState<AttemptItem | null>(null);
  const [card, setCard] = useState<CardDraft | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const data = useLive(async () => {
    const attempt = await db.attempts.get(id!);
    if (!attempt) return null;
    const items = (await db.attempt_items.where('attempt_id').equals(attempt.id).toArray()).filter((i) => !i.deleted_at).sort((a, b) => a.position - b.position);
    const qs = await db.questions.bulkGet(items.map((i) => i.question_id));
    const checklists = (await db.form_checklists.toArray()).filter((c) => !c.deleted_at);
    const siblings = attempt.bar_day_group_id ? (await db.attempts.toArray()).filter((a) => a.bar_day_group_id === attempt.bar_day_group_id && !a.deleted_at) : [];
    return { attempt, items, questions: new Map(qs.filter(Boolean).map((q) => [q!.id, q!])), checklists, siblings };
  }, [id]);

  // Local overlay so grading by keyboard is instant and never reads a stale row.
  const [over, setOver] = useState<Record<string, Partial<AttemptItem>>>({});
  const items = useMemo(() => (data ? data.items.map((i) => ({ ...i, ...over[i.id] })) : []), [data, over]);
  const item = items[pos];
  const q = item ? data?.questions.get(item.question_id) : undefined;

  const setItem = useCallback(
    async (change: Partial<AttemptItem>, target?: AttemptItem) => {
      const it = target ?? item;
      if (!it || !data) return;
      setOver((o) => ({ ...o, [it.id]: { ...o[it.id], ...change } }));
      await patch('attempt_items', it.id, change);
      const after = items.map((i) => (i.id === it.id ? { ...i, ...change } : i));
      if (data.attempt.status !== 'graded' && after.every((i) => i.score !== null)) await patch('attempts', data.attempt.id, { status: 'graded' });
    },
    [item, items, data],
  );
  const latest = useRef({ item, setItem });
  latest.current = { item, setItem };

  const template = settings.structureTemplate;
  const tags = settings.errorTags;
  const count = items.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { item, setItem } = latest.current;
      if (!item || mistakeFor || card) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, dialog')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (/^[0-5]$/.test(e.key)) void setItem({ score: Number(e.key) });
      else if (e.key === '.' && item.score !== null) void setItem({ score: item.score % 1 ? Math.floor(item.score) : Math.min(5, item.score + 0.5) });
      else if (e.key === '+' || e.key === '=') void setItem({ score: Math.min(5, (item.score ?? 0) + 0.5) });
      else if (e.key === '-') void setItem({ score: Math.max(0, (item.score ?? 0) - 0.5) });
      else if (STRUCT_KEYS.includes(k) && STRUCT_KEYS.indexOf(k) < template.length) {
        const part = template[STRUCT_KEYS.indexOf(k)];
        const cur = item.structure?.[part];
        const next = cur ? MARKS[(MARKS.indexOf(cur) + 1) % MARKS.length] : 'yes';
        void setItem({ structure: { ...(item.structure ?? {}), [part]: next } });
      } else if (TAG_KEYS.includes(k) && TAG_KEYS.indexOf(k) < tags.length) {
        const t = tags[TAG_KEYS.indexOf(k)];
        void setItem({ error_tags: item.error_tags.includes(t) ? item.error_tags.filter((x) => x !== t) : [...item.error_tags, t] });
      } else if (k === 'j' || e.key === 'Enter' || e.key === 'ArrowRight') setPos((p) => Math.min(count - 1, p + 1));
      else if (k === 'k' || e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 1));
      else if (k === 'l') setMistakeFor(item);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [template, tags, count, mistakeFor, card]);

  const summary = useMemo(() => {
    if (!data) return null;
    const scored = items.filter((i) => i.score !== null);
    const total = scored.reduce((s, i) => s + i.score!, 0);
    const possible = items.length * 5;
    const used = data.attempt.submitted_at ? (Date.parse(data.attempt.submitted_at) - Date.parse(data.attempt.started_at)) / 1000 : 0;
    const slowest = [...items].sort((a, b) => b.time_spent_sec - a.time_spent_sec).slice(0, 3);
    const tagCounts = new Map<string, number>();
    for (const i of items) for (const t of i.error_tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    return { scored: scored.length, total, possible, pct: possible ? (total / possible) * 100 : 0, used, slowest, tagCounts };
  }, [data, items]);

  if (data === undefined) return <p className="text-muted">Loading…</p>;
  if (data === null) return <p>Attempt not found.</p>;
  if (data.attempt.status === 'in_progress')
    return (
      <p>
        This attempt is still in progress. <Link className="underline" to={`/practice/attempt/${data.attempt.id}`}>Resume it</Link>
      </p>
    );

  const subject = subjects.find((s) => s.id === data.attempt.subject_id);
  const checklist = q?.type === 'practical' ? data.checklists.find((c) => c.form_type.toLowerCase() === q.form_type.toLowerCase()) : undefined;
  const amPending =
    data.attempt.mode === 'bar_day' && subject?.session === 'AM' && data.siblings.length === 1
      ? subjects.find((s) => s.exam_day === subject.exam_day && s.session === 'PM')
      : undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <>
            <SubjectTag subject={subject} /> Grade {data.attempt.mode === 'drill' ? 'drill' : data.attempt.mode === 'mock' ? 'mock' : 'mock Bar day'}
          </>
        }
        subtitle={`${shortDate(manilaDate(data.attempt.started_at))} · ${summary!.scored} of ${data.items.length} graded`}
        actions={
          <Link to="/practice" className="btn">
            Practice
          </Link>
        }
      />
      {amPending && (
        <Section title="Afternoon session">
          <p className="text-sm text-muted">The morning is done. Start {amPending.code} when your break is over.</p>
          <button
            className="btn btn-primary mt-2"
            onClick={async () => {
              const ids = await pickQuestions({ subjectId: amPending.id, count: 20 });
              if (!ids.length) return alert(`Add ${amPending.code} problems to the bank first.`);
              const a = await createAttempt({ mode: 'bar_day', subjectId: amPending.id, questionIds: ids, timeLimitSec: 240 * 60, barDayGroupId: data.attempt.bar_day_group_id });
              nav(`/practice/attempt/${a.id}`);
            }}
          >
            Start {amPending.code}
          </button>
        </Section>
      )}

      <div className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4" role="tablist" aria-label="Problems">
        {items.map((it, i) => (
          <button
            key={it.id}
            role="tab"
            aria-selected={i === pos}
            className={`btn btn-sm min-w-[2.5rem] shrink-0 tabular-nums ${i === pos ? 'btn-primary' : ''}`}
            onClick={() => setPos(i)}
            title={it.score !== null ? `${it.score}/5` : 'Not graded'}
          >
            {i + 1}
            {it.score !== null ? <span className="text-xs opacity-75">·{it.score}</span> : ''}
          </button>
        ))}
      </div>

      {item && (
        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-3">
            <section className="panel max-h-[60vh] overflow-y-auto p-3">
              <h3 className="mb-1 text-sm font-semibold">
                Problem {pos + 1} {q?.source_label && <span className="font-normal text-muted">· {q.source_label} {q.number && `#${q.number}`}</span>}
              </h3>
              {q ? <Markdown className="reading text-base">{q.text}</Markdown> : <p className="text-muted">Problem deleted.</p>}
            </section>
            <section className="panel max-h-[60vh] overflow-y-auto p-3">
              <h3 className="mb-1 text-sm font-semibold">
                Your answer <span className="font-normal text-muted">· {formatDuration(item.time_spent_sec)} · {(item.answer.trim().match(/\S+/g) ?? []).length} words</span>
              </h3>
              <p className="exam text-base whitespace-pre-wrap">{item.answer || <span className="text-muted">No answer.</span>}</p>
            </section>
            <section className="panel reading-surface max-h-[60vh] overflow-y-auto p-3">
              <h3 className="mb-1 text-sm font-semibold">Reference answer</h3>
              {q?.reference_answer ? <Markdown className="reading text-base">{q.reference_answer}</Markdown> : <p className="text-sm text-muted">No reference answer saved for this problem.</p>}
            </section>
          </div>

          <Section title="Score">
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Score out of 5">
              {Array.from({ length: 11 }, (_, i) => i / 2).map((v) => (
                <button key={v} role="radio" aria-checked={item.score === v} className={`btn btn-sm min-w-[2.6rem] tabular-nums ${item.score === v ? 'btn-primary' : ''}`} onClick={() => void setItem({ score: v })}>
                  {v}
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              {template.map((part, i) => (
                <div key={part} className="flex flex-wrap items-center gap-2">
                  <span className="w-32 text-sm">
                    <kbd className="mr-1 hidden text-xs text-muted lg:inline">{STRUCT_KEYS[i]}</kbd>
                    {part}
                  </span>
                  {MARKS.map((m) => (
                    <button
                      key={m}
                      className={`btn btn-sm ${item.structure?.[part] === m ? 'btn-primary' : ''}`}
                      aria-pressed={item.structure?.[part] === m}
                      onClick={() => void setItem({ structure: { ...(item.structure ?? {}), [part]: m } })}
                    >
                      {MARK_LABEL[m]}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {tags.map((t, i) => (
                <button
                  key={t}
                  className={`btn btn-sm ${item.error_tags.includes(t) ? 'btn-primary' : ''}`}
                  aria-pressed={item.error_tags.includes(t)}
                  onClick={() => void setItem({ error_tags: item.error_tags.includes(t) ? item.error_tags.filter((x) => x !== t) : [...item.error_tags, t] })}
                >
                  <kbd className="hidden text-xs opacity-70 lg:inline">{TAG_KEYS[i]}</kbd> {t}
                </button>
              ))}
            </div>
            {checklist && (
              <div className="mt-4">
                <p className="label">{checklist.form_type} checklist</p>
                <ul className="space-y-1">
                  {checklist.items.map((c) => (
                    <li key={c}>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={!!item.checklist?.[c]} onChange={(e) => void setItem({ checklist: { ...(item.checklist ?? {}), [c]: e.target.checked } })} />
                        {c}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {q?.type === 'practical' && !checklist && q.form_type && (
              <p className="mt-3 text-sm text-muted">
                No checklist for “{q.form_type}” yet. Add one in <Link to="/settings" className="underline">Settings</Link>.
              </p>
            )}
            <div className="mt-4">
              <label className="label" htmlFor="g-notes">
                Notes
              </label>
              <textarea
                id="g-notes"
                className="textarea"
                value={notes[item.id] ?? item.grader_notes}
                onChange={(e) => setNotes({ ...notes, [item.id]: e.target.value })}
                onBlur={() => notes[item.id] !== undefined && void setItem({ grader_notes: notes[item.id] })}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn" onClick={() => setMistakeFor(item)}>
                Add to mistake log
              </button>
              <button
                className="btn"
                onClick={() =>
                  setCard({
                    type: 'basic',
                    front: q?.text ?? '',
                    back: q?.reference_answer ?? '',
                    subject_id: q?.subject_id ?? data.attempt.subject_id,
                    source_type: 'question',
                    source_id: q?.id ?? null,
                  })
                }
              >
                Make card
              </button>
              <button className="btn btn-primary ml-auto" disabled={pos >= data.items.length - 1} onClick={() => setPos(pos + 1)}>
                Next problem
              </button>
            </div>
            <p className="mt-3 hidden text-xs text-muted lg:block">
              Keys: 0–5 score, . adds or removes ½, {STRUCT_KEYS.slice(0, template.length).join(' ')} structure, {TAG_KEYS.slice(0, tags.length).join(' ')} error tags, l mistake log, j/k or Enter next and previous.
            </p>
          </Section>
          <AiNotes item={item} q={q} />
        </div>
      )}

      {summary && (
        <Section title="Summary">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-sm text-muted">Score</p>
              <p className="text-3xl font-bold tabular-nums">
                {summary.pct.toFixed(1)}
                <span className="text-base font-normal text-muted"> / 100</span>
              </p>
              {summary.scored < data.items.length && <p className="text-xs text-muted">{data.items.length - summary.scored} still ungraded</p>}
            </div>
            <div>
              <p className="text-sm text-muted">Time used</p>
              <p className="text-xl font-semibold">{formatDuration(summary.used)}</p>
              <p className="text-xs text-muted">{formatDuration(summary.used / Math.max(1, data.items.length))} per problem</p>
            </div>
            <div>
              <p className="text-sm text-muted">Slowest problems</p>
              <ol className="text-sm">
                {summary.slowest.map((s) => (
                  <li key={s.id}>
                    <button className="underline" onClick={() => setPos(items.findIndex((x) => x.id === s.id))}>
                      #{s.position}
                    </button>{' '}
                    {formatDuration(s.time_spent_sec)}
                  </li>
                ))}
              </ol>
            </div>
          </div>
          {summary.tagCounts.size > 0 && (
            <div className="mt-4">
              <p className="text-sm text-muted">Error tags</p>
              <ul className="mt-1 flex flex-wrap gap-2 text-sm">
                {[...summary.tagCounts].sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                  <li key={t} className="rounded-full border border-rule px-2 py-0.5">
                    {t} · {n}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">Self-graded estimate.</p>
        </Section>
      )}
      {mistakeFor && <MistakeModal item={mistakeFor} q={data.questions.get(mistakeFor.question_id)} subjectId={data.attempt.subject_id} onClose={() => setMistakeFor(null)} />}
      <CardEditor open={!!card} draft={card ?? undefined} onClose={() => setCard(null)} />
    </div>
  );
}
