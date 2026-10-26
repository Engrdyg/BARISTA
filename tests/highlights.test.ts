import { describe, expect, it } from 'vitest';
import { adjustForEdit, segments } from '../src/lib/highlights';

const h = (id: string, start: number, end: number) => ({ id, start, end, color_key: 'yellow', needs_review: false });

describe('highlights', () => {
  it('segments text', () => {
    const s = segments('abcdefgh', [h('a', 2, 4), h('b', 6, 8)]);
    expect(s.map((x) => [x.text, x.hl?.id ?? null])).toEqual([
      ['ab', null],
      ['cd', 'a'],
      ['ef', null],
      ['gh', 'b'],
    ]);
  });
  it('keeps, shifts or flags highlights after an edit', () => {
    const old = 'The quick brown fox jumps over the lazy dog';
    const neu = 'The quick red fox jumps over the lazy dog';
    const out = adjustForEdit(old, neu, [h('before', 0, 3), h('over', 10, 15), h('after', 35, 39)]);
    expect(out[0]).toMatchObject({ start: 0, end: 3, needs_review: false });
    expect(out[1].needs_review).toBe(true);
    expect(neu.slice(out[2].start, out[2].end)).toBe('lazy');
    expect(out[2].needs_review).toBe(false);
  });
});
