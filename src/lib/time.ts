// All "today", day boundaries and countdowns use Asia/Manila.
export const TZ = 'Asia/Manila';

const ymdFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** YYYY-MM-DD of the given instant in Manila. */
export function manilaDate(d: Date | string | number = new Date()): string {
  return ymdFmt.format(new Date(d));
}

export function todayManila(): string {
  return manilaDate(new Date());
}

/** The instant at 00:00 Manila on a YYYY-MM-DD date. Manila has no DST (UTC+8). */
export function startOfManilaDay(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+08:00`);
}

export function endOfManilaDay(ymd: string): Date {
  return new Date(startOfManilaDay(ymd).getTime() + 86_400_000 - 1);
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD date. */
export function weekday(ymd: string): number {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay();
}

/** Monday of the week containing ymd. */
export function startOfWeek(ymd: string): string {
  const wd = weekday(ymd);
  return addDays(ymd, wd === 0 ? -6 : 1 - wd);
}

const longFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const longYearFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** "Sept 5" style label for a YYYY-MM-DD date. */
export function shortDate(ymd: string): string {
  return longFmt.format(new Date(`${ymd}T00:00:00Z`)).replace('Sep ', 'Sept ');
}

export function longDate(ymd: string): string {
  return longYearFmt.format(new Date(`${ymd}T00:00:00Z`)).replace('Sep ', 'Sept ');
}

const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
export function manilaTime(d: Date | string): string {
  return timeFmt.format(new Date(d));
}

/** "HH:MM" 24h → "8:00 AM". */
export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatDuration(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function formatClock(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
