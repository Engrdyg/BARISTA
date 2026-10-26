import { useEffect, useState } from 'react';
import { Gavel, Plus, Zap } from 'lucide-react';
import { useSubjectFilter } from '../lib/subjectFilter';
import { useSearchParams } from 'react-router-dom';
import CardEditor, { type CardDraft } from '../components/CardEditor';
import { NodeSelect } from '../components/TimerDialog';
import { Empty, Field, Markdown, Modal, PageHeader, Star, SubjectChips, SubjectSelect, SubjectTag } from '../components/ui';
import { db } from '../lib/db';
import { useExam, useLive, useSubjects } from '../lib/hooks';
import { create, makeRow, patch, putRow, softDelete } from '../lib/repo';
import { shortDate } from '../lib/time';
import type { Digest, ExamConfig } from '../lib/types';

export function coverageOf(d: Pick<Digest, 'promulgated_on'>, exam: ExamConfig | undefined): 'in' | 'after' | null {
  if (!d.promulgated_on || !exam) return null;
  return d.promulgated_on <= exam.coverage_cutoff ? 'in' : 'after';
}

export function CoverageBadge({ digest, exam }: { digest: Pick<Digest, 'promulgated_on'>; exam: ExamConfig | undefined }) {
  const c = coverageOf(digest, exam);
  if (!c || !exam) return null;
  return c === 'in' ? (
    <span className="rounded-full border border-ok px-2 py-0.5 text-xs font-semibold text-ok">In coverage</span>
  ) : (
    <span className="rounded-full border border-danger px-2 py-0.5 text-xs font-semibold text-danger">
      After cutoff, not examinable for {exam.day1.slice(0, 4)}
    </span>
  );
}

const normGr = (s: string) => s.replace(/[^\dA-Za-z]/g, '').toUpperCase().replace(/^GRNO/, '').replace(/^GR/, '');

function emptyDigest(subjectId: string | null): Digest {
  return makeRow('digests', {
    subject_id: subjectId,
    title: '',
    gr_no: '',
    promulgated_on: null,
    ponente: '',
    division: null,
    doctrine: '',
    facts: '',
    issues: '',
    ruling: '',
    notes: '',
    separate_opinions: '',
    source_url: '',
    starred: false,
  });
}

