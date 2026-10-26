import { useEffect, useState } from 'react';
import { search, type DocType, type Hit } from '../lib/search';

/** Search box that picks one provision, digest, card or problem. */
export default function LinkPicker({
  types,
  onPick,
  placeholder = 'Search provisions, digests, problems…',
}: {
  types: DocType[];
  onPick: (hit: Hit) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const r = await search(q);
      if (live) setHits(r.hits.filter((h) => types.includes(h.type)).slice(0, 12));
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, types]);
  return (
    <div>
      <input className="input" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search to link" />
      {q && (
        <ul className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-rule">
          {hits.length === 0 && <li className="p-2 text-sm text-muted">No matches.</li>}
          {hits.map((h) => (
            <li key={h.id}>
              <button
                className="block w-full px-3 py-2 text-left text-sm hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]"
                onClick={() => {
                  onPick(h);
                  setQ('');
                }}
              >
                <span className="text-xs font-semibold text-muted">{h.type}</span> {h.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
