import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { useLive, useNow, useSubjects } from '../lib/hooks';
import { useStore } from '../lib/store';
import { syncNow, syncStatus } from '../lib/sync';
import { cloudEnabled } from '../lib/supabase';
import { elapsedSec, runningTimer, stopTimer } from '../lib/timer';
import { formatClock } from '../lib/time';
import { Modal, tabStyle } from './ui';

const MAIN = [
  { to: '/today', label: 'Today' },
  { to: '/syllabus', label: 'Syllabus' },
  { to: '/cards', label: 'Cards' },
  { to: '/practice', label: 'Practice' },
];
export const MORE = [
  { to: '/codals', label: 'Codals' },
  { to: '/digests', label: 'Digests' },
  { to: '/mistakes', label: 'Mistakes' },
  { to: '/planner', label: 'Planner' },
  { to: '/progress', label: 'Progress' },
  { to: '/log', label: 'Study log' },
  { to: '/lmt', label: 'LMT sheets' },
  { to: '/search', label: 'Search' },
  { to: '/settings', label: 'Settings' },
];

export function SyncBadge() {
  const s = useStore(syncStatus);
  const [open, setOpen] = useState(false);
  if (!cloudEnabled) return <span className="text-xs text-muted">On this device only</span>;
  const label =
    s.state === 'synced' || (s.state === 'syncing' && !s.pending)
      ? s.pending
        ? `${s.pending} changes waiting`
        : 'Synced'
      : s.state === 'offline'
        ? `Offline${s.pending ? `, ${s.pending} changes waiting` : ''}`
        : s.state === 'error'
          ? 'Sync failed'
          : s.state === 'signed_out'
            ? 'Not signed in'
            : s.state === 'syncing'
              ? `Syncing ${s.pending} changes`
              : 'Local';
  const dot = s.state === 'error' ? 'var(--danger)' : s.state === 'offline' ? 'var(--ink-muted)' : 'var(--ok)';
  return (
    <>
      <button className="inline-flex items-center gap-1.5 text-xs text-muted" onClick={() => setOpen(true)}>
        <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: dot }} />
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Sync">
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="font-semibold">Status</dt>
            <dd>{label}</dd>
          </div>
          <div>
            <dt className="font-semibold">Last synced</dt>
            <dd>{s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString() : 'Not yet'}</dd>
          </div>
          {s.error && (
            <div>
              <dt className="font-semibold">Error</dt>
              <dd className="break-words text-danger">{s.error}</dd>
            </div>
          )}
        </dl>
        <p className="mt-3 text-sm text-muted">
          Changes are saved on this device first and upload when you're online. Nothing is lost while offline.
        </p>
        <button className="btn mt-4" onClick={() => void syncNow()}>
          Sync now
        </button>
      </Modal>
    </>
  );
}

function TimerBar() {
  const timer = useLive(runningTimer);
  const subjects = useSubjects();
  const now = useNow(1000);
  const nav = useNavigate();
  if (!timer) return null;
  const subject = subjects.find((s) => s.id === timer.subject_id);
  return (
    <div
      className="tab no-print flex items-center justify-between gap-2 rounded-r-lg px-3 py-2 text-sm"
      style={tabStyle(subject?.color ?? '#5B6275')}
    >
      <button className="min-w-0 truncate text-left" onClick={() => nav('/log')}>
        <span className="font-semibold">{subject?.code ?? 'Study'}</span> · {timer.kind}
        {timer.paused_at ? ' · paused' : ''}
      </button>
      <span className="font-semibold tabular-nums">{formatClock(elapsedSec(timer, now))}</span>
      <button className="btn btn-sm" onClick={() => void stopTimer(timer.id)}>
        Stop
      </button>
    </div>
  );
}

function SubjectRail() {
  const subjects = useSubjects();
  const loc = useLocation();
  return (
    <div className="mt-4 space-y-1" aria-label="Subjects">
      {subjects.map((s) => {
        const active = loc.pathname === `/syllabus/${s.code}`;
        return (
          <NavLink
            key={s.id}
            to={`/syllabus/${s.code}`}
            className={`tab -mr-6 block rounded-r-lg py-1 pr-3 pl-3 text-sm font-semibold shadow-sm transition-transform ${active ? 'translate-x-2' : 'hover:translate-x-1'}`}
            style={tabStyle(s.color)}
            title={s.name}
          >
            {s.code}
          </NavLink>
        );
      })}
    </div>
  );
}

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-[3px] text-[0.95rem] ${isActive ? 'bg-[color-mix(in_srgb,var(--ink)_9%,transparent)] font-semibold' : 'text-muted hover:text-ink'}`;

export default function Layout() {
  const loc = useLocation();
  const exam = loc.pathname.startsWith('/practice/attempt/');
  const pending = useLive(() => db.attempts.filter((a) => a.status === 'in_progress' && !a.deleted_at).count());
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  if (exam) return <Outlet />;
  return (
    <div className="min-h-dvh lg:flex">
      <aside className="no-print sticky top-0 hidden h-dvh w-52 shrink-0 flex-col border-r border-rule bg-surface px-3 py-4 lg:flex">
        <div className="mb-4 px-3 text-lg font-bold tracking-tight">Tiyaga</div>
        <nav className="space-y-0.5">
          {[...MAIN, ...MORE].map((l) => (
            <NavLink key={l.to} to={l.to} className={linkCls}>
              {l.label}
              {l.to === '/practice' && pending ? <span className="ml-1 text-xs">●</span> : null}
            </NavLink>
          ))}
        </nav>
        <SubjectRail />
        <div className="mt-auto px-3 pt-4">
          <SyncBadge />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="no-print sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-rule bg-paper/95 px-4 py-2 backdrop-blur lg:hidden">
          <span className="font-bold">Tiyaga</span>
          <SyncBadge />
        </div>
        <div className="no-print sticky top-11 z-10 px-4 pt-2 lg:top-0 lg:px-8">
          <TimerBar />
        </div>
        <main className="mx-auto max-w-5xl px-4 pt-3 pb-28 lg:px-8 lg:pt-6 lg:pb-12">
          <Outlet />
        </main>
      </div>
      <nav
        className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-rule bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="Main"
      >
        {[...MAIN, { to: '/more', label: 'More' }].map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              `flex h-14 items-center justify-center text-sm ${isActive || (l.to === '/more' && MORE.some((m) => loc.pathname.startsWith(m.to))) ? 'font-bold text-ink' : 'text-muted'}`
            }
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
