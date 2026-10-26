import { useState } from 'react';
import { Plus, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSubjectFilter } from '../lib/subjectFilter';
import { useSearchParams } from 'react-router-dom';
import CardEditor, { type CardDraft } from '../components/CardEditor';
import { NodeSelect } from '../components/TimerDialog';
import { Empty, Field, Markdown, Modal, PageHeader, Section, SubjectChips, SubjectSelect, SubjectTag } from '../components/ui';
import { db } from '../lib/db';
import { useLive, useSettings, useSubjects } from '../lib/hooks';
import { makeRow, patch, putRow, softDelete } from '../lib/repo';
import { manilaDate, shortDate } from '../lib/time';
import type { Mistake } from '../lib/types';
import { nodeTag, weakSpots } from '../lib/weak';

function MistakeEditor({ m: initial, onClose }: { m: Mistake; onClose: () => void }) {
  const subjects = useSubjects();
  const settings = useSettings();
  const [m, setM] = useState(initial);
  const set = <K extends keyof Mistake>(k: K, v: Mistake[K]) => setM((x) => ({ ...x, [k]: v }));
  return (
    <Modal open onClose={onClose} title={initial.what_went_wrong ? 'Edit mistake' : 'New mistake'}>
      <div className="space-y-3">
        <Field label="What went wrong" htmlFor="m-what">
          <textarea id="m-what" className="textarea" value={m.what_went_wrong} onChange={(e) => set('what_went_wrong', e.target.value)} />
        </Field>
        <Field label="Correct rule" htmlFor="m-rule">
          <textarea id="m-rule" className="textarea reading" value={m.correct_rule} onChange={(e) => set('correct_rule', e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Subject">
            <SubjectSelect subjects={subjects} value={m.subject_id} onChange={(v) => set('subject_id', v)} />
          </Field>
          <Field label="Syllabus item">
            <NodeSelect subjectId={m.subject_id} value={m.node_id} onChange={(v) => set('node_id', v)} />
          </Field>
          <Field label="Error type" htmlFor="m-type">
            <select id="m-type" className="select" value={m.error_type} onChange={(e) => set('error_type', e.target.value)}>
              <option value="">—</option>
              {[...new Set([...settings.errorTags, m.error_type].filter(Boolean))].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Status" htmlFor="m-status">
            <select id="m-status" className="select" value={m.status} onChange={(e) => set('status', e.target.value as Mistake['status'])}>
              <option value="open">Open</option>
              <option value="fixed">Fixed</option>
            </select>
          </Field>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={!m.what_went_wrong.trim()} onClick={async () => { await putRow('mistakes', m); onClose(); }}>
            Save
          </button>
          {initial.what_went_wrong && (
            <button className="btn btn-danger ml-auto" onClick={async () => { await softDelete('mistakes', m.id); onClose(); }}>
              Delete
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function Mistakes() {
  const subjects = useSubjects();
  const [params, setParams] = useSearchParams();
  const nodeFilter = params.get('node');
  const [subject, setSubject] = useSubjectFilter();
  const [status, setStatus] = useState<'open' | 'fixed' | 'all'>('open');
  const [editing, setEditing] = useState<Mistake | null>(null);
  const [card, setCard] = useState<{ draft: CardDraft; mistake: Mistake } | null>(null);
  const data = useLive(async () => {
    const ms = (await db.mistakes.toArray()).filter((m) => !m.deleted_at).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const nodes = new Map((await db.syllabus_nodes.toArray()).map((n) => [n.id, n]));
    return { ms, nodes, spots: await weakSpots(8) };
  });
  if (!data) return <p className="text-muted">Loading…</p>;
  const list = data.ms
    .filter((m) => status === 'all' || m.status === status)
    .filter((m) => !subject || m.subject_id === subject)
    .filter((m) => !nodeFilter || m.node_id === nodeFilter);
  const blank = () =>
    makeRow('mistakes', {
      subject_id: subject,
      node_id: nodeFilter,
      source_type: 'manual',
      source_id: null,
      what_went_wrong: '',
      correct_rule: '',
      error_type: '',
      status: 'open',
      card_id: null,
    });

  return (
    <div className="space-y-4">
      <PageHeader
        icon={TriangleAlert}
        title="Mistake review"
        subtitle={`${data.ms.filter((m) => m.status === 'open').length} open`}
        actions={
          <button className="btn btn-primary" onClick={() => setEditing(blank())}>
            <Plus /> Add mistake
          </button>
        }
      />
      {data.spots.length > 0 && (
        <Section title="Weak spots">
          <ol className="space-y-1.5 text-sm">
            {data.spots.map((s) => (
              <li key={s.node.id} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0">
                  <SubjectTag subject={subjects.find((x) => x.id === s.node.subject_id)} /> {s.node.title}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {[s.openMistakes && `${s.openMistakes} open`, s.lowScores && `${s.lowScores} low scores`, s.lapses && `${s.lapses} lapses`, s.node.needs_work && 'needs work'].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      )}
      <SubjectChips subjects={subjects} value={subject} onChange={setSubject} />
      {nodeFilter && (
        <p className="text-sm">
          Linked to <strong>{data.nodes.get(nodeFilter)?.title}</strong>{' '}
          <button className="underline" onClick={() => setParams({})}>
            Clear
          </button>
        </p>
      )}
      <div className="flex gap-2">
        {(['open', 'fixed', 'all'] as const).map((s) => (
          <button key={s} className={`btn btn-sm ${status === s ? 'btn-primary' : ''}`} onClick={() => setStatus(s)}>
            {s === 'open' ? 'Open' : s === 'fixed' ? 'Fixed' : 'All'}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        data.ms.length ? (
          <Empty icon={TriangleAlert} title="Nothing here" compact>
            No mistakes match this filter.
          </Empty>
        ) : (
          <Empty
            icon={TriangleAlert}
            title="No mistakes logged"
            actions={
              <Link to="/practice" className="btn btn-primary">
                Start a drill
              </Link>
            }
          >
            Every rule you miss is a point you can win back. After grading a problem, use Add to mistake log, and fix it here before the Bar.
          </Empty>
        )
      ) : (
        <ul className="space-y-2">
          {list.map((m) => (
            <li key={m.id} className={`panel p-3 ${m.status === 'fixed' ? 'opacity-70' : ''}`}>
              <div className="flex items-start gap-2">
                <SubjectTag subject={subjects.find((s) => s.id === m.subject_id)} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{m.what_went_wrong}</p>
                  {m.correct_rule && <Markdown className="reading mt-1 text-base">{m.correct_rule}</Markdown>}
                  <p className="mt-1 text-xs text-muted">
                    {[m.error_type, m.node_id && data.nodes.get(m.node_id)?.title, shortDate(manilaDate(m.created_at)), m.source_type !== 'manual' && `from ${m.source_type}`].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn btn-sm" onClick={() => void patch('mistakes', m.id, { status: m.status === 'open' ? 'fixed' : 'open' })}>
                  {m.status === 'open' ? 'Mark fixed' : 'Reopen'}
                </button>
                {!m.card_id && (
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      setCard({
                        mistake: m,
                        draft: {
                          type: 'basic',
                          front: m.what_went_wrong,
                          back: m.correct_rule,
                          subject_id: m.subject_id,
                          source_type: 'mistake',
                          source_id: m.id,
                          tags: m.node_id ? [nodeTag(m.node_id)] : [],
                        },
                      })
                    }
                  >
                    Make card
                  </button>
                )}
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(m)}>
                  Edit
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <MistakeEditor m={editing} onClose={() => setEditing(null)} />}
      <CardEditor
        open={!!card}
        draft={card?.draft}
        onClose={() => setCard(null)}
        onSaved={(c) => card && void patch('mistakes', card.mistake.id, { card_id: c.id })}
      />
    </div>
  );
}
