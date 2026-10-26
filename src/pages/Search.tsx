import { useEffect, useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Empty, PageHeader, SubjectChips, SubjectTag } from '../components/ui';
import { db } from '../lib/db';
import { useSubjects } from '../lib/hooks';
import { search, type DocType, type Hit } from '../lib/search';

const TYPES: { value: DocType | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'provision', label: 'Provisions' },
  { value: 'digest', label: 'Digests' },
  { value: 'card', label: 'Cards' },
  { value: 'question', label: 'Problems' },
  { value: 'node', label: 'Syllabus' },
  { value: 'note', label: 'Notes' },
];

const TYPE_LABEL: Record<DocType, string> = { provision: 'Provision', digest: 'Digest', card: 'Card', question: 'Problem', node: 'Syllabus', note: 'Note' };

export default function Search() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const subjects = useSubjects();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [type, setType] = useState<DocType | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [res, setRes] = useState<{ hits: Hit[]; exact: Hit | null; ms: number }>({ hits: [], exact: null, ms: 0 });

  useEffect(() => {
    let live = true;
    const t0 = performance.now();
    void search(q, { type, subjectId: subject }).then((r) => {
      if (live) setRes({ ...r, ms: performance.now() - t0 });
    });
    return () => {
      live = false;
    };
  }, [q, type, subject]);

  async function open(h: Hit) {
    if (h.type === 'provision') {
      const p = await db.provisions.get(h.rowId);
      if (p) nav(`/codals/${p.law_id}#p-${p.id}`);
    } else if (h.type === 'digest') nav(`/digests?open=${h.rowId}`);
    else if (h.type === 'card') nav(`/cards`);
    else if (h.type === 'question') nav(`/practice`);
    else if (h.type === 'node' || h.type === 'note') {
      const n = await db.syllabus_nodes.get(h.rowId);
      if (n) {
        const s = subjects.find((x) => x.id === n.subject_id);
        nav(`/syllabus/${s?.code}`);
        return;
      }
      const p = await db.provisions.get(h.rowId);
      if (p) nav(`/codals/${p.law_id}#p-${p.id}`);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader icon={SearchIcon} title="Search" subtitle="Everything you've added, offline. Try Art. 1156, 1156 NCC, or a G.R. No." />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setParams(q ? { q } : {});
          if (res.exact) void open(res.exact);
        }}
      >
        <input
          className="input text-lg"
          type="search"
          autoFocus
          placeholder="Art. 1156, 1156 NCC, a G.R. No., or any words"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search"
        />
      </form>
      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
        {TYPES.map((t) => (
          <button key={t.label} className={`btn btn-sm shrink-0 ${type === t.value ? 'btn-primary' : ''}`} onClick={() => setType(t.value)}>
            {t.label}
          </button>
        ))}
      </div>
      <SubjectChips subjects={subjects} value={subject} onChange={setSubject} />
      {q.trim() &&
        (res.hits.length === 0 ? (
          <Empty icon={SearchIcon} title="No results" compact>Check the spelling, or search a provision number like Art. 1156.</Empty>
        ) : (
          <>
            <p className="text-xs text-muted">
              {res.hits.length} results{res.exact ? ' · press Enter to open the exact match' : ''}
            </p>
            <ul className="panel divide-y divide-rule">
              {res.hits.map((h) => (
                <li key={h.id}>
                  <button className="block w-full px-3 py-2 text-left" onClick={() => void open(h)}>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted">{TYPE_LABEL[h.type]}</span>
                      <SubjectTag subject={subjects.find((s) => s.id === h.subject_id)} />
                      <span className="font-semibold">{h.title}</span>
                    </div>
                    {h.snippet && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{h.snippet}</p>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ))}
    </div>
  );
}
