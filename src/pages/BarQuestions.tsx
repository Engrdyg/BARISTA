import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Landmark, Lightbulb, Play } from 'lucide-react';
import { Empty, Markdown, PageHeader, PageSkeleton, SubjectChips, SubjectTag } from '../components/ui';
import { dedupeBank } from '../lib/bank';
import { db } from '../lib/db';
import { createAttempt } from '../lib/exam';
import { useLive, useSettings, useSubjects } from '../lib/hooks';
import { useSubjectFilter } from '../lib/subjectFilter';
import type { Question } from '../lib/types';

/** A problem counts as a past Bar question when its source names the Bar and it has a year. */
export function isBarQuestion(q: Pick<Question, 'source_label' | 'year'>): boolean {
  return !!q.year && /\bbar\b/i.test(q.source_label);
}

const RECENT_YEARS = 5;

export default function BarQuestions() {
  const subjects = useSubjects();
  const settings = useSettings();
  const nav = useNavigate();
  const [subject, setSubject] = useSubjectFilter();
  const [recentOnly, setRecentOnly] = useState(true);
  const [year, setYear] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [answerFor, setAnswerFor] = useState<string | null>(null);

  const data = useLive(async () => {
    const qs = dedupeBank((await db.questions.toArray()).filter((q) => !q.deleted_at && isBarQuestion(q)));
    const items = (await db.attempt_items.toArray()).filter((i) => !i.deleted_at && i.score !== null);
    const attempts = new Map((await db.attempts.toArray()).map((a) => [a.id, a]));
    const last = new Map<string, { score: number; at: string }>();
    for (const i of items) {
      const at = attempts.get(i.attempt_id)?.submitted_at ?? i.updated_at;
      const prev = last.get(i.question_id);
      if (!prev || prev.at < at) last.set(i.question_id, { score: i.score!, at });
    }
    return { qs, last };
  });

  const years = useMemo(() => [...new Set((data?.qs ?? []).map((q) => q.year!))].sort((a, b) => b - a), [data]);
  if (!data) return <PageSkeleton />;

  const recentCut = years.slice(0, RECENT_YEARS);
  const shown = data.qs
    .filter((q) => !subject || q.subject_id === subject)
    .filter((q) => (year ? q.year === year : !recentOnly || recentCut.includes(q.year!)));

  // year → subject → questions, newest year first, then Bar subject order
  const groups = new Map<number, Map<string, Question[]>>();
  for (const q of shown) {
    if (!groups.has(q.year!)) groups.set(q.year!, new Map());
    const g = groups.get(q.year!)!;
    const k = q.subject_id ?? 'none';
    if (!g.has(k)) g.set(k, []);
    g.get(k)!.push(q);
  }
  const subjectOrder = (k: string) => {
    const i = subjects.findIndex((s) => s.id === k);
    return i < 0 ? 99 : i;
  };
  const num = (q: Question) => Number(q.number) || 0;

  async function practise(qs: Question[]) {
    const sorted = [...qs].sort((a, b) => num(a) - num(b));
    const full = sorted.length >= 10;
    const a = await createAttempt({
      mode: full ? 'mock' : 'drill',
      subjectId: sorted[0].subject_id,
      questionIds: sorted.map((q) => q.id),
      timeLimitSec: Math.min(240, sorted.length * settings.minutesPerProblem) * 60,
    });
    nav(`/practice/attempt/${a.id}`);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Landmark}
        title="Past Bar questions"
        subtitle={
          data.qs.length
            ? `${data.qs.length} questions from ${years.length} ${years.length === 1 ? 'Bar' : 'Bars'} · newest first`
            : 'Actual questions from past Bar examinations, grouped by year and subject'
        }
      />

      {data.qs.length === 0 ? (
        <Empty icon={Landmark} title="Loading past Bar questions">
          The question bank downloads the first time the app opens with an internet connection. Keep the app open for a moment, then come back to this page.
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-rule p-0.5" role="radiogroup" aria-label="Years">
              <button
                role="radio"
                aria-checked={!year && recentOnly}
                className={`btn btn-sm ${!year && recentOnly ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => {
                  setYear(null);
                  setRecentOnly(true);
                }}
              >
                Last {Math.min(RECENT_YEARS, years.length)} Bars
              </button>
              <button
                role="radio"
                aria-checked={!year && !recentOnly}
                className={`btn btn-sm ${!year && !recentOnly ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => {
                  setYear(null);
                  setRecentOnly(false);
                }}
              >
                All years
              </button>
            </div>
            <select className="select w-auto" value={year ?? ''} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)} aria-label="Bar year">
              <option value="">Pick a year</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y} Bar
                </option>
              ))}
            </select>
          </div>
          <SubjectChips subjects={subjects} value={subject} onChange={setSubject} />

          {groups.size === 0 ? (
            <Empty icon={Landmark} title="No questions match" compact>
              Try another year or subject.
            </Empty>
          ) : (
            [...groups.entries()]
              .sort((a, b) => b[0] - a[0])
              .map(([y, bySubject]) => (
                <section key={y} aria-label={`${y} Bar`}>
                  <h2 className="t-title mb-3 text-xl">{y} Bar</h2>
                  <div className="space-y-4">
                    {[...bySubject.entries()]
                      .sort((a, b) => subjectOrder(a[0]) - subjectOrder(b[0]))
                      .map(([sid, qs]) => {
                        const s = subjects.find((x) => x.id === sid);
                        const sorted = [...qs].sort((a, b) => num(a) - num(b));
                        const answered = sorted.filter((q) => data.last.has(q.id)).length;
                        return (
                          <div key={sid} className="panel overflow-hidden">
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
                              <div className="flex items-center gap-2 text-sm">
                                <SubjectTag subject={s} />
                                <span className="font-medium">{s?.name ?? 'No subject'}</span>
                                <span className="text-muted">
                                  · {sorted.length} {sorted.length === 1 ? 'question' : 'questions'}
                                  {answered ? ` · ${answered} answered` : ''}
                                </span>
                              </div>
                              <button className="btn btn-sm btn-primary" onClick={() => void practise(sorted)}>
                                <Play /> {sorted.length >= 10 ? `Take the ${y} set` : 'Practise these'} · {Math.min(240, sorted.length * settings.minutesPerProblem)} min
                              </button>
                            </div>
                            <ul className="divide-y divide-rule">
                              {sorted.map((q) => {
                                const expanded = open === q.id;
                                const last = data.last.get(q.id);
                                return (
                                  <li key={q.id}>
                                    <button
                                      className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-elevated"
                                      onClick={() => setOpen(expanded ? null : q.id)}
                                      aria-expanded={expanded}
                                    >
                                      <span className="w-8 shrink-0 pt-0.5 text-sm font-semibold text-muted tabular-nums">{q.number ? `#${q.number}` : '—'}</span>
                                      <span className={`min-w-0 flex-1 text-sm ${expanded ? '' : 'line-clamp-2'}`}>{expanded ? '' : q.text}</span>
                                      {last && (
                                        <span className={`chip shrink-0 ${last.score >= 3 ? 'text-ok' : 'text-danger'}`} title="Last score">
                                          {last.score}/5
                                        </span>
                                      )}
                                      <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
                                    </button>
                                    {expanded && (
                                      <div className="page-in px-4 pb-4 pl-15">
                                        <Markdown className="reading text-base">{q.text}</Markdown>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          <button className="btn btn-sm" onClick={() => void practise([q])}>
                                            <Play /> Answer this one · {settings.minutesPerProblem} min
                                          </button>
                                          {q.reference_answer && (
                                            <button className="btn btn-sm btn-ghost" aria-expanded={answerFor === q.id} onClick={() => setAnswerFor(answerFor === q.id ? null : q.id)}>
                                              <Lightbulb /> {answerFor === q.id ? 'Hide' : 'Show'} suggested answer
                                            </button>
                                          )}
                                        </div>
                                        {answerFor === q.id && q.reference_answer && (
                                          <div className="page-in mt-3 rounded-lg border border-rule bg-elevated p-4">
                                            <p className="t-eyebrow mb-2">Suggested answer</p>
                                            <Markdown className="reading text-base">{q.reference_answer}</Markdown>
                                            {q.notes && <p className="mt-3 text-xs text-muted">{q.notes}</p>}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        );
                      })}
                  </div>
                </section>
              ))
          )}
        </>
      )}
    </div>
  );
}
