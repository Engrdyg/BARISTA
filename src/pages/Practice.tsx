import { useMemo, useState } from 'react';
import { useSubjectFilter } from '../lib/subjectFilter';
import { PenLine } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { NodeSelect } from '../components/TimerDialog';
import { download, Empty, Field, Markdown, Modal, PageHeader, Section, SubjectChips, SubjectSelect, SubjectTag } from '../components/ui';
import { parseDelimited, toCsv } from '../lib/backup';
import { db } from '../lib/db';
import { createAttempt, newGroupId, pickQuestions } from '../lib/exam';
import { useExam, useLive, useSettings, useSubjects } from '../lib/hooks';
import { splitProblems, type SplitProblem } from '../lib/parsers/problems';
import { create, makeRow, putRow, putRows, softDelete } from '../lib/repo';
import { formatDuration, manilaDate, shortDate, todayManila } from '../lib/time';
import type { Attempt, AttemptItem, Question, QuestionType, Subject } from '../lib/types';

function emptyQuestion(subjectId: string | null): Question {
  return makeRow('questions', {
    subject_id: subjectId,
    type: 'essay',
    source_label: '',
    year: null,
    number: '',
    text: '',
    points: 5,
    reference_answer: '',
    form_type: '',
    notes: '',
  });
}

