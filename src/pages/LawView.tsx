import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, Pencil, Plus, Search, Star as StarIcon } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import CardEditor, { type CardDraft } from '../components/CardEditor';
import { NodeSelect } from '../components/TimerDialog';
import { Bar, Field, Markdown, Modal, Star, SubjectSelect, SubjectTag } from '../components/ui';
import { clozeFromRanges } from '../lib/cloze';
import { db } from '../lib/db';
import { adjustForEdit, offsetIn, segments } from '../lib/highlights';
import { useLive, useSettings, useSubjects } from '../lib/hooks';
import { create, patch, putRows, softDelete } from '../lib/repo';
import { nowIso } from '../lib/time';
import type { Highlight, HighlightColor, Law, Provision } from '../lib/types';
import { nodeTag } from '../lib/weak';
import { LawImport } from './Codals';

interface Sel {
  provisionId: string;
  start: number;
  end: number;
}

function ProvisionText({ p, hls, legend, onHighlightClick }: { p: Provision; hls: Highlight[]; legend: HighlightColor[]; onHighlightClick: (h: Highlight) => void }) {
  const color = (k: string) => legend.find((l) => l.key === k)?.color ?? '#FFE14D';
  return (
    <div className="reading whitespace-pre-wrap" data-provision={p.id}>
      {segments(p.text, hls).map((s) =>
        s.hl ? (
          <mark
            key={s.start}
            className={`hl ${s.hl.needs_review ? 'hl-review' : ''}`}
            style={{ ['--hl' as string]: color(s.hl.color_key), color: 'inherit' }}
            onClick={() => onHighlightClick(s.hl as Highlight)}
            title={s.hl.needs_review ? 'Text changed here: check this highlight' : legend.find((l) => l.key === s.hl!.color_key)?.label}
          >
            {s.text}
          </mark>
        ) : (
          <span key={s.start}>{s.text}</span>
        ),
      )}
    </div>
  );
}

