import { Link } from 'react-router-dom';
import { Bar, PageHeader, tabStyle } from '../components/ui';
import { overallCoverage, subjectCoverage } from '../lib/calc';
import { db } from '../lib/db';
import { useLive, useSettings, useSubjects } from '../lib/hooks';

export default function Syllabus() {
  const subjects = useSubjects();
  const settings = useSettings();
  const nodes = useLive(async () => (await db.syllabus_nodes.toArray()).filter((n) => !n.deleted_at && !n.unmatched)) ?? [];
  const cov = new Map(subjects.map((s) => [s.id, subjectCoverage(nodes.filter((n) => n.subject_id === s.id), settings.leafScores)]));
  const overall = overallCoverage(subjects, cov);
  return (
    <div>
      <PageHeader title="Syllabus" subtitle={`Weighted coverage ${Math.round(overall * 100)}%`} />
      <div className="mb-6">
        <Bar value={overall} />
      </div>
      <ul className="space-y-2">
        {subjects.map((s) => {
          const c = cov.get(s.id);
          const count = nodes.filter((n) => n.subject_id === s.id).length;
          return (
            <li key={s.id}>
              <Link to={`/syllabus/${s.code}`} className="tab block rounded-r-xl px-4 py-3" style={tabStyle(s.color)}>
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-semibold">{s.code}</span> <span className="text-sm">{s.name}</span>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums">{c === null || c === undefined ? 'No syllabus yet' : `${Math.round(c * 100)}%`}</span>
                </div>
                <div className="mt-2">
                  <Bar value={c ?? 0} color={s.color} />
                </div>
                <div className="mt-1 text-xs text-muted">
                  Weight {s.weight}% · {count ? `${count} items` : 'Paste the official syllabus to start'}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