function DigestEditor({ initial, onClose, quick, onOpenExisting }: { initial: Digest; onClose: () => void; quick: boolean; onOpenExisting: (id: string) => void }) {
  const subjects = useSubjects();
  const exam = useExam();
  const [d, setD] = useState<Digest>(initial);
  const [full, setFull] = useState(!quick);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [dup, setDup] = useState<Digest | null>(null);
  const isNew = !(useLive(() => db.digests.get(initial.id), [initial.id]));
  const set = (k: keyof Digest, v: unknown) => setD((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    void db.node_links
      .where('target_id')
      .equals(initial.id)
      .filter((l) => !l.deleted_at && l.target_type === 'digest')
      .first()
      .then((l) => setNodeId(l?.node_id ?? null));
  }, [initial.id]);

  async function save(force = false) {
    if (d.gr_no.trim() && !force) {
      const g = normGr(d.gr_no);
      const existing = (await db.digests.toArray()).find((x) => !x.deleted_at && x.id !== d.id && x.gr_no && normGr(x.gr_no) === g);
      if (existing) {
        setDup(existing);
        return;
      }
    }
    await putRow('digests', { ...d, title: d.title.trim(), doctrine: d.doctrine.trim() });
    const links = (await db.node_links.where('target_id').equals(d.id).toArray()).filter((l) => !l.deleted_at && l.target_type === 'digest');
    for (const l of links) if (l.node_id !== nodeId) await softDelete('node_links', l.id);
    if (nodeId && !links.some((l) => l.node_id === nodeId)) await create('node_links', { node_id: nodeId, target_type: 'digest', target_id: d.id });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={isNew ? (full ? 'New digest' : 'Quick add digest') : 'Edit digest'} wide>
      <div className="space-y-3">
        <Field label="Case title" htmlFor="dg-title">
          <input id="dg-title" className="input" value={d.title} onChange={(e) => set('title', e.target.value)} autoFocus />
        </Field>
        <Field label="Doctrine (one to three sentences, main opinion only)" htmlFor="dg-doctrine">
          <textarea id="dg-doctrine" className="textarea reading" value={d.doctrine} onChange={(e) => set('doctrine', e.target.value)} />
        </Field>
        {!full ? (
          <button className="btn btn-ghost btn-sm" onClick={() => setFull(true)}>
            More fields
          </button>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="G.R. No." htmlFor="dg-gr">
                <input id="dg-gr" className="input" value={d.gr_no} onChange={(e) => set('gr_no', e.target.value)} placeholder="G.R. No. 123456" />
              </Field>
              <Field label="Promulgated" htmlFor="dg-date">
                <input id="dg-date" type="date" className="input" value={d.promulgated_on ?? ''} onChange={(e) => set('promulgated_on', e.target.value || null)} />
              </Field>
              <Field label="Ponente" htmlFor="dg-ponente">
                <input id="dg-ponente" className="input" value={d.ponente} onChange={(e) => set('ponente', e.target.value)} />
              </Field>
            </div>
            <div>
              <CoverageBadge digest={d} exam={exam} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Court" htmlFor="dg-div">
                <select id="dg-div" className="select" value={d.division ?? ''} onChange={(e) => set('division', e.target.value || null)}>
                  <option value="">—</option>
                  <option value="en_banc">En Banc</option>
                  <option value="division">Division</option>
                </select>
              </Field>
              <Field label="Subject" htmlFor="dg-subject">
                <SubjectSelect id="dg-subject" subjects={subjects} value={d.subject_id} onChange={(v) => set('subject_id', v)} />
              </Field>
              <Field label="Syllabus item" htmlFor="dg-node">
                <NodeSelect id="dg-node" subjectId={d.subject_id} value={nodeId} onChange={setNodeId} />
              </Field>
            </div>
            {(['facts', 'issues', 'ruling', 'notes'] as const).map((k) => (
              <Field key={k} label={k[0].toUpperCase() + k.slice(1)} htmlFor={`dg-${k}`}>
                <textarea id={`dg-${k}`} className="textarea reading" value={d[k]} onChange={(e) => set(k, e.target.value)} />
              </Field>
            ))}
            <Field label="Separate opinions (not examinable)" htmlFor="dg-sep">
              <textarea id="dg-sep" className="textarea" value={d.separate_opinions} onChange={(e) => set('separate_opinions', e.target.value)} />
            </Field>
            <Field label="Source URL" htmlFor="dg-url">
              <input id="dg-url" className="input" type="url" value={d.source_url} onChange={(e) => set('source_url', e.target.value)} />
            </Field>
          </>
        )}
        {dup && (
          <div className="rounded-lg border border-danger p-3 text-sm" role="alert">
            <p>
              A digest with this G.R. No. already exists: <strong>{dup.title}</strong>.
            </p>
            <div className="mt-2 flex gap-2">
              <button className="btn btn-sm" onClick={() => onOpenExisting(dup.id)}>
                Open existing digest
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => void save(true)}>
                Save anyway
              </button>
            </div>
          </div>
        )}
        <button className="btn btn-primary" disabled={!d.title.trim() || !d.doctrine.trim()} onClick={() => void save()}>
          Save digest
        </button>
      </div>
    </Modal>
  );
}

function doctrineDraft(d: Digest, cloze: boolean): CardDraft {
  const issue = d.issues.split('\n').find((l) => l.trim()) ?? '';
  const front = `**${d.title}**${issue ? `\n\n${issue}` : ''}`;
  return cloze
    ? { type: 'cloze', cloze_text: `${front}\n\n{{c1::${d.doctrine}}}`, subject_id: d.subject_id, source_type: 'digest', source_id: d.id }
    : { type: 'basic', front, back: d.doctrine, subject_id: d.subject_id, source_type: 'digest', source_id: d.id };
}

