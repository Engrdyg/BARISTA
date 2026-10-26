import { createEmptyCard, fsrs, Rating, State, type Card, type Grade, type RecordLogItem } from 'ts-fsrs';
import { clozeIndices } from './cloze';
import { db } from './db';
import { makeRow, putRows } from './repo';
import { endOfManilaDay, startOfManilaDay, todayManila } from './time';
import type { CardItem, CardRow, ReviewLogRow, SettingsData } from './types';

export { Rating, State };
export type { Grade };

export function scheduler(retention: number) {
  return fsrs({ request_retention: retention, enable_fuzz: true });
}

export function itemToCard(it: CardItem): Card {
  return {
    due: new Date(it.due),
    stability: it.stability,
    difficulty: it.difficulty,
    elapsed_days: it.elapsed_days,
    scheduled_days: it.scheduled_days,
    learning_steps: it.learning_steps,
    reps: it.reps,
    lapses: it.lapses,
    state: it.state,
    last_review: it.last_review ? new Date(it.last_review) : undefined,
  };
}

export function cardFields(c: Card) {
  return {
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.toISOString() : null,
  };
}

export function emptyItemFields(now = new Date()) {
  return cardFields(createEmptyCard(now));
}

export function formatInterval(due: Date, now: Date): string {
  const min = (due.getTime() - now.getTime()) / 60_000;
  if (min < 1) return '<1m';
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  const mo = d / 30;
  if (mo < 12) return `${mo.toFixed(mo < 10 ? 1 : 0).replace(/\.0$/, '')}mo`;
  return `${(d / 365).toFixed(1).replace(/\.0$/, '')}y`;
}

export const GRADES: { rating: Grade; label: string; key: string }[] = [
  { rating: Rating.Again, label: 'Again', key: '1' },
  { rating: Rating.Hard, label: 'Hard', key: '2' },
  { rating: Rating.Good, label: 'Good', key: '3' },
  { rating: Rating.Easy, label: 'Easy', key: '4' },
];

export function previewIntervals(item: CardItem, retention: number, now = new Date()): Record<number, string> {
  const p = scheduler(retention).repeat(itemToCard(item), now);
  const out: Record<number, string> = {};
  for (const g of GRADES) out[g.rating] = formatInterval(p[g.rating].card.due, now);
  return out;
}

export interface UndoInfo {
  before: CardItem;
  logId: string;
}

export interface GradeOptions {
  /** Cram sessions leave the schedule alone unless she turns rescheduling on. */
  reschedule: boolean;
}

/** Grades an item: updates its FSRS state and stores a review log. */
export async function gradeItem(
  item: CardItem,
  rating: Grade,
  retention: number,
  durationMs: number,
  opts: GradeOptions = { reschedule: true },
  /** A result already computed by the caller (so the UI and the stored state match). */
  precomputed?: { result: RecordLogItem; now: Date },
): Promise<{ updated: CardItem; undo: UndoInfo | null }> {
  if (!opts.reschedule) return { updated: item, undo: null };
  const now = precomputed?.now ?? new Date();
  const { card, log } = precomputed?.result ?? scheduler(retention).next(itemToCard(item), now, rating);
  const updated: CardItem = { ...item, ...cardFields(card) };
  const logRow = makeRow('review_logs', {
    card_item_id: item.id,
    rating: log.rating,
    reviewed_at: now.toISOString(),
    duration_ms: Math.round(durationMs),
    state: log.state,
    due: log.due.toISOString(),
    stability: log.stability,
    difficulty: log.difficulty,
    elapsed_days: log.elapsed_days,
    last_elapsed_days: log.last_elapsed_days,
    scheduled_days: log.scheduled_days,
    learning_steps: log.learning_steps,
    review: log.review.toISOString(),
  } as Omit<ReviewLogRow, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'deleted_at'>);
  await putRows('card_items', [updated]);
  await putRows('review_logs', [logRow]);
  return { updated, undo: { before: item, logId: logRow.id } };
}

/** Restores the item's exact previous scheduling state and removes the log. */
export async function undoGrade(u: UndoInfo): Promise<void> {
  const log = await db.review_logs.get(u.logId);
  await putRows('card_items', [u.before]);
  if (log) await putRows('review_logs', [{ ...log, deleted_at: new Date().toISOString() }]);
}

/** Keeps a card's items in line with its cloze numbers (one item for basic cards). */
export async function syncItems(card: CardRow): Promise<void> {
  const items = (await db.card_items.where('card_id').equals(card.id).toArray()) as CardItem[];
  const wanted: (number | null)[] = card.type === 'cloze' ? clozeIndices(card.cloze_text) : [null];
  const now = new Date().toISOString();
  const puts: CardItem[] = [];
  for (const idx of wanted) {
    const existing = items.find((i) => i.cloze_index === idx);
    if (!existing) {
      puts.push(makeRow('card_items', { card_id: card.id, cloze_index: idx, ...emptyItemFields() } as never));
    } else if (existing.deleted_at) {
      puts.push({ ...existing, deleted_at: null });
    }
  }
  for (const it of items) {
    if (!it.deleted_at && !wanted.includes(it.cloze_index)) puts.push({ ...it, deleted_at: now });
  }
  if (card.deleted_at) {
    for (const it of items) if (!it.deleted_at) puts.push({ ...it, deleted_at: now });
  }
  await putRows('card_items', dedupe(puts));
}

