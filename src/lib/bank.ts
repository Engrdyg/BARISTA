import { db, getMeta, setMeta } from './db';
import { getUserId, stableId } from './identity';
import { emitChange } from './repo';
import type { Question, QuestionType } from './types';

/**
 * The built-in bank of past Bar questions (and suggested answers) ships with the
 * app under /bar. It is installed into the local database on every device and is
 * never uploaded: only the user's own attempts and edits sync.
 */

type BankIndex = { version: string; years: Record<string, { count: number }> };
type BankItem = { s: string; n: string; type: string; t: string; a: string; f: string; notes: string };

const BUILTIN_TIME = '2000-01-01T00:00:00.000Z';
const key = (q: Pick<Question, 'subject_id' | 'source_label' | 'number'>) =>
  `${q.subject_id}|${q.source_label.trim().toLowerCase()}|${q.number.trim()}`;

let running: Promise<void> | null = null;

/** Installs or refreshes the built-in bank when it is missing or out of date. Safe to call often. */
export function installBank(): Promise<void> {
  running ??= doInstall()
    .catch(() => {}) // offline or not deployed yet; try again next launch
    .finally(() => {
      running = null;
    });
  return running;
}

async function doInstall(): Promise<void> {
  const res = await fetch(`${import.meta.env.BASE_URL}bar/index.json`, { cache: 'no-cache' });
  if (!res.ok) return;
  const index = (await res.json()) as BankIndex;
  const expected = Object.values(index.years).reduce((n, y) => n + y.count, 0);
  const have = await db.questions.filter((q) => !!q.builtin).count();
  if ((await getMeta<string | null>('bank:version', null)) === index.version && have === expected) return;

  const uid = getUserId();
  const subjects = new Map((await db.subjects.toArray()).filter((s) => !s.deleted_at).map((s) => [s.code, s.id]));
  const rows: Question[] = [];
  for (const year of Object.keys(index.years)) {
    const r = await fetch(`${import.meta.env.BASE_URL}bar/${year}.json?v=${index.version}`);
    if (!r.ok) return;
    for (const it of (await r.json()) as BankItem[]) {
      rows.push({
        id: await stableId('bar-bank', year, it.s, it.n),
        user_id: uid,
        created_at: BUILTIN_TIME,
        updated_at: BUILTIN_TIME,
        deleted_at: null,
        subject_id: subjects.get(it.s) ?? null,
        type: (it.type === 'practical' ? 'practical' : 'essay') as QuestionType,
        source_label: `${year} Bar`,
        year: Number(year),
        number: it.n,
        text: it.t,
        points: 5,
        reference_answer: it.a,
        form_type: it.f,
        notes: it.notes,
        builtin: true,
      });
    }
  }
  if (rows.length !== expected) return;

  const bankKeys = new Set(rows.map(key));
  const used = new Set((await db.attempt_items.toArray()).map((i) => i.question_id));
  await db.transaction('rw', db.questions, db.outbox, async () => {
    await db.questions.bulkPut(rows);
    // Copies the user imported earlier are now redundant. Ones never uploaded and
    // never practised are simply removed; uploaded ones are soft-deleted so other
    // devices drop them too. Copies with attempts stay, so their history is kept.
    for (const q of await db.questions.toArray()) {
      if (q.builtin || q.deleted_at || used.has(q.id) || !bankKeys.has(key(q))) continue;
      if (!(q as Question & { synced_at?: string }).synced_at) {
        await db.questions.delete(q.id);
        await db.outbox.where('[table+id]').equals(['questions', q.id]).delete();
      } else {
        const now = new Date().toISOString();
        await db.questions.put({ ...q, deleted_at: now, updated_at: now });
        await db.outbox.add({ table: 'questions', id: q.id, at: now });
      }
    }
  });
  await setMeta('bank:version', index.version);
  emitChange('questions', rows);
}

/** Merges a user's copy of a bank question with the built-in one, preferring the user's copy. */
export function dedupeBank(questions: Question[]): Question[] {
  const mine = new Map<string, Question>();
  const bankByKey = new Map<string, Question>();
  for (const q of questions) (q.builtin ? bankByKey : mine).set(key(q), q);
  const out: Question[] = [];
  for (const q of questions) {
    if (!q.builtin) {
      const bank = bankByKey.get(key(q));
      out.push(bank && !q.reference_answer ? { ...q, reference_answer: bank.reference_answer, notes: q.notes || bank.notes } : q);
    } else if (!mine.has(key(q))) out.push(q);
  }
  return out;
}
