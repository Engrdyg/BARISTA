import { db } from './db';
import type { Question, SyllabusNode } from './types';

export interface WeakSpot {
  node: SyllabusNode;
  score: number;
  openMistakes: number;
  lowScores: number;
  lapses: number;
}

export const NODE_TAG = 'node:';
export const nodeTag = (id: string) => `${NODE_TAG}${id}`;
export const nodeIdsFromTags = (tags: string[]) =>
  tags.filter((t) => t.startsWith(NODE_TAG)).map((t) => t.slice(NODE_TAG.length));

const RECENT_MS = 90 * 86_400_000;

/** Syllabus nodes ranked by open mistakes, recent low scores, card lapses and the Needs work flag. */
export async function weakSpots(limit = 10): Promise<WeakSpot[]> {
  const [nodes, mistakes, links, items, attempts, cards, cardItems] = await Promise.all([
    db.syllabus_nodes.filter((n) => !n.deleted_at).toArray(),
    db.mistakes.filter((m) => !m.deleted_at && m.status === 'open').toArray(),
    db.node_links.filter((l) => !l.deleted_at).toArray(),
    db.attempt_items.filter((i) => !i.deleted_at && i.score !== null).toArray(),
    db.attempts.filter((a) => !a.deleted_at).toArray(),
    db.cards.filter((c) => !c.deleted_at).toArray(),
    db.card_items.filter((i) => !i.deleted_at && i.lapses > 0).toArray(),
  ]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const acc = new Map<string, Omit<WeakSpot, 'node' | 'score'>>();
  const bump = (id: string | null, key: 'openMistakes' | 'lowScores' | 'lapses', n = 1) => {
    if (!id || !byId.has(id)) return;
    const cur = acc.get(id) ?? { openMistakes: 0, lowScores: 0, lapses: 0 };
    cur[key] += n;
    acc.set(id, cur);
  };
  for (const m of mistakes) bump(m.node_id, 'openMistakes');

  const questionNodes = new Map<string, string[]>();
  for (const l of links) {
    if (l.target_type !== 'question') continue;
    if (!questionNodes.has(l.target_id)) questionNodes.set(l.target_id, []);
    questionNodes.get(l.target_id)!.push(l.node_id);
  }
  const attemptTime = new Map(attempts.map((a) => [a.id, Date.parse(a.submitted_at ?? a.started_at)]));
  const now = Date.now();
  for (const it of items) {
    if ((it.score ?? 5) >= 3) continue;
    if (now - (attemptTime.get(it.attempt_id) ?? 0) > RECENT_MS) continue;
    for (const n of questionNodes.get(it.question_id) ?? []) bump(n, 'lowScores');
  }

  const cardNodes = new Map(cards.map((c) => [c.id, nodeIdsFromTags(c.tags)]));
  for (const ci of cardItems) for (const n of cardNodes.get(ci.card_id) ?? []) bump(n, 'lapses', ci.lapses);

  const out: WeakSpot[] = [];
  for (const n of nodes) {
    const a = acc.get(n.id) ?? { openMistakes: 0, lowScores: 0, lapses: 0 };
    const score = a.openMistakes * 3 + a.lowScores * 3 + a.lapses * 0.5 + (n.needs_work ? 2 : 0);
    if (score > 0) out.push({ node: n, score, ...a });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}

/** One problem from her weakest area: linked to the top weak spot, never attempted or lowest scored first. */
export async function suggestedDrill(): Promise<{ question: Question; spot: WeakSpot | null } | null> {
  const spots = await weakSpots(5);
  const questions = await db.questions.filter((q) => !q.deleted_at).toArray();
  if (!questions.length) return null;
  const items = await db.attempt_items.filter((i) => !i.deleted_at).toArray();
  const lastScore = new Map<string, number>();
  for (const i of items) if (i.score !== null) lastScore.set(i.question_id, i.score);
  const rank = (q: Question) => (lastScore.has(q.id) ? lastScore.get(q.id)! : -1);
  const links = await db.node_links.filter((l) => !l.deleted_at && l.target_type === 'question').toArray();
  for (const spot of spots) {
    const ids = new Set(links.filter((l) => l.node_id === spot.node.id).map((l) => l.target_id));
    const qs = questions.filter((q) => ids.has(q.id)).sort((a, b) => rank(a) - rank(b));
    if (qs.length) return { question: qs[0], spot };
    const sameSubject = questions.filter((q) => q.subject_id === spot.node.subject_id).sort((a, b) => rank(a) - rank(b));
    if (sameSubject.length) return { question: sameSubject[0], spot };
  }
  const sorted = [...questions].sort((a, b) => rank(a) - rank(b));
  return { question: sorted[0], spot: null };
}
