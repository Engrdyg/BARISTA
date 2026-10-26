import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

/** A subject's code shown as a small codal tab (never color alone). */
export function SubjectTag({ subject, className = '' }: { subject?: Subject | null; className?: string }) {
  if (!subject) return null;
  return (
    <span
      className={`tab inline-flex items-center rounded-r px-1.5 py-0.5 text-xs font-semibold tracking-wide ${className}`}
      style={tabStyle(subject.color)}
      title={subject.name}
    >
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
  return (
    <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist">
      {allowAll && (
        <button
          role="tab"
          aria-selected={value === null}
          className={`btn btn-sm shrink-0 ${value === null ? 'btn-primary' : ''}`}
          onClick={() => onChange(null)}
        >
          All
        </button>
      )}
      {subjects.map((s) => (
        <button
          key={s.id}
          role="tab"
          aria-selected={value === s.id}
          onClick={() => onChange(s.id)}
          className={`tab shrink-0 rounded-r-md px-3 py-1.5 text-sm font-semibold ${value === s.id ? 'ring-2 ring-[var(--ink)]' : ''}`}
          style={tabStyle(s.color)}
          title={s.name}
        >
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
      className={`m-auto w-[calc(100%-1rem)] ${wide ? 'max-w-4xl' : 'max-w-lg'} rounded-xl border border-rule bg-surface p-0 text-ink backdrop:bg-black/40`}
    >
      {open && (
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex items-center justify-between border-b border-rule px-4 py-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          <div className="overflow-y-auto p-4">{children}</div>
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
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  color?: string;
}) {
  return (
    <header
      className={`mb-4 flex flex-wrap items-end justify-between gap-3 ${color ? 'tab-tint -mx-4 rounded-b-xl px-4 pt-4 pb-3 lg:-mx-8 lg:px-8' : ''}`}
      style={color ? tabStyle(color) : undefined}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-rule p-6 text-center text-muted">{children}</div>;
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="panel p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Star({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={onClick}
      aria-pressed={on}
      aria-label={on ? 'Unstar' : 'Star'}
      title={on ? 'Starred' : 'Star'}
    >
      <span aria-hidden className={on ? 'text-[#E08A1E]' : 'text-muted'}>
        {on ? '★' : '☆'}
      </span>
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

export function Bar({ value, color }: { value: number; color?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink)_10%,transparent)]"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color ?? 'var(--ink)' }} />
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
