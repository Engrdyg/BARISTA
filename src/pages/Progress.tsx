import { useEffect } from 'react';
import { Bar as RBar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axis, ChartTooltip, grid, Legend } from '../components/charts';
import { Bar, PageHeader, Section, SubjectTag } from '../components/ui';
import { gainFromTen, overallCoverage, projectedGwa, subjectCoverage, type GradedAttempt } from '../lib/calc';
import { db } from '../lib/db';
import { updateSettings, useExam, useLive, useSettings, useSubjects } from '../lib/hooks';
import { State } from '../lib/srs';
import { addDays, formatDuration, manilaDate, shortDate, startOfManilaDay, startOfWeek, todayManila } from '../lib/time';

export default function Progress() {
  const subjects = useSubjects();
  const settings = useSettings();
  const exam = useExam();
  const today = todayManila();

  const data = useLive(async () => {
    const [nodes, sessions, logs, attempts, items, plans] = await Promise.all([
      db.syllabus_nodes.filter((n) => !n.deleted_at && !n.unmatched).toArray(),
      db.study_sessions.filter((s) => !s.deleted_at && !!s.ended_at).toArray(),
      db.review_logs.where('reviewed_at').aboveOrEqual(startOfManilaDay(addDays(today, -29)).toISOString()).filter((l) => !l.deleted_at).toArray(),
      db.attempts.filter((a) => !a.deleted_at && a.status !== 'in_progress').toArray(),
      db.attempt_items.filter((i) => !i.deleted_at).toArray(),
      db.plans.filter((p) => !p.deleted_at).toArray(),
    ]);
    const plan = plans.sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0];
    const blocks = plan ? (await db.plan_blocks.where('plan_id').equals(plan.id).toArray()).filter((b) => !b.deleted_at && b.status !== 'moved' && b.status !== 'skipped') : [];
    return { nodes, sessions, logs, attempts, items, blocks };
  }, [today]);

  const cov = new Map(subjects.map((s) => [s.id, data ? subjectCoverage(data.nodes.filter((n) => n.subject_id === s.id), settings.leafScores) : null]));
  const overall = overallCoverage(subjects, cov);

  // Record today's weighted coverage once a day for the trend line.
  useEffect(() => {
    if (!data || !data.nodes.length) return;
    const hist = settings.coverageHistory ?? [];
    const last = hist[hist.length - 1];
    const v = Math.round(overall * 1000) / 10;
    if (last?.date === today && last.value === v) return;
    void updateSettings({ coverageHistory: [...hist.filter((h) => h.date !== today), { date: today, value: v }].slice(-400) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, overall, today]);

  if (!data || !exam) return <p className="text-muted">Loading…</p>;

  // Hours per week, last 8 weeks.
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(startOfWeek(today), (i - 7) * 7));
  const hours = weeks.map((w) => {
    const end = addDays(w, 7);
    const row: Record<string, number | string> = { week: shortDate(w) };
    for (const s of subjects) {
      row[s.id] = data.sessions.filter((x) => x.subject_id === s.id && manilaDate(x.started_at) >= w && manilaDate(x.started_at) < end).reduce((t, x) => t + x.duration_sec, 0) / 3600;
      row[`plan:${s.id}`] = data.blocks.filter((b) => b.subject_id === s.id && b.date >= w && b.date < end).reduce((t, b) => t + b.minutes, 0) / 60;
    }
    return row;
  });
  const thisWeek = hours[hours.length - 1];

  // Cards: 30-day retention (share of reviews of mature-ish cards not graded Again).
  const reviews = data.logs.filter((l) => l.state === State.Review);
  const retention = reviews.length ? reviews.filter((l) => l.rating > 1).length / reviews.length : null;
  const perDay = Array.from({ length: 30 }, (_, i) => {
    const d = addDays(today, i - 29);
    return { date: shortDate(d), reviews: data.logs.filter((l) => manilaDate(l.reviewed_at) === d).length };
  });

  // Mocks and projected GWA.
  const graded: GradedAttempt[] = data.attempts.map((a) => ({
    subject_id: a.subject_id,
    mode: a.mode,
    submitted_at: a.submitted_at,
    items: data.items.filter((i) => i.attempt_id === a.id).map((i) => ({ score: i.score })),
  }));
  const proj = projectedGwa(subjects, graded);
  const mockPoints = data.attempts
    .filter((a) => a.mode !== 'drill' && a.submitted_at)
    .map((a) => {
      const its = data.items.filter((i) => i.attempt_id === a.id);
      if (!its.length || its.some((i) => i.score === null)) return null;
      return { subject_id: a.subject_id!, date: manilaDate(a.submitted_at!), score: (its.reduce((t, i) => t + i.score!, 0) / (its.length * 5)) * 100 };
    })
    .filter(Boolean) as { subject_id: string; date: string; score: number }[];
  const mockDates = [...new Set(mockPoints.map((m) => m.date))].sort();
  const mockRows = mockDates.map((d) => {
    const row: Record<string, number | string> = { date: shortDate(d) };
    for (const m of mockPoints.filter((x) => x.date === d)) row[m.subject_id] = Math.round(m.score * 10) / 10;
    return row;
  });
  const mockSubjects = subjects.filter((s) => mockPoints.some((m) => m.subject_id === s.id));
  const history = (settings.coverageHistory ?? []).map((h) => ({ date: shortDate(h.date), value: h.value }));

  return (
    <div className="space-y-4">
      <PageHeader title="Progress" subtitle="Projections are self-graded estimates" />

      <Section title="Coverage">
        <div className="mb-3 flex items-baseline gap-3">
          <p className="text-4xl font-bold tabular-nums">{Math.round(overall * 100)}%</p>
          <p className="text-sm text-muted">weighted by subject</p>
        </div>
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {subjects.map((s) => (
            <li key={s.id} className="text-sm">
              <div className="mb-1 flex justify-between">
                <SubjectTag subject={s} />
                <span className="tabular-nums">{cov.get(s.id) === null ? 'No syllabus' : `${Math.round((cov.get(s.id) ?? 0) * 100)}%`}</span>
              </div>
              <Bar value={cov.get(s.id) ?? 0} color={s.color} />
            </li>
          ))}
        </ul>
        {history.length > 1 && (
          <div className="mt-4 h-40" aria-label="Weighted coverage over time">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="date" {...axis} minTickGap={24} />
                <YAxis {...axis} axisLine={false} domain={[0, 100]} unit="%" />
                <Tooltip content={<ChartTooltip unit="%" />} />
                <Line type="monotone" dataKey="value" name="Coverage" stroke="var(--ink)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      <Section title="Hours per week">
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 pr-3 font-normal">Subject</th>
                {weeks.map((w) => (
                  <th key={w} className="px-1 py-1 text-right font-normal">
                    {shortDate(w)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => (
                <tr key={s.id} className="border-t border-rule">
                  <td className="py-1 pr-3">
                    <SubjectTag subject={s} />
                  </td>
                  {hours.map((h, i) => {
                    const done = h[s.id] as number;
                    const plan = h[`plan:${s.id}`] as number;
                    return (
                      <td key={i} className="px-1 py-1 text-right">
                        {done ? done.toFixed(1) : '·'}
                        {plan ? <span className="text-xs text-muted">/{plan.toFixed(1)}</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Hours studied, with planned hours after the slash. This week so far:{' '}
          {formatDuration(subjects.reduce((t, s) => t + (thisWeek[s.id] as number), 0) * 3600)}.
        </p>
      </Section>

      <Section title="Cards">
        <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-muted">30-day retention</p>
            <p className="text-3xl font-bold tabular-nums">{retention === null ? '—' : `${Math.round(retention * 100)}%`}</p>
            <p className="text-xs text-muted">target {Math.round(settings.desiredRetention * 100)}%</p>
          </div>
          <div>
            <p className="text-sm text-muted">Reviews, 30 days</p>
            <p className="text-3xl font-bold tabular-nums">{data.logs.length}</p>
          </div>
        </div>
        {data.logs.length > 0 && (
          <div className="h-40" aria-label="Reviews per day">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perDay} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="date" {...axis} interval={6} />
                <YAxis {...axis} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'color-mix(in srgb, var(--ink) 6%, transparent)' }} />
                <RBar dataKey="reviews" name="Reviews" fill="var(--ink-muted)" radius={[4, 4, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      <Section title="Mocks and projected GWA">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <p className="text-4xl font-bold tabular-nums">{proj.gwa === null ? '—' : proj.gwa.toFixed(2)}</p>
          <p className="text-sm text-muted">
            projected GWA · passing {exam.passing_gwa}
            {proj.partial && proj.gwa !== null && ` · partial: no data for ${proj.missing.join(', ')}`}
          </p>
        </div>
        {proj.gwa === null && <p className="text-sm text-muted">Grade a mock or a few drills to see a projection.</p>}
        <ul className="mb-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {subjects.map((s) => {
            const sc = proj.bySubject.get(s.id);
            return (
              <li key={s.id} className="flex justify-between">
                <SubjectTag subject={s} />
                <span className="tabular-nums">{sc ? `${sc.score.toFixed(1)} (${sc.basis === 'mocks' ? `last ${sc.count} mocks` : `last ${sc.count} drill problems`})` : '—'}</span>
              </li>
            );
          })}
        </ul>
        {mockRows.length > 0 && (
          <>
            <div className="h-56" aria-label="Mock scores by subject">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={mockRows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid {...grid} />
                  <XAxis dataKey="date" {...axis} />
                  <YAxis {...axis} axisLine={false} domain={[0, 100]} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={exam.passing_gwa} stroke="var(--ink-muted)" label={{ value: String(exam.passing_gwa), fill: 'var(--ink-muted)', fontSize: 11, position: 'insideTopLeft' }} />
                  {mockSubjects.map((s) => (
                    <Line key={s.id} type="monotone" dataKey={s.id} name={s.code} stroke={s.color} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: s.color }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend line items={mockSubjects.map((s) => ({ key: s.id, label: s.code, color: s.color }))} />
          </>
        )}
      </Section>

      <Section title="Where points are cheapest">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 font-normal">Subject</th>
              <th className="py-1 text-right font-normal">Weight</th>
              <th className="py-1 text-right font-normal">+10 points adds to GWA</th>
            </tr>
          </thead>
          <tbody>
            {[...subjects]
              .sort((a, b) => b.weight - a.weight)
              .map((s) => (
                <tr key={s.id} className="border-t border-rule">
                  <td className="py-1">
                    <SubjectTag subject={s} /> <span className="text-muted">{s.name}</span>
                  </td>
                  <td className="py-1 text-right">{s.weight}%</td>
                  <td className="py-1 text-right font-semibold">+{gainFromTen(s.weight).toFixed(1)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">Self-graded estimate.</p>
      </Section>
    </div>
  );
}
