import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import LinkPicker from '../components/LinkPicker';
import TimerDialog from '../components/TimerDialog';
import { Bar, Empty, Markdown, Modal, PageHeader, Star, tabStyle } from '../components/ui';
import { rollup, subjectCoverage } from '../lib/calc';
import { db } from '../lib/db';
import { useLive, useSettings, useSubjects } from '../lib/hooks';
import { normalizeDepths, parseSyllabus, type FlatNode } from '../lib/parsers/syllabus';
import { outlineOrder } from '../lib/planner';
import { create, patch, softDelete } from '../lib/repo';
import { nextStatus, saveImport, STATUSES } from '../lib/syllabusStore';
import { nowIso, shortDate, manilaDate } from '../lib/time';
import type { LinkTarget, NodeStatus, Subject, SyllabusNode } from '../lib/types';
import { nodeIdsFromTags } from '../lib/weak';

const STATUS_STYLE: Record<NodeStatus, string> = {
  not_started: 'border-rule text-muted',
  read_once: 'border-[var(--tab)] text-ink',
  reviewed: 'border-[var(--tab)] bg-[color-mix(in_srgb,var(--tab)_25%,transparent)] text-ink',
  confident: 'border-[var(--tab)] bg-[var(--tab)] text-ink font-semibold',
};

function StatusButton({ node }: { node: SyllabusNode }) {
  const label = STATUSES.find((s) => s.value === node.status)!.label;
  return (
    <button
      className={`shrink-0 rounded-full border-2 px-2 py-0.5 text-xs whitespace-nowrap ${STATUS_STYLE[node.status]}`}
      style={node.status === 'confident' ? { background: 'color-mix(in srgb, var(--tab) 45%, transparent)' } : undefined}
      onClick={(e) => {
        e.stopPropagation();
        void patch('syllabus_nodes', node.id, { status: nextStatus(node.status), last_studied_at: nowIso() });
      }}
      title="Tap to change status"
    >
      {label}
    </button>
  );
}

// Importer ----------------------------------------------------------------------

function ImportModal({ subject, open, onClose, hasExisting }: { subject: Subject; open: boolean; onClose: () => void; hasExisting: boolean }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<FlatNode[] | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setRows(null);
    setText('');
    setResult(null);
    onClose();
  };
  const set = (i: number, change: Partial<FlatNode>) => setRows((r) => normalizeDepths(r!.map((x, j) => (j === i ? { ...x, ...change } : x))));

  return (
    <Modal open={open} onClose={close} title={hasExisting ? 'Re-import syllabus' : 'Import syllabus'} wide>
      {result ? (
        <div>
          <p>{result}</p>
          <button className="btn btn-primary mt-4" onClick={close}>
            Done
          </button>
        </div>
      ) : !rows ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Copy the {subject.code} syllabus text from the official 2027 PDF and paste it here. You'll see a preview before anything is saved.
            {hasExisting && ' Re-importing keeps the status, notes and links of every item that still matches.'}
          </p>
          <textarea className="textarea min-h-[16rem] font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} aria-label="Syllabus text" />
          <button
            className="btn btn-primary"
            disabled={!text.trim()}
            onClick={() => {
              const r = parseSyllabus(text);
              setRows(r.nodes);
              setIgnored(r.ignored);
            }}
          >
            Preview
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {rows.length} items. Fix nesting with the arrows, merge a line into the one above, or delete it.
          </p>
          {ignored.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">{ignored.length} lines left out (headers, footers, text before the first item)</summary>
              <ul className="mt-1 list-disc pl-5 text-muted">
                {ignored.slice(0, 50).map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </details>
          )}
          <ol className="max-h-[50vh] overflow-y-auto rounded-lg border border-rule">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center gap-1 border-b border-rule px-2 py-1 last:border-b-0" style={{ paddingLeft: `${0.5 + r.depth * 1.25}rem` }}>
                <span className="w-10 shrink-0 text-right text-sm text-muted">{r.marker}</span>
                <input
                  className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm"
                  value={r.title}
                  onChange={(e) => set(i, { title: e.target.value })}
                  aria-label={`Title of item ${i + 1}`}
                />
                <button className="btn btn-ghost btn-sm" aria-label="Outdent" onClick={() => set(i, { depth: Math.max(0, r.depth - 1) })}>
                  ←
                </button>
                <button className="btn btn-ghost btn-sm" aria-label="Indent" onClick={() => set(i, { depth: r.depth + 1 })}>
                  →
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  aria-label="Merge into previous"
                  title="Merge into the item above"
                  disabled={i === 0}
                  onClick={() =>
                    setRows((rs) =>
                      normalizeDepths(
                        rs!.flatMap((x, j) => (j === i ? [] : j === i - 1 ? [{ ...x, title: `${x.title} ${r.marker} ${r.title}`.trim() }] : [x])),
                      ),
                    )
                  }
                >
                  ⤒
                </button>
                <button className="btn btn-ghost btn-sm btn-danger" aria-label="Delete" onClick={() => setRows((rs) => normalizeDepths(rs!.filter((_, j) => j !== i)))}>
                  ✕
                </button>
              </li>
            ))}
          </ol>
          <div className="flex gap-2">
            <button className="btn" onClick={() => setRows(null)}>
              Back to text
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !rows.length}
              onClick={async () => {
                setBusy(true);
                const r = await saveImport(subject.id, rows);
                setBusy(false);
                setResult(
                  r.created + r.updated + r.unmatched === 0
                    ? 'Nothing changed: the syllabus already matches this text.'
                    : `Saved. ${r.created} new, ${r.updated} updated${r.unmatched ? `, ${r.unmatched} moved to Unmatched for you to reassign or delete` : ''}.`,
                );
              }}
            >
              Save {rows.length} items
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Node detail -------------------------------------------------------------------

