import { db, getMeta, setMeta, TABLES } from './db';
import { getRole, getUserId } from './identity';
import { emitChange, onChange } from './repo';
import { createStore } from './store';
import { supabase } from './supabase';
import type { TableName } from './types';

export type SyncState = 'local' | 'synced' | 'syncing' | 'offline' | 'error' | 'signed_out';

export const syncStatus = createStore<{
  state: SyncState;
  pending: number;
  /** Rows the server rejected; they stay on this device until retried. */
  parked: number;
  error: string | null;
  lastSyncAt: string | null;
}>({ state: 'local', pending: 0, parked: 0, error: null, lastSyncAt: null });

const PAGE = 500;
// Rows go up in small requests so a large import never hits request-size or
// statement-time limits.
const CHUNK = 50;

type Parked = { table: TableName; id: string; error: string };
// Pull re-reads a few seconds before the cursor so rows committed slightly out
// of order are never skipped; re-applying a row is harmless.
const OVERLAP_MS = 5000;

function tablesForRole(): TableName[] {
  return getRole() === 'supporter' ? ['profiles', 'baon_notes'] : TABLES;
}

let signedIn = false;
let running: Promise<void> | null = null;
let again = false;

export function setSignedIn(v: boolean) {
  signedIn = v;
  void refreshPending();
}

async function refreshPending() {
  const pending = await db.outbox.count();
  const parked = (await getMeta<Parked[]>('sync:parked', [])).length;
  syncStatus.set((s) => ({
    ...s,
    pending,
    parked,
    state: !supabase ? 'local' : !signedIn ? 'signed_out' : s.state,
  }));
}

function stripLocal(row: Record<string, unknown>) {
  const { synced_at: _s, ...rest } = row;
  return rest;
}

/** Errors tied to particular rows; anything else (network, auth, permissions) fails the whole run. */
function isRowError(e: { code?: string; message: string }): boolean {
  const code = e.code ?? '';
  return code.startsWith('22') || code.startsWith('23') || code === '57014' || code === '54000' || /too large|timeout/i.test(e.message);
}

type UpsertError = { code?: string; message: string } | null;

/**
 * Sends rows in chunks. When a chunk is rejected for a row-level reason, halves it
 * until the offending rows are isolated and reports each through `onRejected`.
 */
export async function upsertInChunks<R extends { id: string }>(
  rows: R[],
  upsert: (rows: R[]) => Promise<UpsertError>,
  onRejected: (row: R, message: string) => void,
  chunk = CHUNK,
): Promise<void> {
  const send = async (part: R[]): Promise<void> => {
    const error = await upsert(part);
    if (!error) return;
    if (!isRowError(error)) throw new Error(error.message);
    if (part.length === 1) return onRejected(part[0], error.message);
    const mid = part.length >> 1;
    await send(part.slice(0, mid));
    await send(part.slice(mid));
  };
  for (let i = 0; i < rows.length; i += chunk) await send(rows.slice(i, i + chunk));
}

