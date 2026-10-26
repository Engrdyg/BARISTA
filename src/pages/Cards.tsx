import { useMemo, useState } from 'react';
import { Layers, Play, Plus, Shuffle } from 'lucide-react';
import { useSubjectFilter } from '../lib/subjectFilter';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Bar as RBar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axis, ChartTooltip, grid, Legend } from '../components/charts';
import CardEditor from '../components/CardEditor';
import { NodeSelect } from '../components/TimerDialog';
import { download, Empty, Modal, PageHeader, Section, SubjectChips, SubjectTag } from '../components/ui';
import { parseDelimited, toCsv } from '../lib/backup';
import { isLeech } from '../lib/calc';
import { stripCloze } from '../lib/cloze';
import { db } from '../lib/db';
import { useLive, useSettings, useSubjects } from '../lib/hooks';
import { buildQueue, dueForecast, newCard, saveCard, State } from '../lib/srs';
import { shortDate, todayManila } from '../lib/time';
import type { CardItem, CardRow, Subject } from '../lib/types';
import { nodeIdsFromTags, nodeTag } from '../lib/weak';

function cardTitle(c: CardRow) {
  return (c.type === 'cloze' ? stripCloze(c.cloze_text) : c.front).replace(/\s+/g, ' ').slice(0, 140);
}

function ImportModal({ open, onClose, subjects }: { open: boolean; onClose: () => void; subjects: Subject[] }) {
  const [text, setText] = useState('');
  const [defaultSubject, setDefaultSubject] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const parsed = useMemo(() => {
    if (!text.trim()) return [];
    const isAnki = /^#separator:/m.test(text) || /^#html:/m.test(text);
    const lines = text
      .split('\n')
      .filter((l) => !l.startsWith('#'))
      .join('\n');
    const sep = /^#separator:(\w+)/m.exec(text)?.[1];
    const delim = sep === 'Comma' ? ',' : sep === 'Semicolon' ? ';' : sep === 'Pipe' ? '|' : isAnki || lines.includes('\t') ? '\t' : ',';
    const rows = parseDelimited(lines, delim);
    const header = rows[0]?.map((h) => h.trim().toLowerCase());
    const hasHeader = header && header[0] === 'front' && header[1] === 'back';
    return (hasHeader ? rows.slice(1) : rows)
      .filter((r) => r[0]?.trim())
      .map((r) => {
        const front = r[0].trim();
        const back = (r[1] ?? '').trim();
        const code = (r[2] ?? '').trim().toUpperCase();
        const tags = (r[3] ?? '')
          .split(/[\s,;]+/)
          .map((t) => t.trim())
          .filter(Boolean);
        const subject = subjects.find((s) => s.code === code || s.name.toUpperCase() === code)?.id ?? defaultSubject;
        const isCloze = /\{\{c\d+::/.test(front);
        // Anki HTML: keep line breaks, drop tags.
        const clean = (s: string) => s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
        return { front: clean(front), back: clean(back), subject, tags, isCloze };
      });
  }, [text, subjects, defaultSubject]);

  return (
    <Modal open={open} onClose={() => { setResult(null); setText(''); onClose(); }} title="Import cards" wide>
      {result ? (
        <p>{result}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Paste CSV or TSV with columns <code>front, back, subject, tags</code> (subject as a code like CIV), or an Anki “Notes in Plain Text” export.
          </p>
          <input
            type="file"
            accept=".csv,.tsv,.txt"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setText(await f.text());
            }}
          />
          <textarea className="textarea min-h-[10rem] font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} aria-label="Cards to import" />
          <div>
            <label className="label">Subject for rows without one</label>
            <select className="select" value={defaultSubject ?? ''} onChange={(e) => setDefaultSubject(e.target.value || null)}>
              <option value="">None</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code}
                </option>
              ))}
            </select>
          </div>
          {parsed.length > 0 && (
            <p className="text-sm">
              {parsed.length} cards ready ({parsed.filter((p) => p.isCloze).length} cloze). First: “{parsed[0].front.slice(0, 80)}”
            </p>
          )}
          <button
            className="btn btn-primary"
            disabled={!parsed.length}
            onClick={async () => {
              for (const p of parsed) {
                await saveCard(
                  newCard(
                    p.isCloze
                      ? { type: 'cloze', cloze_text: p.front, back: p.back, subject_id: p.subject, tags: p.tags, source_type: 'import' }
                      : { type: 'basic', front: p.front, back: p.back, subject_id: p.subject, tags: p.tags, source_type: 'import' },
                  ),
                );
              }
              setResult(`Imported ${parsed.length} cards.`);
            }}
          >
            Import {parsed.length || ''} cards
          </button>
        </div>
      )}
    </Modal>
  );
}