interface Counts {
  provision: number;
  digest: number;
  card: number;
  question: number;
  mistake: number;
}

function NodeDetail({ node, onClose, counts, subject }: { node: SyllabusNode; onClose: () => void; counts: Counts; subject: Subject }) {
  const [notes, setNotes] = useState(node.notes);
  const [editing, setEditing] = useState(false);
  const [timer, setTimer] = useState(false);
  const links = useLive(() => db.node_links.where('node_id').equals(node.id).filter((l) => !l.deleted_at).toArray(), [node.id]) ?? [];

  const linkTo = async (type: LinkTarget, id: string) => {
    if (links.some((l) => l.target_id === id)) return;
    await create('node_links', { node_id: node.id, target_type: type, target_id: id });
  };

  const list: [keyof Counts, string, string][] = [
    ['provision', 'provisions', `/codals?node=${node.id}`],
    ['digest', 'digests', `/digests?node=${node.id}`],
    ['card', 'cards', `/cards?node=${node.id}`],
    ['question', 'problems', `/practice?node=${node.id}`],
    ['mistake', 'mistakes', `/mistakes?node=${node.id}`],
  ];
  return (
    <Modal open onClose={onClose} title={`${node.marker} ${node.title}`} wide>
      <div className="space-y-4" style={tabStyle(subject.color)}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="select w-auto"
            value={node.status}
            onChange={(e) => void patch('syllabus_nodes', node.id, { status: e.target.value as NodeStatus, last_studied_at: nowIso() })}
            aria-label="Status"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={node.needs_work} onChange={(e) => void patch('syllabus_nodes', node.id, { needs_work: e.target.checked })} />
            Needs work
          </label>
          <Star on={node.starred} onClick={() => void patch('syllabus_nodes', node.id, { starred: !node.starred })} />
          <button className="btn btn-sm" onClick={() => setTimer(true)}>
            Start timer
          </button>
        </div>
        <p className="text-sm text-muted">
          {node.last_studied_at ? `Last studied ${shortDate(manilaDate(node.last_studied_at))}` : 'Not studied yet'} · studied {node.times_studied} times
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          {list.map(([k, label, to]) => (
            <Link key={k} to={to} className="btn btn-sm" onClick={onClose}>
              {counts[k]} {label}
            </Link>
          ))}
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="font-semibold">Notes</h3>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                if (editing) void patch('syllabus_nodes', node.id, { notes });
                setEditing(!editing);
              }}
            >
              {editing ? 'Save' : 'Edit'}
            </button>
          </div>
          {editing ? (
            <textarea className="textarea reading min-h-[10rem]" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
          ) : node.notes ? (
            <Markdown className="reading">{node.notes}</Markdown>
          ) : (
            <p className="text-sm text-muted">No notes yet.</p>
          )}
        </div>
        <div>
          <h3 className="mb-1 font-semibold">Link an item</h3>
          <LinkPicker types={['provision', 'digest', 'question']} onPick={(h) => void linkTo(h.type as LinkTarget, h.rowId)} />
          {links.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {links.map((l) => (
                <LinkRow key={l.id} type={l.target_type} targetId={l.target_id} onRemove={() => void softDelete('node_links', l.id)} />
              ))}
            </ul>
          )}
        </div>
        <TimerDialog open={timer} onClose={() => setTimer(false)} initial={{ subjectId: node.subject_id, nodeId: node.id, kind: 'reading' }} />
      </div>
    </Modal>
  );
}

