import { createStore, useStore } from './store';

// The subject picked in the sidebar. Lists that filter by subject (cards,
// digests, codals, practice, mistakes) start from it, so choosing CIV once
// narrows everything to Civil Law until it is cleared.

const KEY = 'barista.subject';

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export const subjectFilter = createStore<string | null>(typeof window === 'undefined' ? null : read());

export function setSubjectFilter(id: string | null) {
  subjectFilter.set(id);
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: keep it in memory */
  }
}

export function useSubjectFilter(): [string | null, (id: string | null) => void] {
  return [useStore(subjectFilter), setSubjectFilter];
}
