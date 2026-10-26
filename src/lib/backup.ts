import { db, TABLES } from './db';
import { getUserId } from './identity';
import { emitChange } from './repo';
import { nowIso, todayManila } from './time';
import type { TableName } from './types';

export interface BackupFile {
  app: 'barista';
  version: 1;
  exported_at: string;
  tables: Partial<Record<TableName, unknown[]>>;
}

export async function exportAll(): Promise<BackupFile> {
  const tables: BackupFile['tables'] = {};
  for (const t of TABLES) tables[t] = await db.t(t).toArray();
  return { app: 'barista', version: 1, exported_at: nowIso(), tables };
}

export async function isEmptyAccount(): Promise<boolean> {
  for (const t of ['syllabus_nodes', 'cards', 'digests', 'provisions', 'questions', 'study_sessions'] as TableName[]) {
    if ((await db.t(t).count()) > 0) return false;
  }
  return true;
}

/**
 * Restores a backup. Rows merge by id: a row replaces the local one only if it
 * is newer (or the local one doesn't exist). Everything restored is re-owned
 * by the current user and queued for sync.
 */
export async function importBackup(file: BackupFile): Promise<{ added: number; updated: number; skipped: number }> {
  if (file?.app !== 'barista' || !file.tables) throw new Error('This is not a BARISTA backup file.');
  const uid = getUserId();
  // Seeded rows (subjects, exam config, settings) have per-account ids; map the
  // backup's onto this account's by code or name so nothing is duplicated.
  const idMap = new Map<string, string>();
  const localSubjects = await db.subjects.toArray();
  for (const s of (file.tables.subjects ?? []) as { id: string; code: string }[]) {
    const m = localSubjects.find((l) => l.code === s.code && !l.deleted_at);
    if (m && m.id !== s.id) idMap.set(s.id, m.id);
  }
  const localExams = await db.exam_configs.toArray();
  for (const e of (file.tables.exam_configs ?? []) as { id: string; name: string }[]) {
    const m = localExams.find((l) => l.name === e.name);
    if (m && m.id !== e.id) idMap.set(e.id, m.id);
  }
  const localSettings = (await db.settings.toArray())[0];
  for (const st of (file.tables.settings ?? []) as { id: string }[]) {
    if (localSettings && localSettings.id !== st.id) idMap.set(st.id, localSettings.id);
  }
  const remap = (v: unknown) => (typeof v === 'string' && idMap.has(v) ? idMap.get(v) : v);
  let added = 0;
  let updated = 0;
  let skipped = 0;
  const now = nowIso();
  for (const t of TABLES) {
    if (t === 'profiles' || t === 'baon_notes') continue;
    const rows = (file.tables[t] ?? []) as Record<string, unknown>[];
    if (!rows.length) continue;
    const changed: Record<string, unknown>[] = [];
    await db.transaction('rw', db.t(t), db.outbox, async () => {
      for (const original of rows) {
        const r: Record<string, unknown> = { ...original };
        for (const k of Object.keys(r)) if (k === 'id' || k.endsWith('subject_id')) r[k] = remap(r[k]);
        const local = (await db.t(t).get(r.id as string)) as Record<string, unknown> | undefined;
        if (local && Date.parse(local.updated_at as string) >= Date.parse(r.updated_at as string)) {
          skipped++;
          continue;
        }
        const row: Record<string, unknown> = { ...r, user_id: uid };
        delete row.synced_at;
        // Imported rows must win LWW on the server too, so they carry a fresh timestamp.
        row.updated_at = now;
        await db.t(t).put(row as never);
        await db.outbox.add({ table: t, id: row.id as string, at: now });
        changed.push(row);
        if (local) updated++;
        else added++;
      }
    });
    if (changed.length) emitChange(t, changed);
  }
  return { added, updated, skipped };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
}

/** Parses CSV or TSV (quoted fields, embedded newlines). */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? (text.split('\n')[0].includes('\t') ? '\t' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === d) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Keeps the last 3 daily local snapshots. */
export async function dailySnapshot(): Promise<void> {
  const today = todayManila();
  if (await db.snapshots.get(today)) return;
  const data = JSON.stringify(await exportAll());
  await db.snapshots.put({ date: today, data });
  const all = await db.snapshots.orderBy('date').keys();
  const old = all.slice(0, Math.max(0, all.length - 3));
  if (old.length) await db.snapshots.bulkDelete(old as string[]);
}
