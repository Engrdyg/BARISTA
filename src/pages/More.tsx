import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { NAV } from '../components/Layout';
import { PageHeader } from '../components/ui';

export default function More() {
  return (
    <div>
      <PageHeader title="All sections" />
      <div className="space-y-6">
        {NAV.map((g) => (
          <section key={g.group} aria-label={g.group}>
            <h2 className="t-eyebrow mb-2 px-1">{g.group}</h2>
            <ul className="panel divide-y divide-rule overflow-hidden">
              {g.items.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="flex items-center gap-3 px-4 py-3.5 hover:bg-elevated">
                    <l.icon className="h-4 w-4 text-muted" aria-hidden />
                    <span className="flex-1">{l.label}</span>
                    <ChevronRight className="h-4 w-4 text-faint" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
