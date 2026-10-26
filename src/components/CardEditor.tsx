import { useEffect, useState } from 'react';
import { clozeIndices, renderCloze } from '../lib/cloze';
import { db } from '../lib/db';
import { useSubjects } from '../lib/hooks';
import { softDelete } from '../lib/repo';
import { newCard, saveCard, syncItems } from '../lib/srs';
import type { CardRow, CardType, SourceType } from '../lib/types';
import { nodeIdsFromTags, nodeTag } from '../lib/weak';
import { NodeSelect } from './TimerDialog';
import { Field, Markdown, Modal, SubjectSelect } from './ui';

export interface CardDraft {
  type?: CardType;
  front?: string;
  back?: string;
  cloze_text?: string;
  subject_id?: string | null;
  source_type?: SourceType | null;
  source_id?: string | null;
  tags?: string[];
}

export default function CardEditor({
  open,
  onClose,
  card,
  draft,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  card?: CardRow | null;
  draft?: CardDraft;
  onSaved?: (c: CardRow) => void;
}) {
  const subjects = useSubjects();
  const [c, setC] = useState<CardRow>(() => newCard({}));
  const [tagText, setTagText] = useState('');
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!open) return;
    const base = card ?? newCard({ ...draft, type: draft?.type ?? (draft?.cloze_text ? 'cloze' : 'basic') });
    setC(base);
    setTagText(base.tags.filter((t) => !t.startsWith('node:')).join(', '));
    setNodeId(nodeIdsFromTags(base.tags)[0] ?? null);
    setPreview(false);
    // Reset only when the dialog opens or switches card, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, card?.id]);

  const clozes = c.type === 'cloze' ? clozeIndices(c.cloze_text) : [];
  const valid = c.type === 'basic' ? c.front.trim() && c.back.trim() : clozes.length > 0;

  async function save() {
    const free = tagText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const others = c.tags.filter((t) => t.startsWith('node:') && nodeIdsFromTags([t])[0] !== nodeIdsFromTags(c.tags)[0]);
    const tags = [...new Set([...free, ...others, ...(nodeId ? [nodeTag(nodeId)] : [])])];
    const saved = await saveCard({ ...c, tags });
    onSaved?.(saved);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={card ? 'Edit card' : 'New card'} wide>
      <div className="space-y-3">
        <div className="flex gap-2" role="radiogroup" aria-label="Card type">
          {(['basic', 'cloze'] as CardType[]).map((t) => (
            <button key={t} role="radio" aria-checked={c.type === t} className={`btn btn-sm ${c.type === t ? 'btn-primary' : ''}`} onClick={() => setC({ ...c, type: t })}>
              {t === 'basic' ? 'Basic' : 'Cloze'}
            </button>
          ))}
          <button className="btn btn-sm btn-ghost ml-auto" onClick={() => setPreview(!preview)}>
            {preview ? 'Edit' : 'Preview'}
          </button>
        </div>
        {preview ? (
          <div className="space-y-3">
            {c.type === 'basic' ? (
              <>
                <div className="panel reading p-3">
                  <Markdown>{c.front || '_Front_'}</Markdown>
                </div>
                <div className="panel reading p-3">
                  <Markdown>{c.back || '_Back_'}</Markdown>
                </div>
              </>
            ) : (
              clozes.map((i) => (
                <div key={i} className="panel reading p-3">
                  <p className="mb-1 text-xs text-muted">Item c{i}</p>
                  <Markdown>{renderCloze(c.cloze_text, i, 'front')}</Markdown>
                </div>
              ))
            )}
          </div>
        ) : c.type === 'basic' ? (
          <>
            <Field label="Front" htmlFor="ce-front">
              <textarea id="ce-front" className="textarea reading" value={c.front} onChange={(e) => setC({ ...c, front: e.target.value })} />
            </Field>
            <Field label="Back" htmlFor="ce-back">
              <textarea id="ce-back" className="textarea reading" value={c.back} onChange={(e) => setC({ ...c, back: e.target.value })} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Text with cloze deletions" htmlFor="ce-cloze">
              <textarea id="ce-cloze" className="textarea reading min-h-[8rem]" value={c.cloze_text} onChange={(e) => setC({ ...c, cloze_text: e.target.value })} />
            </Field>
            <p className="text-xs text-muted">
              Write {'{{c1::answer}}'} or {'{{c1::answer::hint}}'}. Each number is reviewed separately. {clozes.length} items.
            </p>
            <Field label="Extra on the back (optional)" htmlFor="ce-extra">
              <textarea id="ce-extra" className="textarea" value={c.back} onChange={(e) => setC({ ...c, back: e.target.value })} />
            </Field>
          </>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Subject" htmlFor="ce-subject">
            <SubjectSelect id="ce-subject" subjects={subjects} value={c.subject_id} onChange={(v) => setC({ ...c, subject_id: v })} />
          </Field>
          <Field label="Syllabus item" htmlFor="ce-node">
            <NodeSelect id="ce-node" subjectId={c.subject_id} value={nodeId} onChange={setNodeId} />
          </Field>
        </div>
        <Field label="Tags (comma separated)" htmlFor="ce-tags">
          <input id="ce-tags" className="input" value={tagText} onChange={(e) => setTagText(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" disabled={!valid} onClick={() => void save()}>
            Save card
          </button>
          {card && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={c.suspended} onChange={(e) => setC({ ...c, suspended: e.target.checked })} /> Suspended
              </label>
              <button
                className="btn btn-danger ml-auto"
                onClick={async () => {
                  await softDelete('cards', card.id);
                  const fresh = await db.cards.get(card.id);
                  if (fresh) await syncItems(fresh);
                  onClose();
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
