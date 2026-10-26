import type { TooltipContentProps } from 'recharts';

// Shared chart chrome: recessive hairline grid and axes, text in ink tokens,
// a tooltip where values lead and series names follow.

export const axis = {
  tick: { fontSize: 11, fill: 'var(--ink-muted)' },
  axisLine: { stroke: 'var(--rule)' },
  tickLine: false,
} as const;

export const grid = { stroke: 'var(--rule)', strokeDasharray: undefined, vertical: false } as const;

export function ChartTooltip({ active, payload, label, unit = '' }: Partial<TooltipContentProps<number, string>> & { unit?: string }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value !== undefined && p.value !== null && p.value !== 0);
  if (!rows.length) return null;
  return (
    <div className="rounded-lg border border-rule bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 text-muted">{label}</p>
      <ul className="space-y-0.5">
        {rows.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: p.color }} />
            <strong className="tabular-nums text-ink">
              {typeof p.value === 'number' ? Math.round(p.value * 10) / 10 : p.value}
              {unit}
            </strong>
            <span className="text-muted">{p.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Legend({ items, line = false }: { items: { key: string; label: string; color: string }[]; line?: boolean }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-1.5">
          <span aria-hidden className={line ? 'inline-block h-0.5 w-4 rounded' : 'inline-block h-2.5 w-2.5 rounded-sm'} style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
