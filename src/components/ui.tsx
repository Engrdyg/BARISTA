import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Star as StarIcon, X, type LucideIcon } from 'lucide-react';
import type { Subject } from '../lib/types';

export function Markdown({ children, className = '' }: { children: string; className?: string }) {
  return (
    <div className={`prose-md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: c }) => {
            if (href === '#cloze-blank') return <span className="cloze-blank">{c}</span>;
            if (href === '#cloze-answer') return <mark className="cloze-answer">{c}</mark>;
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {c}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function tabStyle(color: string | undefined): CSSProperties {
  return { ['--tab' as string]: color ?? '#888' };
}

/** A subject's code shown as a small tab (never color alone). */
export function SubjectTag({ subject, className = '' }: { subject?: Subject | null; className?: string }) {
  if (!subject) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border border-rule bg-elevated px-1.5 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-ink ${className}`}
      style={tabStyle(subject.color)}
      title={subject.name}
    >
      <span className="subject-dot" aria-hidden />
      {subject.code}
    </span>
  );
}

export function SubjectChips({
  subjects,
  value,
  onChange,
  allowAll = true,
}: {
  subjects: Subject[];
  value: string | null;
  onChange: (id: string | null) => void;
  allowAll?: boolean;
}) {
  const chip = (active: boolean) =>
    `inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? 'border-[var(--tab,var(--accent))] bg-[color-mix(in_srgb,var(--tab,var(--accent))_14%,var(--surface))] text-ink' : 'border-rule bg-surface text-muted hover:border-rule-strong hover:text-ink'
    }`;
  return (
    <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0" role="tablist" aria-label="Subject">
      {allowAll && (
        <button role="tab" aria-selected={value === null} className={chip(value === null)} onClick={() => onChange(null)}>
          All subjects
        </button>
      )}
      {subjects.map((s) => (
        <button key={s.id} role="tab" aria-selected={value === s.id} onClick={() => onChange(s.id)} className={chip(value === s.id)} style={tabStyle(s.color)} title={s.name}>
          <span className="subject-dot" aria-hidden />
          {s.code}
        </button>
      ))}
    </div>
  );
}

export function SubjectSelect({
  subjects,
  value,
  onChange,
  allowNone = true,
  id,
}: {
  subjects: Subject[];
  value: string | null;
  onChange: (id: string | null) => void;
  allowNone?: boolean;
  id?: string;
}) {
  return (
    <select id={id} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowNone && <option value="">No subject</option>}
      {subjects.map((s) => (
        <option key={s.id} value={s.id}>
          {s.code} — {s.name}
        </option>
      ))}
    </select>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-label={title}
      className={`m-auto w-[calc(100%-1rem)] ${wide ? 'max-w-4xl' : 'max-w-lg'} rounded-2xl border border-rule bg-surface p-0 text-ink shadow-[var(--shadow-lg)] backdrop:bg-black/50 backdrop:backdrop-blur-[2px]`}
    >
      {open && (
        <div className="page-in flex max-h-[90vh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3.5">
            <h2 className="t-section truncate">{title}</h2>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close">
              <X />
            </button>
          </div>
          <div className="scrollbar-thin overflow-y-auto p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  color,
  icon: Icon,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  color?: string;
  icon?: LucideIcon;
  eyebrow?: ReactNode;
}) {
  return (
    <header
      className={`mb-6 flex flex-wrap items-end justify-between gap-4 ${color ? 'tab-tint -mx-4 rounded-2xl px-4 pt-5 pb-4 lg:-mx-6 lg:px-6' : ''}`}
      style={color ? tabStyle(color) : undefined}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rule bg-surface text-accent shadow-[var(--shadow-sm)] sm:flex" aria-hidden>
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="t-eyebrow mb-1">{eyebrow}</p>}
          <h1 className="t-title">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** Empty state: an icon, a heading, one helpful sentence, and the next action. */
export function Empty({
  children,
  icon: Icon,
  title,
  actions,
  compact = false,
}: {
  children?: ReactNode;
  icon?: LucideIcon;
  title?: string;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-rule-strong text-center ${compact ? 'px-4 py-6' : 'px-6 py-10'}`}>
      {Icon && (
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-accent" aria-hidden>
          <Icon className="h-5 w-5" />
        </span>
      )}
      {title && <h3 className="t-section">{title}</h3>}
      {children && <div className={`max-w-md text-sm text-muted ${title ? 'mt-1' : ''}`}>{children}</div>}
      {actions && <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({
  title,
  children,
  action,
  icon: Icon,
  description,
  className = '',
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel p-5 ${className}`} aria-label={title}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />}
          <div className="min-w-0">
            <h2 className="t-section">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Star({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button className="btn btn-ghost btn-sm btn-icon" onClick={onClick} aria-pressed={on} aria-label={on ? 'Unstar' : 'Star'} title={on ? 'Starred' : 'Star'}>
      <StarIcon className={on ? 'pop fill-[#F59E0B] text-[#F59E0B]' : 'text-muted'} />
    </button>
  );
}

export function Field({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function Bar({ value, color, size = 'md', label }: { value: number; color?: string; size?: 'sm' | 'md'; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      className={`${size === 'sm' ? 'h-1.5' : 'h-2'} w-full overflow-hidden rounded-full bg-elevated`}
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="bar-grow h-full rounded-full" style={{ width: `${pct}%`, background: color ?? 'var(--accent)' }} />
    </div>
  );
}

/** Circular progress, 0–1. */
export function Ring({ value, size = 44, stroke = 4, color, label }: { value: number; size?: number; stroke?: number; color?: string; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${Math.round(v * 100)}%`} className="-rotate-90 shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--elevated)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color ?? 'var(--accent)'}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - v)}
        style={{ transition: 'stroke-dashoffset 500ms cubic-bezier(0.2,0.7,0.2,1)' }}
      />
    </svg>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/** Placeholder layout shown while a page's data loads. */
export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function download(filename: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFile(file: File): Promise<string> {
  return file.text();
}
