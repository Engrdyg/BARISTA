import Dexie, { type Table } from 'dexie';
import type { TableMap, TableName } from './types';

export interface OutboxEntry {
  seq?: number;
  table: TableName;
  id: string;
  at: string;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export interface Snapshot {
  date: string;
  data: string;
}

// Every synced table, in an order where parents come before children so a
// restore or first push never references a row that isn't there yet.
export const TABLES: TableName[] = [
  'profiles',
  'settings',
  'exam_configs',
  'subjects',
  'syllabus_nodes',
  'laws',
  'provisions',
  'highlights',
  'digests',
  'cards',
  'card_items',
  'review_logs',
  'questions',
  'attempts',
  'attempt_items',
  'mistakes',
  'study_sessions',
  'plans',
  'plan_blocks',
  'events',
  'node_links',
  'form_checklists',
  'baon_notes',
];

type Tables = { [K in TableName]: Table<TableMap[K], string> };

// Class/interface merge: gives db.cards, db.subjects, … their row types.
export interface BaristaDB extends Tables {}

export class BaristaDB extends Dexie {
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaEntry, string>;
  snapshots!: Table<Snapshot, string>;

  constructor(name = 'barista') {
    super(name);
    this.version(1).stores({
      profiles: 'id',
      settings: 'id',
      exam_configs: 'id',
      subjects: 'id, sort',
      syllabus_nodes: 'id, subject_id, parent_id',
      laws: 'id',
      provisions: 'id, law_id',
      highlights: 'id, provision_id',
      digests: 'id, subject_id, gr_no',
      cards: 'id, subject_id, source_id',
      card_items: 'id, card_id, due',
      review_logs: 'id, card_item_id, reviewed_at',
      questions: 'id, subject_id',
      attempts: 'id, status',
      attempt_items: 'id, attempt_id, question_id',
      mistakes: 'id, subject_id, node_id',
      study_sessions: 'id, started_at',
      plans: 'id',
      plan_blocks: 'id, plan_id, date',
      events: 'id, starts_at',
      node_links: 'id, node_id, target_id',
      form_checklists: 'id',
      baon_notes: 'id, show_on',
      outbox: '++seq, [table+id]',
      meta: 'key',
      snapshots: 'date',
    });
  }

  t<K extends TableName>(name: K): Table<TableMap[K], string> {
    return (this as unknown as Tables)[name];
  }
}

export const db = new BaristaDB();

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