function DigestView({ d, onClose, onEdit }: { d: Digest; onClose: () => void; onEdit: () => void }) {
  const subjects = useSubjects();
  const exam = useExam();
  const [card, setCard] = useState<CardDraft | null>(null);
  const cards = useLive(() => db.cards.where('source_id').equals(d.id).filter((c) => !c.deleted_at).count(), [d.id]);
  return (
    <Modal open onClose={onClose} title={d.title} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <SubjectTag subject={subjects.find((s) => s.id === d.subject_id)} />
          {d.gr_no && <span>{d.gr_no}</span>}
          {d.promulgated_on && <span>{shortDate(d.promulgated_on)}, {d.promulgated_on.slice(0, 4)}</span>}
          {d.ponente && <span>{d.ponente}, J.</span>}
          {d.division && <span>{d.division === 'en_banc' ? 'En Banc' : 'Division'}</span>}
          <CoverageBadge digest={d} exam={exam} />
        </div>
        <section className="reading-surface rounded-xl border-l-4 border-accent p-4" aria-label="Doctrine">
          <h3 className="t-eyebrow mb-1.5 text-accent">Doctrine</h3>
          <Markdown className="reading">{d.doctrine}</Markdown>
        </section>
        {(['facts', 'issues', 'ruling', 'notes'] as const).map((k) =>
          d[k] ? (
            <section key={k} className="border-t border-rule pt-4" aria-label={k}>
              <h3 className="t-eyebrow mb-1.5">{k[0].toUpperCase() + k.slice(1)}</h3>
              <Markdown className="reading">{d[k]}</Markdown>
            </section>
          ) : null,
        )}
        {d.separate_opinions && (
          <section className="rounded-lg border border-dashed border-rule p-3">
            <h3 className="mb-1 text-sm font-semibold">Separate opinions · not examinable</h3>
            <Markdown className="reading text-muted">{d.separate_opinions}</Markdown>
          </section>
        )}
        {d.source_url && (
          <a className="text-sm underline" href={d.source_url} target="_blank" rel="noreferrer noopener">
            Source
          </a>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => setCard(doctrineDraft(d, false))}>
            Make doctrine card
          </button>
          <button className="btn" onClick={() => setCard(doctrineDraft(d, true))}>
            Make cloze card
          </button>
          <button className="btn" onClick={onEdit}>
            Edit
          </button>
          <Star on={d.starred} onClick={() => void patch('digests', d.id, { starred: !d.starred })} />
          <button
            className="btn btn-danger ml-auto"
            onClick={async () => {
              await softDelete('digests', d.id);
              onClose();
            }}
          >
            Delete
          </button>
        </div>
        {!!cards && <p className="text-sm text-muted">{cards} cards made from this digest.</p>}
      </div>
      <CardEditor open={!!card} draft={card ?? undefined} onClose={() => setCard(null)} />
    </Modal>
  );
}

export default function Digests() {
  const subjects = useSubjects();
  const exam = useExam();
  const [params, setParams] = useSearchParams();
  const nodeFilter = params.get('node');
  const [subject, setSubject] = useSubjectFilter();
  const [q, setQ] = useState('');
  const [year, setYear] = useState('');
  const [cov, setCov] = useState<'all' | 'in' | 'after'>('all');
  const [starred, setStarred] = useState(false);
  const [sort, setSort] = useState<'date' | 'title'>('date');
  const [editing, setEditing] = useState<{ d: Digest; quick: boolean } | null>(null);
  const [viewing, setViewing] = useState<string | null>(params.get('open'));

  const data = useLive(async () => {
    const ds = (await db.digests.toArray()).filter((d) => !d.deleted_at);
    let linked: Set<string> | null = null;
    if (nodeFilter) linked = new Set((await db.node_links.where('node_id').equals(nodeFilter).toArray()).filter((l) => !l.deleted_at && l.target_type === 'digest').map((l) => l.target_id));
    const node = nodeFilter ? await db.syllabus_nodes.get(nodeFilter) : undefined;
    return { ds, linked, node };
  }, [nodeFilter]);
  const viewed = useLive(() => (viewing ? db.digests.get(viewing) : undefined), [viewing]);
  if (!data) return <p className="text-muted">Loading…</p>;

  const needle = q.trim().toLowerCase();
  const years = [...new Set(data.ds.map((d) => d.promulgated_on?.slice(0, 4)).filter(Boolean))].sort().reverse() as string[];
  const list = data.ds
    .filter((d) => !subject || d.subject_id === subject)
    .filter((d) => !data.linked || data.linked.has(d.id))
    .filter((d) => !year || d.promulgated_on?.startsWith(year))
    .filter((d) => cov === 'all' || coverageOf(d, exam) === cov)
    .filter((d) => !starred || d.starred)
    .filter((d) => !needle || `${d.title} ${d.gr_no} ${d.doctrine} ${d.ponente}`.toLowerCase().includes(needle))
    .sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title) : (b.promulgated_on ?? '').localeCompare(a.promulgated_on ?? '')));

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Gavel}
        title="Case digests"
        subtitle={`${data.ds.length} digests`}
        actions={
          <>
            <button className="btn btn-primary" onClick={() => setEditing({ d: emptyDigest(subject), quick: true })}>
              <Zap /> Quick add
            </button>
            <button className="btn" onClick={() => setEditing({ d: emptyDigest(subject), quick: false })}>
              <Plus /> New digest
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
        <input className="input max-w-xs" placeholder="Title, G.R. No., doctrine" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter digests" />
        <select className="select w-auto" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">
          <option value="">All years</option>
          {years.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
        <select className="select w-auto" value={cov} onChange={(e) => setCov(e.target.value as typeof cov)} aria-label="Coverage">
          <option value="all">Any coverage</option>
          <option value="in">In coverage</option>
          <option value="after">After cutoff</option>
        </select>
        <select className="select w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="date">Newest first</option>
          <option value="title">By title</option>
        </select>
        <button className={`btn btn-sm self-center ${starred ? 'btn-primary' : ''}`} onClick={() => setStarred(!starred)}>
          ★ Starred
        </button>
      </div>
      {list.length === 0 ? (
        data.ds.length ? (
          <Empty icon={Gavel} title="No digests match" compact>
            Try another subject, year or coverage filter.
          </Empty>
        ) : (
          <Empty
            icon={Gavel}
            title="No case digests yet"
            actions={
              <button className="btn btn-primary" onClick={() => setEditing({ d: emptyDigest(subject), quick: true })}>
                <Zap /> Quick add a case
              </button>
            }
          >
            Quick add needs only the case title and its doctrine, under 30 seconds on your phone. Fill in facts, issues and ruling later.
          </Empty>
        )
      ) : (
        <ul className="panel divide-y divide-rule">
          {list.map((d) => (
            <li key={d.id}>
              <button className="block w-full px-3 py-2.5 text-left" onClick={() => setViewing(d.id)}>
                <div className="flex items-start gap-2">
                  <SubjectTag subject={subjects.find((s) => s.id === d.subject_id)} className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">
                      {d.title} {d.starred && <span aria-label="Starred">★</span>}
                    </div>
                    <div className="text-xs text-muted">
                      {[d.gr_no, d.promulgated_on && `${shortDate(d.promulgated_on)}, ${d.promulgated_on.slice(0, 4)}`].filter(Boolean).join(' · ')}
                      {coverageOf(d, exam) === 'after' && <span className="ml-1 font-semibold text-danger">· After cutoff</span>}
                    </div>
                    <p className="reading mt-1 line-clamp-2 text-base">{d.doctrine}</p>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <DigestEditor
          initial={editing.d}
          quick={editing.quick}
          onClose={() => setEditing(null)}
          onOpenExisting={(id) => {
            setEditing(null);
            setViewing(id);
          }}
        />
      )}
      {viewed && !editing && (
        <DigestView
          d={viewed}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing({ d: viewed, quick: false });
          }}
        />
      )}
    </div>
  );
}
