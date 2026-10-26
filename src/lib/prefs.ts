import { useState } from 'react';

/** A small per-device UI preference kept in localStorage (never study data). */
export function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`barista.${key}`);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(`barista.${key}`, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  };
  return [value, set];
}
