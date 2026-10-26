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
  error: string | null;
  lastSyncAt: string | null;
}>({ state: 'local', pending: 0, error: null, lastSyncAt: null });

const PAGE = 500;
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
  syncStatus.set((s) => ({
    ...s,
    pending,
    state: !supabase ? 'local' : !signedIn ? 'signed_out' : s.state,
  }));
}

function stripLocal(row: Record<string, unknown>) {
  const { synced_at: _s, ...rest } = row;
  return rest;
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
      const { error } = await supabase.from(table).upsert(clean, { onConflict: 'id' });
      if (error) throw new Error(`${table}: ${error.message}`);
    }
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
      syncStatus.set((s) => ({ ...s, state: 'synced', error: null, lastSyncAt: new Date().toISOString() }));
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
