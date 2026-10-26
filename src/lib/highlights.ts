// Character-range highlights on provision text.

export interface HL {
  id: string;
  start: number;
  end: number;
  color_key: string;
  needs_review: boolean;
}

export interface Segment {
  text: string;
  start: number;
  hl: HL | null;
}

/** Splits text into plain and highlighted segments; later highlights win on overlap. */
export function segments(text: string, hls: HL[]): Segment[] {
  const owner: (HL | null)[] = new Array(text.length).fill(null);
  for (const h of [...hls].sort((a, b) => a.start - b.start)) {
    for (let i = Math.max(0, h.start); i < Math.min(text.length, h.end); i++) owner[i] = h;
  }
  const out: Segment[] = [];
  let i = 0;
  while (i < text.length) {
    const h = owner[i];
    let j = i;
    while (j < text.length && owner[j] === h) j++;
    out.push({ text: text.slice(i, j), start: i, hl: h });
    i = j;
  }
  return out;
}

/**
 * After a text edit: highlights before the change stay, those after it shift
 * with the unchanged text, and those overlapping the change are flagged for
 * review (not silently moved).
 */
export function adjustForEdit(oldText: string, newText: string, hls: HL[]): HL[] {
  let p = 0;
  while (p < oldText.length && p < newText.length && oldText[p] === newText[p]) p++;
  let s = 0;
  while (s < oldText.length - p && s < newText.length - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++;
  const oldEnd = oldText.length - s; // changed region in old text: [p, oldEnd)
  const delta = newText.length - oldText.length;
  if (oldText === newText) return hls;
  return hls.map((h) => {
    if (h.end <= p) return h;
    if (h.start >= oldEnd) return { ...h, start: h.start + delta, end: h.end + delta };
    return { ...h, needs_review: true };
  });
}

/** Character offset of a DOM position within a container's text. */
export function offsetIn(container: Node, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(container);
  r.setEnd(node, offset);
  return r.toString().length;
}