function LinkRow({ type, targetId, onRemove }: { type: LinkTarget; targetId: string; onRemove: () => void }) {
  const title = useLive(async () => {
    if (type === 'provision') {
      const p = await db.provisions.get(targetId);
      const law = p ? await db.laws.get(p.law_id) : undefined;
      return p ? `${p.label} ${law?.short_name ?? ''}` : 'Deleted provision';
    }
    if (type === 'digest') return (await db.digests.get(targetId))?.title ?? 'Deleted digest';
    if (type === 'question') {
      const q = await db.questions.get(targetId);
      return q ? `${q.source_label} ${q.number ? `#${q.number}` : ''}` : 'Deleted problem';
    }
    return type;
  }, [type, targetId]);
  return (
    <li className="flex items-center justify-between gap-2">
      <span>
        <span className="text-muted">{type}</span> {title}
      </span>
      <button className="btn btn-ghost btn-sm" onClick={onRemove} aria-label="Remove link">
        ✕
      </button>
    </li>
  );
}

// Page --------------------------------------------------------------------------

type Filter = 'all' | 'needs_work' | 'not_started' | 'stale' | 'starred';

export default function SyllabusSubject() {
  const { subject: code } = useParams();
  const subjects = useSubjects();
  const subject = subjects.find((s) => s.code === code);
  const settings = useSettings();
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string> | null>(null);

  const data = useLive(async () => {
    if (!subject) return null;
    const all = (await db.syllabus_nodes.where('subject_id').equals(subject.id).toArray()).filter((n) => !n.deleted_at);
    const nodeIds = new Set(all.map((n) => n.id));
    const links = (await db.node_links.toArray()).filter((l) => !l.deleted_at && nodeIds.has(l.node_id));
    const cards = (await db.cards.toArray()).filter((c) => !c.deleted_at && c.tags.some((t) => t.startsWith('node:')));
    const mistakes = (await db.mistakes.toArray()).filter((m) => !m.deleted_at && m.node_id && nodeIds.has(m.node_id));
    return { all, links, cards, mistakes };
  }, [subject?.id]);

  const counts = useMemo(() => {
    const m = new Map<string, Counts>();
    if (!data) return m;
    const get = (id: string) => {
      if (!m.has(id)) m.set(id, { provision: 0, digest: 0, card: 0, question: 0, mistake: 0 });
      return m.get(id)!;
    };
    for (const l of data.links) if (l.target_type in get(l.node_id)) get(l.node_id)[l.target_type as keyof Counts]++;
    const ids = new Set(data.all.map((n) => n.id));
    for (const c of data.cards) for (const id of nodeIdsFromTags(c.tags)) if (ids.has(id)) get(id).card++;
    for (const mi of data.mistakes) get(mi.node_id!).mistake++;
    return m;
  }, [data]);

  if (!subject || !data) return <p className="text-muted">Loading…</p>;
  const nodes = data.all.filter((n) => !n.unmatched);
  const unmatched = data.all.filter((n) => n.unmatched);
  const ordered = outlineOrder(nodes);
  const progress = rollup(nodes, settings.leafScores);
  const cov = subjectCoverage(nodes, settings.leafScores);
  const parents = new Set(nodes.map((n) => n.parent_id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depthOf = (n: SyllabusNode) => {
    let d = 0;
    let p = n.parent_id;
    while (p && byId.has(p) && d < 20) {
      d++;
      p = byId.get(p)!.parent_id;
    }
    return d;
  };
  const collapsedSet = collapsed ?? new Set(nodes.filter((n) => parents.has(n.id) && depthOf(n) >= 1).map((n) => n.id));

  const cutoff = Date.now() - 30 * 86_400_000;
  const matches = (n: SyllabusNode) =>
    filter === 'all' ||
    (filter === 'needs_work' && n.needs_work) ||
    (filter === 'starred' && n.starred) ||
    (filter === 'not_started' && !parents.has(n.id) && n.status === 'not_started') ||
    (filter === 'stale' && !parents.has(n.id) && (!n.last_studied_at || Date.parse(n.last_studied_at) < cutoff));

  // Filtered view: matching nodes plus their ancestors; otherwise honor collapse.
  let visible: SyllabusNode[];
  if (filter !== 'all') {
    const keep = new Set<string>();
    for (const n of nodes)
      if (matches(n)) {
        keep.add(n.id);
        let p = n.parent_id;
        while (p && byId.has(p)) {
          keep.add(p);
          p = byId.get(p)!.parent_id;
        }
      }
    visible = ordered.filter((n) => keep.has(n.id));
  } else {
    visible = [];
    const hiddenUnder = new Set<string>();
    for (const n of ordered) {
      if (n.parent_id && (hiddenUnder.has(n.parent_id) || collapsedSet.has(n.parent_id))) {
        hiddenUnder.add(n.id);
        continue;
      }
      visible.push(n);
    }
  }

  const toggle = (id: string) => {
    const next = new Set(collapsedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };
  const openNode = openId ? byId.get(openId) ?? data.all.find((n) => n.id === openId) : undefined;
  const filters: [Filter, string][] = [
    ['all', 'All'],
    ['needs_work', 'Needs work'],
    ['not_started', 'Not started'],
    ['stale', 'Not touched in 30 days'],
    ['starred', 'Starred'],
  ];

  return (
    <div style={tabStyle(subject.color)}>
      <PageHeader
        color={subject.color}
        title={
          <>
            <span className="mr-2">{subject.code}</span>
            <span className="text-base font-normal">{subject.name}</span>
          </>
        }
        subtitle={cov === null ? 'No syllabus yet' : `${Math.round(cov * 100)}% covered · weight ${subject.weight}%`}
        actions={
          <button className="btn" onClick={() => setImporting(true)}>
            {nodes.length ? 'Re-import' : 'Import syllabus'}
          </button>
        }
      />
      {cov !== null && (
        <div className="mb-4">
          <Bar value={cov} color={subject.color} />
        </div>
      )}

      {nodes.length === 0 ? (
        <Empty>
          <p>No syllabus for {subject.code} yet.</p>
          <p className="mt-1 text-sm">Paste the text of the official 2027 syllabus and the app turns it into a checklist.</p>
          <button className="btn btn-primary mt-3" onClick={() => setImporting(true)}>
            Import syllabus
          </button>
        </Empty>
      ) : (
        <>
          <div className="scrollbar-none -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
            {filters.map(([f, label]) => (
              <button key={f} className={`btn btn-sm shrink-0 ${filter === f ? 'btn-primary' : ''}`} onClick={() => setFilter(f)}>
                {label}
              </button>
            ))}
            {filter === 'all' && (
              <button className="btn btn-sm btn-ghost shrink-0" onClick={() => setCollapsed(collapsedSet.size ? new Set() : null)}>
                {collapsedSet.size ? 'Expand all' : 'Collapse'}
              </button>
            )}
          </div>
          <ul className="panel divide-y divide-rule overflow-hidden">
            {visible.map((n) => {
              const isParent = parents.has(n.id);
              const p = progress.get(n.id);
              const c = counts.get(n.id);
              const total = c ? c.provision + c.digest + c.card + c.question + c.mistake : 0;
              return (
                <li key={n.id} className="flex items-center gap-2 py-2 pr-3" style={{ paddingLeft: `${0.5 + depthOf(n) * 1.1}rem` }}>
                  {isParent ? (
                    <button className="w-6 shrink-0 text-muted" onClick={() => toggle(n.id)} aria-label={collapsedSet.has(n.id) ? 'Expand' : 'Collapse'} aria-expanded={!collapsedSet.has(n.id)}>
                      {filter === 'all' && collapsedSet.has(n.id) ? '▸' : '▾'}
                    </button>
                  ) : (
                    <span className="w-6 shrink-0" />
                  )}
                  <button className="min-w-0 flex-1 text-left" onClick={() => setOpenId(n.id)}>
                    <span className={`${isParent ? 'font-semibold' : ''}`}>
                      <span className="text-muted">{n.marker}</span> {n.title}
                    </span>
                    <span className="ml-2 inline-flex flex-wrap gap-1.5 align-middle text-xs text-muted">
                      {n.needs_work && <span className="font-semibold text-danger">Needs work</span>}
                      {n.starred && <span aria-label="Starred">★</span>}
                      {total > 0 && <span>{[c!.provision && `${c!.provision} prov`, c!.digest && `${c!.digest} dig`, c!.card && `${c!.card} cards`, c!.question && `${c!.question} prob`, c!.mistake && `${c!.mistake} mist`].filter(Boolean).join(' · ')}</span>}
                    </span>
                  </button>
                  {isParent ? (
                    <span className="flex w-24 shrink-0 items-center gap-2 text-xs tabular-nums text-muted">
                      <Bar value={p?.score ?? 0} color={subject.color} />
                      {Math.round((p?.score ?? 0) * 100)}%
                    </span>
                  ) : (
                    <StatusButton node={n} />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {unmatched.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">Unmatched ({unmatched.length})</h2>
          <p className="mb-2 text-sm text-muted">These items weren't in the latest import. Reassign them under a current item to keep their progress, or delete them.</p>
          <ul className="panel divide-y divide-rule">
            {unmatched.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  {n.marker} {n.title} <span className="text-xs text-muted">({STATUSES.find((s) => s.value === n.status)!.label})</span>
                </span>
                <span className="flex gap-2">
                  <select
                    className="select w-48"
                    defaultValue=""
                    aria-label="Reassign under"
                    onChange={(e) => {
                      if (!e.target.value) return;
                      const parent = e.target.value === '__root' ? null : e.target.value;
                      void patch('syllabus_nodes', n.id, { parent_id: parent, unmatched: false, sort: 9999 });
                    }}
                  >
                    <option value="">Reassign under…</option>
                    <option value="__root">Top level</option>
                    {ordered.map((o) => (
                      <option key={o.id} value={o.id}>
                        {' '.repeat(depthOf(o) * 2)}
                        {o.marker} {o.title.slice(0, 60)}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-sm btn-danger" onClick={() => void softDelete('syllabus_nodes', n.id)}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ImportModal subject={subject} open={importing} onClose={() => setImporting(false)} hasExisting={data.all.length > 0} />
      {openNode && (
        <NodeDetail
          node={openNode}
          subject={subject}
          counts={counts.get(openNode.id) ?? { provision: 0, digest: 0, card: 0, question: 0, mistake: 0 }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
