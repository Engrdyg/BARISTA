import { db, getMeta, setMeta, TABLES } from './db';
import { getUserId, setRole, setUserId, stableId } from './identity';
import { ensureSeed } from './seed';
import { createStore } from './store';
import { supabase } from './supabase';
import { resetPullCursors, setSignedIn, syncNow } from './sync';
import { nowIso } from './time';
import type { Role } from './types';
import seed from '../seed/bar2027.json';

export const authState = createStore<{
  ready: boolean;
  email: string | null;
  role: Role;
  /** True when the user chose to use the app on this device without an account. */
  localOnly: boolean;
}>({ ready: false, email: null, role: 'reviewee', localOnly: false });

async function seedIdMap(fromUid: string, toUid: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const pairs: string[][] = [['settings'], ['exam_config', seed.examConfig.name]];
  for (const s of seed.subjects) pairs.push(['subject', s.code]);
  for (const p of pairs) map.set(await stableId(fromUid, ...p), await stableId(toUid, ...p));
  return map;
}

/**
 * Moves rows made before sign-in (or under the local id) to the signed-in
 * account and queues them all for upload.
 */
async function adoptLocalData(toUid: string): Promise<void> {
  const fromUid = getUserId();
  const map = await seedIdMap(fromUid, toUid);
  const remap = (v: unknown) => (typeof v === 'string' && map.has(v) ? map.get(v) : v);
  const now = nowIso();
  await db.transaction('rw', [...TABLES.map((t) => db.t(t)), db.outbox], async () => {
    await db.outbox.clear();
    for (const t of TABLES) {
      if (t === 'profiles' || t === 'baon_notes') {
        await db.t(t).clear();
        continue;
      }
      const rows = (await db.t(t).toArray()) as unknown as Record<string, unknown>[];
      if (!rows.length) continue;
      const moved = rows.map((r) => {
        const out: Record<string, unknown> = { ...r, user_id: toUid };
        delete out.synced_at;
        for (const k of Object.keys(out)) if (k === 'id' || k.endsWith('subject_id')) out[k] = remap(out[k]);
        return out;
      });
      await db.t(t).clear();
      await db.t(t).bulkPut(moved as never[]);
      await db.outbox.bulkAdd(moved.map((r) => ({ table: t, id: r.id as string, at: now })));
    }
  });
}

async function clearAll(): Promise<void> {
  await db.transaction('rw', [...TABLES.map((t) => db.t(t)), db.outbox, db.meta], async () => {
    for (const t of TABLES) await db.t(t).clear();
    await db.outbox.clear();
    await db.meta.where('key').startsWith('pull:').delete();
  });
}

async function onSignedIn(uid: string, email: string | null): Promise<void> {
  const previous = getUserId();
  if (previous !== uid) {
    const lastAccount = await getMeta<string | null>('accountId', null);
    if (lastAccount && lastAccount !== uid) await clearAll(); // a different account used this device
    else await adoptLocalData(uid);
    await setUserId(uid);
    await setMeta('accountId', uid);
    await resetPullCursors();
  }
  let role: Role = 'reviewee';
  const { data } = await supabase!.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (data) {
    role = data.role as Role;
    await db.profiles.put(data as never);
  }
  await setRole(role);
  setSignedIn(true);
  authState.set({ ready: true, email, role, localOnly: false });
  await syncNow();
  if (role === 'reviewee') await ensureSeed();
}

export async function initAuth(): Promise<void> {
  if (!supabase) {
    setSignedIn(false);
    await ensureSeed();
    authState.set({ ready: true, email: null, role: 'reviewee', localOnly: true });
    return;
  }
  const localOnly = await getMeta<boolean>('localOnly', false);
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  supabase.auth.onAuthStateChange((event, s) => {
    if (event === 'SIGNED_IN' && s && s.user.id !== getUserId()) void onSignedIn(s.user.id, s.user.email ?? null);
    if (event === 'SIGNED_OUT') {
      setSignedIn(false);
      authState.set((st) => ({ ...st, email: null }));
    }
  });
  if (session) {
    // Show local data right away; sync catches up in the background.
    const accountId = await getMeta<string | null>('accountId', null);
    if (accountId === session.user.id) {
      const role = await getMeta<Role>('role', 'reviewee');
      authState.set({ ready: true, email: session.user.email ?? null, role, localOnly: false });
    }
    void onSignedIn(session.user.id, session.user.email ?? null);
    return;
  }
  if (localOnly) await ensureSeed();
  setSignedIn(false);
  authState.set({ ready: true, email: null, role: 'reviewee', localOnly });
}

export async function signIn(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Sync is not configured for this build.';
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return error.message;
  if (data.user) await onSignedIn(data.user.id, data.user.email ?? null);
  return null;
}

export async function continueLocalOnly(): Promise<void> {
  await setMeta('localOnly', true);
  await ensureSeed();
  authState.set((s) => ({ ...s, localOnly: true }));
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await syncNow();
  await supabase.auth.signOut();
  await clearAll();
  await setMeta('localOnly', false);
  authState.set({ ready: true, email: null, role: 'reviewee', localOnly: false });
}