function CramModal({ open, onClose, subjects }: { open: boolean; onClose: () => void; subjects: Subject[] }) {
  const nav = useNavigate();
  const [subject, setSubject] = useState<string | null>(null);
  const [node, setNode] = useState<string | null>(null);
  const [tag, setTag] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Cram session">
      <div className="space-y-3">
        <p className="text-sm text-muted">Reviews any set of cards in random order. Schedules don't change unless you turn that on in Settings.</p>
        <div>
          <label className="label">Subject</label>
          <SubjectChips subjects={subjects} value={subject} onChange={setSubject} />
        </div>
        <div>
          <label className="label">Syllabus item</label>
          <NodeSelect subjectId={subject} value={node} onChange={setNode} />
        </div>
        <div>
          <label className="label" htmlFor="cram-tag">
            Tag
          </label>
          <input id="cram-tag" className="input" value={tag} onChange={(e) => setTag(e.target.value)} />
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            const p = new URLSearchParams({ cram: '1' });
            if (subject) p.set('subject', subject);
            if (node) p.set('tag', nodeTag(node));
            else if (tag.trim()) p.set('tag', tag.trim());
            nav(`/cards/review?${p}`);
          }}
        >
          Start cram
        </button>
      </div>
    </Modal>
  );
}

function Forecast({ subjects }: { subjects: Subject[] }) {
  const data = useLive(() => dueForecast(30));
  if (!data) return null;
  const rows = data.map((d) => ({ date: shortDate(d.date), ...d.bySubject }));
  if (!data.some((d) => Object.keys(d.bySubject).length)) return null;
  const used = subjects.filter((s) => data.some((d) => d.bySubject[s.id]));
  const hasNone = data.some((d) => d.bySubject.none);
  return (
    <Section title="Due in the next 30 days">
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap={2}>
            <CartesianGrid {...grid} />
            <XAxis dataKey="date" {...axis} interval={6} />
            <YAxis {...axis} axisLine={false} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'color-mix(in srgb, var(--ink) 6%, transparent)' }} />
            {used.map((s) => (
              <RBar key={s.id} dataKey={s.id} name={s.code} stackId="a" fill={s.color} stroke="var(--surface)" strokeWidth={2} maxBarSize={24} />
            ))}
            {hasNone && <RBar dataKey="none" name="No subject" stackId="a" fill="var(--ink-muted)" stroke="var(--surface)" strokeWidth={2} maxBarSize={24} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend items={[...used.map((s) => ({ key: s.id, label: s.code, color: s.color })), ...(hasNone ? [{ key: 'none', label: 'No subject', color: 'var(--ink-muted)' }] : [])]} />
    </Section>
  );
}

