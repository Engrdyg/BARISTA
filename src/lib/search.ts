import MiniSearch from 'minisearch';
import { stripCloze } from './cloze';
import { db } from './db';
import { onChange } from './repo';
import type { CardRow, Digest, Law, Provision, Question, SyllabusNode, TableName } from './types';

export type DocType = 'provision' | 'digest' | 'card' | 'question' | 'node' | 'note';

export interface SearchDoc {
  id: string; // `${type}:${rowId}`
  type: DocType;
  rowId: string;
  subject_id: string | null;
  title: string;
  body: string;
  extra: string;
  /** Provisions: label number and law id. Digests: G.R. No. digits. */
  key?: string;
  lawId?: string;
}

const INDEXED: TableName[] = ['provisions', 'digests', 'cards', 'questions', 'syllabus_nodes', 'laws'];

let index: MiniSearch<SearchDoc> | null = null;
let ready: Promise<void> | null = null;
const lawsById = new Map<string, Law>();
const docs = new Map<string, SearchDoc>();

function make(): MiniSearch<SearchDoc> {
  return new MiniSearch<SearchDoc>({
    fields: ['title', 'body', 'extra'],
    storeFields: ['type', 'rowId', 'subject_id', 'title'],
    searchOptions: { boost: { title: 3, extra: 2 }, prefix: true, fuzzy: 0.15, combineWith: 'AND' },
  });
}

function docsFor(table: TableName, row: unknown): SearchDoc[] {
  const r = row as { id: string; deleted_at: string | null };
  if (r.deleted_at) return [];
  switch (table) {
    case 'provisions': {
      const p = row as Provision;
      const law = lawsById.get(p.law_id);
      return [
        {
          id: `provision:${p.id}`,
          type: 'provision',
          rowId: p.id,
          subject_id: law?.primary_subject_id ?? null,
          title: `${p.label}${law ? ` ${law.short_name}` : ''}`,
          body: p.text,
          extra: `${law?.short_name ?? ''} ${law?.title ?? ''} ${p.label.replace(/\./g, '')}`,
          key: p.label.match(/(?:Art|Sec)\.\s*([\w-]+)$/i)?.[1]?.toUpperCase(),
          lawId: p.law_id,
        },
        ...(p.notes
          ? [
              {
                id: `note:provision:${p.id}`,
                type: 'note' as const,
                rowId: p.id,
                subject_id: law?.primary_subject_id ?? null,
                title: `Note on ${p.label}${law ? ` ${law.short_name}` : ''}`,
                body: p.notes,
                extra: 'provision',
              },
            ]
          : []),
      ];
    }
    case 'digests': {
      const d = row as Digest;
      return [
        {
          id: `digest:${d.id}`,
          type: 'digest',
          rowId: d.id,
          subject_id: d.subject_id,
          title: d.title,
          body: [d.doctrine, d.facts, d.issues, d.ruling, d.notes].join('\n'),
          extra: `${d.gr_no} ${d.ponente}`,
          key: d.gr_no.replace(/[^\d]/g, ''),
        },
      ];
    }
    case 'cards': {
      const c = row as CardRow;
      return [
        {
          id: `card:${c.id}`,
          type: 'card',
          rowId: c.id,
          subject_id: c.subject_id,
          title: c.type === 'cloze' ? stripCloze(c.cloze_text).slice(0, 120) : c.front.slice(0, 120),
          body: c.type === 'cloze' ? stripCloze(c.cloze_text) : `${c.front}\n${c.back}`,
          extra: c.tags.join(' '),
        },
      ];
    }
    case 'questions': {
      const q = row as Question;
      return [
        {
          id: `question:${q.id}`,
          type: 'question',
          rowId: q.id,
          subject_id: q.subject_id,
          title: `${q.source_label}${q.number ? ` #${q.number}` : ''}`.trim() || 'Problem',
          body: q.text,
          extra: q.notes,
        },
      ];
    }
    case 'syllabus_nodes': {
      const n = row as SyllabusNode;
      const out: SearchDoc[] = [
        { id: `node:${n.id}`, type: 'node', rowId: n.id, subject_id: n.subject_id, title: `${n.marker} ${n.title}`, body: '', extra: '' },
      ];
      if (n.notes)
        out.push({
          id: `note:node:${n.id}`,
          type: 'note',
          rowId: n.id,
          subject_id: n.subject_id,
          title: `Note on ${n.title}`,
          body: n.notes,
          extra: 'syllabus',
        });
      return out;
    }
    default:
      return [];
  }
}

