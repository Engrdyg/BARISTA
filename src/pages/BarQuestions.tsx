import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Landmark, Lightbulb, Play } from 'lucide-react';
import { Empty, Markdown, PageHeader, PageSkeleton, SubjectChips, SubjectTag } from '../components/ui';
import { dedupeBank, installBank } from '../lib/bank';
import { db } from '../lib/db';
import { createAttempt } from '../lib/exam';
import { useLive, useSettings, useSubjects } from '../lib/hooks';
import { useSubjectFilter } from '../lib/subjectFilter';
import type { Question } from '../lib/types';

/** A problem counts as a past Bar question when its source names the Bar and it has a year. */
export function isBarQuestion(q: Pick<Question, 'source_label' | 'year'>): boolean {
  return !!q.year && /\bbar\b/i.test(q.source_label);
}

const num = (q: Question) => Number(q.number) || 0;

/**
 * Three steps: pick a Bar year, then a question number, then read the question.
 * The year and question live in the URL so the back button steps back out.
 */
export default function BarQuestions() {
  const subjects = useSubjects();
  const settings = useSettings();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [subject, setSubject] = useSubjectFilter();
  const [showAnswer, setShowAnswer] = useState(false);
  const year = Number(params.get('year')) || null;
  const qid = params.get('q');

  // Normally done at start-up; repeated here in case that run was cut short.
  useEffect(() => void installBank(), []);
  useEffect(() => {
    setShowAnswer(false);
    window.scrollTo(0, 0);
  }, [qid, year]);

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

  const go = (next: { year?: number | null; q?: string | null }) => {
    const p = new URLSearchParams();
    if (next.year) p.set('year', String(next.year));
    if (next.q) p.set('q', next.q);
    setParams(p);
  };
  const subjectOrder = (id: string | null) => {
    const i = subjects.findIndex((s) => s.id === id);
    return i < 0 ? 99 : i;
  };

  async function practise(qs: Question[]) {
    const sorted = [...qs].sort((a, b) => num(a) - num(b));
    const a = await createAttempt({
      mode: sorted.length >= 10 ? 'mock' : 'drill',
      subjectId: sorted[0].subject_id,
      questionIds: sorted.map((q) => q.id),
      timeLimitSec: Math.min(240, sorted.length * settings.minutesPerProblem) * 60,
    });
    nav(`/practice/attempt/${a.id}`);
  }

  if (data.qs.length === 0)
    return (
      <div className="space-y-5">
        <PageHeader icon={Landmark} title="Past Bar questions" subtitle="Actual questions from past Bar examinations" />
        <Empty icon={Landmark} title="Loading past Bar questions">
          The question bank downloads the first time the app opens with an internet connection. Keep the app open for a moment, then come back to this page.
        </Empty>
      </div>
    );

  // Step 3: one question ------------------------------------------------------
  const current = qid ? data.qs.find((q) => q.id === qid) : undefined;
  if (current) {
    const siblings = data.qs.filter((q) => q.year === current.year && q.subject_id === current.subject_id).sort((a, b) => num(a) - num(b));
    const at = siblings.findIndex((q) => q.id === current.id);
    const prev = siblings[at - 1];
    const next = siblings[at + 1];
    const s = subjects.find((x) => x.id === current.subject_id);
    const last = data.last.get(current.id);
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <button className="btn btn-ghost btn-sm -ml-2" onClick={() => go({ year: current.year })}>
          <ChevronLeft /> {current.year} Bar
        </button>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <SubjectTag subject={s} />
          <span className="font-medium">{s?.name ?? 'No subject'}</span>
          <span className="text-muted">· Question {current.number} of {siblings.length}</span>
          {last && <span className={`chip ${last.score >= 3 ? 'text-ok' : 'text-danger'}`}>Last score {last.score}/5</span>}
        </div>
        <article className="panel p-5 lg:p-7">
          <p className="t-eyebrow mb-3">
            {current.year} Bar · No. {current.number}
          </p>
          <Markdown className="reading text-base">{current.text}</Markdown>
          <div className="mt-5 flex flex-wrap gap-2">
            <button className="btn btn-primary btn-sm" onClick={() => void practise([current])}>
              <Play /> Answer this one · {settings.minutesPerProblem} min
            </button>
            {current.reference_answer && (
              <button className="btn btn-sm" aria-expanded={showAnswer} onClick={() => setShowAnswer(!showAnswer)}>
                <Lightbulb /> {showAnswer ? 'Hide' : 'Show'} suggested answer
              </button>
            )}
          </div>
          {showAnswer && current.reference_answer && (
            <div className="page-in mt-4 rounded-lg border border-rule bg-elevated p-4">
              <p className="t-eyebrow mb-2">Suggested answer</p>
              <Markdown className="reading text-base">{current.reference_answer}</Markdown>
              {current.notes && <p className="mt-3 text-xs text-muted">{current.notes}</p>}
            </div>
          )}
        </article>
        <div className="flex items-center justify-between gap-2">
          <button className="btn btn-sm" disabled={!prev} onClick={() => prev && go({ year: current.year, q: prev.id })}>
            <ChevronLeft /> {prev ? `No. ${prev.number}` : 'Previous'}
          </button>
          <button className="btn btn-sm" disabled={!next} onClick={() => next && go({ year: current.year, q: next.id })}>
            {next ? `No. ${next.number}` : 'Next'} <ChevronRight />
          </button>
        </div>
      </div>
    );
  }

  // Step 2: question numbers for one year ---------------------------------------
  if (year && years.includes(year)) {
    const inYear = data.qs.filter((q) => q.year === year && (!subject || q.subject_id === subject));
    const bySubject = new Map<string | null, Question[]>();
    for (const q of inYear) bySubject.set(q.subject_id, [...(bySubject.get(q.subject_id) ?? []), q]);
    return (
      <div className="space-y-5">
        <button className="btn btn-ghost btn-sm -ml-2" onClick={() => go({})}>
          <ChevronLeft /> All years
        </button>
        <PageHeader icon={Landmark} title={`${year} Bar`} subtitle="Tap a number to read the question" />
        <SubjectChips subjects={subjects} value={subject} onChange={setSubject} />
        {bySubject.size === 0 ? (
          <Empty icon={Landmark} title="No questions for this subject" compact>
            Try another subject.
          </Empty>
        ) : (
          [...bySubject.entries()]
            .sort((a, b) => subjectOrder(a[0]) - subjectOrder(b[0]))
            .map(([sid, qs]) => {
              const s = subjects.find((x) => x.id === sid);
              const sorted = [...qs].sort((a, b) => num(a) - num(b));
              const answered = sorted.filter((q) => data.last.has(q.id)).length;
              return (
                <section key={sid ?? 'none'} className="panel p-4" aria-label={s?.name ?? 'No subject'}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm">
                      <SubjectTag subject={s} />
                      <span className="font-medium">{s?.name ?? 'No subject'}</span>
                      <span className="text-muted whitespace-nowrap">
                        {answered ? `${answered}/${sorted.length} answered` : `${sorted.length} questions`}
                      </span>
                    </div>
                    <button className="btn btn-sm" onClick={() => void practise(sorted)}>
                      <Play /> {sorted.length >= 10 ? `Take the ${year} set` : 'Practise these'} · {Math.min(240, sorted.length * settings.minutesPerProblem)} min
                    </button>
                  </div>
                  <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 lg:grid-cols-10">
                    {sorted.map((q) => {
                      const last = data.last.get(q.id);
                      return (
                        <button
                          key={q.id}
                          className="relative flex aspect-square items-center justify-center rounded-lg border border-rule bg-surface text-base font-semibold tabular-nums hover:border-accent hover:bg-elevated"
                          style={last ? { borderColor: last.score >= 3 ? 'var(--ok)' : 'var(--danger)' } : undefined}
                          onClick={() => go({ year, q: q.id })}
                          aria-label={`Question ${q.number}${last ? `, last score ${last.score} of 5` : ''}${q.reference_answer ? ', has suggested answer' : ''}`}
                        >
                          {q.number || '•'}
                          {q.reference_answer && <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })
        )}
        <p className="text-xs text-muted">
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" aria-hidden /> has a suggested answer · green or red border shows your last score
        </p>
      </div>
    );
  }

  // Step 1: years ------------------------------------------------------------------
  return (
    <div className="space-y-5">
      <PageHeader icon={Landmark} title="Past Bar questions" subtitle={`${data.qs.length} questions from ${years.length} Bars · pick a year`} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {years.map((y) => {
          const qs = data.qs.filter((q) => q.year === y);
          const answered = qs.filter((q) => data.last.has(q.id)).length;
          const withAnswers = qs.some((q) => q.reference_answer);
          return (
            <button key={y} className="panel card-hover p-4 text-left" onClick={() => go({ year: y })}>
              <p className="t-title text-2xl">{y}</p>
              <p className="mt-1 text-sm text-muted">
                {qs.length} questions{answered ? ` · ${answered} answered` : ''}
              </p>
              {withAnswers && (
                <p className="mt-2 flex items-center gap-1 text-xs text-accent">
                  <Lightbulb className="h-3.5 w-3.5" aria-hidden /> Suggested answers
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
