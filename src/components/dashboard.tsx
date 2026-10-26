import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  CalendarPlus,
  CalendarRange,
  Check,
  CircleAlert,
  Clock,
  Flame,
  Gavel,
  Layers,
  ListChecks,
  NotebookPen,
  PenLine,
  Play,
  RotateCcw,
  Target,
  TrendingDown,
  TrendingUp,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { nextFor, type DashboardData, type RecentItem } from '../lib/dashboard';
import { db } from '../lib/db';
import { dayCapacity, PHASE_LABELS } from '../lib/planner';
import { makeRow, patch, putRows } from '../lib/repo';
import { addDays, clockLabel, daysBetween, formatDuration, longDate, manilaDate, shortDate, todayManila, weekday } from '../lib/time';
import type { ExamConfig, PlanBlock, SessionKind, Subject } from '../lib/types';
import { Bar, Empty, Ring, SubjectTag, tabStyle } from './ui';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface StartArgs {
  subjectId: string | null;
  nodeId: string | null;
  kind: SessionKind;
}

function Card({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <section className={`panel flex flex-col p-5 ${className}`} aria-label={label}>
      {children}
    </section>
  );
}

function CardHeader({ title, icon: Icon, action, sub }: { title: string; icon?: LucideIcon; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-elevated text-muted" aria-hidden>
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="t-section">{title}</h2>
          {sub && <p className="text-xs text-muted">{sub}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

// Countdown -----------------------------------------------------------------------

export function ExamCountdown({ exam, subjects, data }: { exam: ExamConfig; subjects: Subject[]; data: DashboardData }) {
  const today = todayManila();
  const days = daysBetween(today, exam.day1);
  const dates = [exam.day1, exam.day2, exam.day3];
  const plan = data.plan;
  const start = plan?.start_date;
  const total = start ? Math.max(1, daysBetween(start, exam.day1)) : null;
  const elapsed = start ? Math.min(total!, Math.max(0, daysBetween(start, today))) : null;
  const weeks = Math.floor(Math.max(0, days) / 7);
  const phaseColors = ['#5B8CFF', '#8B7CF6', '#F59E0B', '#22C55E'];

  return (
    <section
      className="panel relative overflow-hidden p-6 lg:p-7"
      aria-label="Bar exam countdown"
      style={{ backgroundImage: 'radial-gradient(1200px 300px at 0% 0%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 60%)' }}
    >
      <div className="grid gap-6 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-5">
          <p className="t-eyebrow">{exam.name}</p>
          {days > 0 ? (
            <>
              <p className="mt-2 flex items-baseline gap-3">
                <span className="text-6xl leading-none font-semibold tracking-tight tabular-nums">{days}</span>
                <span className="text-lg font-medium text-muted">{days === 1 ? 'day' : 'days'} to Day 1</span>
              </p>
              <p className="mt-2 text-sm text-muted">
                {weeks > 0 ? `About ${weeks} ${weeks === 1 ? 'week' : 'weeks'} · ` : ''}
                {longDate(exam.day1)}
              </p>
            </>
          ) : days === 0 ? (
            <p className="mt-2 text-4xl font-semibold tracking-tight">Day 1 is today</p>
          ) : (
            <p className="mt-2 text-4xl font-semibold tracking-tight">The Bar is underway</p>
          )}
        </div>

        <ol className="grid grid-cols-3 gap-2 sm:gap-3 lg:col-span-7">
          {dates.map((d, i) => {
            const subs = subjects.filter((s) => s.exam_day === i + 1).sort((a, b) => a.session.localeCompare(b.session));
            const left = daysBetween(today, d);
            const done = left < 0;
            return (
              <li key={d} className={`rounded-xl border border-rule bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] p-3 ${done ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">Day {i + 1}</span>
                  <span className="text-[0.6875rem] text-muted tabular-nums">{done ? 'Done' : left === 0 ? 'Today' : `${left}d`}</span>
                </div>
                <p className="mt-1 text-sm font-medium">
                  {WEEKDAY[weekday(d)]}, {shortDate(d)}
                </p>
                <ul className="mt-2 space-y-1">
                  {subs.map((s) => (
                    <li key={s.id} className="flex items-center gap-1.5 text-[0.6875rem] text-muted" style={tabStyle(s.color)} title={`${s.name} · ${s.session === 'AM' ? `${clockLabel(exam.am_start)}–${clockLabel(exam.am_end)}` : `${clockLabel(exam.pm_start)}–${clockLabel(exam.pm_end)}`}`}>
                      <span className="subject-dot" aria-hidden />
                      <span className="font-semibold text-ink">{s.code}</span>
                      <span className="hidden sm:inline">{s.session}</span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      </div>

      {plan && total !== null && elapsed !== null && (
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-xs text-muted">
            <span>
              {data.phase ? <span className="font-medium text-ink">{PHASE_LABELS[data.phase.key]}</span> : 'Review'} · day {elapsed + 1} of {total}
            </span>
            <span>{Math.round((elapsed / total) * 100)}% of review time used</span>
          </div>
          <div className="relative flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`Review timeline: ${plan.phases.map((p) => `${PHASE_LABELS[p.key]} until ${shortDate(p.end)}`).join(', ')}`}>
            {plan.phases.map((p, i) => {
              const w = Math.max(0, daysBetween(p.start, p.end) + 1) / total;
              return <span key={p.key} className="h-full" style={{ width: `${w * 100}%`, background: `color-mix(in srgb, ${phaseColors[i % 4]} 35%, var(--elevated))` }} />;
            })}
            <span className="absolute inset-y-0 left-0 rounded-full bg-[color-mix(in_srgb,var(--ink)_18%,transparent)]" style={{ width: `${(elapsed / total) * 100}%` }} aria-hidden />
          </div>
          <ol className="mt-2 hidden justify-between text-[0.6875rem] text-muted sm:flex">
            {plan.phases.map((p, i) => (
              <li key={p.key} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: phaseColors[i % 4] }} aria-hidden />
                {PHASE_LABELS[p.key]} · {shortDate(p.start)}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

// KPI cards ----------------------------------------------------------------------

export function StudyStatCard({
  label,
  icon: Icon,
  value,
  sub,
  visual,
  to,
  tone = 'var(--accent)',
}: {
  label: string;
  icon: LucideIcon;
  value: ReactNode;
  sub: ReactNode;
  visual?: ReactNode;
  to?: string;
  tone?: string;
}) {
  const body = (
    <div className="flex h-full items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-xs font-medium text-muted">
          <Icon className="h-3.5 w-3.5" style={{ color: tone }} aria-hidden />
          {label}
        </p>
        <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted">{sub}</p>
      </div>
      {visual}
    </div>
  );
  return to ? (
    <Link to={to} className="panel card-hover block p-4">
      {body}
    </Link>
  ) : (
    <div className="panel p-4">{body}</div>
  );
}

export function StatRow({ data }: { data: DashboardData }) {
  const { coverage, streak, studiedToday, accuracy, due } = data;
  const dueTotal = due.reviews + due.fresh;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <StudyStatCard
        label="Study progress"
        icon={Target}
        value={coverage === null ? '—' : `${Math.round(coverage * 100)}%`}
        sub={coverage === null ? 'Import a syllabus to track coverage' : 'Weighted syllabus coverage'}
        visual={coverage !== null ? <Ring value={coverage} label={`${Math.round(coverage * 100)}% covered`} /> : undefined}
        to="/syllabus"
      />
      <StudyStatCard
        label="Study streak"
        icon={Flame}
        tone="#F59E0B"
        value={
          <>
            {streak} <span className="text-base font-medium text-muted">{streak === 1 ? 'day' : 'days'}</span>
          </>
        }
        sub={streak === 0 ? 'Study today to start one' : studiedToday ? 'Today counts. Keep it going' : 'Study today to keep it going'}
        to="/log"
      />
      <StudyStatCard
        label="Practice performance"
        icon={PenLine}
        tone="#8B7CF6"
        value={accuracy ? `${accuracy.value.toFixed(0)}%` : '—'}
        sub={
          accuracy ? (
            accuracy.delta !== null ? (
              <span className={`inline-flex items-center gap-1 ${accuracy.delta >= 0 ? 'text-ok' : 'text-danger'}`}>
                {accuracy.delta >= 0 ? <TrendingUp className="h-3.5 w-3.5" aria-hidden /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden />}
                {accuracy.delta >= 0 ? '+' : ''}
                {accuracy.delta.toFixed(0)} pts vs previous 10
              </span>
            ) : (
              `Average of your last ${Math.min(10, accuracy.count)} graded answers`
            )
          ) : (
            'Grade a drill to see your average'
          )
        }
        to="/practice"
      />
      <StudyStatCard
        label="Review queue"
        icon={Layers}
        tone="#22C55E"
        value={dueTotal}
        sub={due.totalCards === 0 ? 'No flashcards yet' : `${due.reviews} due · ${due.fresh} new`}
        visual={
          dueTotal > 0 ? (
            <span className="btn btn-primary btn-sm self-center">
              <Play className="!h-3.5 !w-3.5" /> Review
            </span>
          ) : undefined
        }
        to={dueTotal > 0 ? '/cards/review' : '/cards'}
      />
    </div>
  );
}

// Today's plan ---------------------------------------------------------------------

function copyBlock(b: PlanBlock, date: string): PlanBlock {
  return makeRow('plan_blocks', { plan_id: b.plan_id, date, subject_id: b.subject_id, minutes: b.minutes, kind: b.kind, status: 'planned', continue_node_id: b.continue_node_id });
}

/** Moves a missed block to the next day with room for it (or today). */
async function moveToNextFreeSlot(b: PlanBlock, data: DashboardData, exam: ExamConfig) {
  const plan = data.plan!;
  const today = todayManila();
  const events = (await db.events.toArray()).filter((e) => !e.deleted_at);
  const eventMinutes: Record<string, number> = {};
  for (const e of events) {
    const day = manilaDate(e.starts_at);
    eventMinutes[day] = (eventMinutes[day] ?? 0) + (Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 60000;
  }
  const all = (await db.plan_blocks.where('plan_id').equals(plan.id).toArray()).filter((x) => !x.deleted_at && x.status !== 'moved' && x.status !== 'skipped');
  for (let i = 0; i < 60; i++) {
    const d = addDays(today, i);
    if (d >= exam.day1) break;
    const cap = dayCapacity(
      {
        hoursByWeekday: plan.hours_by_weekday,
        restDays: plan.rest_rules.restDays ?? [],
        halfDays: plan.rest_rules.halfDays ?? [],
        eventMinutes,
        blackout: [exam.day1, exam.day2, exam.day3],
      } as never,
      d,
    );
    const dayBlocks = all.filter((x) => x.date === d);
    const used = dayBlocks.reduce((s, x) => s + x.minutes, 0);
    const subs = new Set(dayBlocks.map((x) => x.subject_id));
    if (cap - used >= b.minutes && (subs.has(b.subject_id) || subs.size < plan.max_subjects_per_day)) {
      await putRows('plan_blocks', [{ ...b, status: 'moved' }, copyBlock(b, d)]);
      return;
    }
  }
  await putRows('plan_blocks', [{ ...b, status: 'moved' }, copyBlock(b, today)]);
}

export function TodayStudyPlan({ data, subjects, exam, onStart }: { data: DashboardData; subjects: Subject[]; exam: ExamConfig; onStart: (a: StartArgs) => void }) {
  const nav = useNavigate();
  const { plan, todayBlocks, missed } = data;
  const sub = (id: string) => subjects.find((s) => s.id === id);

  if (!plan) {
    const hasSyllabus = data.nodes.length > 0;
    return (
      <Card label="Today's study plan" className="h-full">
        <CardHeader title="Today's study plan" icon={CalendarRange} />
        <Empty
          icon={CalendarPlus}
          title="No study plan yet"
          actions={
            <>
              {!hasSyllabus && (
                <button className="btn" onClick={() => nav('/syllabus')}>
                  <Upload /> Import syllabus
                </button>
              )}
              <button className="btn btn-primary" onClick={() => nav('/planner')}>
                <CalendarPlus /> Create my study plan
              </button>
            </>
          }
        >
          Build your study roadmap and know exactly what to review every day. {hasSyllabus ? 'Your syllabus is ready to plan from.' : 'Start by importing your syllabus, then build your personalised schedule.'}
        </Empty>
      </Card>
    );
  }

  const live = todayBlocks.filter((b) => b.status !== 'skipped');
  const doneMin = live.filter((b) => b.status === 'done').reduce((t, b) => t + b.minutes, 0);
  const totalMin = live.reduce((t, b) => t + b.minutes, 0);
  const nextBlock = live.find((b) => b.status === 'planned');

  return (
    <Card label="Today's study plan" className="h-full">
      <CardHeader
        title="Today's study plan"
        icon={CalendarRange}
        sub={totalMin ? `${formatDuration(doneMin * 60)} of ${formatDuration(totalMin * 60)} done` : data.phase ? PHASE_LABELS[data.phase.key] : undefined}
        action={
          <Link to="/planner" className="btn btn-ghost btn-sm">
            Full planner <ArrowRight />
          </Link>
        }
      />
      {totalMin > 0 && (
        <div className="mb-4">
          <Bar value={doneMin / totalMin} label="Today's plan completed" />
        </div>
      )}

      {missed.length > 0 && (
        <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--warn)_40%,var(--rule))] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CircleAlert className="h-4 w-4 text-warn" aria-hidden /> {missed.length} missed {missed.length === 1 ? 'block' : 'blocks'}
          </p>
          <ul className="mt-2 space-y-1.5">
            {missed.slice(0, 4).map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <SubjectTag subject={sub(b.subject_id)} /> {formatDuration(b.minutes * 60)} · {shortDate(b.date)}
                </span>
                <span className="flex gap-1.5">
                  <button className="btn btn-sm" onClick={() => void moveToNextFreeSlot(b, data, exam)}>
                    Move to next free slot
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => void patch('plan_blocks', b.id, { status: 'skipped' })}>
                    Skip
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {live.length === 0 ? (
        <Empty icon={Check} title="Nothing planned today" compact>
          Rest counts. Your streak is safe on planned rest days.
        </Empty>
      ) : (
        <ul className="divide-y divide-rule">
          {live.map((b) => {
            const s = sub(b.subject_id);
            const next = nextFor(data, b.subject_id);
            const done = b.status === 'done';
            return (
              <li key={b.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0" style={tabStyle(s?.color)}>
                <button
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${done ? 'pop border-[var(--tab)] bg-[var(--tab)] text-white' : 'border-rule-strong hover:border-[var(--tab)]'}`}
                  onClick={() => void patch('plan_blocks', b.id, { status: done ? 'planned' : 'done' })}
                  aria-label={done ? `Mark ${s?.code} block not done` : `Mark ${s?.code} block done`}
                  aria-pressed={done}
                >
                  {done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                </button>
                <div className={`min-w-0 flex-1 ${done ? 'opacity-60' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <SubjectTag subject={s} />
                    <span className={`font-medium ${done ? 'line-through' : ''}`}>{next ? next.title : s?.name}</span>
                  </div>
                  <p className="mt-0.5 flex items-center gap-3 text-xs text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden /> {formatDuration(b.minutes * 60)}
                    </span>
                    <span className="capitalize">{b.kind}</span>
                    {next && <span className="hidden truncate sm:inline">Continue at {next.marker}</span>}
                  </p>
                </div>
                {!done && (
                  <button className="btn btn-sm shrink-0" onClick={() => onStart({ subjectId: b.subject_id, nodeId: next?.id ?? null, kind: b.kind })}>
                    <Play className="!h-3.5 !w-3.5" /> Start
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {nextBlock && (
        <button
          className="btn btn-primary mt-5 w-full sm:w-auto sm:self-start"
          onClick={() => onStart({ subjectId: nextBlock.subject_id, nodeId: nextFor(data, nextBlock.subject_id)?.id ?? null, kind: nextBlock.kind })}
        >
          <Play /> Continue studying {sub(nextBlock.subject_id)?.code}
        </button>
      )}
    </Card>
  );
}

// Review queue ---------------------------------------------------------------------

export function ReviewQueue({ data, subjects }: { data: DashboardData; subjects: Subject[] }) {
  const nav = useNavigate();
  const { due, openMistakes, needsWork, lowScored, upcoming7 } = data;
  const dueTotal = due.reviews + due.fresh;
  const rows: { label: string; count: number; to: string; priority: 'high' | 'medium' | 'low'; icon: LucideIcon }[] = [
    { label: 'Flashcards due', count: due.reviews, to: '/cards/review', priority: due.reviews > 50 ? 'high' : 'medium', icon: Layers },
    { label: 'New flashcards', count: due.fresh, to: '/cards/review', priority: 'low', icon: Layers },
    { label: 'Problems scored below 3', count: lowScored, to: '/practice', priority: 'high', icon: PenLine },
    { label: 'Open mistakes', count: openMistakes, to: '/mistakes', priority: 'medium', icon: CircleAlert },
  ].filter((r) => r.count > 0) as never;
  const dot = { high: 'var(--danger)', medium: 'var(--warn)', low: 'var(--ink-faint)' };
  const nothing = rows.length === 0 && needsWork.length === 0;

  return (
    <Card label="Smart review queue" className="h-full">
      <CardHeader title="Review queue" icon={RotateCcw} sub={upcoming7 ? `${upcoming7} more cards due this week` : undefined} />
      {nothing ? (
        <Empty icon={Layers} title={due.totalCards ? 'All caught up' : 'No flashcards yet'} compact actions={!due.totalCards && <Link to="/cards" className="btn btn-sm">Create flashcards</Link>}>
          {due.totalCards ? 'Nothing is due right now. New reviews appear as cards come due.' : 'Turn important provisions and legal concepts into effective review cards.'}
        </Empty>
      ) : (
        <>
          <ul className="space-y-1">
            {rows.map((r) => (
              <li key={r.label}>
                <Link to={r.to} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-elevated">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot[r.priority] }} aria-label={`${r.priority} priority`} />
                  <span className="flex-1">{r.label}</span>
                  <span className="font-semibold tabular-nums">{r.count}</span>
                </Link>
              </li>
            ))}
          </ul>
          {Object.keys(due.bySubject).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {subjects
                .filter((s) => due.bySubject[s.id])
                .map((s) => (
                  <Link key={s.id} to={`/cards/review?subject=${s.id}`} className="chip hover:text-ink" style={tabStyle(s.color)}>
                    <span className="subject-dot" aria-hidden />
                    {s.code} {due.bySubject[s.id]}
                  </Link>
                ))}
            </div>
          )}
          {needsWork.length > 0 && (
            <div className="mt-4">
              <p className="t-eyebrow mb-1.5">Topics needing revision</p>
              <ul className="space-y-1">
                {needsWork.map((n) => {
                  const s = subjects.find((x) => x.id === n.subject_id);
                  return (
                    <li key={n.id}>
                      <Link to={`/syllabus/${s?.code}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-elevated" style={tabStyle(s?.color)}>
                        <span className="subject-dot" aria-hidden />
                        <span className="truncate">{n.title}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {dueTotal > 0 && (
            <button className="btn btn-primary mt-auto w-full" style={{ marginTop: '1.25rem' }} onClick={() => nav('/cards/review')}>
              <Play /> Start reviewing · {dueTotal}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

// Continue -------------------------------------------------------------------------

const RECENT_ICON: Record<RecentItem['kind'], LucideIcon> = { provision: BookOpen, node: ListChecks, cards: Layers, attempt: PenLine };

function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function ContinueStudying({ data, subjects, onStart }: { data: DashboardData; subjects: Subject[]; onStart: (a: StartArgs) => void }) {
  const items = data.recent;
  // Without any history yet, offer where each subject's syllabus begins.
  const starts = subjects
    .map((s) => ({ s, n: nextFor(data, s.id) }))
    .filter((x) => x.n)
    .slice(0, 3);
  return (
    <Card label="Continue where you left off" className="h-full">
      <CardHeader title="Continue where you left off" icon={RotateCcw} />
      {items.length === 0 ? (
        starts.length ? (
          <ul className="space-y-2">
            {starts.map(({ s, n }) => (
              <li key={s.id} className="flex items-center gap-3 rounded-xl border border-rule p-3" style={tabStyle(s.color)}>
                <span className="subject-dot" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted">{s.code} · start here</p>
                  <p className="truncate text-sm font-medium">
                    {n!.marker} {n!.title}
                  </p>
                </div>
                <button className="btn btn-sm" onClick={() => onStart({ subjectId: s.id, nodeId: n!.id, kind: 'reading' })}>
                  <Play className="!h-3.5 !w-3.5" /> Start
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={BookOpen} title="Nothing to resume yet" compact actions={<Link to="/syllabus" className="btn btn-sm">Open syllabus</Link>}>
            What you read, review and practise will show up here so you can pick it up in one tap.
          </Empty>
        )
      ) : (
        <ul className="space-y-2">
          {items.map((r) => {
            const s = subjects.find((x) => x.id === r.subjectId);
            const Icon = RECENT_ICON[r.kind];
            return (
              <li key={r.kind}>
                <Link to={r.to} className="card-hover flex items-center gap-3 rounded-xl border border-rule p-3" style={tabStyle(s?.color ?? 'var(--accent)')}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--tab)_14%,var(--elevated))]" aria-hidden>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="truncate text-xs text-muted">
                      {r.detail} · {ago(r.at)}
                    </p>
                  </div>
                  <span className={`btn btn-sm shrink-0 ${r.inProgress ? 'btn-primary' : ''}`}>
                    Resume <ArrowRight />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// Weekly activity --------------------------------------------------------------------

export function StudyActivityChart({ data }: { data: DashboardData }) {
  const week = data.week;
  const max = Math.max(60, ...week.map((d) => d.minutes));
  const total = week.reduce((t, d) => t + d.minutes, 0);
  const reviews = week.reduce((t, d) => t + d.reviews, 0);
  const activeDays = week.filter((d) => d.minutes || d.reviews).length;
  const today = todayManila();
  return (
    <Card label="Weekly study activity" className="h-full">
      <CardHeader
        title="Last 7 days"
        icon={Clock}
        sub={`${formatDuration(total * 60)} studied · ${reviews} card ${reviews === 1 ? 'review' : 'reviews'}`}
        action={
          <Link to="/progress" className="btn btn-ghost btn-sm">
            Progress <ArrowRight />
          </Link>
        }
      />
      <div className="flex flex-1 items-end gap-2" role="img" aria-label={`Study minutes, last 7 days: ${week.map((d) => `${WEEKDAY[weekday(d.date)]} ${d.minutes} minutes`).join(', ')}`}>
        {week.map((d) => {
          const h = d.minutes ? Math.max(6, (d.minutes / max) * 100) : 0;
          const isToday = d.date === today;
          return (
            <div key={d.date} className="group flex flex-1 flex-col items-center gap-2">
              <div className="relative flex h-28 w-full items-end justify-center">
                <span className="pointer-events-none absolute -top-1 hidden -translate-y-full rounded-md bg-[var(--ink)] px-2 py-1 text-[0.6875rem] whitespace-nowrap text-[var(--paper)] group-hover:block">
                  {formatDuration(d.minutes * 60)}
                  {d.reviews ? ` · ${d.reviews} reviews` : ''}
                </span>
                {h > 0 ? (
                  <span className="w-full max-w-[1.75rem] rounded-t-[4px] rounded-b-[2px] transition-[height] duration-500" style={{ height: `${h}%`, background: isToday ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 45%, var(--elevated))' }} />
                ) : (
                  <span className="h-1 w-full max-w-[1.75rem] rounded-full bg-elevated" />
                )}
              </div>
              <span className={`text-[0.6875rem] ${isToday ? 'font-semibold text-ink' : 'text-muted'}`}>{WEEKDAY[weekday(d.date)].slice(0, 2)}</span>
              {d.reviews > 0 && <span className="h-1 w-1 rounded-full bg-ok" title={`${d.reviews} card reviews`} aria-hidden />}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">
        {activeDays === 0 ? 'No study logged this week yet. Start a timer or review cards to see it here.' : `Active ${activeDays} of 7 days · daily average ${formatDuration((total / 7) * 60)}`}
      </p>
    </Card>
  );
}

// Quick actions ----------------------------------------------------------------------

export function QuickActions({ onLog }: { onLog: () => void }) {
  const actions: { label: string; sub: string; icon: LucideIcon; to?: string; onClick?: () => void; color: string }[] = [
    { label: 'Start practice', sub: 'Timed essay drill', icon: PenLine, to: '/practice', color: '#8B7CF6' },
    { label: 'Review flashcards', sub: 'Spaced repetition', icon: Layers, to: '/cards/review', color: '#22C55E' },
    { label: 'Read codals', sub: 'Provisions and highlights', icon: BookOpen, to: '/codals', color: '#5B8CFF' },
    { label: 'Case digests', sub: 'Doctrines and rulings', icon: Gavel, to: '/digests', color: '#E08A1E' },
    { label: 'Open syllabus', sub: 'Track coverage', icon: ListChecks, to: '/syllabus', color: '#178C96' },
    { label: 'Log study session', sub: 'Start the timer', icon: NotebookPen, onClick: onLog, color: '#CF3F3F' },
  ];
  return (
    <section aria-label="Quick actions">
      <h2 className="t-section mb-3">Quick actions</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {actions.map((a) => {
          const inner = (
            <>
              <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${a.color} 16%, transparent)`, color: a.color }} aria-hidden>
                <a.icon className="h-4 w-4" />
              </span>
              <span className="mt-3 block text-sm font-medium">{a.label}</span>
              <span className="block text-xs text-muted">{a.sub}</span>
            </>
          );
          return a.to ? (
            <Link key={a.label} to={a.to} className="panel card-hover block p-4">
              {inner}
            </Link>
          ) : (
            <button key={a.label} onClick={a.onClick} className="panel card-hover block p-4 text-left">
              {inner}
            </button>
          );
        })}
      </div>
    </section>
  );
}