function QuestionEditor({ q: initial, onClose }: { q: Question; onClose: () => void }) {
  const subjects = useSubjects();
  const [q, setQ] = useState(initial);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const links = useLive(() => db.node_links.where('target_id').equals(initial.id).filter((l) => !l.deleted_at && l.target_type === 'question').toArray(), [initial.id]) ?? [];
  const linkedNodes = useLive(async () => (await db.syllabus_nodes.bulkGet(links.map((l) => l.node_id))).filter(Boolean), [links.map((l) => l.id).join()]) ?? [];
  const set = <K extends keyof Question>(k: K, v: Question[K]) => setQ((x) => ({ ...x, [k]: v }));
  return (
    <Modal open onClose={onClose} title={initial.text ? 'Edit problem' : 'New problem'} wide>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Subject" htmlFor="q-subject">
            <SubjectSelect id="q-subject" subjects={subjects} value={q.subject_id} onChange={(v) => set('subject_id', v)} />
          </Field>
          <Field label="Type" htmlFor="q-type">
            <select id="q-type" className="select" value={q.type} onChange={(e) => set('type', e.target.value as QuestionType)}>
              <option value="essay">Essay</option>
              <option value="practical">Practical exercise</option>
            </select>
          </Field>
          <Field label="Points" htmlFor="q-points">
            <input id="q-points" className="input" type="number" min={0} step={0.5} value={q.points} onChange={(e) => set('points', Number(e.target.value))} />
          </Field>
          <Field label="Source" htmlFor="q-source">
            <input id="q-source" className="input" value={q.source_label} onChange={(e) => set('source_label', e.target.value)} placeholder="2019 Bar, Mock 3, Self-made" />
          </Field>
          <Field label="Year" htmlFor="q-year">
            <input id="q-year" className="input" type="number" value={q.year ?? ''} onChange={(e) => set('year', e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label="Number" htmlFor="q-number">
            <input id="q-number" className="input" value={q.number} onChange={(e) => set('number', e.target.value)} placeholder="7" />
          </Field>
        </div>
        {q.type === 'practical' && (
          <Field label="Form type (for the grading checklist)" htmlFor="q-form">
            <input id="q-form" className="input" value={q.form_type} onChange={(e) => set('form_type', e.target.value)} placeholder="Complaint, Information, Deed of sale…" />
          </Field>
        )}
        <Field label="Problem (markdown)" htmlFor="q-text">
          <textarea id="q-text" className="textarea reading min-h-[10rem]" value={q.text} onChange={(e) => set('text', e.target.value)} />
        </Field>
        <Field label="Reference answer (your own copy; hidden during attempts)" htmlFor="q-ref">
          <textarea id="q-ref" className="textarea reading min-h-[8rem]" value={q.reference_answer} onChange={(e) => set('reference_answer', e.target.value)} />
        </Field>
        <Field label="Notes" htmlFor="q-notes">
          <textarea id="q-notes" className="textarea" value={q.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <div>
          <p className="label">Syllabus items</p>
          <ul className="mb-2 space-y-1 text-sm">
            {linkedNodes.map((n) => (
              <li key={n!.id} className="flex justify-between">
                {n!.marker} {n!.title}
                <button className="btn btn-ghost btn-sm" onClick={() => void softDelete('node_links', links.find((l) => l.node_id === n!.id)!.id)} aria-label="Unlink">
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <NodeSelect subjectId={q.subject_id} value={nodeId} onChange={setNodeId} />
            <button
              className="btn"
              disabled={!nodeId}
              onClick={async () => {
                if (nodeId && !links.some((l) => l.node_id === nodeId)) await create('node_links', { node_id: nodeId, target_type: 'question', target_id: q.id });
                setNodeId(null);
              }}
            >
              Link
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-primary"
            disabled={!q.text.trim()}
            onClick={async () => {
              await putRow('questions', q);
              onClose();
            }}
          >
            Save problem
          </button>
          {initial.text && (
            <button className="btn btn-danger ml-auto" onClick={async () => { await softDelete('questions', q.id); onClose(); }}>
              Delete
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function BulkPaste({ onClose, subjects }: { onClose: () => void; subjects: Subject[] }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<SplitProblem[] | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [source, setSource] = useState('');
  const [year, setYear] = useState('');
  const [type, setType] = useState<QuestionType>('essay');
  const [done, setDone] = useState<number | null>(null);
  return (
    <Modal open onClose={onClose} title="Paste a set of problems" wide>
      {done !== null ? (
        <p>Saved {done} problems.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Subject">
              <SubjectSelect subjects={subjects} value={subject} onChange={setSubject} />
            </Field>
            <Field label="Source" htmlFor="bp-source">
              <input id="bp-source" className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="2019 Bar" />
            </Field>
            <Field label="Year" htmlFor="bp-year">
              <input id="bp-year" className="input" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
            </Field>
            <Field label="Type" htmlFor="bp-type">
              <select id="bp-type" className="select" value={type} onChange={(e) => setType(e.target.value as QuestionType)}>
                <option value="essay">Essay</option>
                <option value="practical">Practical exercise</option>
              </select>
            </Field>
          </div>
          {!rows ? (
            <>
              <textarea className="textarea min-h-[14rem] font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder={'1. First problem…\n2. Second problem…'} aria-label="Problems" />
              <button className="btn btn-primary" disabled={!text.trim()} onClick={() => setRows(splitProblems(text))}>
                Split and preview
              </button>
            </>
          ) : (
            <>
              <p className="text-sm">{rows.length} problems found.</p>
              <ol className="max-h-[50vh] space-y-2 overflow-y-auto">
                {rows.map((r, i) => (
                  <li key={i} className="rounded-lg border border-rule p-2">
                    <div className="mb-1 flex items-center gap-2">
                      <input className="input w-20 py-1" value={r.number} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))} aria-label="Number" />
                      <span className="flex-1" />
                      <button className="btn btn-ghost btn-sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                        Delete
                      </button>
                    </div>
                    <textarea className="textarea reading text-sm" value={r.text} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} aria-label={`Problem ${r.number}`} />
                  </li>
                ))}
              </ol>
              <div className="flex gap-2">
                <button className="btn" onClick={() => setRows(null)}>
                  Back
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!rows.length}
                  onClick={async () => {
                    await putRows(
                      'questions',
                      rows.map((r) => ({ ...emptyQuestion(subject), type, source_label: source.trim(), year: year ? Number(year) : null, number: r.number, text: r.text })),
                    );
                    setDone(rows.length);
                  }}
                >
                  Save {rows.length} problems
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function CsvImport({ onClose, subjects }: { onClose: () => void; subjects: Subject[] }) {
  const [text, setText] = useState('');
  const [done, setDone] = useState<number | null>(null);
  const rows = useMemo(() => {
    const r = parseDelimited(text);
    if (!r.length) return [];
    const header = r[0].map((h) => h.trim().toLowerCase());
    const col = (row: string[], name: string) => {
      const i = header.indexOf(name);
      return i >= 0 ? (row[i] ?? '').trim() : '';
    };
    return r.slice(1).map((row) => {
      const code = col(row, 'subject').toUpperCase();
      return {
        ...emptyQuestion(subjects.find((s) => s.code === code)?.id ?? null),
        type: (col(row, 'type') === 'practical' ? 'practical' : 'essay') as QuestionType,
        source_label: col(row, 'source_label') || col(row, 'source'),
        year: Number(col(row, 'year')) || null,
        number: col(row, 'number'),
        text: col(row, 'text'),
        points: Number(col(row, 'points')) || 5,
        reference_answer: col(row, 'reference_answer'),
        form_type: col(row, 'form_type'),
        notes: col(row, 'notes'),
      };
    }).filter((q) => q.text);
  }, [text, subjects]);
  return (
    <Modal open onClose={onClose} title="Import problems from CSV" wide>
      {done !== null ? (
        <p>Imported {done} problems.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">Columns: subject (code), type, source_label, year, number, text, points, reference_answer, form_type, notes. Same as the export.</p>
          <input type="file" accept=".csv,.tsv,.txt" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
          <textarea className="textarea min-h-[10rem] font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} aria-label="CSV" />
          <button className="btn btn-primary" disabled={!rows.length} onClick={async () => { await putRows('questions', rows); setDone(rows.length); }}>
            Import {rows.length || ''} problems
          </button>
        </div>
      )}
    </Modal>
  );
}

function StartPanel({ subjects }: { subjects: Subject[] }) {
  const nav = useNavigate();
  const settings = useSettings();
  const exam = useExam();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'drill' | 'mock' | 'bar_day'>('drill');
  const [filterSubject] = useSubjectFilter();
  const [subject, setSubject] = useState<string | null>(filterSubject ?? subjects[0]?.id ?? null);
  const [node, setNode] = useState<string | null>(params.get('node'));
  const [source, setSource] = useState('');
  const [filter, setFilter] = useState<'any' | 'never' | 'low'>('any');
  const [count, setCount] = useState(1);
  const [day, setDay] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);
  const sources = useLive(async () => [...new Set((await db.questions.toArray()).filter((q) => !q.deleted_at && q.source_label).map((q) => q.source_label))].sort()) ?? [];
  const perProblem = settings.minutesPerProblem;
  const qps = exam?.questions_per_subject ?? 20;

  async function start() {
    setMsg(null);
    if (mode === 'bar_day') {
      const am = subjects.find((s) => s.exam_day === day && s.session === 'AM');
      if (!am) return setMsg('No morning subject on that day.');
      const ids = await pickQuestions({ subjectId: am.id, count: qps });
      if (!ids.length) return setMsg(`Add ${am.code} problems to the bank first.`);
      const a = await createAttempt({ mode: 'bar_day', subjectId: am.id, questionIds: ids, timeLimitSec: 240 * 60, barDayGroupId: newGroupId() });
      return nav(`/practice/attempt/${a.id}`);
    }
    const n = mode === 'mock' ? qps : count;
    const ids = await pickQuestions({ subjectId: subject, count: n, nodeId: mode === 'drill' ? node : null, source: source || null, filter: mode === 'drill' ? filter : 'any' });
    if (!ids.length) return setMsg('No problems match. Add some to the bank or loosen the filters.');
    if (mode === 'mock' && ids.length < n && !confirm(`Only ${ids.length} problems available. Start a shorter mock (${ids.length * perProblem} minutes)?`)) return;
    const a = await createAttempt({
      mode,
      subjectId: subject,
      questionIds: ids,
      timeLimitSec: mode === 'mock' ? Math.min(240, ids.length * perProblem) * 60 : ids.length * perProblem * 60,
    });
    nav(`/practice/attempt/${a.id}`);
  }

  return (
    <Section title="Start">
      <div className="mb-3 flex flex-wrap gap-2" role="radiogroup">
        {([
          ['drill', 'Drill'],
          ['mock', 'Full mock'],
          ['bar_day', 'Mock Bar day'],
        ] as const).map(([m, label]) => (
          <button key={m} role="radio" aria-checked={mode === m} className={`btn btn-sm ${mode === m ? 'btn-primary' : ''}`} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'bar_day' ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">The two subjects of a real exam day back to back, 4 hours each, with a 2-hour break screen between.</p>
          <select className="select max-w-sm" value={day} onChange={(e) => setDay(Number(e.target.value))} aria-label="Exam day">
            {[1, 2, 3].map((d) => (
              <option key={d} value={d}>
                Day {d}: {subjects.filter((s) => s.exam_day === d).map((s) => s.code).join(' and ')}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="label">Subject</p>
            <SubjectChips subjects={subjects} value={subject} onChange={setSubject} allowAll={mode === 'drill'} />
          </div>
          {mode === 'drill' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Syllabus item">
                <NodeSelect subjectId={subject} value={node} onChange={setNode} />
              </Field>
              <Field label="Problems" htmlFor="pr-count">
                <select id="pr-count" className="select" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} · {n * perProblem} min
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Which problems" htmlFor="pr-filter">
                <select id="pr-filter" className="select" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                  <option value="any">Any (least recent first)</option>
                  <option value="never">Never attempted</option>
                  <option value="low">Last score below 3</option>
                </select>
              </Field>
              <Field label="Source" htmlFor="pr-source">
                <select id="pr-source" className="select" value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="">Any source</option>
                  {sources.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          {mode === 'mock' && <p className="text-sm text-muted">{qps} problems, 4 hours, no pausing — the real format.</p>}
        </div>
      )}
      {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}
      <button className="btn btn-primary mt-4" onClick={() => void start()}>
        {mode === 'drill' ? 'Start drill' : mode === 'mock' ? 'Start mock' : 'Start mock Bar day'}
      </button>
    </Section>
  );
}

export default function Practice() {
  const subjects = useSubjects();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'start' | 'bank' | 'history'>(params.get('node') ? 'bank' : 'start');
  const [subject, setSubject] = useSubjectFilter();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Question | null>(null);
  const [bulk, setBulk] = useState(false);
  const [csv, setCsv] = useState(false);
  const [viewing, setViewing] = useState<Question | null>(null);
  const nodeFilter = params.get('node');

  const data = useLive(async () => {
    const questions = (await db.questions.toArray()).filter((x) => !x.deleted_at);
    const attempts = (await db.attempts.toArray()).filter((a) => !a.deleted_at).sort((a, b) => b.started_at.localeCompare(a.started_at));
    const items = (await db.attempt_items.toArray()).filter((i) => !i.deleted_at);
    const linked = nodeFilter ? new Set((await db.node_links.where('node_id').equals(nodeFilter).toArray()).filter((l) => !l.deleted_at && l.target_type === 'question').map((l) => l.target_id)) : null;
    return { questions, attempts, items, linked };
  }, [nodeFilter]);
  if (!data) return <p className="text-muted">Loading…</p>;

  const stats = new Map<string, { n: number; last: number | null; time: number }>();
  const attemptById = new Map(data.attempts.map((a) => [a.id, a]));
  for (const it of [...data.items].sort((a, b) => (attemptById.get(a.attempt_id)?.started_at ?? '').localeCompare(attemptById.get(b.attempt_id)?.started_at ?? ''))) {
    const a = attemptById.get(it.attempt_id);
    if (!a || a.status === 'in_progress') continue;
    const s = stats.get(it.question_id) ?? { n: 0, last: null, time: 0 };
    s.n++;
    if (it.score !== null) s.last = it.score;
    s.time += it.time_spent_sec;
    stats.set(it.question_id, s);
  }
  const inProgress = data.attempts.filter((a) => a.status === 'in_progress');
  const needle = q.trim().toLowerCase();
  const bank = data.questions
    .filter((x) => !subject || x.subject_id === subject)
    .filter((x) => !data.linked || data.linked.has(x.id))
    .filter((x) => !needle || `${x.source_label} ${x.text} ${x.number}`.toLowerCase().includes(needle))
    .sort((a, b) => a.source_label.localeCompare(b.source_label) || (Number(a.number) || 0) - (Number(b.number) || 0));

  const itemsBy = (id: string) => data.items.filter((i) => i.attempt_id === id);

  return (
    <div className="space-y-4">
      <PageHeader icon={PenLine} title="Essay practice" subtitle={`${data.questions.length} problems in the bank · 20 problems, 4 hours, like the real Bar`} />
      {inProgress.length > 0 && (
        <Section title="In progress">
          <ul className="space-y-2">
            {inProgress.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <span className="text-sm">
                  <SubjectTag subject={subjects.find((s) => s.id === a.subject_id)} /> {a.mode === 'drill' ? 'Drill' : a.mode === 'mock' ? 'Full mock' : 'Mock Bar day'} · started {shortDate(manilaDate(a.started_at))}
                </span>
                <Link to={`/practice/attempt/${a.id}`} className="btn btn-sm btn-primary">
                  Resume
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <div className="flex gap-2" role="tablist">
        {([
          ['start', 'Start'],
          ['bank', 'Problem bank'],
          ['history', 'History'],
        ] as const).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`btn btn-sm ${tab === t ? 'btn-primary' : ''}`} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'start' && <StartPanel subjects={subjects} />}

      {tab === 'bank' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => setEditing(emptyQuestion(subject))}>
              New problem
            </button>
            <button className="btn" onClick={() => setBulk(true)}>
              Paste a set
            </button>
            <button className="btn" onClick={() => setCsv(true)}>
              Import CSV
            </button>
            <button
              className="btn"
              onClick={() =>
                download(
                  `barista-problems-${todayManila()}.csv`,
                  toCsv(
                    data.questions.map((x) => ({ ...x, subject: subjects.find((s) => s.id === x.subject_id)?.code ?? '' })),
                    ['subject', 'type', 'source_label', 'year', 'number', 'text', 'points', 'reference_answer', 'form_type', 'notes'],
                  ),
                  'text/csv',
                )
              }
            >
              Export CSV
            </button>
          </div>
          <SubjectChips subjects={subjects} value={subject} onChange={setSubject} />
          <input className="input max-w-sm" placeholder="Filter problems" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter problems" />
          {bank.length === 0 ? (
            <Empty
              icon={PenLine}
              title="Your problem bank is empty"
              actions={
                <>
                  <button className="btn btn-primary" onClick={() => setBulk(true)}>
                    Paste a set
                  </button>
                  <button className="btn" onClick={() => setEditing(emptyQuestion(subject))}>
                    New problem
                  </button>
                </>
              }
            >
              Paste a numbered set from a past Bar or a mock exam. Add your reference answers so you can grade yourself.
            </Empty>
          ) : (
            <ul className="panel divide-y divide-rule">
              {bank.map((x) => {
                const s = stats.get(x.id);
                return (
                  <li key={x.id}>
                    <button className="flex w-full items-start gap-2 px-3 py-2 text-left" onClick={() => setViewing(x)}>
                      <SubjectTag subject={subjects.find((y) => y.id === x.subject_id)} className="mt-0.5 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-semibold">
                          {x.source_label || 'Problem'} {x.number && `#${x.number}`} {x.type === 'practical' && '· practical'}
                        </span>
                        <span className="line-clamp-2 block text-sm">{x.text}</span>
                        <span className="text-xs text-muted">
                          {s ? `${s.n} attempts · last ${s.last ?? '—'}/5 · avg ${formatDuration(s.time / s.n)}` : 'Never attempted'}
                          {!x.reference_answer && ' · no reference answer'}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div>
          {data.attempts.filter((a) => a.status !== 'in_progress').length === 0 ? (
            <Empty icon={PenLine} title="No attempts yet" actions={<button className="btn btn-primary" onClick={() => setTab('start')}>Start a drill</button>}>
              Drills, mocks and mock Bar days you finish appear here with their scores.
            </Empty>
          ) : (
            <ul className="panel divide-y divide-rule">
              {data.attempts
                .filter((a) => a.status !== 'in_progress')
                .map((a: Attempt) => {
                  const its = itemsBy(a.id);
                  const graded = its.filter((i: AttemptItem) => i.score !== null);
                  const pct = graded.length === its.length && its.length ? (graded.reduce((t, i) => t + i.score!, 0) / (its.length * 5)) * 100 : null;
                  return (
                    <li key={a.id}>
                      <Link to={`/practice/grade/${a.id}`} className="flex items-center justify-between gap-2 px-3 py-2">
                        <span className="text-sm">
                          <SubjectTag subject={subjects.find((s) => s.id === a.subject_id)} /> {a.mode === 'drill' ? `Drill · ${its.length}` : a.mode === 'mock' ? 'Full mock' : 'Mock Bar day'} ·{' '}
                          {shortDate(manilaDate(a.started_at))}
                        </span>
                        <span className="text-sm tabular-nums">{pct !== null ? `${pct.toFixed(1)}` : `${graded.length}/${its.length} graded`}</span>
                      </Link>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      )}

      {viewing && !editing && (
        <Modal open onClose={() => setViewing(null)} title={`${viewing.source_label || 'Problem'} ${viewing.number ? `#${viewing.number}` : ''}`} wide>
          <Markdown className="reading">{viewing.text}</Markdown>
          {viewing.reference_answer && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold">Reference answer</summary>
              <Markdown className="reading mt-2">{viewing.reference_answer}</Markdown>
            </details>
          )}
          <div className="mt-4 flex gap-2">
            <button className="btn" onClick={() => setEditing(viewing)}>
              Edit
            </button>
          </div>
        </Modal>
      )}
      {editing && <QuestionEditor q={editing} onClose={() => { setEditing(null); setViewing(null); }} />}
      {bulk && <BulkPaste onClose={() => setBulk(false)} subjects={subjects} />}
      {csv && <CsvImport onClose={() => setCsv(false)} subjects={subjects} />}
    </div>
  );
}