function dedupe(items: CardItem[]): CardItem[] {
  const m = new Map<string, CardItem>();
  for (const i of items) m.set(i.id, i);
  return [...m.values()];
}

export async function saveCard(card: CardRow): Promise<CardRow> {
  await putRows('cards', [card]);
  await syncItems(card);
  return card;
}

export function newCard(fields: Partial<CardRow>): CardRow {
  return makeRow('cards', {
    subject_id: null,
    type: 'basic',
    front: '',
    back: '',
    cloze_text: '',
    source_type: 'manual',
    source_id: null,
    tags: [],
    suspended: false,
    starred: false,
    ...fields,
  } as never);
}

// Queue -------------------------------------------------------------------------

export interface QueueFilter {
  subjectId?: string | null;
  tag?: string | null;
  cardIds?: Set<string> | null;
  dueOnly?: boolean;
  cram?: boolean;
}

export interface QueueEntry {
  item: CardItem;
  card: CardRow;
}

export interface DayCounts {
  newDone: number;
  reviewsDone: number;
}

export async function todayCounts(): Promise<DayCounts> {
  const today = todayManila();
  const from = startOfManilaDay(today).toISOString();
  const logs = (await db.review_logs.where('reviewed_at').aboveOrEqual(from).toArray()).filter((l) => !l.deleted_at);
  return {
    newDone: logs.filter((l) => l.state === State.New).length,
    reviewsDone: logs.filter((l) => l.state !== State.New).length,
  };
}

/** Cards that are live, not suspended, and match the filter. */
export async function liveCards(filter: QueueFilter = {}): Promise<Map<string, CardRow>> {
  const cards = (await db.cards.toArray()).filter(
    (c) =>
      !c.deleted_at &&
      !c.suspended &&
      (!filter.subjectId || c.subject_id === filter.subjectId) &&
      (!filter.tag || c.tags.includes(filter.tag)) &&
      (!filter.cardIds || filter.cardIds.has(c.id)),
  );
  return new Map(cards.map((c) => [c.id, c]));
}

/**
 * Due items first (oldest due first), then new cards up to today's limit.
 * Reviews over the daily max carry to the next day.
 */
export async function buildQueue(settings: SettingsData, filter: QueueFilter = {}): Promise<QueueEntry[]> {
  const cards = await liveCards(filter);
  const items = (await db.card_items.toArray()).filter((i) => !i.deleted_at && cards.has(i.card_id));
  const join = (i: CardItem): QueueEntry => ({ item: i, card: cards.get(i.card_id)! });
  if (filter.cram) return shuffle(items).map(join);

  const now = Date.now();
  const endToday = endOfManilaDay(todayManila()).getTime();
  const counts = await todayCounts();
  const due = items
    .filter((i) => i.state !== State.New)
    .filter((i) => {
      const t = Date.parse(i.due);
      return i.state === State.Review ? t <= endToday : t <= now;
    })
    .sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
  const reviewRoom = Math.max(0, settings.maxReviewsPerDay - counts.reviewsDone);
  const out = due.slice(0, reviewRoom).map(join);
  if (!filter.dueOnly) {
    const newRoom = Math.max(0, settings.newCardsPerDay - counts.newDone);
    const fresh = items
      .filter((i) => i.state === State.New)
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || (a.cloze_index ?? 0) - (b.cloze_index ?? 0))
      .slice(0, newRoom)
      .map(join);
    // Interleave new cards among reviews so a session isn't all-new at the end.
    return interleave(out, fresh);
  }
  return out;
}

/** Learning items that come due soon, for "learn ahead" at the end of a session. */
export async function learningSoon(filter: QueueFilter, withinMin = 20): Promise<QueueEntry[]> {
  const cards = await liveCards(filter);
  const limit = Date.now() + withinMin * 60_000;
  return (await db.card_items.toArray())
    .filter(
      (i) =>
        !i.deleted_at &&
        cards.has(i.card_id) &&
        (i.state === State.Learning || i.state === State.Relearning) &&
        Date.parse(i.due) <= limit,
    )
    .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))
    .map((i) => ({ item: i, card: cards.get(i.card_id)! }));
}

function interleave<T>(a: T[], b: T[]): T[] {
  if (!b.length) return a;
  if (!a.length) return b;
  const out: T[] = [];
  const step = Math.max(1, Math.floor(a.length / b.length));
  let j = 0;
  a.forEach((x, i) => {
    out.push(x);
    if ((i + 1) % step === 0 && j < b.length) out.push(b[j++]);
  });
  while (j < b.length) out.push(b[j++]);
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Due counts per day for the next N days (Manila dates), per subject. */
export async function dueForecast(days = 30): Promise<{ date: string; bySubject: Record<string, number> }[]> {
  const cards = await liveCards();
  const items = (await db.card_items.toArray()).filter(
    (i) => !i.deleted_at && cards.has(i.card_id) && i.state !== State.New,
  );
  const today = todayManila();
  const out: { date: string; bySubject: Record<string, number> }[] = [];
  const start = startOfManilaDay(today).getTime();
  for (let d = 0; d < days; d++) out.push({ date: new Date(start + d * 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10), bySubject: {} });
  for (const i of items) {
    const t = Date.parse(i.due);
    const idx = Math.max(0, Math.floor((t - start) / 86_400_000));
    if (idx >= days) continue;
    const sid = cards.get(i.card_id)!.subject_id ?? 'none';
    out[idx].bySubject[sid] = (out[idx].bySubject[sid] ?? 0) + 1;
  }
  return out;
}
