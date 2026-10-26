import { useEffect, useMemo, useState } from 'react';
import { Empty, Field, Modal, PageHeader, Section, SubjectSelect, SubjectTag, tabStyle } from '../components/ui';
import { DIFFICULTY_FACTOR, plannerShares } from '../lib/calc';
import { db } from '../lib/db';
import { useExam, useLive, useSubjects } from '../lib/hooks';
import { defaultPhases, examWeekAllowed, generateBlocks, PHASE_LABELS, phaseOn } from '../lib/planner';
import { create, makeRow, patch, putRows, softDelete } from '../lib/repo';
import { addDays, formatDuration, longDate, manilaDate, manilaTime, nowIso, shortDate, startOfWeek, todayManila, weekday } from '../lib/time';
import type { Difficulty, EventRow, PhaseDef, Plan, PlanBlock } from '../lib/types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function EventEditor({ onClose }: { onClose: () => void }) {
  const subjects = useSubjects();
  const [e, setE] = useState({ title: '', date: todayManila(), start: '08:00', end: '12:00', kind: 'lecture' as EventRow['kind'], subject_id: null as string | null });
  return (
    <Modal open onClose={onClose} title="Add a fixed event">
      <div className="space-y-3">
        <Field label="Title" htmlFor="ev-title">
          <input id="ev-title" className="input" value={e.title} onChange={(x) => setE({ ...e, title: x.target.value })} placeholder="Review center lecture" />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Date" htmlFor="ev-date">
            <input id="ev-date" type="date" className="input" value={e.date} onChange={(x) => setE({ ...e, date: x.target.value })} />
          </Field>
          <Field label="From" htmlFor="ev-start">
            <input id="ev-start" type="time" className="input" value={e.start} onChange={(x) => setE({ ...e, start: x.target.value })} />
          </Field>
          <Field label="To" htmlFor="ev-end">
            <input id="ev-end" type="time" className="input" value={e.end} onChange={(x) => setE({ ...e, end: x.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Kind" htmlFor="ev-kind">
            <select id="ev-kind" className="select" value={e.kind} onChange={(x) => setE({ ...e, kind: x.target.value as EventRow['kind'] })}>
              <option value="lecture">Lecture</option>
              <option value="mock">Mock exam</option>
              <option value="personal">Personal</option>
            </select>
          </Field>
          <Field label="Subject">
            <SubjectSelect subjects={subjects} value={e.subject_id} onChange={(v) => setE({ ...e, subject_id: v })} />
          </Field>
        </div>
        <button
          className="btn btn-primary"
          disabled={!e.title.trim() || e.end <= e.start}
          onClick={async () => {
            await create('events', {
              title: e.title.trim(),
              starts_at: new Date(`${e.date}T${e.start}:00+08:00`).toISOString(),
              ends_at: new Date(`${e.date}T${e.end}:00+08:00`).toISOString(),
              kind: e.kind,
              subject_id: e.subject_id,
            });
            onClose();
          }}
        >
          Add event
        </button>
      </div>
    </Modal>
  );
}

function DateList({ label, dates, onChange }: { label: string; dates: string[]; onChange: (d: string[]) => void }) {
  const [v, setV] = useState('');
  return (
    <div>
      <p className="label">{label}</p>
      <div className="flex gap-2">
        <input type="date" className="input w-auto" value={v} onChange={(e) => setV(e.target.value)} aria-label={label} />
        <button className="btn" disabled={!v} onClick={() => { onChange([...new Set([...dates, v])].sort()); setV(''); }}>
          Add
        </button>
      </div>
      {dates.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5 text-sm">
          {dates.map((d) => (
            <li key={d} className="flex items-center gap-1 rounded-full border border-rule px-2 py-0.5">
              {shortDate(d)}
              <button onClick={() => onChange(dates.filter((x) => x !== d))} aria-label={`Remove ${d}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Planner() {
  const subjects = useSubjects();
  const exam = useExam();
  const today = todayManila();
  const data = useLive(async () => {
    const plan = (await db.plans.toArray()).filter((p) => !p.deleted_at).sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0] ?? null;
    const blocks = plan ? (await db.plan_blocks.where('plan_id').equals(plan.id).toArray()).filter((b) => !b.deleted_at) : [];
    const events = (await db.events.toArray()).filter((e) => !e.deleted_at).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return { plan, blocks, events };
  });
  const [form, setForm] = useState<{
    start: string;
    hours: number[];
    restDays: string[];
    halfDays: string[];
    max: number;
    phases: PhaseDef[];
    daysBefore: number;
  } | null>(null);
  const [eventOpen, setEventOpen] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data || !exam || form) return;
    const p = data.plan;
    setForm({
      start: p?.start_date ?? today,
      hours: p?.hours_by_weekday ?? [0, 8, 8, 8, 8, 8, 6],
      restDays: p?.rest_rules.restDays ?? [],
      halfDays: p?.rest_rules.halfDays ?? [],
      max: p?.max_subjects_per_day ?? 2,
      phases: p?.phases ?? defaultPhases(today, exam.day1),
      daysBefore: p?.rest_rules.daysBeforeDay1 ?? 3,
    });
  }, [data, exam, form, today]);

  const shares = useMemo(() => plannerShares(subjects), [subjects]);
  if (!data || !exam || !form) return <p className="text-muted">Loading…</p>;
  const weeklyHours = form.hours.reduce((a, b) => a + b, 0);

  async function generate() {
    if (!exam || !form) return;
    setBusy(true);
    const from = data!.plan ? (today > form.start ? today : form.start) : form.start;
    const eventMinutes: Record<string, number> = {};
    for (const e of data!.events) {
      const d = manilaDate(e.starts_at);
      eventMinutes[d] = (eventMinutes[d] ?? 0) + (Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 60000;
    }
    const plan: Plan = data!.plan
      ? { ...data!.plan }
      : makeRow('plans', { start_date: form.start, hours_by_weekday: [], rest_rules: { restDays: [], halfDays: [] }, max_subjects_per_day: 2, phases: [], generated_at: nowIso() });
    Object.assign(plan, {
      start_date: form.start,
      hours_by_weekday: form.hours,
      rest_rules: { restDays: form.restDays, halfDays: form.halfDays, daysBeforeDay1: form.daysBefore },
      max_subjects_per_day: form.max,
      phases: form.phases,
      generated_at: nowIso(),
    });
    // Regenerate from today: keep every past day and anything already done.
    const drop = data!.blocks.filter((b) => b.date >= from && b.status === 'planned');
    const gen = generateBlocks({
      from,
      until: addDays(exam.day3, -1),
      hoursByWeekday: form.hours,
      restDays: form.restDays,
      halfDays: form.halfDays,
      maxSubjectsPerDay: form.max,
      phases: form.phases,
      subjects,
      eventMinutes,
      blackout: [exam.day1, exam.day2, exam.day3],
      allowedOn: examWeekAllowed(exam.day1, exam.day2, exam.day3, subjects, form.daysBefore),
    });
    await putRows('plans', [plan]);
    await softDelete('plan_blocks', drop.map((b) => b.id));
    await putRows(
      'plan_blocks',
      gen.map((g) => makeRow('plan_blocks', { plan_id: plan.id, date: g.date, subject_id: g.subject_id, minutes: g.minutes, kind: g.kind, status: 'planned', continue_node_id: null })),
    );
    setBusy(false);
  }

  const weekStart = addDays(startOfWeek(today), weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const live = data.blocks.filter((b) => b.status !== 'moved' && b.status !== 'skipped');
  const weekBlocks = live.filter((b) => b.date >= weekStart && b.date <= days[6]);
  const weekTotal = weekBlocks.reduce((s, b) => s + b.minutes, 0);
  const phase = data.plan ? phaseOn(data.plan.phases, today) : undefined;

  return (
    <div className="space-y-4">
      <PageHeader title="Planner" subtitle={data.plan ? `${phase ? PHASE_LABELS[phase.key] : 'Plan'} · generated ${shortDate(manilaDate(data.plan.generated_at))}` : 'No plan yet'} />

      {data.plan && (
        <Section
          title={`Week of ${shortDate(weekStart)}`}
          action={
            <div className="flex gap-1">
              <button className="btn btn-sm" onClick={() => setWeekOffset(weekOffset - 1)} aria-label="Previous week">
                ←
              </button>
              <button className="btn btn-sm" onClick={() => setWeekOffset(0)}>
                This week
              </button>
              <button className="btn btn-sm" onClick={() => setWeekOffset(weekOffset + 1)} aria-label="Next week">
                →
              </button>
            </div>
          }
        >
          <p className="mb-2 text-sm text-muted">{formatDuration(weekTotal * 60)} planned</p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
            {days.map((d) => {
              const bs = weekBlocks.filter((b) => b.date === d);
              const evs = data.events.filter((e) => manilaDate(e.starts_at) === d);
              const examDay = d === exam.day1 || d === exam.day2 || d === exam.day3;
              return (
                <li key={d} className={`rounded-lg border border-rule p-2 ${d === today ? 'ring-2 ring-[var(--ink)]' : ''}`}>
                  <p className="text-xs font-semibold">
                    {WEEKDAYS[weekday(d)]} {shortDate(d)}
                  </p>
                  {examDay && <p className="text-xs font-semibold">Exam day</p>}
                  {form.restDays.includes(d) && <p className="text-xs text-muted">Rest</p>}
                  <ul className="mt-1 space-y-1">
                    {bs.map((b: PlanBlock) => {
                      const s = subjects.find((x) => x.id === b.subject_id);
                      return (
                        <li key={b.id} className={`tab rounded-r px-1.5 py-0.5 text-xs ${b.status === 'done' ? 'opacity-60' : ''}`} style={tabStyle(s?.color)}>
                          <span className="font-semibold">{s?.code}</span> {formatDuration(b.minutes * 60)}
                          {b.kind !== 'reading' && ` · ${b.kind}`}
                          {b.status === 'done' && ' ✓'}
                        </li>
                      );
                    })}
                    {evs.map((e) => (
                      <li key={e.id} className="rounded border border-dashed border-rule px-1.5 py-0.5 text-xs">
                        {manilaTime(e.starts_at)} {e.title}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
          <ul className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
            {subjects.map((s) => {
              const m = weekBlocks.filter((b) => b.subject_id === s.id).reduce((t, b) => t + b.minutes, 0);
              return (
                <li key={s.id}>
                  <SubjectTag subject={s} /> {formatDuration(m * 60)}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section title={data.plan ? 'Plan settings' : 'Make a plan'}>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start date" htmlFor="pl-start">
              <input id="pl-start" type="date" className="input" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value, phases: defaultPhases(e.target.value, exam.day1) })} />
            </Field>
            <Field label="Max subjects per day" htmlFor="pl-max">
              <select id="pl-max" className="select" value={form.max} onChange={(e) => setForm({ ...form, max: Number(e.target.value) })}>
                {[1, 2, 3].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </Field>
          </div>
          <div>
            <p className="label">Study hours per weekday · {weeklyHours} h a week</p>
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((w, i) => (
                <label key={w} className="text-center text-xs">
                  {w}
                  <input
                    type="number"
                    min={0}
                    max={16}
                    step={0.5}
                    className="input mt-1 px-1 text-center"
                    value={form.hours[i]}
                    onChange={(e) => setForm({ ...form, hours: form.hours.map((h, j) => (j === i ? Number(e.target.value) : h)) })}
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateList label="Rest days" dates={form.restDays} onChange={(d) => setForm({ ...form, restDays: d })} />
            <DateList label="Half days" dates={form.halfDays} onChange={(d) => setForm({ ...form, halfDays: d })} />
          </div>
          <div>
            <p className="label">Difficulty per subject</p>
            <ul className="space-y-1.5">
              {subjects.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    <SubjectTag subject={s} /> weight {s.weight}% · {Math.round((shares.get(s.id) ?? 0) * 100)}% of time
                    {weeklyHours ? ` · ${formatDuration((shares.get(s.id) ?? 0) * weeklyHours * 3600)} a week` : ''}
                  </span>
                  <select className="select w-28" value={s.difficulty} onChange={(e) => void patch('subjects', s.id, { difficulty: e.target.value as Difficulty })} aria-label={`${s.code} difficulty`}>
                    {(Object.keys(DIFFICULTY_FACTOR) as Difficulty[]).map((d) => (
                      <option key={d} value={d}>
                        {d === 'easy' ? 'Easy' : d === 'normal' ? 'Normal' : 'Hard'} ({DIFFICULTY_FACTOR[d]})
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label">Phases</p>
            <ul className="space-y-1.5">
              {form.phases.map((p, i) => (
                <li key={p.key} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-28 font-semibold">{PHASE_LABELS[p.key]}</span>
                  <input type="date" className="input w-auto" value={p.start} onChange={(e) => setForm({ ...form, phases: form.phases.map((x, j) => (j === i ? { ...x, start: e.target.value } : j === i - 1 ? { ...x, end: addDays(e.target.value, -1) } : x)) })} aria-label={`${p.label} start`} />
                  <span>to</span>
                  <input type="date" className="input w-auto" value={p.end} onChange={(e) => setForm({ ...form, phases: form.phases.map((x, j) => (j === i ? { ...x, end: e.target.value } : j === i + 1 ? { ...x, start: addDays(e.target.value, 1) } : x)) })} aria-label={`${p.label} end`} />
                </li>
              ))}
            </ul>
            <button className="btn btn-sm btn-ghost mt-2" onClick={() => setForm({ ...form, phases: defaultPhases(form.start, exam.day1) })}>
              Reset to 45 / 30 / 15 / 10
            </button>
          </div>
          <div>
            <p className="label">Exam-week order</p>
            <ul className="text-sm">
              <li>
                Last{' '}
                <input type="number" min={0} max={14} className="input inline w-16 px-1 py-0.5" value={form.daysBefore} onChange={(e) => setForm({ ...form, daysBefore: Number(e.target.value) })} aria-label="Days before Day 1" /> days before Day 1:{' '}
                {subjects.filter((s) => s.exam_day === 1).map((s) => s.code).join(', ')}
              </li>
              <li>Between Day 1 and Day 2: {subjects.filter((s) => s.exam_day === 2).map((s) => s.code).join(', ')}</li>
              <li>Between Day 2 and Day 3: {subjects.filter((s) => s.exam_day === 3).map((s) => s.code).join(', ')}</li>
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={busy || !weeklyHours} onClick={() => void generate()}>
              {busy ? 'Generating…' : data.plan ? 'Regenerate from today' : 'Generate plan'}
            </button>
            {data.plan && <span className="self-center text-xs text-muted">Past days and logged sessions are never changed.</span>}
          </div>
        </div>
      </Section>

      <Section
        title="Fixed events"
        action={
          <button className="btn btn-sm" onClick={() => setEventOpen(true)}>
            Add event
          </button>
        }
      >
        {data.events.filter((e) => manilaDate(e.ends_at) >= today).length === 0 ? (
          <Empty>Review-center lectures, mock exams and personal commitments go here. Their time is taken out before blocks are planned.</Empty>
        ) : (
          <ul className="divide-y divide-rule">
            {data.events
              .filter((e) => manilaDate(e.ends_at) >= today)
              .map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span>
                    {longDate(manilaDate(e.starts_at))}, {manilaTime(e.starts_at)}–{manilaTime(e.ends_at)} · {e.title}{' '}
                    <SubjectTag subject={subjects.find((s) => s.id === e.subject_id)} />
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => void softDelete('events', e.id)} aria-label="Delete event">
                    ✕
                  </button>
                </li>
              ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">After adding events, regenerate the plan to make room for them.</p>
      </Section>
      {eventOpen && <EventEditor onClose={() => setEventOpen(false)} />}
    </div>
  );
}
