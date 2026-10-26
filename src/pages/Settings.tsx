import { useEffect, useState } from 'react';
import { SyncBadge } from '../components/Layout';
import { download, Field, PageHeader, Section, SubjectTag } from '../components/ui';
import { authState, signIn, signOut } from '../lib/auth';
import { exportAll, importBackup, isEmptyAccount, toCsv, type BackupFile } from '../lib/backup';
import { db, TABLES } from '../lib/db';
import { updateSettings, useExam, useLive, useSettings, useSubjects } from '../lib/hooks';
import { create, patch, softDelete } from '../lib/repo';
import { defaultSettings } from '../lib/seed';
import { useStore } from '../lib/store';
import { cloudEnabled } from '../lib/supabase';
import { daysBetween, manilaDate, todayManila } from '../lib/time';
import type { ExamConfig, FormChecklist, SettingsData, Subject } from '../lib/types';

function ListEditor({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [v, setV] = useState('');
  return (
    <div>
      <p className="label">{label}</p>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={`${it}-${i}`} className="flex items-center gap-1">
            <input className="input py-1" value={it} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`${label} ${i + 1}`} />
            <button className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => onChange(items.map((x, j) => (j === i - 1 ? items[i] : j === i ? items[i - 1] : x)))} aria-label="Move up">
              ↑
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove">
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-1 flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (v.trim()) onChange([...items, v.trim()]);
          setV('');
        }}
      >
        <input className="input py-1" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder ?? 'Add…'} aria-label={`Add to ${label}`} />
        <button className="btn btn-sm">Add</button>
      </form>
    </div>
  );
}

function NumberField({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number }) {
  const id = `n-${label.replace(/\W+/g, '-')}`;
  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        className="input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(min !== undefined && n < min ? min : max !== undefined && n > max ? max : n);
        }}
      />
    </Field>
  );
}

function Account() {
  const auth = useStore(authState);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  if (!cloudEnabled)
    return (
      <Section title="Account and sync">
        <p className="text-sm text-muted">This build keeps everything on this device only. To sync your laptop and phone, set up Supabase (see the README) and redeploy. Export a backup regularly.</p>
      </Section>
    );
  return (
    <Section title="Account and sync">
      {auth.email ? (
        <div className="space-y-2 text-sm">
          <p>
            Signed in as <strong>{auth.email}</strong>
          </p>
          <SyncBadge />
          <div>
            <button
              className="btn btn-sm"
              onClick={async () => {
                if (confirm('Sign out? Your data stays in your account; this device will be cleared.')) await signOut();
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(await signIn(email, pw));
          }}
        >
          <p className="text-sm text-muted">Using this device only. Sign in to sync; everything here uploads to your account.</p>
          <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
          <input className="input" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Password" />
          {err && <p className="text-sm text-danger">{err}</p>}
          <button className="btn btn-primary">Sign in</button>
        </form>
      )}
    </Section>
  );
}

function ExamSection({ exam }: { exam: ExamConfig }) {
  const [e, setE] = useState(exam);
  useEffect(() => setE(exam), [exam]);
  const save = (change: Partial<ExamConfig>) => {
    setE({ ...e, ...change });
    void patch('exam_configs', exam.id, change);
  };
  return (
    <Section title="Exam">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" htmlFor="ex-name">
          <input id="ex-name" className="input" value={e.name} onChange={(x) => save({ name: x.target.value })} />
        </Field>
        {(['day1', 'day2', 'day3'] as const).map((d, i) => (
          <Field key={d} label={`Day ${i + 1}`} htmlFor={`ex-${d}`}>
            <input id={`ex-${d}`} type="date" className="input" value={e[d]} onChange={(x) => x.target.value && save({ [d]: x.target.value })} />
          </Field>
        ))}
        {(['am_start', 'am_end', 'pm_start', 'pm_end'] as const).map((k) => (
          <Field key={k} label={k.replace('_', ' ').replace('am', 'Morning').replace('pm', 'Afternoon')} htmlFor={`ex-${k}`}>
            <input id={`ex-${k}`} type="time" className="input" value={e[k]} onChange={(x) => save({ [k]: x.target.value })} />
          </Field>
        ))}
        <Field label="Coverage cutoff" htmlFor="ex-cutoff">
          <input id="ex-cutoff" type="date" className="input" value={e.coverage_cutoff} onChange={(x) => x.target.value && save({ coverage_cutoff: x.target.value })} />
        </Field>
        <NumberField label="Problems per subject" value={e.questions_per_subject} min={1} max={50} onChange={(n) => save({ questions_per_subject: n })} />
        <NumberField label="Passing GWA" value={e.passing_gwa} min={0} max={100} onChange={(n) => save({ passing_gwa: n })} />
      </div>
    </Section>
  );
}

