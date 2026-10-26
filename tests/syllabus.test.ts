import { describe, expect, it } from 'vitest';
import { parseSyllabus, planMerge, toTree, type ExistingNode } from '../src/lib/parsers/syllabus';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const LOWER_ROMAN = ROMAN.map((r) => r.toLowerCase());
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

describe('parseSyllabus', () => {
  it('nests a short realistic outline', () => {
    const text = `
POLITICAL AND PUBLIC INTERNATIONAL LAW
I. The 1987 Constitution
  A. Nature and concept of a Constitution
  B. Parts of the Constitution
    1. Amendments and revisions
    2. Self-executing and non-self-executing
       provisions
II. General considerations
  A. National territory
    1. Archipelagic doctrine
       a. Baselines
       b. Internal waters
  B. State immunity
Page 3 of 12
III. Bill of Rights
  A. Due process
    1. Procedural
      (a) Notice
      (b) Hearing
    2. Substantive
`;
    const { nodes, ignored } = parseSyllabus(text);
    expect(ignored).toContain('POLITICAL AND PUBLIC INTERNATIONAL LAW');
    expect(ignored).toContain('Page 3 of 12');
    expect(nodes.map((n) => `${n.depth}:${n.marker} ${n.title}`)).toEqual([
      '0:I. The 1987 Constitution',
      '1:A. Nature and concept of a Constitution',
      '1:B. Parts of the Constitution',
      '2:1. Amendments and revisions',
      '2:2. Self-executing and non-self-executing provisions',
      '0:II. General considerations',
      '1:A. National territory',
      '2:1. Archipelagic doctrine',
      '3:a. Baselines',
      '3:b. Internal waters',
      '1:B. State immunity',
      '0:III. Bill of Rights',
      '1:A. Due process',
      '2:1. Procedural',
      '3:(a) Notice',
      '3:(b) Hearing',
      '2:2. Substantive',
    ]);
  });

  it('resolves ambiguous letters by sequence', () => {
    const letters = 'ABCDEFGH'.split('').map((l) => `A${l}`);
    const text = [
      'I. Obligations',
      ...letters.map((_, i) => `${ALPHA[i]}. Topic ${ALPHA[i]}`),
      'I. Topic I (the letter, after H)',
      'J. Topic J',
      'II. Contracts',
      'A. Essential requisites',
      'III. Sales',
      'IV. Lease',
      'V. Partnership (the Roman numeral, after IV)',
      'A. Definition',
      'a. Elements',
      'i. First',
      'ii. Second',
      'b. Kinds',
      'c. Effects',
      'h. eighth',
      'i. ninth (the letter, after h)',
    ].join('\n');
    const { nodes } = parseSyllabus(text);
    const byTitle = (t: string) => nodes.find((n) => n.title.startsWith(t))!;
    expect(byTitle('Topic I').depth).toBe(1);
    expect(byTitle('Topic J').depth).toBe(1);
    expect(byTitle('Contracts').depth).toBe(0);
    expect(byTitle('Partnership').depth).toBe(0);
    expect(byTitle('Definition').depth).toBe(1);
    expect(byTitle('Elements').depth).toBe(2);
    expect(byTitle('First').depth).toBe(3);
    expect(byTitle('Second').depth).toBe(3);
    expect(byTitle('Kinds').depth).toBe(2);
    expect(byTitle('Effects').depth).toBe(2);
    expect(byTitle('ninth').depth).toBe(2);
  });

  it('nests a generated 300+ line syllabus correctly, dropping footers', () => {
    const lines: string[] = ['2027 BAR EXAMINATIONS — CIVIL LAW SYLLABUS'];
    const expected: string[] = [];
    let page = 1;
    for (let r = 0; r < 6; r++) {
      lines.push(`${ROMAN[r]}. Part ${r}`);
      expected.push(`0:${ROMAN[r]}. Part ${r}`);
      for (let a = 0; a < 4; a++) {
        lines.push(`  ${ALPHA[a]}. Title ${r}.${a} with a long name that the PDF`);
        lines.push('     wraps onto a second line');
        expected.push(`1:${ALPHA[a]}. Title ${r}.${a} with a long name that the PDF wraps onto a second line`);
        for (let n = 1; n <= 3; n++) {
          lines.push(`    ${n}. Item ${r}.${a}.${n}`);
          expected.push(`2:${n}. Item ${r}.${a}.${n}`);
          for (let s = 0; s < 3; s++) {
            const letter = ALPHA[s].toLowerCase();
            lines.push(`      ${letter}. Sub ${r}.${a}.${n}.${letter}`);
            expected.push(`3:${letter}. Sub ${r}.${a}.${n}.${letter}`);
          }
          if (n === 2) {
            for (let k = 0; k < 2; k++) {
              lines.push(`        ${LOWER_ROMAN[k]}. Deep ${k}`);
              expected.push(`4:${LOWER_ROMAN[k]}. Deep ${k}`);
            }
          }
        }
        if (a % 2 === 1) {
          lines.push(`Page ${page} of 40`);
          lines.push('2027 BAR EXAMINATIONS — CIVIL LAW SYLLABUS');
          page++;
        }
      }
    }
    expect(lines.length).toBeGreaterThan(300);
    const { nodes } = parseSyllabus(lines.join('\n'));
    expect(nodes.map((n) => `${n.depth}:${n.marker} ${n.title}`)).toEqual(expected);
    const tree = toTree(nodes);
    expect(tree).toHaveLength(6);
    expect(tree[0].children).toHaveLength(4);
    expect(tree[0].children[0].children[1].children).toHaveLength(3);
    expect(tree[0].children[0].children[1].children[2].children).toHaveLength(2);
  });

  it('handles (1), 1) and a) styles and a skipped level', () => {
    const { nodes } = parseSyllabus(
      ['I. Top', 'A. Mid', '1) one', 'a) aa', '(1) p1', 'II. Next', '1) skipped A level'].join('\n'),
    );
    expect(nodes.map((n) => n.depth)).toEqual([0, 1, 2, 3, 4, 0, 1]);
  });
});

describe('planMerge (re-import)', () => {
  const text = ['I. One', 'A. Alpha', 'B. Beta', 'II. Two', 'A. Gamma'].join('\n');

  function asExisting(): ExistingNode[] {
    const plan = planMerge([], parseSyllabus(text).nodes);
    const ids = plan.nodes.map((_, i) => `n${i}`);
    return plan.nodes.map((n, i) => ({
      id: ids[i],
      parent_id: n.parent === null ? null : ids[n.parent],
      title: n.title,
      marker: n.marker,
      sort: n.sort,
      depth: n.depth,
      unmatched: false,
    }));
  }

  it('re-importing the same text changes nothing', () => {
    const existing = asExisting();
    const plan = planMerge(existing, parseSyllabus(text).nodes);
    expect(plan.nodes.every((n) => n.id !== null)).toBe(true);
    expect(plan.changed.size).toBe(0);
    expect(plan.unmatched).toEqual([]);
  });

  it('keeps ids for matched nodes and lists removed ones as unmatched', () => {
    const existing = asExisting();
    const revised = ['I. One', 'A. alpha', 'C. New topic', 'II. Two'].join('\n');
    const plan = planMerge(existing, parseSyllabus(revised).nodes);
    expect(plan.nodes.map((n) => n.id)).toEqual(['n0', 'n1', null, 'n3']);
    expect(plan.unmatched.sort()).toEqual(['n2', 'n4']);
  });
});
