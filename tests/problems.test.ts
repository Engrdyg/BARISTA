import { describe, expect, it } from 'vitest';
import { splitProblems } from '../src/lib/parsers/problems';

describe('splitProblems', () => {
  it('splits 20 numbered problems in order, keeping inner lists', () => {
    const parts: string[] = [];
    for (let i = 1; i <= 20; i++) {
      parts.push(`${i}. Problem ${i} facts.`);
      if (i === 3) parts.push('(a) Is the contract valid?', '1. A first inner point', '(b) Explain.');
    }
    const ps = splitProblems(parts.join('\n'));
    expect(ps).toHaveLength(20);
    expect(ps.map((p) => p.number)).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1)));
    expect(ps[2].text).toContain('1. A first inner point');
  });
  it('supports Roman and Q markers', () => {
    expect(splitProblems('I. one\nII. two\nIII. three').map((p) => p.text)).toEqual(['one', 'two', 'three']);
    expect(splitProblems('Q1 first\nQ2: second').map((p) => p.number)).toEqual(['1', '2']);
  });
});