function ClozeFromProvision({ p, hls, law, legend, onClose }: { p: Provision; hls: Highlight[]; law: Law; legend: HighlightColor[]; onClose: () => void }) {
  const present = legend.filter((l) => hls.some((h) => h.color_key === l.key));
  const [colors, setColors] = useState<Set<string>>(new Set(present.length ? [present[0].key] : []));
  const [mode, setMode] = useState<'each' | 'one'>('each');
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const chosen = hls.filter((h) => colors.has(h.color_key));
  return (
    <>
      <Modal open={!draft} onClose={onClose} title="Make cloze card">
        {present.length === 0 ? (
          <p className="text-muted">Highlight the words to hide first (select text, then pick a color).</p>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="label">Hide highlights of these colors</p>
              <div className="flex flex-wrap gap-2">
                {present.map((l) => (
                  <label key={l.key} className="flex items-center gap-2 rounded-lg border border-rule px-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={colors.has(l.key)}
                      onChange={() => {
                        const n = new Set(colors);
                        if (n.has(l.key)) n.delete(l.key);
                        else n.add(l.key);
                        setColors(n);
                      }}
                    />
                    <span className="hl px-1" style={{ ['--hl' as string]: l.color }}>
                      {l.label}
                    </span>
                    ({hls.filter((h) => h.color_key === l.key).length})
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2" role="radiogroup">
              <button role="radio" aria-checked={mode === 'each'} className={`btn btn-sm ${mode === 'each' ? 'btn-primary' : ''}`} onClick={() => setMode('each')}>
                Each its own item
              </button>
              <button role="radio" aria-checked={mode === 'one'} className={`btn btn-sm ${mode === 'one' ? 'btn-primary' : ''}`} onClick={() => setMode('one')}>
                All as one item
              </button>
            </div>
            <button
              className="btn btn-primary"
              disabled={!chosen.length}
              onClick={async () => {
                const links = (await db.node_links.where('target_id').equals(p.id).toArray()).filter((l) => !l.deleted_at);
                setDraft({
                  type: 'cloze',
                  cloze_text: `**${p.label}${law.short_name ? ` ${law.short_name}` : ''}**\n\n${clozeFromRanges(p.text, chosen, mode)}`,
                  subject_id: law.primary_subject_id,
                  source_type: 'provision',
                  source_id: p.id,
                  tags: links.map((l) => nodeTag(l.node_id)),
                });
              }}
            >
              Continue with {chosen.length} highlights
            </button>
          </div>
        )}
      </Modal>
      <CardEditor open={!!draft} draft={draft ?? undefined} onClose={onClose} />
    </>
  );
}

function ProvisionMenu({ p, law, onClose }: { p: Provision; law: Law; onClose: () => void }) {
  const [notes, setNotes] = useState(p.notes);
  const [text, setText] = useState(p.text);
  const [label, setLabel] = useState(p.label);
  const [nodeSubject, setNodeSubject] = useState<string | null>(law.primary_subject_id);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const subjects = useSubjects();
  const links = useLive(() => db.node_links.where('target_id').equals(p.id).filter((l) => !l.deleted_at).toArray(), [p.id]) ?? [];
  const linkedNodes = useLive(async () => (await db.syllabus_nodes.bulkGet(links.map((l) => l.node_id))).filter(Boolean), [links.length]) ?? [];

  async function saveText() {
    const hls = (await db.highlights.where('provision_id').equals(p.id).toArray()).filter((h) => !h.deleted_at);
    const adjusted = adjustForEdit(p.text, text, hls);
    await putRows('highlights', adjusted.filter((h, i) => h !== hls[i]) as Highlight[]);
    await patch('provisions', p.id, { text, label, notes });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={`${p.label}${law.short_name ? ` ${law.short_name}` : ''}`} wide>
      <div className="space-y-4">
        <Field label="Notes (markdown)" htmlFor="pm-notes">
          <textarea id="pm-notes" className="textarea reading" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div>
          <p className="label">Linked syllabus items</p>
          <ul className="mb-2 space-y-1 text-sm">
            {linkedNodes.map((n) => (
              <li key={n!.id} className="flex items-center justify-between">
                <span>
                  {n!.marker} {n!.title}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => void softDelete('node_links', links.find((l) => l.node_id === n!.id)!.id)} aria-label="Unlink">
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
            <SubjectSelect subjects={subjects} value={nodeSubject} onChange={setNodeSubject} />
            <NodeSelect subjectId={nodeSubject} value={nodeId} onChange={setNodeId} />
            <button
              className="btn"
              disabled={!nodeId}
              onClick={async () => {
                if (nodeId && !links.some((l) => l.node_id === nodeId)) await create('node_links', { node_id: nodeId, target_type: 'provision', target_id: p.id });
                setNodeId(null);
              }}
            >
              Link
            </button>
          </div>
        </div>
        <details>
          <summary className="cursor-pointer text-sm font-semibold">Edit label and text</summary>
          <div className="mt-2 space-y-2">
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Label" />
            <textarea className="textarea reading min-h-[12rem]" value={text} onChange={(e) => setText(e.target.value)} aria-label="Provision text" />
            <p className="text-xs text-muted">Highlights that overlap a change are flagged for you to check.</p>
          </div>
        </details>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => void saveText()}>
            Save
          </button>
          <button className="btn btn-danger ml-auto" onClick={async () => { await softDelete('provisions', p.id); onClose(); }}>
            Delete provision
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function LawView() {
  const { law: lawId } = useParams();
  const nav = useNavigate();
  const settings = useSettings();
  const subjects = useSubjects();
  const legend = settings.highlightLegend;
  const [active, setActive] = useState(0);
  const [sel, setSel] = useState<Sel | null>(null);
  const [lastColor, setLastColor] = useState<string>(legend[0]?.key ?? 'yellow');
  const [hlMenu, setHlMenu] = useState<Highlight | null>(null);
  const [menu, setMenu] = useState<Provision | null>(null);
  const [cloze, setCloze] = useState<Provision | null>(null);
  const [adding, setAdding] = useState(false);
  const [editLaw, setEditLaw] = useState(false);
  const [filter, setFilter] = useState('');
  const refs = useRef<Map<string, HTMLElement>>(new Map());

  const data = useLive(async () => {
    const law = await db.laws.get(lawId!);
    if (!law) return null;
    const provisions = (await db.provisions.where('law_id').equals(law.id).toArray()).filter((p) => !p.deleted_at).sort((a, b) => a.sort - b.sort);
    const ids = new Set(provisions.map((p) => p.id));
    const hls = (await db.highlights.toArray()).filter((h) => !h.deleted_at && ids.has(h.provision_id));
    const byP = new Map<string, Highlight[]>();
    for (const h of hls) {
      if (!byP.has(h.provision_id)) byP.set(h.provision_id, []);
      byP.get(h.provision_id)!.push(h);
    }
    return { law, provisions, byP };
  }, [lawId]);

  const list = useMemo(() => {
    if (!data) return [];
    const f = filter.trim().toLowerCase();
    return f ? data.provisions.filter((p) => `${p.label} ${p.text}`.toLowerCase().includes(f)) : data.provisions;
  }, [data, filter]);

  // Track text selection inside a provision.
  useEffect(() => {
    const onSel = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || !s.rangeCount) {
        setSel(null);
        return;
      }
      const r = s.getRangeAt(0);
      const el = (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement) as HTMLElement | null;
      const container = el?.closest('[data-provision]') as HTMLElement | null;
      if (!container) {
        setSel(null);
        return;
      }
      const start = offsetIn(container, r.startContainer, r.startOffset);
      const end = offsetIn(container, r.endContainer, r.endOffset);
      if (end > start) setSel({ provisionId: container.dataset.provision!, start, end });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  const highlight = useCallback(
    async (color: string) => {
      if (!sel) return;
      setLastColor(color);
      await create('highlights', { provision_id: sel.provisionId, start: sel.start, end: sel.end, color_key: color, needs_review: false });
      window.getSelection()?.removeAllRanges();
      setSel(null);
    },
    [sel],
  );

  const markRead = useCallback(async (p: Provision) => {
    await patch('provisions', p.id, { read_count: p.read_count + 1, last_read_at: nowIso() });
  }, []);

  const go = useCallback(
    (i: number) => {
      const idx = Math.max(0, Math.min(list.length - 1, i));
      setActive(idx);
      const p = list[idx];
      if (p) refs.current.get(p.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
    [list],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, dialog')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'j') go(active + 1);
      else if (e.key === 'k') go(active - 1);
      else if (e.key === 'r' && list[active]) void markRead(list[active]);
      else if (e.key === 'h' && sel) void highlight(lastColor);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, list, go, markRead, sel, highlight, lastColor]);

  // Jump to #p-<id> from links.
  useEffect(() => {
    const id = window.location.hash.replace('#p-', '');
    if (id && data) {
      const i = list.findIndex((p) => p.id === id);
      if (i >= 0) setTimeout(() => go(i), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!data]);

  if (data === undefined) return <p className="text-muted">Loading…</p>;
  if (data === null)
    return (
      <p>
        Law not found. <Link to="/codals" className="underline">Back to codals</Link>
      </p>
    );
  const { law } = data;
  const subj = subjects.find((s) => s.id === law.primary_subject_id);
  const read1 = data.provisions.filter((p) => p.read_count >= 1).length;

  return (
    <div>
      <div className="mb-6">
        <Link to="/codals" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ChevronLeft className="h-4 w-4" aria-hidden /> Codals
        </Link>
        <h1 className="t-title mt-2">
          {law.short_name && <span className="mr-2">{law.short_name}</span>}
          <span className="font-normal text-muted">{law.title}</span>
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <SubjectTag subject={subj} />
          {law.citation} · {read1} of {data.provisions.length} read at least once
        </p>
        <div className="mt-3 max-w-md">
          <Bar value={data.provisions.length ? read1 / data.provisions.length : 0} size="sm" color={subj?.color} label="Provisions read" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
            <input className="input pl-9" placeholder="Find in this law" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find in this law" />
          </div>
          <button className="btn" onClick={() => setAdding(true)}>
            <Plus /> Add text
          </button>
          <button className="btn btn-ghost" onClick={() => setEditLaw(true)}>
            <Pencil /> Edit law
          </button>
        </div>
        <p className="mt-3 hidden gap-4 text-xs text-muted lg:flex">
          <span><kbd className="kbd">j</kbd> <kbd className="kbd">k</kbd> next / previous</span>
          <span><kbd className="kbd">r</kbd> mark read</span>
          <span><kbd className="kbd">h</kbd> highlight selection</span>
        </p>
      </div>

      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
      <nav className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] self-start overflow-y-auto pr-1 scrollbar-thin lg:block" aria-label="Contents">
        <p className="t-eyebrow mb-2 px-2">Contents</p>
        <ul className="space-y-px">
          {list.map((p, i) => (
            <li key={p.id}>
              <button
                onClick={() => go(i)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[0.8125rem] ${i === active ? 'bg-[var(--accent-soft)] font-medium text-ink' : 'text-muted hover:bg-elevated hover:text-ink'}`}
                aria-current={i === active}
              >
                <span className="flex-1 truncate">{p.label}</span>
                {p.starred && <StarIcon className="h-3 w-3 fill-[#F59E0B] text-[#F59E0B]" aria-label="Starred" />}
                {p.read_count > 0 && <Check className="h-3 w-3 text-ok" aria-label={`Read ${p.read_count} times`} />}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="reading-surface -mx-4 rounded-none border-y border-rule px-4 py-2 lg:mx-0 lg:rounded-2xl lg:border lg:px-10">
        {list.length === 0 && <p className="py-6 text-muted">{data.provisions.length ? 'No provisions match.' : 'No provisions yet. Use Add text to paste this law.'}</p>}
        {list.map((p, i) => {
          const hls = data.byP.get(p.id) ?? [];
          return (
            <article
              key={p.id}
              id={`p-${p.id}`}
              ref={(el) => {
                if (el) refs.current.set(p.id, el);
              }}
              className={`relative scroll-mt-24 border-b border-rule py-6 last:border-b-0 ${i === active ? 'before:absolute before:top-6 before:bottom-6 before:-left-4 before:w-[3px] before:rounded-full before:bg-accent lg:before:-left-6' : ''}`}
              onClick={() => setActive(i)}
            >
              {p.heading && <p className="t-eyebrow mb-3 whitespace-pre-wrap">{p.heading}</p>}
              <ProvisionText p={p} hls={hls} legend={legend} onHighlightClick={setHlMenu} />
              {p.notes && (
                <div className="mt-3 rounded-lg border border-rule p-3 text-sm">
                  <Markdown>{p.notes}</Markdown>
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-1">
                <button className="btn btn-sm" onClick={() => void markRead(p)}>
                  <Check /> Mark read{p.read_count ? ` · ${p.read_count}×` : ''}
                </button>
                <Star on={p.starred} onClick={() => void patch('provisions', p.id, { starred: !p.starred })} />
                <button className="btn btn-sm btn-ghost" onClick={() => setCloze(p)}>
                  Make cloze card
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setMenu(p)}>
                  Notes and links
                </button>
                {hls.some((h) => h.needs_review) && <span className="text-xs font-semibold text-danger">Check highlights</span>}
              </div>
            </article>
          );
        })}
      </div>
      </div>

      {sel && (
        <div className="fixed inset-x-0 bottom-16 z-40 flex justify-center px-4 lg:bottom-6">
          <div className="flex items-center gap-1 rounded-full border border-rule bg-surface p-1.5 shadow-lg">
            {legend.map((l) => (
              <button
                key={l.key}
                className="h-10 rounded-full px-3 text-sm"
                style={{ background: l.color, color: '#1D2130' }}
                // Apply on pointerdown: on phones the selection collapses before click fires.
                onPointerDown={(e) => {
                  e.preventDefault();
                  void highlight(l.key);
                }}
                aria-label={`Highlight: ${l.label}`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {hlMenu && (
        <Modal open onClose={() => setHlMenu(null)} title="Highlight">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {legend.map((l) => (
                <button key={l.key} className="btn btn-sm" style={{ background: l.color, color: '#1D2130' }} onClick={async () => { await patch('highlights', hlMenu.id, { color_key: l.key, needs_review: false }); setHlMenu(null); }}>
                  {l.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              {hlMenu.needs_review && (
                <button className="btn" onClick={async () => { await patch('highlights', hlMenu.id, { needs_review: false }); setHlMenu(null); }}>
                  It's fine
                </button>
              )}
              <button className="btn btn-danger" onClick={async () => { await softDelete('highlights', hlMenu.id); setHlMenu(null); }}>
                Remove highlight
              </button>
            </div>
          </div>
        </Modal>
      )}
      {menu && <ProvisionMenu p={menu} law={law} onClose={() => setMenu(null)} />}
      {cloze && <ClozeFromProvision p={cloze} hls={data.byP.get(cloze.id) ?? []} law={law} legend={legend} onClose={() => setCloze(null)} />}
      <LawImport open={adding} onClose={() => setAdding(false)} law={law} />
      {editLaw && <LawMetaEditor law={law} onClose={() => setEditLaw(false)} onDeleted={() => nav('/codals')} />}
    </div>
  );
}

function LawMetaEditor({ law, onClose, onDeleted }: { law: Law; onClose: () => void; onDeleted: () => void }) {
  const subjects = useSubjects();
  const [m, setM] = useState(law);
  return (
    <Modal open onClose={onClose} title="Edit law">
      <div className="space-y-3">
        <Field label="Title" htmlFor="lm-title">
          <input id="lm-title" className="input" value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} />
        </Field>
        <Field label="Short name" htmlFor="lm-short">
          <input id="lm-short" className="input" value={m.short_name} onChange={(e) => setM({ ...m, short_name: e.target.value })} />
        </Field>
        <Field label="Citation" htmlFor="lm-cite">
          <input id="lm-cite" className="input" value={m.citation} onChange={(e) => setM({ ...m, citation: e.target.value })} />
        </Field>
        <Field label="Primary subject" htmlFor="lm-subj">
          <SubjectSelect id="lm-subj" subjects={subjects} value={m.primary_subject_id} onChange={(v) => setM({ ...m, primary_subject_id: v })} />
        </Field>
        <Field label="Source URL" htmlFor="lm-url">
          <input id="lm-url" className="input" value={m.source_url} onChange={(e) => setM({ ...m, source_url: e.target.value })} />
        </Field>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={async () => { await putRows('laws', [{ ...m, short_name: m.short_name.toUpperCase() }]); onClose(); }}>
            Save
          </button>
          <button
            className="btn btn-danger ml-auto"
            onClick={async () => {
              if (!confirm(`Delete ${law.title} and all its provisions?`)) return;
              const ps = await db.provisions.where('law_id').equals(law.id).primaryKeys();
              await softDelete('provisions', ps as string[]);
              await softDelete('laws', law.id);
              onDeleted();
            }}
          >
            Delete law
          </button>
        </div>
      </div>
    </Modal>
  );
}
