import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, CircleAlert, Clock, Heart, HardDriveDownload } from 'lucide-react';
import {
  ContinueStudying,
  ExamCountdown,
  QuickActions,
  ReviewQueue,
  StatRow,
  StudyActivityChart,
  TodayStudyPlan,
  type StartArgs,
} from '../components/dashboard';
import TimerDialog from '../components/TimerDialog';
import { PageSkeleton, SubjectTag, tabStyle } from '../components/ui';
import { loadDashboard } from '../lib/dashboard';
import { db } from '../lib/db';
import { useExam, useLive, useSettings, useSubjects } from '../lib/hooks';
import { patch } from '../lib/repo';
import { clockLabel, daysBetween, longDate, todayManila } from '../lib/time';
import type { BaonNote, Subject } from '../lib/types';

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
    <section className="panel flex items-start gap-4 p-5" aria-label="Baon, a note from home" style={{ backgroundImage: 'linear-gradient(90deg, color-mix(in srgb, #F59E0B 8%, transparent), transparent 50%)' }}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,#F59E0B_16%,transparent)] text-[#F59E0B]" aria-hidden>
        <Heart className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="t-eyebrow">Baon · a note from home</p>
        <p className="reading mt-1 text-lg italic">“{note.body}”</p>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={() => void patch('baon_notes', note.id, { archived: true })}>
        <Archive /> Archive
      </button>
    </section>
  );
}

function ExamDay({ dayNo, subjects }: { dayNo: number; subjects: Subject[] }) {
  const exam = useExam()!;
  const settings = useSettings();
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const todays = subjects.filter((s) => s.exam_day === dayNo).sort((a, b) => a.session.localeCompare(b.session));
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <p className="t-eyebrow">
          Day {dayNo} · {longDate(todayManila())}
        </p>
        <h1 className="mt-1 text-4xl font-semibold tracking-tight">Kaya mo ’to.</h1>
      </header>
      <section className="panel p-5" aria-label="Today's subjects">
        <h2 className="t-section mb-3">Today's subjects</h2>
        <ul className="space-y-2">
          {todays.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-xl border border-rule p-3" style={tabStyle(s.color)}>
              <Clock className="h-4 w-4 text-muted" aria-hidden />
              <div>
                <p className="text-sm font-semibold">
                  {s.session === 'AM' ? `${clockLabel(exam.am_start)}–${clockLabel(exam.am_end)}` : `${clockLabel(exam.pm_start)}–${clockLabel(exam.pm_end)}`} · {s.code}
                </p>
                <p className="text-sm text-muted">{s.name}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      {settings.examDayChecklist.length > 0 && (
        <section className="panel p-5" aria-label="Checklist">
          <h2 className="t-section mb-3">Checklist</h2>
          <ul className="space-y-1">
            {settings.examDayChecklist.map((item, i) => (
              <li key={i}>
                <label className="flex items-center gap-3 rounded-lg px-1 py-1.5">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[var(--accent)]"
                    checked={checked.has(i)}
                    onChange={() => {
                      const n = new Set(checked);
                      if (n.has(i)) n.delete(i);
                      else n.add(i);
                      setChecked(n);
                    }}
                  />
                  <span className={checked.has(i) ? 'text-muted line-through' : ''}>{item}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}
      <BaonCard />
    </div>
  );
}

function Nudges({ subjects, hasData }: { subjects: Subject[]; hasData: boolean }) {
  const settings = useSettings();
  const today = todayManila();
  const neglected = useLive(async () => {
    const sessions = (await db.study_sessions.toArray()).filter((s) => !s.deleted_at);
    if (!sessions.length) return [];
    const last: Record<string, string> = {};
    for (const s of sessions) if (s.subject_id && (!last[s.subject_id] || last[s.subject_id] < s.started_at)) last[s.subject_id] = s.started_at;
    const now = Date.now();
    return subjects
      .map((s) => ({ s, days: last[s.id] ? Math.floor((now - Date.parse(last[s.id])) / 86_400_000) : null }))
      .filter((x) => x.days === null || x.days >= settings.neglectDays);
  }, [subjects.length, settings.neglectDays]);
  const staleBackup = hasData && (!settings.lastExportAt || daysBetween(settings.lastExportAt.slice(0, 10), today) >= 7);
  if (!neglected?.length && !staleBackup) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {!!neglected?.length && (
        <section className="panel flex items-start gap-3 p-4" aria-label="Subjects waiting">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium">A subject is waiting</p>
            <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              {neglected.map(({ s, days }) => (
                <li key={s.id} className="flex items-center gap-1.5">
                  <SubjectTag subject={s} /> {days === null ? 'not studied yet' : `${days} days`}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      {staleBackup && (
        <section className="panel flex items-center gap-3 p-4" aria-label="Backup reminder">
          <HardDriveDownload className="h-4 w-4 shrink-0 text-muted" aria-hidden />
          <p className="flex-1 text-sm">No backup exported in the last 7 days.</p>
          <Link to="/settings" className="btn btn-sm">
            Export backup
          </Link>
        </section>
      )}
    </div>
  );
}

export default function Today() {
  const exam = useExam();
  const subjects = useSubjects();
  const settings = useSettings();
  const [timer, setTimer] = useState<StartArgs | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const today = todayManila();
  const data = useLive(() => loadDashboard(settings, subjects), [subjects.length, settings.newCardsPerDay, settings.maxReviewsPerDay, JSON.stringify(settings.leafScores), today]);

  if (!exam || !data) return <PageSkeleton />;
  const dayNo = today === exam.day1 ? 1 : today === exam.day2 ? 2 : today === exam.day3 ? 3 : 0;
  if (dayNo) return <ExamDay dayNo={dayNo} subjects={subjects} />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="t-eyebrow">
            {greeting(settings.greetingName)} · {longDate(today)}
          </p>
          <h1 className="t-title mt-1">Your Study Dashboard</h1>
          <p className="mt-1 text-sm text-muted">One provision, one card, one problem at a time. Here's what today asks of you.</p>
        </div>
      </header>

      <ExamCountdown exam={exam} subjects={subjects} data={data} />
      <BaonCard />
      <StatRow data={data} />

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <TodayStudyPlan data={data} subjects={subjects} exam={exam} onStart={setTimer} />
        </div>
        <div className="lg:col-span-4">
          <ReviewQueue data={data} subjects={subjects} />
        </div>
        <div className="lg:col-span-7">
          <ContinueStudying data={data} subjects={subjects} onStart={setTimer} />
        </div>
        <div className="lg:col-span-5">
          <StudyActivityChart data={data} />
        </div>
      </div>

      <QuickActions onLog={() => setLogOpen(true)} />
      <Nudges subjects={subjects} hasData={data.hasAnyData} />

      <TimerDialog open={!!timer || logOpen} onClose={() => { setTimer(null); setLogOpen(false); }} initial={timer ? { subjectId: timer.subjectId, nodeId: timer.nodeId, kind: timer.kind } : undefined} />
    </div>
  );
}