function upsert(table: TableName, rows: unknown[]) {
  if (!index) return;
  if (table === 'laws') {
    for (const l of rows as Law[]) lawsById.set(l.id, l);
    const ids = new Set((rows as Law[]).map((l) => l.id));
    void db.provisions
      .filter((p) => ids.has(p.law_id))
      .toArray()
      .then((ps) => upsert('provisions', ps));
    return;
  }
  for (const row of rows) {
    const r = row as { id: string };
    // Remove every doc this row produced before (including notes), then re-add.
    for (const prefix of [`${typeOf(table)}:`, `note:${typeOf(table)}:`]) {
      const key = prefix + r.id;
      if (docs.has(key)) {
        index.discard(key);
        docs.delete(key);
      }
    }
    for (const d of docsFor(table, row)) {
      index.add(d);
      docs.set(d.id, d);
    }
  }
}

function typeOf(table: TableName): string {
  return (
    { provisions: 'provision', digests: 'digest', cards: 'card', questions: 'question', syllabus_nodes: 'node' } as Record<
      string,
      string
    >
  )[table];
}

export function initSearch(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    index = make();
    for (const l of await db.laws.toArray()) lawsById.set(l.id, l);
    for (const t of INDEXED) {
      if (t === 'laws') continue;
      const rows = await db.t(t).toArray();
      const batch = rows.flatMap((r) => docsFor(t, r));
      for (const d of batch) docs.set(d.id, d);
      index.addAll(batch);
    }
    onChange((table, rows) => {
      if (INDEXED.includes(table)) upsert(table, rows);
    });
  })();
  return ready;
}

export interface Hit {
  id: string;
  type: DocType;
  rowId: string;
  subject_id: string | null;
  title: string;
  score: number;
  snippet: string;
}

const ART_RE = /^(?:art(?:icle)?\.?|sec(?:tion)?\.?)\s*(\d+[-\w]*)\s*([a-z]+)?$/i;
const NUM_LAW_RE = /^(\d+[-\w]*)\s+([a-z]{2,10})$/i;
const GR_RE = /^(?:g\.?\s*r\.?\s*(?:no\.?)?\s*)?(l-)?\d{4,6}(?:[-,\s&]+\d{4,6})*$/i;

function snippet(body: string, q: string): string {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = body.toLowerCase();
  let at = -1;
  for (const w of words) {
    at = lower.indexOf(w);
    if (at >= 0) break;
  }
  if (at < 0) return body.slice(0, 160);
  const start = Math.max(0, at - 60);
  return (start ? '…' : '') + body.slice(start, start + 180).replace(/\s+/g, ' ') + '…';
}

/** Shortcut lookups ("Art. 1156", "1156 NCC", a G.R. No.) before full-text search. */
export async function search(
  q: string,
  opts: { type?: DocType | null; subjectId?: string | null } = {},
): Promise<{ hits: Hit[]; exact: Hit | null }> {
  await initSearch();
  const query = q.trim();
  if (!query || !index) return { hits: [], exact: null };
  const pass = (d: { type: DocType; subject_id: string | null }) =>
    (!opts.type || d.type === opts.type) && (!opts.subjectId || d.subject_id === opts.subjectId);
  const toHit = (d: SearchDoc, score = 100): Hit => ({ ...d, score, snippet: d.body.slice(0, 180) });

  let exact: Hit | null = null;
  const shortcut: Hit[] = [];
  const art = ART_RE.exec(query);
  const numLaw = NUM_LAW_RE.exec(query);
  if (art || numLaw) {
    const num = (art ? art[1] : numLaw![1]).toUpperCase();
    const lawName = (art ? art[2] : numLaw![2])?.toUpperCase();
    for (const d of docs.values()) {
      if (d.type !== 'provision' || d.key !== num) continue;
      const law = d.lawId ? lawsById.get(d.lawId) : undefined;
      if (lawName && law?.short_name.toUpperCase() !== lawName) continue;
      shortcut.push(toHit(d));
    }
    if (lawName && shortcut.length === 1) exact = shortcut[0];
  }
  if (GR_RE.test(query.replace(/\s+/g, ' '))) {
    const digits = query.replace(/[^\d]/g, '');
    if (digits.length >= 4) {
      for (const d of docs.values()) if (d.type === 'digest' && d.key?.includes(digits)) shortcut.push(toHit(d));
    }
    if (shortcut.length === 1) exact = shortcut[0];
  }

  const results = index.search(query).slice(0, 200);
  const hits: Hit[] = shortcut.filter(pass);
  const seen = new Set(hits.map((h) => h.id));
  for (const r of results) {
    const d = docs.get(r.id);
    if (!d || seen.has(d.id) || !pass(d)) continue;
    hits.push({ ...d, score: r.score, snippet: snippet(d.body, query) });
    if (hits.length >= 100) break;
  }
  return { hits, exact: exact && pass(exact) ? exact : null };
}
