import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import TimerDialog from '../components/TimerDialog';
import { Bar, Section, SubjectTag, tabStyle } from '../components/ui';
import { db } from '../lib/db';
import { createAttempt } from '../lib/exam';
import { useExam, useLive, useSettings, useSubjects } from '../lib/hooks';
import { continueNode, dayCapacity, phaseOn } from '../lib/planner';
import { patch, putRows, makeRow } from '../lib/repo';
import { buildQueue } from '../lib/srs';
import { addDays, clockLabel, daysBetween, formatDuration, longDate, shortDate, startOfManilaDay, startOfWeek, todayManila } from '../lib/time';
import type { BaonNote, PlanBlock, SessionKind, Subject, SyllabusNode } from '../lib/types';
import { suggestedDrill } from '../lib/weak';

function greeting(name: string) {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', hour12: false }).format(new Date()));
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

/** Today shows at most one Baon note: scheduled for today, else an unseen unscheduled one. */
export function pickBaon(notes: BaonNote[], today: string): BaonNote | undefined {
  const live = notes.filter((n) => !n.deleted_at && !n.archived);
  return (
    live.find((n) => n.show_on === today) ??
    live.find((n) => !n.show_on && n.seen_at && n.seen_at.slice(0, 10) === today) ??
    live.filter((n) => !n.show_on && !n.seen_at).sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
  );
}

function BaonCard() {
  const settings = useSettings();
  const today = todayManila();
  const note = useLive(async () => pickBaon(await db.baon_notes.toArray(), today), [today]);
  useEffect(() => {
    if (settings.baonEnabled && note && !note.seen_at) void patch('baon_notes', note.id, { seen_at: new Date().toISOString() });
  }, [note, settings.baonEnabled]);
  if (!settings.baonEnabled || !note) return null;
  return (
    <section className="panel p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold">Baon</h2>
        <button className="btn btn-ghost btn-sm" onClick={() => void patch('baon_notes', note.id, { archived: true })}>
          Archive
        </button>
      </div>
      <p className="reading text-lg italic">“{note.body}”</p>
    </section>
  );
}

function Countdown({ day1, day2, day3 }: { day1: string; day2: string; day3: string }) {
  const days = daysBetween(todayManila(), day1);
  return (
    <section className="py-2">
      <p className="text-4xl font-bold tracking-tight tabular-nums">
        {days > 0 ? (
          <>
            {days} <span className="text-2xl font-semibold">{days === 1 ? 'day' : 'days'} to Day 1</span>
          </>
        ) : days === 0 ? (
          'Day 1 is today'
        ) : (
          'The Bar is underway'
        )}
      </p>
      <p className="mt-1 text-muted">
        {shortDate(day1)}, {shortDate(day2)}, {shortDate(day3)}, {day3.slice(0, 4)}
      </p>
    </section>
  );
}

function ExamDay({ dayNo, subjects }: { dayNo: number; subjects: Subject[] }) {
  const exam = useExam()!;
  const settings = useSettings();
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const todays = subjects.filter((s) => s.exam_day === dayNo).sort((a, b) => a.session.localeCompare(b.session));
  return (
    <div className="space-y-4">
      <section className="py-2">
        <p className="text-sm font-semibold text-muted">Day {dayNo} · {longDate(todayManila())}</p>
        <h1 className="mt-1 text-3xl font-bold">Kaya mo ’to.</h1>
      </section>
      <Section title="Today's subjects">
        <ul className="space-y-2">
          {todays.map((s) => (
            <li key={s.id} className="tab rounded-r-lg px-3 py-2" style={tabStyle(s.color)}>
              <div className="font-semibold">
                {s.session === 'AM'
                  ? `${clockLabel(exam.am_start)}–${clockLabel(exam.am_end)}`
                  : `${clockLabel(exam.pm_start)}–${clockLabel(exam.pm_end)}`}{' '}
                · {s.code}
              </div>
              <div className="text-sm">{s.name}</div>
            </li>
          ))}
        </ul>
      </Section>
      {settings.examDayChecklist.length > 0 && (
        <Section title="Checklist">
          <ul className="space-y-1">
            {settings.examDayChecklist.map((item, i) => (
              <li key={i}>
                <label className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={checked.has(i)}
                    onChange={() => {
                      const n = new Set(checked);
                      if (n.has(i)) n.delete(i);
                      else n.add(i);
                      setChecked(n);
                    }}
                  />
                  {item}
                </label>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <BaonCard />
    </div>
  );
}

function copyBlock(b: PlanBlock, date: string): PlanBlock {
  return makeRow('plan_blocks', {
    plan_id: b.plan_id,
    date,
    subject_id: b.subject_id,
    minutes: b.minutes,
    kind: b.kind,
    status: 'planned',
    continue_node_id: b.continue_node_id,
  });
}

interface StartArgs {
  subjectId: string | null;
  nodeId: string | null;
  kind: SessionKind;
}

function PlanSection({ subjects, onStart }: { subjects: Subject[]; onStart: (a: StartArgs) => void }) {
  const today = todayManila();
  const exam = useExam();
  const data = useLive(async () => {
    const plan = (await db.plans.toArray()).filter((p) => !p.deleted_at).sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0];
    const nodes = (await db.syllabus_nodes.toArray()).filter((n) => !n.deleted_at && !n.unmatched);
    if (!plan) return { plan: null, blocks: [] as PlanBlock[], missed: [] as PlanBlock[], nodes };
    const blocks = (await db.plan_blocks.where('plan_id').equals(plan.id).toArray()).filter((b) => !b.deleted_at);
    return {
      plan,
      blocks: blocks.filter((b) => b.date === today),
      missed: blocks.filter((b) => b.date < today && b.status === 'planned' && b.date >= addDays(today, -14)),
      nodes,
    };
  }, [today]);
  if (!data) return null;
  const bySubject = (sid: string) => data.nodes.filter((n) => n.subject_id === sid);
  const phase = data.plan ? phaseOn(data.plan.phases, today)?.key : undefined;

  if (!data.plan) {
    // Before a plan exists: each subject's last studied item, with Continue.
    const rows = subjects
      .map((s) => {
        const ns = bySubject(s.id);
        const last = [...ns].filter((n) => n.last_studied_at).sort((a, b) => b.last_studied_at!.localeCompare(a.last_studied_at!))[0];
        return { s, last, next: last ? last : continueNode(ns, 'first_read') };
      })
      .filter((r) => r.next);
    if (!rows.length)
      return (
        <Section title="Today's plan">
          <p className="text-muted">
            Import a subject's syllabus to see where to continue, or <Link to="/planner" className="underline">make a plan</Link>.
          </p>
        </Section>
      );
    return (
      <Section title="Pick up where you left off">
        <ul className="space-y-2">
          {rows.map(({ s, last, next }) => (
            <li key={s.id} className="tab flex items-center justify-between gap-2 rounded-r-lg px-3 py-2" style={tabStyle(s.color)}>
              <div className="min-w-0">
                <div className="text-sm font-semibold">{s.code}</div>
                <div className="truncate text-sm">
                  {last ? 'Last: ' : 'Start at: '}
                  {next!.marker} {next!.title}
                </div>
              </div>
              <button className="btn btn-sm shrink-0" onClick={() => onStart({ subjectId: s.id, nodeId: next!.id, kind: 'reading' })}>
                Continue
              </button>
            </li>
          ))}
        </ul>
      </Section>
    );
  }

  async function moveBlock(b: PlanBlock) {
    // Next free slot: the first day from today with room left (and room for the subject).
    const plan = data!.plan!;
    const events = (await db.events.toArray()).filter((e) => !e.deleted_at);
    const all = (await db.plan_blocks.where('plan_id').equals(plan.id).toArray()).filter((x) => !x.deleted_at && x.status !== 'moved' && x.status !== 'skipped');
    for (let i = 0; i < 60; i++) {
      const d = addDays(today, i);
      if (exam && d >= exam.day1) break;
      const eventMinutes: Record<string, number> = {};
      for (const e of events) {
        const day = e.starts_at.slice(0, 10);
        eventMinutes[day] = (eventMinutes[day] ?? 0) + (Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 60000;
      }
      const cap = dayCapacity(
        {
          hoursByWeekday: plan.hours_by_weekday,
          restDays: plan.rest_rules.restDays ?? [],
          halfDays: plan.rest_rules.halfDays ?? [],
          eventMinutes,
          blackout: exam ? [exam.day1, exam.day2, exam.day3] : [],
        } as never,
        d,
      );
      const dayBlocks = all.filter((x) => x.date === d);
      const used = dayBlocks.reduce((s, x) => s + x.minutes, 0);
      const subjectsThatDay = new Set(dayBlocks.map((x) => x.subject_id));
      const room = subjectsThatDay.has(b.subject_id) || subjectsThatDay.size < plan.max_subjects_per_day;
      if (cap - used >= b.minutes && room) {
        await putRows('plan_blocks', [{ ...b, status: 'moved' }, copyBlock(b, d)]);
        return;
      }
    }
    // No room in the next weeks: put it on today.
    await putRows('plan_blocks', [{ ...b, status: 'moved' }, copyBlock(b, today)]);
  }

  return (
    <>
      {data.missed.length > 0 && (
        <Section title="Missed blocks">
          <ul className="space-y-2">
            {data.missed.map((b) => {
              const s = subjects.find((x) => x.id === b.subject_id);
              return (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">
                    <SubjectTag subject={s} /> {formatDuration(b.minutes * 60)} on {shortDate(b.date)}
                  </span>
                  <span className="flex gap-2">
                    <button className="btn btn-sm" onClick={() => void moveBlock(b)}>
                      Move to next free slot
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => void patch('plan_blocks', b.id, { status: 'skipped' })}>
                      Skip
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      <Section title="Today's plan" action={<Link to="/planner" className="text-sm text-muted underline">Planner</Link>}>
        {data.blocks.length === 0 ? (
          <p className="text-muted">Nothing planned today. Rest counts.</p>
        ) : (
          <ul className="space-y-2">
            {data.blocks.map((b) => {
              const s = subjects.find((x) => x.id === b.subject_id);
              const next = continueNode(bySubject(b.subject_id), phase);
              return (
                <li key={b.id} className={`tab rounded-r-lg px-3 py-2 ${b.status === 'done' ? 'opacity-60' : ''}`} style={tabStyle(s?.color)}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm">
                        <span className="font-semibold">{s?.code}</span> · {formatDuration(b.minutes * 60)} · {b.kind}
                        {b.status === 'done' ? ' · done' : ''}
                      </div>
                      {next && (
                        <div className="truncate text-sm text-muted">
                          Continue at: {next.marker} {next.title}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {b.status === 'planned' && (
                        <button className="btn btn-sm btn-ghost" onClick={() => void patch('plan_blocks', b.id, { status: 'done' })} aria-label="Mark done">
                          ✓
                        </button>
                      )}
                      <button className="btn btn-sm" onClick={() => onStart({ subjectId: b.subject_id, nodeId: next?.id ?? null, kind: b.kind })}>
                        Start
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}

function CardsSection({ subjects }: { subjects: Subject[] }) {
  const settings = useSettings();
  const q = useLive(async () => {
    const all = await buildQueue(settings);
    const due: Record<string, number> = {};
    let fresh = 0;
    for (const e of all) {
      if (e.item.state === 0) fresh++;
      else due[e.card.subject_id ?? 'none'] = (due[e.card.subject_id ?? 'none'] ?? 0) + 1;
    }
    const total = await db.cards.filter((c) => !c.deleted_at).count();
    return { due, fresh, dueTotal: all.length - fresh, total };
  }, [settings.newCardsPerDay, settings.maxReviewsPerDay]);
  if (!q) return null;
  if (!q.total)
    return (
      <Section title="Cards">
        <p className="text-muted">No cards yet. Make cards from a provision or a digest, or add one in Cards.</p>
      </Section>
    );
  return (
    <Section title="Cards">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">
            {q.dueTotal} due, {q.fresh} new
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {subjects
              .filter((s) => q.due[s.id])
              .map((s) => (
                <span key={s.id} className="text-sm">
                  <SubjectTag subject={s} /> {q.due[s.id]}
                </span>
              ))}
          </div>
        </div>
        <Link to="/cards/review" className={`btn btn-primary ${q.dueTotal + q.fresh === 0 ? 'pointer-events-none opacity-50' : ''}`}>
          Review
        </Link>
      </div>
      {q.dueTotal + q.fresh === 0 && <p className="mt-2 text-sm text-muted">No cards due. Make cards from a provision or a digest.</p>}
    </Section>
  );
}

function DrillSection({ subjects }: { subjects: Subject[] }) {
  const settings = useSettings();
  const nav = useNavigate();
  const d = useLive(suggestedDrill);
  if (!d) return null;
  const s = subjects.find((x) => x.id === d.question.subject_id);
  return (
    <Section title="Suggested drill">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <div>
            <SubjectTag subject={s} /> 1 problem, {settings.minutesPerProblem} min
          </div>
          {d.spot && <div className="truncate text-muted">Weak spot: {d.spot.node.title}</div>}
        </div>
        <button
          className="btn btn-primary shrink-0"
          onClick={async () => {
            const a = await createAttempt({
              mode: 'drill',
              subjectId: d.question.subject_id,
              questionIds: [d.question.id],
              timeLimitSec: settings.minutesPerProblem * 60,
            });
            nav(`/practice/attempt/${a.id}`);
          }}
        >
          Start
        </button>
      </div>
    </Section>
  );
}

function WeekSection({ subjects }: { subjects: Subject[] }) {
  const today = todayManila();
  const week = startOfWeek(today);
  const data = useLive(async () => {
    const from = startOfManilaDay(week).toISOString();
    const sessions = (await db.study_sessions.where('started_at').aboveOrEqual(from).toArray()).filter((s) => !s.deleted_at);
    const done: Record<string, number> = {};
    for (const s of sessions) done[s.subject_id ?? 'none'] = (done[s.subject_id ?? 'none'] ?? 0) + (s.ended_at ? s.duration_sec : 0);
    const plan = (await db.plans.toArray()).filter((p) => !p.deleted_at).sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0];
    const planned: Record<string, number> = {};
    if (plan) {
      const blocks = (await db.plan_blocks.where('plan_id').equals(plan.id).toArray()).filter(
        (b) => !b.deleted_at && b.date >= week && b.date <= addDays(week, 6) && b.status !== 'moved' && b.status !== 'skipped',
      );
      for (const b of blocks) planned[b.subject_id] = (planned[b.subject_id] ?? 0) + b.minutes * 60;
    }
    return { done, planned, any: sessions.length > 0 || !!plan };
  }, [week]);
  if (!data?.any) return null;
  return (
    <Section title="This week" action={<Link to="/progress" className="text-sm text-muted underline">Progress</Link>}>
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {subjects.map((s) => {
          const done = data.done[s.id] ?? 0;
          const plan = data.planned[s.id] ?? 0;
          return (
            <li key={s.id} className="text-sm">
              <div className="mb-1 flex justify-between">
                <SubjectTag subject={s} />
                <span className="tabular-nums text-muted">
                  {formatDuration(done)}
                  {plan ? ` of ${formatDuration(plan)}` : ''}
                </span>
              </div>
              <Bar value={plan ? done / plan : done ? 1 : 0} color={s.color} />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function NeglectSection({ subjects }: { subjects: Subject[] }) {
  const settings = useSettings();
  const data = useLive(async () => {
    const sessions = (await db.study_sessions.toArray()).filter((s) => !s.deleted_at);
    if (!sessions.length) return [];
    const last: Record<string, string> = {};
    for (const s of sessions) if (s.subject_id && (!last[s.subject_id] || last[s.subject_id] < s.started_at)) last[s.subject_id] = s.started_at;
    const now = Date.now();
    return subjects
      .map((s) => ({ s, days: last[s.id] ? Math.floor((now - Date.parse(last[s.id])) / 86_400_000) : null }))
      .filter((x) => x.days === null || x.days >= settings.neglectDays);
  }, [subjects.length, settings.neglectDays]);
  if (!data?.length) return null;
  return (
    <section className="rounded-xl border border-rule p-4">
      <h2 className="font-semibold">A subject is waiting</h2>
      <ul className="mt-1 space-y-1 text-sm">
        {data.map(({ s, days }) => (
          <li key={s.id}>
            <SubjectTag subject={s} /> {days === null ? 'not studied yet' : `not studied in ${days} days`}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CoverageStrip({ subjects }: { subjects: Subject[] }) {
  const settings = useSettings();
  const nodes = useLive(async () => (await db.syllabus_nodes.toArray()).filter((n) => !n.deleted_at && !n.unmatched));
  const cov = useMemo(() => {
    if (!nodes?.length) return null;
    const parents = new Set(nodes.map((n) => n.parent_id));
    let num = 0;
    let den = 0;
    for (const s of subjects) {
      const leaves = nodes.filter((n: SyllabusNode) => n.subject_id === s.id && !parents.has(n.id));
      const c = leaves.length ? leaves.reduce((t, n) => t + settings.leafScores[n.status], 0) / leaves.length : 0;
      num += s.weight * c;
      den += s.weight;
    }
    return den ? num / den : 0;
  }, [nodes, subjects, settings.leafScores]);
  if (cov === null) return null;
  return (
    <Link to="/syllabus" className="block">
      <div className="mb-1 flex justify-between text-sm">
        <span className="font-semibold">Weighted coverage</span>
        <span className="tabular-nums">{Math.round(cov * 100)}%</span>
      </div>
      <Bar value={cov} />
    </Link>
  );
}

function BackupNudge() {
  const settings = useSettings();
  const hasData = useLive(async () => (await db.cards.count()) + (await db.syllabus_nodes.count()) + (await db.digests.count()) > 0);
  const stale = !settings.lastExportAt || daysBetween(settings.lastExportAt.slice(0, 10), todayManila()) >= 7;
  if (!hasData || !stale) return null;
  return (
    <p className="text-sm text-muted">
      No backup exported in the last 7 days. <Link to="/settings" className="underline">Export one</Link>.
    </p>
  );
}

export default function Today() {
  const exam = useExam();
  const subjects = useSubjects();
  const settings = useSettings();
  const [timer, setTimer] = useState<StartArgs | null>(null);
  const today = todayManila();
  if (!exam) return <div className="p-4 text-muted">Setting things up…</div>;
  const dayNo = today === exam.day1 ? 1 : today === exam.day2 ? 2 : today === exam.day3 ? 3 : 0;
  if (dayNo) return <ExamDay dayNo={dayNo} subjects={subjects} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{greeting(settings.greetingName)} · {longDate(today)}</p>
      <Countdown day1={exam.day1} day2={exam.day2} day3={exam.day3} />
      <BaonCard />
      <PlanSection subjects={subjects} onStart={setTimer} />
      <CardsSection subjects={subjects} />
      <DrillSection subjects={subjects} />
      <WeekSection subjects={subjects} />
      <NeglectSection subjects={subjects} />
      <CoverageStrip subjects={subjects} />
      <BackupNudge />
      <TimerDialog
        open={!!timer}
        onClose={() => setTimer(null)}
        initial={timer ? { subjectId: timer.subjectId, nodeId: timer.nodeId, kind: timer.kind } : undefined}
      />
    </div>
  );
}
