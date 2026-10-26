import { db } from './db';
import { uuid } from './identity';
import { planMerge, type FlatNode } from './parsers/syllabus';
import { makeRow, putRows } from './repo';
import type { NodeStatus, SyllabusNode } from './types';

export const STATUSES: { value: NodeStatus; label: string }[] = [
  { value: 'not_started', label: 'Not started' },
  { value: 'read_once', label: 'Read once' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'confident', label: 'Confident' },
];

export function nextStatus(s: NodeStatus): NodeStatus {
  const i = STATUSES.findIndex((x) => x.value === s);
  return STATUSES[(i + 1) % STATUSES.length].value;
}

export async function subjectNodes(subjectId: string): Promise<SyllabusNode[]> {
  return (await db.syllabus_nodes.where('subject_id').equals(subjectId).toArray()).filter((n) => !n.deleted_at);
}

/**
 * Saves an imported outline. Matching nodes keep their ids, status, notes and
 * links; nodes that no longer appear move to the Unmatched list. Nothing is
 * written when nothing changed.
 */
export async function saveImport(subjectId: string, flat: FlatNode[]): Promise<{ created: number; updated: number; unmatched: number }> {
  const existing = await subjectNodes(subjectId);
  const plan = planMerge(existing, flat);
  const byId = new Map(existing.map((e) => [e.id, e]));
  const ids = plan.nodes.map((n) => n.id ?? uuid());
  const rows: SyllabusNode[] = [];
  let created = 0;
  let updated = 0;
  plan.nodes.forEach((n, i) => {
    const parent_id = n.parent === null ? null : ids[n.parent];
    if (n.id) {
      const e = byId.get(n.id)!;
      if (plan.changed.has(n.id) || plan.rematched.includes(n.id) || e.parent_id !== parent_id) {
        rows.push({ ...e, parent_id, marker: n.marker, title: n.title, sort: n.sort, depth: n.depth, unmatched: false });
        updated++;
      }
    } else {
      rows.push(
        makeRow('syllabus_nodes', {
          id: ids[i],
          subject_id: subjectId,
          parent_id,
          marker: n.marker,
          title: n.title,
          sort: n.sort,
          depth: n.depth,
          status: 'not_started',
          needs_work: false,
          notes: '',
          starred: false,
          last_studied_at: null,
          times_studied: 0,
          unmatched: false,
        }),
      );
      created++;
    }
  });
  for (const id of plan.unmatched) rows.push({ ...byId.get(id)!, unmatched: true });
  await putRows('syllabus_nodes', rows);
  return { created, updated, unmatched: plan.unmatched.length };
}
