import { describe, expect, it } from 'vitest';
import { clozeFromRanges, clozeIndices, renderCloze, stripCloze } from '../src/lib/cloze';

describe('cloze', () => {
  const t = 'Prescription of {{c1::10 years}} for {{c2::written contracts::kind}}, {{c1::from accrual}}.';
  it('finds indices', () => expect(clozeIndices(t)).toEqual([1, 2]));
  it('renders front and back', () => {
    expect(renderCloze(t, 2, 'front')).toBe('Prescription of 10 years for [\\[kind\\]](#cloze-blank), from accrual.');
    expect(renderCloze(t, 1, 'back')).toContain('[10 years](#cloze-answer)');
  });
  it('strips markup', () => expect(stripCloze(t)).toBe('Prescription of 10 years for written contracts, from accrual.'));
  it('three highlights make three cloze items', () => {
    const text = 'Actions upon a written contract prescribe in ten years from accrual.';
    const ranges = [
      { start: text.indexOf('written contract'), end: text.indexOf('written contract') + 16 },
      { start: text.indexOf('ten years'), end: text.indexOf('ten years') + 9 },
      { start: text.indexOf('accrual'), end: text.indexOf('accrual') + 7 },
    ];
    const each = clozeFromRanges(text, ranges, 'each');
    expect(clozeIndices(each)).toEqual([1, 2, 3]);
    expect(stripCloze(each)).toBe(text);
    expect(clozeIndices(clozeFromRanges(text, ranges, 'one'))).toEqual([1]);
  });
});
