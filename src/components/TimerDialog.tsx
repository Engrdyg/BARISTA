import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { useLive, useSubjects } from '../lib/hooks';
import { outlineOrder } from '../lib/planner';
import { startTimer } from '../lib/timer';
import type { SessionKind } from '../lib/types';
import { Field, Modal, SubjectSelect } from './ui';

export const KINDS: { value: SessionKind; label: string }[] = [
  { value: 'reading', label: 'Reading' },
  { value: 'cards', label: 'Cards' },
  { value: 'practice', label: 'Practice' },
  { value: 'lecture', label: 'Lecture' },
  { value: 'other', label: 'Other' },
];

export function NodeSelect({
  subjectId,
  value,
  onChange,
  id,
}: {
  subjectId: string | null;
  value: string | null;
  onChange: (id: string | null) => void;
  id?: string;
}) {
  const nodes = useLive(
    async () =>
      subjectId
        ? outlineOrder((await db.syllabus_nodes.where('subject_id').equals(subjectId).toArray()).filter((n) => !n.deleted_at))
        : [],
    [subjectId],
  );
  return (
    <select id={id} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">No syllabus item</option>
      {(nodes ?? []).map((n) => {
        const depth = depthOf(n.id, nodes ?? []);
        return (
          <option key={n.id} value={n.id}>
            {'  '.repeat(depth)}
            {n.marker} {n.title.slice(0, 80)}
          </option>
        );
      })}
    </select>
  );
}

function depthOf(id: string, nodes: { id: string; parent_id: string | null }[]): number {
  let d = 0;
  let cur = nodes.find((n) => n.id === id);
  while (cur?.parent_id && d < 12) {
    d++;
    const pid = cur.parent_id;
    cur = nodes.find((n) => n.id === pid);
  }
  return d;
}

export default function TimerDialog({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: { subjectId?: string | null; nodeId?: string | null; kind?: SessionKind };
}) {
  const subjects = useSubjects();
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [kind, setKind] = useState<SessionKind>('reading');
  useEffect(() => {
    if (!open) return;
    setSubjectId(initial?.subjectId ?? null);
    setNodeId(initial?.nodeId ?? null);
    setKind(initial?.kind ?? 'reading');
  }, [open, initial?.subjectId, initial?.nodeId, initial?.kind]);

  return (
    <Modal open={open} onClose={onClose} title="Start timer">
      <div className="space-y-3">
        <Field label="Subject" htmlFor="t-subject">
          <SubjectSelect
            id="t-subject"
            subjects={subjects}
            value={subjectId}
            onChange={(v) => {
              setSubjectId(v);
              setNodeId(null);
            }}
          />
        </Field>
        <Field label="Syllabus item" htmlFor="t-node">
          <NodeSelect id="t-node" subjectId={subjectId} value={nodeId} onChange={setNodeId} />
        </Field>
        <Field label="Kind" htmlFor="t-kind">
          <select id="t-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as SessionKind)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <button
          className="btn btn-primary w-full"
          onClick={async () => {
            await startTimer({ subject_id: subjectId, node_id: nodeId, kind });
            onClose();
          }}
        >
          Start
        </button>
      </div>
    </Modal>
  );
}
