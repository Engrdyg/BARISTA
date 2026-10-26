import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Bar, Empty, Field, Modal, PageHeader, SubjectChips, SubjectSelect, SubjectTag } from '../components/ui';
import { db } from '../lib/db';
import { useLive, useSubjects } from '../lib/hooks';
import { DEFAULT_PATTERNS, joinProvisions, splitLaw, stripWhitespace, type SplitProvision } from '../lib/parsers/law';
import { makeRow, putRows } from '../lib/repo';
import type { Law, SplitPattern } from '../lib/types';

/** Paste a law's text, split into provisions, preview, save (new law or appended to one). */
export function LawImport({ open, onClose, law }: { open: boolean; onClose: () => void; law?: Law }) {
  const subjects = useSubjects();
  const nav = useNavigate();
  const [meta, setMeta] = useState({ title: '', short_name: '', citation: '', primary_subject_id: null as string | null, source_url: '' });
  const [patterns, setPatterns] = useState<SplitPattern[]>(law?.split_patterns ?? DEFAULT_PATTERNS);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<SplitProvision[] | null>(null);
  const [showPatterns, setShowPatterns] = useState(false);

  const lossless = useMemo(() => (rows ? stripWhitespace(joinProvisions(rows)) === stripWhitespace(text) : true), [rows, text]);

  const close = () => {
    setRows(null);
    setText('');
    onClose();
  };

  async function save() {
    if (!rows) return;
    let target = law;
    if (!target) {
      target = makeRow('laws', { ...meta, title: meta.title.trim(), short_name: meta.short_name.trim().toUpperCase(), split_patterns: patterns });
      await putRows('laws', [target]);
    } else if (JSON.stringify(patterns) !== JSON.stringify(law?.split_patterns)) {
      await putRows('laws', [{ ...target, split_patterns: patterns }]);
    }
    const existing = (await db.provisions.where('law_id').equals(target.id).toArray()).filter((p) => !p.deleted_at);
    const start = existing.reduce((m, p) => Math.max(m, p.sort + 1), 0);
    await putRows(
      'provisions',
      rows.map((r, i) =>
        makeRow('provisions', {
          law_id: target!.id,
          label: r.label,
          heading: r.heading,
          text: r.text,
          sort: start + i,
          read_count: 0,
          last_read_at: null,
          notes: '',
          starred: false,
        }),
      ),
    );
    close();
    nav(`/codals/${target.id}`);
  }

  return (
    <Modal open={open} onClose={close} title={law ? `Add text to ${law.short_name || law.title}` : 'Add a law'} wide>
      {!rows ? (
        <div className="space-y-3">
          {!law && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Title" htmlFor="law-title">
                  <input id="law-title" className="input" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} placeholder="Civil Code of the Philippines" />
                </Field>
                <Field label="Short name" htmlFor="law-short">
                  <input id="law-short" className="input" value={meta.short_name} onChange={(e) => setMeta({ ...meta, short_name: e.target.value })} placeholder="NCC" />
                </Field>
                <Field label="Citation" htmlFor="law-cite">
                  <input id="law-cite" className="input" value={meta.citation} onChange={(e) => setMeta({ ...meta, citation: e.target.value })} placeholder="R.A. No. 386" />
                </Field>
                <Field label="Primary subject" htmlFor="law-subject">
                  <SubjectSelect id="law-subject" subjects={subjects} value={meta.primary_subject_id} onChange={(v) => setMeta({ ...meta, primary_subject_id: v })} />
                </Field>
              </div>
              <Field label="Source URL" htmlFor="law-url">
                <input id="law-url" className="input" type="url" value={meta.source_url} onChange={(e) => setMeta({ ...meta, source_url: e.target.value })} />
              </Field>
            </>
          )}
          <Field label="Full text" htmlFor="law-text">
            <textarea id="law-text" className="textarea min-h-[14rem] font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowPatterns(!showPatterns)}>
            {showPatterns ? 'Hide split patterns' : 'Edit split patterns'}
          </button>
          {showPatterns && (
            <div className="space-y-2 rounded-lg border border-rule p-3">
              <p className="text-xs text-muted">
                Each line that matches a pattern starts a provision or a heading. Labels use $1 for the number. A heading with "prefix" adds its label in front (Rule 70, Sec. 1).
              </p>
              {patterns.map((p, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select className="select w-28" value={p.kind} onChange={(e) => setPatterns(patterns.map((x, j) => (j === i ? { ...x, kind: e.target.value as SplitPattern['kind'] } : x)))} aria-label="Kind">
                    <option value="provision">Provision</option>
                    <option value="heading">Heading</option>
                  </select>
                  <input className="input min-w-0 flex-1 font-mono text-xs" value={p.regex} onChange={(e) => setPatterns(patterns.map((x, j) => (j === i ? { ...x, regex: e.target.value } : x)))} aria-label="Pattern" />
                  <input className="input w-28" value={p.label} onChange={(e) => setPatterns(patterns.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Label" />
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={!!p.prefix} onChange={(e) => setPatterns(patterns.map((x, j) => (j === i ? { ...x, prefix: e.target.checked } : x)))} />
                    prefix
                  </label>
                  <button className="btn btn-ghost btn-sm" onClick={() => setPatterns(patterns.filter((_, j) => j !== i))} aria-label="Remove pattern">
                    ✕
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <button className="btn btn-sm" onClick={() => setPatterns([...patterns, { kind: 'provision', regex: '^', label: '$1' }])}>
                  Add pattern
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setPatterns(DEFAULT_PATTERNS)}>
                  Reset
                </button>
              </div>
            </div>
          )}
          <button className="btn btn-primary" disabled={!text.trim() || (!law && !meta.title.trim())} onClick={() => setRows(splitLaw(text, patterns))}>
            Split and preview
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            {rows.length} provisions.{' '}
            {lossless ? <span className="text-ok">All text accounted for.</span> : <span className="text-danger">Some text changed while editing the preview.</span>}
          </p>
          <ol className="max-h-[55vh] space-y-2 overflow-y-auto">
            {rows.map((r, i) => (
              <li key={i} className="rounded-lg border border-rule p-2">
                <div className="flex items-center gap-2">
                  <input className="input w-40 py-1 text-sm font-semibold" value={r.label} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Label" />
                  <span className="flex-1" />
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={i === 0}
                    title="Merge into the provision above"
                    onClick={() =>
                      setRows(rows.flatMap((x, j) => (j === i ? [] : j === i - 1 ? [{ ...x, text: [x.text, r.heading, r.text].filter(Boolean).join('\n') }] : [x])))
                    }
                  >
                    Merge up
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Split at a line"
                    onClick={() => {
                      const lines = r.text.split('\n');
                      const at = Number(prompt(`Split before which line? (2–${lines.length})`, '2'));
                      if (!at || at < 2 || at > lines.length) return;
                      const a = { ...r, text: lines.slice(0, at - 1).join('\n') };
                      const b = { label: `${r.label} (cont.)`, heading: '', text: lines.slice(at - 1).join('\n') };
                      setRows([...rows.slice(0, i), a, b, ...rows.slice(i + 1)]);
                    }}
                  >
                    Split
                  </button>
                </div>
                {r.heading && <p className="mt-1 text-xs whitespace-pre-wrap text-muted">{r.heading}</p>}
                <p className="reading mt-1 line-clamp-3 text-sm whitespace-pre-wrap">{r.text}</p>
              </li>
            ))}
          </ol>
          <div className="flex gap-2">
            <button className="btn" onClick={() => setRows(null)}>
              Back
            </button>
            <button className="btn btn-primary" disabled={!rows.length} onClick={() => void save()}>
              Save {rows.length} provisions
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Codals() {
  const subjects = useSubjects();
  const [params, setParams] = useSearchParams();
  const nodeFilter = params.get('node');
  const [subject, setSubject] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const data = useLive(async () => {
    const laws = (await db.laws.toArray()).filter((l) => !l.deleted_at);
    const provisions = (await db.provisions.toArray()).filter((p) => !p.deleted_at);
    let linked: { id: string; label: string; law: Law | undefined; text: string }[] = [];
    const node = nodeFilter ? await db.syllabus_nodes.get(nodeFilter) : undefined;
    if (nodeFilter) {
      const ids = new Set((await db.node_links.where('node_id').equals(nodeFilter).toArray()).filter((l) => !l.deleted_at && l.target_type === 'provision').map((l) => l.target_id));
      linked = provisions.filter((p) => ids.has(p.id)).map((p) => ({ id: p.id, label: p.label, law: laws.find((l) => l.id === p.law_id), text: p.text }));
    }
    const stats = new Map<string, { total: number; r1: number; r2: number; r3: number; starred: number }>();
    for (const p of provisions) {
      const s = stats.get(p.law_id) ?? { total: 0, r1: 0, r2: 0, r3: 0, starred: 0 };
      s.total++;
      if (p.read_count >= 1) s.r1++;
      if (p.read_count >= 2) s.r2++;
      if (p.read_count >= 3) s.r3++;
      if (p.starred) s.starred++;
      stats.set(p.law_id, s);
    }
    return { laws, stats, linked, node };
  }, [nodeFilter]);
  if (!data) return <p className="text-muted">Loading…</p>;
  const laws = data.laws.filter((l) => !subject || l.primary_subject_id === subject).sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Codals"
        subtitle="Laws and provisions"
        actions={
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            Add a law
          </button>
        }
      />
      {data.node && (
        <section className="panel p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Linked to {data.node.title}</h2>
            <button className="text-sm underline" onClick={() => setParams({})}>
              Clear
            </button>
          </div>
          {data.linked.length === 0 ? (
            <p className="text-sm text-muted">No provisions linked yet. Link them from a provision's menu or the syllabus item.</p>
          ) : (
            <ul className="space-y-2">
              {data.linked.map((p) => (
                <li key={p.id}>
                  <Link to={`/codals/${p.law?.id}#p-${p.id}`} className="block">
                    <span className="font-semibold">
                      {p.label} {p.law?.short_name}
                    </span>
                    <span className="reading line-clamp-2 block text-base">{p.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <SubjectChips subjects={subjects} value={subject} onChange={setSubject} />
      {laws.length === 0 ? (
        <Empty>
          <p>No laws yet.</p>
          <p className="mt-1 text-sm">Paste a law's full text (from the Official Gazette or a codal you own) and the app splits it into provisions.</p>
        </Empty>
      ) : (
        <ul className="space-y-2">
          {laws.map((l) => {
            const s = data.stats.get(l.id) ?? { total: 0, r1: 0, r2: 0, r3: 0, starred: 0 };
            const subj = subjects.find((x) => x.id === l.primary_subject_id);
            return (
              <li key={l.id}>
                <Link to={`/codals/${l.id}`} className="panel block p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold">
                        {l.short_name && <span className="mr-2">{l.short_name}</span>}
                        <span className="font-normal">{l.title}</span>
                      </div>
                      <div className="text-xs text-muted">
                        {l.citation} · {s.total} provisions{s.starred ? ` · ${s.starred} starred` : ''}
                      </div>
                    </div>
                    <SubjectTag subject={subj} />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-xs text-muted">
                    {(['r1', 'r2', 'r3'] as const).map((k, i) => (
                      <div key={k}>
                        <div className="mb-1">
                          {['1st', '2nd', '3rd'][i]} read {s.total ? Math.round((s[k] / s.total) * 100) : 0}%
                        </div>
                        <Bar value={s.total ? s[k] / s.total : 0} color={subj?.color} />
                      </div>
                    ))}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <LawImport open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
