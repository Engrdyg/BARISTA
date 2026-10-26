// Parses syllabus text pasted from the official PDF into an outline.
//
// - A line starting with an outline marker starts a node.
// - Depth follows the order in which marker styles first appear, using a
//   stack so a skipped level still nests under the nearest shallower node.
// - A line without a marker joins the previous node (PDF line wraps).
// - Page headers and footers are detected and dropped.
// - Ambiguous letters (I V X L C D M, i v x …) resolve by sequence.

export interface FlatNode {
  marker: string;
  title: string;
  depth: number;
}

export interface ParseResult {
  nodes: FlatNode[];
  /** Lines dropped as headers or footers, or text before the first marker. */
  ignored: string[];
}

type Kind = 'num' | 'alpha' | 'roman';
type Wrap = 'dot' | 'rparen' | 'paren';

interface Candidate {
  style: string;
  value: number;
}

const ROMAN_RE = /^(M{0,3})(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i;
const MARKER_RE = /^\s*(?:\((\d{1,3}|[A-Za-z]{1,6})\)|(\d{1,3}|[A-Za-z]{1,6})([.)]))(?=\s|$)\s*(.*)$/;

export function romanToInt(s: string): number {
  const vals: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const t = s.toLowerCase();
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const v = vals[t[i]];
    const next = vals[t[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

function isRoman(s: string): boolean {
  return s.length > 0 && ROMAN_RE.test(s) && (s === s.toUpperCase() || s === s.toLowerCase());
}

function styleKey(kind: Kind, wrap: Wrap, upper: boolean | null): string {
  return `${kind}:${wrap}:${upper === null ? '' : upper ? 'U' : 'L'}`;
}

/** Possible readings of a marker token; empty if it isn't a marker. */
function candidates(token: string, wrap: Wrap): Candidate[] {
  if (/^\d+$/.test(token)) return [{ style: styleKey('num', wrap, null), value: Number(token) }];
  const upper = token === token.toUpperCase();
  if (!upper && token !== token.toLowerCase()) return [];
  const out: Candidate[] = [];
  if (token.length === 1) {
    out.push({ style: styleKey('alpha', wrap, upper), value: token.toLowerCase().charCodeAt(0) - 96 });
  }
  if (isRoman(token)) out.push({ style: styleKey('roman', wrap, upper), value: romanToInt(token) });
  return out;
}

export function parseMarker(line: string): { marker: string; token: string; wrap: Wrap; rest: string } | null {
  const m = MARKER_RE.exec(line);
  if (!m) return null;
  const token = m[1] ?? m[2];
  const wrap: Wrap = m[1] !== undefined ? 'paren' : m[3] === '.' ? 'dot' : 'rparen';
  if (!candidates(token, wrap).length) return null;
  const marker = wrap === 'paren' ? `(${token})` : `${token}${m[3]}`;
  return { marker, token, wrap, rest: (m[4] ?? '').trim() };
}

function normalizeForRepeat(line: string): string {
  return line.trim().toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
}

const FOOTER_RES = [
  /^page\s*\d+(\s*(of|\/)\s*\d+)?$/i,
  /^\d{1,4}$/,
  /^[-–—]\s*\d+\s*[-–—]$/,
  /^\d+\s*(of|\/)\s*\d+$/i,
];

function joinWrapped(prev: string, next: string): string {
  if (!prev) return next;
  if (/[A-Za-z]-$/.test(prev) && /^[a-z]/.test(next)) return prev.slice(0, -1) + next;
  return `${prev} ${next}`;
}

export function parseSyllabus(text: string): ParseResult {
  const raw = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  const lines = raw.map((l) => l.trim()).filter(Boolean);

  // Repeated non-marker lines (running headers like "2027 Bar Syllabus — Page 3")
  const counts = new Map<string, number>();
  for (const l of lines) {
    if (parseMarker(l)) continue;
    const k = normalizeForRepeat(l);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const ignored: string[] = [];
  const nodes: FlatNode[] = [];
  const rank = new Map<string, number>();
  const stack: { style: string; last: number }[] = [];

  for (const line of lines) {
    // A running header repeats on every page and starts with a capital or a
    // digit; a wrapped continuation line usually starts in lowercase.
    const repeated = (counts.get(normalizeForRepeat(line)) ?? 0) >= 3 && line.length < 100 && /^[\p{Lu}\d]/u.test(line);
    if (FOOTER_RES.some((re) => re.test(line)) || (repeated && !parseMarker(line))) {
      ignored.push(line);
      continue;
    }
    const pm = parseMarker(line);
    if (!pm) {
      const last = nodes[nodes.length - 1];
      if (last) last.title = joinWrapped(last.title, line);
      else ignored.push(line);
      continue;
    }

    const cands = candidates(pm.token, pm.wrap);
    let chosen: Candidate | undefined;
    if (cands.length === 1) chosen = cands[0];
    else {
      // Prefer a reading that continues an open list; the innermost wins.
      let bestDepth = -1;
      for (const c of cands) {
        const idx = stack.findIndex((f) => f.style === c.style);
        if (idx >= 0 && stack[idx].last + 1 === c.value && idx > bestDepth) {
          chosen = c;
          bestDepth = idx;
        }
      }
      if (!chosen) chosen = cands.find((c) => c.value === 1 && !stack.some((f) => f.style === c.style));
      if (!chosen) chosen = cands.find((c) => stack.some((f) => f.style === c.style));
      if (!chosen) chosen = cands.find((c) => c.style.startsWith('alpha')) ?? cands[0];
    }

    if (!rank.has(chosen.style)) rank.set(chosen.style, rank.size);
    const r = rank.get(chosen.style)!;
    while (stack.length && rank.get(stack[stack.length - 1].style)! >= r) stack.pop();
    stack.push({ style: chosen.style, last: chosen.value });
    nodes.push({ marker: pm.marker, title: pm.rest, depth: stack.length - 1 });
  }

  for (const n of nodes) n.title = n.title.replace(/\s+/g, ' ').trim();
  return { nodes: normalizeDepths(nodes), ignored };
}

/** Clamps depths so each node is at most one level below the one before it. */
export function normalizeDepths(nodes: FlatNode[]): FlatNode[] {
  let prev = -1;
  return nodes.map((n) => {
    const depth = Math.max(0, Math.min(n.depth, prev + 1));
    prev = depth;
    return { ...n, depth };
  });
}

export interface TreeNode extends FlatNode {
  children: TreeNode[];
}

export function toTree(nodes: FlatNode[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const path: TreeNode[] = [];
  for (const n of normalizeDepths(nodes)) {
    const t: TreeNode = { ...n, children: [] };
    path.length = n.depth;
    if (n.depth === 0) roots.push(t);
    else path[n.depth - 1].children.push(t);
    path[n.depth] = t;
  }
  return roots;
}

export function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Re-import: match new nodes to existing ones by normalized title under the
// same parent, keeping their ids (and so their status, notes and links).

export interface ExistingNode {
  id: string;
  parent_id: string | null;
  title: string;
  marker: string;
  sort: number;
  depth: number;
  unmatched: boolean;
}

export interface MergedNode {
  id: string | null; // null → create
  parent: number | null; // index into merged list
  marker: string;
  title: string;
  depth: number;
  sort: number;
}

export interface MergePlan {
  nodes: MergedNode[];
  /** Existing nodes whose fields change (id → new values). */
  changed: Set<string>;
  /** Existing nodes with no match in the new text. */
  unmatched: string[];
  /** Existing nodes that were unmatched before and matched again now. */
  rematched: string[];
}

export function planMerge(existing: ExistingNode[], flat: FlatNode[]): MergePlan {
  const byParent = new Map<string | null, ExistingNode[]>();
  for (const e of existing) {
    const k = e.parent_id;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(e);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sort - b.sort);

  const used = new Set<string>();
  const nodes: MergedNode[] = [];
  const changed = new Set<string>();
  const rematched: string[] = [];
  const path: number[] = [];
  const sortCounter = new Map<number | null, number>();

  for (const n of normalizeDepths(flat)) {
    path.length = n.depth;
    const parentIdx = n.depth === 0 ? null : path[n.depth - 1];
    const parentId = parentIdx === null ? null : nodes[parentIdx].id;
    const sort = sortCounter.get(parentIdx) ?? 0;
    sortCounter.set(parentIdx, sort + 1);

    let match: ExistingNode | undefined;
    if (parentIdx === null || parentId) {
      const key = normalizeTitle(n.title);
      match = (byParent.get(parentId) ?? []).find((e) => !used.has(e.id) && normalizeTitle(e.title) === key);
    }
    if (match) {
      used.add(match.id);
      if (match.title !== n.title || match.marker !== n.marker || match.sort !== sort || match.depth !== n.depth) {
        changed.add(match.id);
      }
      if (match.unmatched) rematched.push(match.id);
    }
    nodes.push({ id: match?.id ?? null, parent: parentIdx, marker: n.marker, title: n.title, depth: n.depth, sort });
    path[n.depth] = nodes.length - 1;
  }

  const unmatched = existing.filter((e) => !used.has(e.id) && !e.unmatched).map((e) => e.id);
  return { nodes, changed, unmatched, rematched };
}
