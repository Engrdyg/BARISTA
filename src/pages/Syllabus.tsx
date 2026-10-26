import { Link } from 'react-router-dom';
import { ArrowRight, ListChecks, Upload } from 'lucide-react';
import { Bar, PageHeader, PageSkeleton, Ring, tabStyle } from '../components/ui';
import { overallCoverage, subjectCoverage } from '../lib/calc';
import { db } from '../lib/db';
import { useLive, useSettings, useSubjects } from '../lib/hooks';
import { setSubjectFilter } from '../lib/subjectFilter';

export default function Syllabus() {
  const subjects = useSubjects();
  const settings = useSettings();
  const nodes = useLive(async () => (await db.syllabus_nodes.toArray()).filter((n) => !n.deleted_at && !n.unmatched));
  if (!nodes) return <PageSkeleton />;
  const cov = new Map(subjects.map((s) => [s.id, subjectCoverage(nodes.filter((n) => n.subject_id === s.id), settings.leafScores)]));
  const overall = overallCoverage(subjects, cov);
  const parents = new Set(nodes.map((n) => n.parent_id));
  const imported = subjects.filter((s) => cov.get(s.id) !== null).length;

  return (
    <div>
      <PageHeader
        icon={ListChecks}
        title="Syllabus"
        subtitle={imported ? `${imported} of ${subjects.length} subjects imported · weighted by Bar weight` : 'Import each subject’s official 2027 syllabus to track coverage'}
      />
      <section className="panel mb-6 flex flex-wrap items-center gap-5 p-5" aria-label="Overall coverage">
        <Ring value={overall} size={64} stroke={6} label={`${Math.round(overall * 100)}% weighted coverage`} />
        <div className="min-w-0 flex-1">
          <p className="t-eyebrow">Weighted coverage</p>
          <p className="text-3xl font-semibold tracking-tight tabular-nums">{Math.round(overall * 100)}%</p>
          <div className="mt-2 max-w-xl">
            <Bar value={overall} size="sm" label="Weighted coverage" />
          </div>
        </div>
        <p className="max-w-xs text-xs text-muted">Leaf topics count by status: read once {settings.leafScores.read_once * 100}%, reviewed {settings.leafScores.reviewed * 100}%, confident 100%.</p>
      </section>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {subjects.map((s) => {
          const c = cov.get(s.id);
          const mine = nodes.filter((n) => n.subject_id === s.id);
          const leaves = mine.filter((n) => !parents.has(n.id));
          const confident = leaves.filter((n) => n.status === 'confident').length;
          const needs = mine.filter((n) => n.needs_work).length;
          return (
            <li key={s.id}>
              <Link
                to={`/syllabus/${s.code}`}
                onClick={() => setSubjectFilter(s.id)}
                className="panel card-hover relative flex h-full flex-col overflow-hidden p-5"
                style={tabStyle(s.color)}
              >
                <span className="absolute inset-x-0 top-0 h-1 bg-[var(--tab)]" aria-hidden />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <span className="subject-dot" aria-hidden />
                      {s.code}
                      <span className="chip">{s.weight}%</span>
                    </p>
                    <p className="mt-1 text-sm text-muted">{s.name}</p>
                  </div>
                  {c !== null && c !== undefined && <Ring value={c} color={s.color} label={`${Math.round(c * 100)}% covered`} />}
                </div>
                <div className="mt-auto pt-5">
                  {c === null || c === undefined ? (
                    <span className="btn btn-sm">
                      <Upload /> Import syllabus
                    </span>
                  ) : (
                    <>
                      <Bar value={c} color={s.color} size="sm" label={`${s.code} coverage`} />
                      <p className="mt-2 flex items-center justify-between text-xs text-muted">
                        <span>
                          {Math.round(c * 100)}% · {confident} of {leaves.length} topics confident{needs ? ` · ${needs} need work` : ''}
                        </span>
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      </p>
                    </>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
