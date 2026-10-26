import { db } from './db';
import { getUserId, uuid } from './identity';
import { nowIso } from './time';
import type { BaseRow, TableMap, TableName } from './types';

type Listener = (table: TableName, rows: unknown[], remote: boolean) => void;
const listeners = new Set<Listener>();

/** Called after any local write or pulled change; search and sync listen here. */
export function onChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitChange(table: TableName, rows: unknown[], remote = false): void {
  for (const fn of listeners) fn(table, rows, remote);
}

type Fields<K extends TableName> = Omit<TableMap[K], keyof BaseRow> & Partial<BaseRow>;

/** Builds a row with id, owner and timestamps filled in. Does not save it. */
export function makeRow<K extends TableName>(_table: K, fields: Fields<K>): TableMap[K] {
  const now = nowIso();
  return {
    id: uuid(),
    user_id: getUserId(),
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ...fields,
  } as unknown as TableMap[K];
}

/** Saves rows locally and queues them for sync. */
export async function putRows<K extends TableName>(
  table: K,
  rows: TableMap[K][],
  opts: { keepTimestamps?: boolean } = {},
): Promise<void> {
  if (!rows.length) return;
  const now = nowIso();
  const stamped = opts.keepTimestamps ? rows : rows.map((r) => ({ ...r, updated_at: now }));
  await db.transaction('rw', db.t(table), db.outbox, async () => {
    await db.t(table).bulkPut(stamped as never[]);
    await db.outbox.bulkAdd(stamped.map((r) => ({ table, id: (r as { id: string }).id, at: now })));
  });
  emitChange(table, stamped);
}

export async function putRow<K extends TableName>(table: K, row: TableMap[K]): Promise<TableMap[K]> {
  await putRows(table, [row]);
  return (await db.t(table).get((row as { id: string }).id)) as TableMap[K];
}

export async function create<K extends TableName>(table: K, fields: Fields<K>): Promise<TableMap[K]> {
  return putRow(table, makeRow(table, fields));
}

/** Merges changes into a row. Read and write happen in one transaction, so concurrent patches never clobber each other. */
export async function patch<K extends TableName>(
  table: K,
  id: string,
  changes: Partial<TableMap[K]>,
): Promise<TableMap[K] | undefined> {
  let out: TableMap[K] | undefined;
  const now = nowIso();
  await db.transaction('rw', db.t(table), db.outbox, async () => {
    const row = await db.t(table).get(id);
    if (!row) return;
    out = { ...row, ...changes, updated_at: now } as TableMap[K];
    await db.t(table).put(out as never);
    await db.outbox.add({ table, id, at: now });
  });
  if (out) emitChange(table, [out]);
  return out;
}

export async function softDelete(table: TableName, ids: string | string[]): Promise<void> {
  const list = Array.isArray(ids) ? ids : [ids];
  const rows = (await db.t(table).bulkGet(list)).filter(Boolean) as { deleted_at: string | null }[];
  const now = nowIso();
  await putRows(
    table,
    rows.map((r) => ({ ...r, deleted_at: now })) as never[],
  );
}

/** Live (not soft-deleted) rows of a table. */
export async function alive<K extends TableName>(table: K): Promise<TableMap[K][]> {
  return db.t(table).filter((r) => !(r as { deleted_at: string | null }).deleted_at).toArray();
}

export async function aliveWhere<K extends TableName>(
  table: K,
  index: string,
  value: string | number,
): Promise<TableMap[K][]> {
  return db
    .t(table)
    .where(index)
    .equals(value)
    .filter((r) => !(r as { deleted_at: string | null }).deleted_at)
    .toArray();
}

export async function getAlive<K extends TableName>(table: K, id: string | undefined | null) {
  if (!id) return undefined;
  const row = await db.t(table).get(id);
  return row && !(row as { deleted_at: string | null }).deleted_at ? row : undefined;
}
