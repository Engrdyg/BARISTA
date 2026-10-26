import { romanToInt } from './syllabus';

// Splits a pasted, numbered set of problems ("1.", "I." or "Q1") into
// problems. Only the marker style of the first problem counts, and only the
// next number in sequence starts a new problem, so numbered lists inside a
// problem stay with it.

export interface SplitProblem {
  number: string;
  text: string;
}

type Style = 'num' | 'roman' | 'q';

const STYLES: { style: Style; re: RegExp; value: (m: RegExpExecArray) => number }[] = [
  { style: 'q', re: /^\s*Q\s*(\d+)\s*[.:)\-–]?\s*(.*)$/i, value: (m) => Number(m[1]) },
  { style: 'num', re: /^\s*(\d+)\s*[.)]\s+(.*)$|^\s*(\d+)\s*[.)]\s*$/, value: (m) => Number(m[1] ?? m[3]) },
  { style: 'roman', re: /^\s*([IVXLC]+)\s*\.\s*(.*)$/, value: (m) => romanToInt(m[1]) },
];

function match(line: string, style?: Style) {
  for (const s of STYLES) {
    if (style && s.style !== style) continue;
    const m = s.re.exec(line);
    if (m) return { style: s.style, value: s.value(m), rest: (m[2] ?? '').trim() };
  }
  return null;
}

export function splitProblems(text: string): SplitProblem[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let style: Style | undefined;
  let expected = 0;
  const out: { number: string; lines: string[] }[] = [];
  for (const line of lines) {
    const m = match(line, style);
    if (m && (style === undefined || m.value === expected)) {
      style = m.style;
      expected = m.value + 1;
      out.push({ number: String(m.value), lines: m.rest ? [m.rest] : [] });
      continue;
    }
    if (out.length) out[out.length - 1].lines.push(line);
  }
  return out
    .map((p) => ({ number: p.number, text: p.lines.join('\n').trim() }))
    .filter((p) => p.text.length > 0);
}
