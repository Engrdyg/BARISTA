import { useState } from 'react';
import { NotebookPen, Plus } from 'lucide-react';
import TimerDialog, { KINDS, NodeSelect } from '../components/TimerDialog';
import { Empty, Field, Modal, PageHeader, Section, SubjectSelect, SubjectTag } from '../components/ui';
import { db } from '../lib/db';
import { useLive, useNow, useSettings, useSubjects } from '../lib/hooks';
import { putRow, softDelete } from '../lib/repo';
import { elapsedSec, logSession, runningTimer, secondsToday, stopTimer } from '../lib/timer';
import { formatClock, formatDuration, longDate, manilaDate, manilaTime, todayManila } from '../lib/time';
import type { SessionKind, StudySession } from '../lib/types';

function toLocalInput(iso: string) {
  // datetime-local in Manila time
  const d = new Date(Date.parse(iso) + 8 * 3600_000);
  return d.toISOString().slice(0, 16);
}
function fromLocalInput(v: string) {
  return new Date(`${v}:00+08:00`).toISOString();
}

function SessionEditor({ s, onClose }: { s: StudySession | null; onClose: () => void }) {
  const subjects = useSubjects();
  const now = new Date().toISOString();
  const [subject, setSubject] = useState<string | null>(s?.subject_id ?? null);
  const [node, setNode] = useState<string | null>(s?.node_id ?? null);
  const [kind, setKind] = useState<SessionKind>(s?.kind ?? 'reading');
  const [start, setStart] = useState(toLocalInput(s?.started_at ?? new Date(Date.now() - 3600_000).toISOString()));
  const [end, setEnd] = useState(toLocalInput(s?.ended_at ?? now));
  const [note, setNote] = useState(s?.note ?? '');
  const valid = end > start;
  return (
    <Modal open onClose={onClose} title={s ? 'Edit session' : 'Add time studied'}>
      <div className="space-y-3">
        <Field label="Subject">
          <SubjectSelect subjects={subjects} value={subject} onChange={(v) => { setSubject(v); setNode(null); }} />
        </Field>
        <Field label="Syllabus item">
          <NodeSelect subjectId={subject} value={node} onChange={setNode} />
        </Field>
        <Field label="Kind" htmlFor="se-kind">
          <select id="se-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as SessionKind)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="From" htmlFor="se-start">
            <input id="se-start" type="datetime-local" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="To" htmlFor="se-end">
            <input id="se-end" type="datetime-local" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Note" htmlFor="se-note">
          <input id="se-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <button
            className="btn btn-primary"
            disabled={!valid}
            onClick={async () => {
              const started_at = fromLocalInput(start);
              const ended_at = fromLocalInput(end);
              if (s) {
                await putRow('study_sessions', {
                  ...s,
                  subject_id: subject,
                  node_id: node,
                  kind,
                  started_at,
                  ended_at,
                  note,
                  duration_sec: Math.round((Date.parse(ended_at) - Date.parse(started_at)) / 1000 - s.paused_sec),
                });
              } else await logSession({ subject_id: subject, node_id: node, kind, source: 'manual', started_at, ended_at, note });
              onClose();
            }}
          >
            Save
          </button>
          {s && (
            <button className="btn btn-danger ml-auto" onClick={async () => { await softDelete('study_sessions', s.id); onClose(); }}>
              Delete
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Running() {
  const timer = useLive(runningTimer);
  const settings = useSettings();
  const subjects = useSubjects();
  const now = useNow(1000);
  const [open, setOpen] = useState(false);
  if (!timer)
    return (
      <Section title="Timer">
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          Start timer
        </button>
        <TimerDialog open={open} onClose={() => setOpen(false)} />
      </Section>
    );
  const el = elapsedSec(timer, now);
  const cycle = (settings.pomodoroWork + settings.pomodoroBreak) * 60;
  const inCycle = el % cycle;
  const focus = inCycle < settings.pomodoroWork * 60;
  const pomoLeft = focus ? settings.pomodoroWork * 60 - inCycle : cycle - inCycle;
  return (
    <Section title="Timer">
      <p className="text-sm">
        <SubjectTag subject={subjects.find((s) => s.id === timer.subject_id)} /> {timer.kind}
        {timer.paused_at && ' · paused while you review cards or take an exam'}
      </p>
      <p className="mt-1 text-5xl font-bold tabular-nums">{formatClock(el)}</p>
      {settings.pomodoro && (
        <p className="mt-1 text-sm">
          {focus ? 'Focus' : 'Break'} · {formatClock(pomoLeft)} left
        </p>
      )}
      <button className="btn btn-primary mt-3" onClick={() => void stopTimer(timer.id)}>
        Stop
      </button>
    </Section>
  );
}

export default function Log() {
  const subjects = useSubjects();
  const settings = useSettings();
  const [editing, setEditing] = useState<StudySession | null | undefined>(undefined);
  const [capDismissed, setCapDismissed] = useState(false);
  const sessions = useLive(async () => (await db.study_sessions.toArray()).filter((s) => !s.deleted_at && s.ended_at).sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 200)) ?? [];
  const today = useLive(secondsToday) ?? 0;
  const byDay = new Map<string, StudySession[]>();
  for (const s of sessions) {
    const d = manilaDate(s.started_at);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(s);
  }
  const overCap = today >= settings.dailyCapHours * 3600;
  return (
    <div className="space-y-4">
      <PageHeader
        icon={NotebookPen}
        title="Study log"
        subtitle={`${formatDuration(today)} today`}
        actions={
          <button className="btn" onClick={() => setEditing(null)}>
            <Plus /> Add time
          </button>
        }
      />
      {overCap && !capDismissed && (
        <div className="flex items-start justify-between gap-2 rounded-xl border border-rule p-3 text-sm">
          <p>That's {formatDuration(today)} today. Rest is part of the plan; tomorrow goes better after sleep.</p>
          <button className="btn btn-sm btn-ghost" onClick={() => setCapDismissed(true)}>
            Dismiss
          </button>
        </div>
      )}
      <Running />
      {sessions.length === 0 ? (
        <Empty icon={NotebookPen} title="No study time logged yet" actions={<button className="btn" onClick={() => setEditing(null)}><Plus /> Add time</button>}>
          Start the timer above, or add time you studied away from the app. Card reviews and exams log their own time.
        </Empty>
      ) : (
        [...byDay].map(([d, list]) => (
          <section key={d}>
            <h2 className="mb-1 text-sm font-semibold">
              {d === todayManila() ? 'Today' : longDate(d)} · {formatDuration(list.reduce((t, s) => t + s.duration_sec, 0))}
            </h2>
            <ul className="panel divide-y divide-rule">
              {list.map((s) => (
                <li key={s.id}>
                  <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm" onClick={() => setEditing(s)}>
                    <span>
                      <SubjectTag subject={subjects.find((x) => x.id === s.subject_id)} /> {s.kind}
                      {s.source !== 'timer' && <span className="text-muted"> · {s.source}</span>}
                      {s.note && <span className="text-muted"> · {s.note}</span>}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted">
                      {manilaTime(s.started_at)} · {formatDuration(s.duration_sec)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {editing !== undefined && <SessionEditor s={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