export default function Cards() {
  const subjects = useSubjects();
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const nodeFilter = params.get('node');
  const [filterSubject, setSubject] = useSubjectFilter();
  const subject = params.get('subject') ?? filterSubject;
  const [q, setQ] = useState('');
  const [view, setView] = useState<'all' | 'leeches' | 'suspended' | 'starred'>('all');
  const [editing, setEditing] = useState<CardRow | null | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const [cram, setCram] = useState(false);

  const data = useLive(async () => {
    const cards = (await db.cards.toArray()).filter((c) => !c.deleted_at);
    const items = (await db.card_items.toArray()).filter((i) => !i.deleted_at);
    const byCard = new Map<string, CardItem[]>();
    for (const i of items) {
      if (!byCard.has(i.card_id)) byCard.set(i.card_id, []);
      byCard.get(i.card_id)!.push(i);
    }
    const queue = await buildQueue(settings);
    const node = nodeFilter ? await db.syllabus_nodes.get(nodeFilter) : undefined;
    return { cards, byCard, due: queue.filter((e) => e.item.state !== State.New).length, fresh: queue.filter((e) => e.item.state === State.New).length, node };
  }, [nodeFilter, settings.newCardsPerDay, settings.maxReviewsPerDay]);

  if (!data) return <p className="text-muted">Loading…</p>;
  const needle = q.trim().toLowerCase();
  const list = data.cards
    .filter((c) => !subject || c.subject_id === subject)
    .filter((c) => !nodeFilter || c.tags.includes(nodeTag(nodeFilter)))
    .filter((c) => {
      const items = data.byCard.get(c.id) ?? [];
      if (view === 'leeches') return items.some((i) => isLeech(i.lapses));
      if (view === 'suspended') return c.suspended;
      if (view === 'starred') return c.starred;
      return true;
    })
    .filter((c) => !needle || `${c.front} ${c.back} ${c.cloze_text} ${c.tags.join(' ')}`.toLowerCase().includes(needle))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const shown = list.slice(0, 300);
  const today = todayManila();

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Layers}
        title="Flashcards"
        subtitle={`${data.due} due · ${data.fresh} new today · ${data.cards.length} cards`}
        actions={
          <>
            <Link to={`/cards/review${subject ? `?subject=${subject}` : ''}`} className={`btn btn-primary ${data.due + data.fresh ? '' : 'pointer-events-none opacity-50'}`}>
              <Play /> Review
            </Link>
            <button className="btn" onClick={() => setEditing(null)}>
              <Plus /> New card
            </button>
            <button className="btn" onClick={() => setCram(true)}>
              <Shuffle /> Cram
            </button>
          </>
        }
      />
      <SubjectChips subjects={subjects} value={subject} onChange={setSubject} />
      {data.node && (
        <p className="text-sm">
          Linked to <strong>{data.node.title}</strong>{' '}
          <button className="underline" onClick={() => setParams({})}>
            Clear
          </button>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Filter cards" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter cards" />
        {(['all', 'leeches', 'suspended', 'starred'] as const).map((v) => (
          <button key={v} className={`btn btn-sm ${view === v ? 'btn-primary' : ''}`} onClick={() => setView(v)}>
            {v === 'all' ? 'All' : v === 'leeches' ? 'Leeches' : v === 'suspended' ? 'Suspended' : 'Starred'}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        data.cards.length === 0 ? (
          <Empty
            icon={Layers}
            title="No flashcards yet"
            actions={
              <>
                <button className="btn btn-primary" onClick={() => setEditing(null)}>
                  <Plus /> Create flashcards
                </button>
                <button className="btn" onClick={() => setImporting(true)}>
                  Import CSV / Anki
                </button>
              </>
            }
          >
            Turn important provisions and legal concepts into effective review cards. You can also make them from a codal highlight or a digest.
          </Empty>
        ) : (
          <Empty icon={Layers} title="No cards match" compact>
            Try another subject or clear the filter.
          </Empty>
        )
      ) : (
        <ul className="panel divide-y divide-rule">
          {shown.map((c) => {
            const items = data.byCard.get(c.id) ?? [];
            const next = items.filter((i) => i.state !== State.New).map((i) => i.due).sort()[0];
            const leech = items.some((i) => isLeech(i.lapses));
            return (
              <li key={c.id}>
                <button className="flex w-full items-start gap-2 px-3 py-2 text-left" onClick={() => setEditing(c)}>
                  <SubjectTag subject={subjects.find((s) => s.id === c.subject_id)} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2">{cardTitle(c)}</span>
                    <span className="text-xs text-muted">
                      {c.type === 'cloze' ? `Cloze · ${items.length} items` : 'Basic'}
                      {next ? ` · next ${next.slice(0, 10) <= today ? 'today' : shortDate(next.slice(0, 10))}` : ' · new'}
                      {c.suspended ? ' · suspended' : ''}
                      {nodeIdsFromTags(c.tags).length ? ' · linked' : ''}
                    </span>
                  </span>
                  {leech && <span className="shrink-0 text-xs font-semibold text-danger">Leech</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {list.length > shown.length && <p className="text-sm text-muted">Showing 300 of {list.length}. Filter to narrow.</p>}
      {view === 'leeches' && list.length > 0 && (
        <p className="text-sm text-muted">Leeches have lapsed 4 or more times. Rewrite them, split them, or add a mistake entry for the rule.</p>
      )}
      <Forecast subjects={subjects} />
      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={() => setImporting(true)}>
          Import CSV / Anki
        </button>
        <button
          className="btn"
          onClick={() =>
            download(
              `barista-cards-${today}.csv`,
              toCsv(
                data.cards.map((c) => ({
                  front: c.type === 'cloze' ? c.cloze_text : c.front,
                  back: c.back,
                  subject: subjects.find((s) => s.id === c.subject_id)?.code ?? '',
                  tags: c.tags.filter((t) => !t.startsWith('node:')).join(' '),
                })),
                ['front', 'back', 'subject', 'tags'],
              ),
              'text/csv',
            )
          }
        >
          Export CSV
        </button>
      </div>
      <CardEditor open={editing !== undefined} card={editing ?? null} draft={editing === null && nodeFilter ? { tags: [nodeTag(nodeFilter)], subject_id: data.node?.subject_id ?? subject } : editing === null ? { subject_id: subject } : undefined} onClose={() => setEditing(undefined)} />
      <ImportModal open={importing} onClose={() => setImporting(false)} subjects={subjects} />
      <CramModal open={cram} onClose={() => setCram(false)} subjects={subjects} />
    </div>
  );
}