function SubjectsSection({ subjects }: { subjects: Subject[] }) {
  const total = subjects.reduce((s, x) => s + x.weight, 0);
  return (
    <Section title="Subjects">
      {total !== 100 && <p className="mb-2 text-sm text-danger">Weights add up to {total}%, not 100%.</p>}
      <ul className="space-y-3">
        {subjects.map((s) => (
          <li key={s.id} className="grid grid-cols-2 gap-2 border-b border-rule pb-3 last:border-b-0 sm:grid-cols-[6rem_1fr_5rem_5rem_5rem_4rem]">
            <input className="input" value={s.code} onChange={(e) => void patch('subjects', s.id, { code: e.target.value.toUpperCase() })} aria-label="Code" />
            <input className="input col-span-2 sm:col-span-1" value={s.name} onChange={(e) => void patch('subjects', s.id, { name: e.target.value })} aria-label="Name" />
            <input className="input" type="number" value={s.weight} onChange={(e) => void patch('subjects', s.id, { weight: Number(e.target.value) })} aria-label={`${s.code} weight`} />
            <select className="select" value={s.exam_day} onChange={(e) => void patch('subjects', s.id, { exam_day: Number(e.target.value) })} aria-label={`${s.code} exam day`}>
              {[1, 2, 3].map((d) => (
                <option key={d} value={d}>
                  Day {d}
                </option>
              ))}
            </select>
            <select className="select" value={s.session} onChange={(e) => void patch('subjects', s.id, { session: e.target.value as Subject['session'] })} aria-label={`${s.code} session`}>
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
            <input className="h-10 w-full rounded border border-rule" type="color" value={s.color} onChange={(e) => void patch('subjects', s.id, { color: e.target.value })} aria-label={`${s.code} color`} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function FormChecklists() {
  const lists = useLive(async () => (await db.form_checklists.toArray()).filter((f) => !f.deleted_at)) ?? [];
  const [name, setName] = useState('');
  return (
    <Section title="Practical-exercise checklists">
      <p className="mb-2 text-sm text-muted">The parts a given pleading or form must have, ticked while grading practical exercises with that form type.</p>
      <div className="space-y-4">
        {lists.map((f: FormChecklist) => (
          <div key={f.id} className="rounded-lg border border-rule p-3">
            <div className="mb-2 flex items-center gap-2">
              <input className="input font-semibold" value={f.form_type} onChange={(e) => void patch('form_checklists', f.id, { form_type: e.target.value })} aria-label="Form type" />
              <button className="btn btn-sm btn-danger" onClick={() => void softDelete('form_checklists', f.id)}>
                Delete
              </button>
            </div>
            <ListEditor label="Parts" items={f.items} onChange={(items) => void patch('form_checklists', f.id, { items })} placeholder="Caption, Verification, …" />
          </div>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await create('form_checklists', { form_type: name.trim(), items: [] });
          setName('');
        }}
      >
        <input className="input" placeholder="Form type, e.g. Complaint" value={name} onChange={(e) => setName(e.target.value)} aria-label="New form type" />
        <button className="btn">Add form</button>
      </form>
    </Section>
  );
}

function Backup({ settings }: { settings: SettingsData }) {
  const [msg, setMsg] = useState<string | null>(null);
  const snapshots = useLive(() => db.snapshots.orderBy('date').reverse().toArray()) ?? [];
  const stale = !settings.lastExportAt || daysBetween(manilaDate(settings.lastExportAt), todayManila()) >= 7;
  return (
    <Section title="Backup">
      {stale && <p className="mb-2 rounded-lg border border-rule p-2 text-sm">No backup exported in the last 7 days. Export one and keep it somewhere safe.</p>}
      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-primary"
          onClick={async () => {
            download(`tiyaga-backup-${todayManila()}.json`, JSON.stringify(await exportAll()), 'application/json');
            await updateSettings({ lastExportAt: new Date().toISOString() });
          }}
        >
          Export everything (JSON)
        </button>
        <label className="btn">
          Import JSON
          <input
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const file = JSON.parse(await f.text()) as BackupFile;
                const empty = await isEmptyAccount();
                if (!empty && !confirm('This account already has data. Merge the backup by id (newer rows win)?')) return;
                const r = await importBackup(file);
                setMsg(`Restored: ${r.added} added, ${r.updated} updated, ${r.skipped} already newer here.`);
              } catch (err) {
                setMsg(err instanceof Error ? err.message : String(err));
              }
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {msg && <p className="mt-2 text-sm">{msg}</p>}
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold">CSV per table</summary>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {TABLES.filter((t) => t !== 'profiles').map((t) => (
            <button
              key={t}
              className="btn btn-sm"
              onClick={async () => {
                const rows = (await db.t(t).toArray()) as unknown as Record<string, unknown>[];
                download(`tiyaga-${t}-${todayManila()}.csv`, toCsv(rows), 'text/csv');
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </details>
      {snapshots.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold">Daily snapshots on this device</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {snapshots.map((s) => (
              <li key={s.date}>
                <button className="underline" onClick={() => download(`tiyaga-snapshot-${s.date}.json`, s.data, 'application/json')}>
                  {s.date}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

export default function Settings() {
  const settings = useSettings();
  const subjects = useSubjects();
  const exam = useExam();
  const set = (c: Partial<SettingsData>) => void updateSettings(c);

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      <Account />
      <Section title="You">
        <Field label="How the app greets you" htmlFor="s-name">
          <input id="s-name" className="input max-w-sm" value={settings.greetingName} onChange={(e) => set({ greetingName: e.target.value })} placeholder="Your name or nickname" />
        </Field>
      </Section>
      {exam && <ExamSection exam={exam} />}
      <SubjectsSection subjects={subjects} />
      <Section title="Study">
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label="New cards per day" value={settings.newCardsPerDay} min={0} max={500} onChange={(n) => set({ newCardsPerDay: n })} />
          <NumberField label="Max reviews per day" value={settings.maxReviewsPerDay} min={1} max={5000} onChange={(n) => set({ maxReviewsPerDay: n })} />
          <NumberField label="Desired retention" value={settings.desiredRetention} min={0.8} max={0.95} step={0.01} onChange={(n) => set({ desiredRetention: n })} />
          <NumberField label="Minutes per problem" value={settings.minutesPerProblem} min={1} max={60} onChange={(n) => set({ minutesPerProblem: n })} />
          <NumberField label="Pomodoro focus (min)" value={settings.pomodoroWork} min={5} max={120} onChange={(n) => set({ pomodoroWork: n })} />
          <NumberField label="Pomodoro break (min)" value={settings.pomodoroBreak} min={1} max={60} onChange={(n) => set({ pomodoroBreak: n })} />
          <NumberField label="Gentle cap (hours a day)" value={settings.dailyCapHours} min={1} max={20} onChange={(n) => set({ dailyCapHours: n })} />
          <NumberField label="Neglect alert after (days)" value={settings.neglectDays} min={1} max={60} onChange={(n) => set({ neglectDays: n })} />
        </div>
        <div className="mt-3 space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.pomodoro} onChange={(e) => set({ pomodoro: e.target.checked })} /> Use Pomodoro with the timer
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.cramReschedules} onChange={(e) => set({ cramReschedules: e.target.checked })} /> Cram sessions change card schedules
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.allowPasteInExam} onChange={(e) => set({ allowPasteInExam: e.target.checked })} /> Allow pasting into exam answers
          </label>
        </div>
      </Section>
      <Section title="Reading">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Theme" htmlFor="s-theme">
            <select id="s-theme" className="select" value={settings.theme} onChange={(e) => set({ theme: e.target.value as SettingsData['theme'] })}>
              <option value="system">Match device</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="sepia">Sepia (reading)</option>
            </select>
          </Field>
          <NumberField label="Text size (%)" value={settings.textSize} min={90} max={140} step={5} onChange={(n) => set({ textSize: n })} />
          <NumberField label="Line height" value={settings.lineHeight} min={1.3} max={2} step={0.1} onChange={(n) => set({ lineHeight: n })} />
        </div>
        <p className="reading mt-3 text-muted">Article 1156. An obligation is a juridical necessity to give, to do or not to do.</p>
      </Section>
      <Section title="Highlighters">
        <ul className="space-y-2">
          {settings.highlightLegend.map((h, i) => (
            <li key={h.key} className="flex items-center gap-2">
              <input
                type="color"
                className="h-10 w-12 rounded border border-rule"
                value={h.color}
                onChange={(e) => set({ highlightLegend: settings.highlightLegend.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })}
                aria-label={`${h.label} color`}
              />
              <input className="input" value={h.label} onChange={(e) => set({ highlightLegend: settings.highlightLegend.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} aria-label="Meaning" />
              <span className="hl px-2 py-1 text-sm" style={{ ['--hl' as string]: h.color }}>
                Sample
              </span>
            </li>
          ))}
        </ul>
        <button className="btn btn-sm btn-ghost mt-2" onClick={() => set({ highlightLegend: defaultSettings().highlightLegend })}>
          Reset to defaults
        </button>
      </Section>
      <Section title="Grading">
        <div className="grid gap-4 sm:grid-cols-2">
          <ListEditor label="Answer structure (ALAC by default)" items={settings.structureTemplate} onChange={(v) => set({ structureTemplate: v })} />
          <ListEditor label="Error tags" items={settings.errorTags} onChange={(v) => set({ errorTags: v })} />
        </div>
        <button className="btn btn-sm btn-ghost mt-2" onClick={() => set({ structureTemplate: ['Issue', 'Rule', 'Application', 'Conclusion'] })}>
          Use IRAC
        </button>
      </Section>
      <FormChecklists />
      <Section title="Exam day">
        <ListEditor label="Your exam-day checklist" items={settings.examDayChecklist} onChange={(v) => set({ examDayChecklist: v })} />
      </Section>
      <Section title="Baon and AI notes">
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.baonEnabled} onChange={(e) => set({ baonEnabled: e.target.checked })} /> Show Baon notes on Today
          </label>
          {cloudEnabled && (
            <>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.aiNotesEnabled} onChange={(e) => set({ aiNotesEnabled: e.target.checked })} /> AI notes on graded essays (compares with your reference answer only)
              </label>
              <div className="max-w-xs">
                <NumberField label="AI notes per month" value={settings.aiMonthlyCap} min={0} max={1000} onChange={(n) => set({ aiMonthlyCap: n })} />
              </div>
            </>
          )}
        </div>
        <BaonArchive />
      </Section>
      <Backup settings={settings} />
      <p className="text-center text-xs text-muted">
        Tiyaga · subjects {subjects.map((s) => <SubjectTag key={s.id} subject={s} className="mx-0.5" />)}
      </p>
    </div>
  );
}

function BaonArchive() {
  const notes = useLive(async () => (await db.baon_notes.toArray()).filter((n) => !n.deleted_at).sort((a, b) => b.created_at.localeCompare(a.created_at))) ?? [];
  if (!notes.length) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-semibold">All Baon notes ({notes.length})</summary>
      <ul className="mt-2 space-y-2 text-sm">
        {notes.map((n) => (
          <li key={n.id} className="flex items-start justify-between gap-2">
            <span className={n.archived ? 'text-muted' : ''}>
              “{n.body}” {n.show_on && <span className="text-xs text-muted">· for {n.show_on}</span>}
            </span>
            <button className="btn btn-sm btn-ghost shrink-0" onClick={() => void patch('baon_notes', n.id, { archived: !n.archived })}>
              {n.archived ? 'Unarchive' : 'Archive'}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