async function upsertRows(table: TableName, rows: Record<string, unknown>[], parked: Parked[]): Promise<void> {
  try {
    await upsertInChunks(
      rows as (Record<string, unknown> & { id: string })[],
      async (part) => (await supabase!.from(table).upsert(part, { onConflict: 'id' })).error,
      (row, error) => parked.push({ table, id: row.id, error }),
    );
  } catch (e) {
    throw new Error(`${table}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Puts rows the server rejected back in the outbox for another try. */
export async function retryParked(): Promise<void> {
  const parked = await getMeta<Parked[]>('sync:parked', []);
  const at = new Date().toISOString();
  await db.outbox.bulkAdd(parked.map((p) => ({ table: p.table, id: p.id, at })));
  await setMeta('sync:parked', []);
  await syncNow();
}

async function push(): Promise<void> {
  if (!supabase) return;
  for (;;) {
    const batch = await db.outbox.orderBy('seq').limit(PAGE).toArray();
    if (!batch.length) return;
    const maxSeq = batch[batch.length - 1].seq!;
    const byTable = new Map<TableName, Set<string>>();
    for (const e of batch) {
      if (!byTable.has(e.table)) byTable.set(e.table, new Set());
      byTable.get(e.table)!.add(e.id);
    }
    const uid = getUserId();
    const parked: Parked[] = [];
    for (const table of TABLES) {
      const ids = byTable.get(table);
      if (!ids) continue;
      if (table === 'profiles') continue; // profiles are edited with direct updates
      const rows = (await db.t(table).bulkGet([...ids])).filter(Boolean) as unknown as Record<string, unknown>[];
      if (!rows.length) continue;
      if (table === 'baon_notes') {
        const mine = rows.filter((r) => r.author_id === uid);
        const toMe = rows.filter((r) => r.author_id !== uid && r.recipient_id === uid);
        if (mine.length) {
          const { error } = await supabase.from(table).upsert(mine.map(stripLocal), { onConflict: 'id' });
          if (error) throw new Error(`${table}: ${error.message}`);
        }
        for (const r of toMe) {
          const { error } = await supabase
            .from(table)
            .update({ seen_at: r.seen_at, archived: r.archived, updated_at: r.updated_at })
            .eq('id', r.id as string);
          if (error) throw new Error(`${table}: ${error.message}`);
        }
        continue;
      }
      const clean = rows.filter((r) => r.user_id === uid).map(stripLocal);
      if (!clean.length) continue;
      await upsertRows(table, clean, parked);
    }
    if (parked.length) await setMeta('sync:parked', [...(await getMeta<Parked[]>('sync:parked', [])), ...parked]);
    await db.outbox.where('seq').belowOrEqual(maxSeq).delete();
    await refreshPending();
  }
}

async function pull(): Promise<void> {
  if (!supabase) return;
  for (const table of tablesForRole()) {
    const key = `pull:${table}`;
    let cursor = await getMeta<string>(key, '1970-01-01T00:00:00Z');
    let since = new Date(Date.parse(cursor) - OVERLAP_MS).toISOString();
    for (;;) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .gt('synced_at', since)
        .order('synced_at', { ascending: true })
        .limit(PAGE);
      if (error) throw new Error(`${table}: ${error.message}`);
      if (!data?.length) break;
      const changed: unknown[] = [];
      await db.transaction('rw', db.t(table), db.outbox, async () => {
        for (const remote of data as Record<string, unknown>[]) {
          const local = (await db.t(table).get(remote.id as string)) as Record<string, unknown> | undefined;
          if (local) {
            const localTime = Date.parse(local.updated_at as string);
            const remoteTime = Date.parse(remote.updated_at as string);
            if (localTime > remoteTime) continue; // ours is newer; it is (or was) in the outbox
            if (localTime === remoteTime && local.synced_at === remote.synced_at) continue;
          }
          await db.t(table).put(remote as never);
          changed.push(remote);
        }
      });
      if (changed.length) emitChange(table, changed, true);
      const last = (data[data.length - 1] as { synced_at: string }).synced_at;
      since = last;
      if (Date.parse(last) > Date.parse(cursor)) {
        cursor = last;
        await setMeta(key, cursor);
      }
      if (data.length < PAGE) break;
    }
  }
}

/** Push the outbox, then pull changes. Safe to call often; runs are serialized. */
export function syncNow(): Promise<void> {
  if (!supabase || !signedIn) {
    void refreshPending();
    return Promise.resolve();
  }
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      syncStatus.set((s) => ({ ...s, state: 'offline' }));
      return;
    }
    syncStatus.set((s) => ({ ...s, state: 'syncing' }));
    try {
      await push();
      await pull();
      const parked = await getMeta<Parked[]>('sync:parked', []);
      syncStatus.set((s) => ({
        ...s,
        state: 'synced',
        error: parked.length ? `${parked.length} item(s) were not accepted by the server: ${parked[0].table}: ${parked[0].error}` : null,
        lastSyncAt: new Date().toISOString(),
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      syncStatus.set((s) => ({ ...s, state: offline ? 'offline' : 'error', error: offline ? null : msg }));
    } finally {
      await refreshPending();
    }
  })().finally(() => {
    running = null;
    if (again) {
      again = false;
      void syncNow();
    }
  });
  return running;
}

let started = false;
let pushTimer: ReturnType<typeof setTimeout> | undefined;

/** Start the sync worker: on start, online, focus, every 60 s, and soon after local writes. */
export function startSync(): void {
  if (started) return;
  started = true;
  void refreshPending();
  window.addEventListener('online', () => void syncNow());
  window.addEventListener('offline', () => syncStatus.set((s) => ({ ...s, state: 'offline' })));
  window.addEventListener('focus', () => void syncNow());
  setInterval(() => void syncNow(), 60_000);
  onChange((_table, _rows, remote) => {
    if (remote) return;
    void refreshPending();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void syncNow(), 2000);
  });
  void syncNow();
}

/** Clears pull cursors so the next sync re-reads everything (used after sign-in). */
export async function resetPullCursors(): Promise<void> {
  await db.meta.where('key').startsWith('pull:').delete();
}
