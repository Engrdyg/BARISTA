import { liveQuery } from 'dexie';
import { useEffect, useState, type DependencyList } from 'react';
import { db } from './db';
import { getUserId, stableId } from './identity';
import { putRows } from './repo';
import { defaultSettings } from './seed';
import type { ExamConfig, SettingsData, SettingsRow, Subject } from './types';

/** Subscribes to a Dexie query; re-runs when the tables it read change. */
export function useLive<T>(fn: () => Promise<T> | T, deps: DependencyList = []): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    const sub = liveQuery(fn).subscribe({ next: setValue, error: (e) => console.error(e) });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

export function useSubjects(): Subject[] {
  return (
    useLive(async () =>
      (await db.subjects.toArray()).filter((s) => !s.deleted_at).sort((a, b) => a.sort - b.sort),
    ) ?? []
  );
}

export function useExam(): ExamConfig | undefined {
  return useLive(async () => (await db.exam_configs.toArray()).find((e) => e.is_active && !e.deleted_at));
}

async function settingsRow(): Promise<SettingsRow | undefined> {
  const id = await stableId(getUserId(), 'settings');
  return (await db.settings.get(id)) ?? (await db.settings.toArray()).find((r) => !r.deleted_at);
}

export function useSettings(): SettingsData {
  const row = useLive(settingsRow);
  return { ...defaultSettings(), ...(row?.data ?? {}) };
}

export async function getSettings(): Promise<SettingsData> {
  const row = await settingsRow();
  return { ...defaultSettings(), ...(row?.data ?? {}) };
}

export async function updateSettings(changes: Partial<SettingsData>): Promise<void> {
  const row = await settingsRow();
  if (!row) return;
  await putRows('settings', [{ ...row, data: { ...defaultSettings(), ...row.data, ...changes } }]);
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}
