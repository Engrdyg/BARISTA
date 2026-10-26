// Cloze syntax: {{c1::answer}} or {{c1::answer::hint}}. Each cloze number is
// reviewed as its own item.

const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

export function clozeIndices(text: string): number[] {
  const set = new Set<number>();
  for (const m of text.matchAll(CLOZE_RE)) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
}

function escapeLinkText(s: string): string {
  return s.replace(/([[\]\\])/g, '\\$1');
}

/**
 * Markdown for one side of a cloze item. Active deletions render as links to
 * "#cloze-blank" / "#cloze-answer", which the card view styles; other
 * deletions show their answer as plain text.
 */
export function renderCloze(text: string, active: number, side: 'front' | 'back'): string {
  return text.replace(CLOZE_RE, (_all, n: string, answer: string, hint?: string) => {
    if (Number(n) !== active) return answer;
    if (side === 'front') return `[${escapeLinkText(hint ? `[${hint}]` : '[…]')}](#cloze-blank)`;
    return `[${escapeLinkText(answer)}](#cloze-answer)`;
  });
}

/** Plain text with cloze markup removed (for search and previews). */
export function stripCloze(text: string): string {
  return text.replace(CLOZE_RE, (_a, _n, answer: string) => answer);
}

export interface Range {
  start: number;
  end: number;
}

/** Sorts and merges overlapping or touching ranges. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Turns highlighted spans into cloze deletions: each its own number, or all c1. */
export function clozeFromRanges(text: string, ranges: Range[], mode: 'each' | 'one'): string {
  const merged = mergeRanges(ranges).map((r) => ({ start: Math.max(0, r.start), end: Math.min(text.length, r.end) }));
  let out = '';
  let pos = 0;
  merged.forEach((r, i) => {
    out += text.slice(pos, r.start);
    out += `{{c${mode === 'each' ? i + 1 : 1}::${text.slice(r.start, r.end)}}}`;
    pos = r.end;
  });
  return out + text.slice(pos);
}
