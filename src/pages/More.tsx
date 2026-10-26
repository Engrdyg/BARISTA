import { Link } from 'react-router-dom';
import { MORE } from '../components/Layout';
import { PageHeader } from '../components/ui';

export default function More() {
  return (
    <div>
      <PageHeader title="More" />
      <ul className="panel divide-y divide-rule">
        {MORE.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="flex items-center justify-between px-4 py-3.5">
              {l.label} <span className="text-muted">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
