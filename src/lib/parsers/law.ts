import type { SplitPattern } from '../types';

// Splits a law's full text into provisions. Every line of the input ends up in
// exactly one provision's heading or text, so joining them reproduces the
// pasted text (ignoring whitespace).

// Structural headings are matched case-sensitively (all caps, or title case on
// a line of their own) so a wrapped line like "Rule 3 of the Rules…" inside a
// provision doesn't start a new heading.
export const DEFAULT_PATTERNS: SplitPattern[] = [
  { kind: 'heading', regex: '^(?:RULE\\s+(\\d+)\\b|Rule\\s+(\\d+)\\.?\\s*$)', label: 'Rule $1', prefix: true, caseSensitive: true },
  {
    kind: 'heading',
    regex: '^(?:ARTICLE\\s+([IVXLCDM]+)\\b|Article\\s+([IVXLCDM]+)\\.?\\s*$)',
    label: 'Art. $1',
    prefix: true,
    caseSensitive: true,
  },
  {
    kind: 'heading',
    regex: '^(?:(?:PRELIMINARY\\s+)?(?:BOOK|TITLE|SUBTITLE|CHAPTER|PART)\\b|(?:Book|Title|Subtitle|Chapter|Part)\\s+(?:[IVXLCDM]+|\\d+|[A-Z][a-z]+)\\.?\\s*$)',
    label: '',
    prefix: false,
    caseSensitive: true,
  },
  { kind: 'provision', regex: '^(?:ARTICLE|ART\\.)\\s*(\\d+(?:-?[A-Z])?(?:-[A-Z0-9]+)?)\\s*\\.', label: 'Art. $1' },
  { kind: 'provision', regex: '^(?:SECTION|SEC\\.)\\s*(\\d+(?:-?[A-Z])?(?:-[A-Z0-9]+)?)\\s*\\.', label: 'Sec. $1' },
];

export interface SplitProvision {
  label: string;
  heading: string;
  text: string;
}

function compile(patterns: SplitPattern[]) {
  return patterns.map((p) => {
    let re: RegExp | null = null;
    try {
      re = new RegExp(p.regex, p.caseSensitive ? '' : 'i');
    } catch {
      re = null;
    }
    return { ...p, re };
  });
}

/** Fills $1 with the first capture group that matched (patterns may use alternation). */
function fill(template: string, m: RegExpExecArray): string {
  const first = m.slice(1).find((g) => g !== undefined) ?? '';
  return template.replace(/\$1/g, first.toUpperCase());
}

export function splitLaw(text: string, patterns: SplitPattern[] = DEFAULT_PATTERNS): SplitProvision[] {
  const compiled = compile(patterns);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: SplitProvision[] = [];
  let prefix = '';
  let pendingHeading: string[] = [];
  let current: { label: string; heading: string; lines: string[] } | null = null;

  const flush = () => {
    if (current) {
      out.push({ label: current.label, heading: current.heading, text: current.lines.join('\n').trim() });
      current = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    let matched = false;
    if (trimmed) {
      for (const p of compiled) {
        if (!p.re) continue;
        const m = p.re.exec(trimmed);
        if (!m) continue;
        matched = true;
        if (p.kind === 'heading') {
          flush();
          if (p.prefix) prefix = fill(p.label, m);
          pendingHeading.push(trimmed);
        } else {
          flush();
          const own = fill(p.label, m);
          current = {
            label: prefix ? `${prefix}, ${own}` : own,
            heading: pendingHeading.join('\n'),
            lines: [line],
          };
          pendingHeading = [];
        }
        break;
      }
    }
    if (matched) continue;
    if (current) current.lines.push(line);
    else if (pendingHeading.length) {
      // Lines right after a heading (e.g. "BILL OF RIGHTS") belong to it.
      if (trimmed) pendingHeading.push(trimmed);
    } else if (trimmed) {
      current = { label: out.length ? 'Text' : 'Preamble', heading: '', lines: [line] };
    }
  }
  flush();
  if (pendingHeading.length) out.push({ label: 'Headings', heading: pendingHeading.join('\n'), text: '' });
  return out;
}

/** Joins provisions back into text; used to check nothing was lost. */
export function joinProvisions(ps: SplitProvision[]): string {
  return ps.map((p) => [p.heading, p.text].filter(Boolean).join('\n')).join('\n');
}

export function stripWhitespace(s: string): string {
  return s.replace(/\s+/g, '');
}
