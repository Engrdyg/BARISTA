import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BookMarked,
  BookOpen,
  CalendarRange,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Cloud,
  CloudOff,
  FileText,
  Gavel,
  Landmark,
  Layers,
  LayoutDashboard,
  LineChart,
  ListChecks,
  LogOut,
  Menu,
  Monitor,
  Moon,
  NotebookPen,
  PenLine,
  RefreshCw,
  Search,
  Settings,
  Square,
  Sun,
  Timer,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { authState, signOut } from '../lib/auth';
import { subjectCoverage } from '../lib/calc';
import { db } from '../lib/db';
import { updateSettings, useLive, useNow, useSettings, useSubjects } from '../lib/hooks';
import { usePref } from '../lib/prefs';
import { useStore } from '../lib/store';
import { setSubjectFilter, useSubjectFilter } from '../lib/subjectFilter';
import { cloudEnabled } from '../lib/supabase';
import { syncNow, syncStatus } from '../lib/sync';
import { elapsedSec, runningTimer, stopTimer } from '../lib/timer';
import { formatClock } from '../lib/time';
import type { SettingsData } from '../lib/types';
import { Modal, tabStyle } from './ui';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Overview',
    items: [
      { to: '/today', label: 'Today', icon: LayoutDashboard },
      { to: '/planner', label: 'My Study Plan', icon: CalendarRange },
      { to: '/progress', label: 'Progress', icon: LineChart },
    ],
  },
  {
    group: 'Study',
    items: [
      { to: '/syllabus', label: 'Syllabus', icon: ListChecks },
      { to: '/cards', label: 'Flashcards', icon: Layers },
      { to: '/practice', label: 'Essay Practice', icon: PenLine },
      { to: '/bar-questions', label: 'Past Bar Questions', icon: Landmark },
      { to: '/codals', label: 'Codals', icon: BookOpen },
      { to: '/digests', label: 'Case Digests', icon: Gavel },
      { to: '/mistakes', label: 'Mistake Review', icon: TriangleAlert },
    ],
  },
  {
    group: 'Resources',
    items: [
      { to: '/lmt', label: 'LMT Sheets', icon: FileText },
      { to: '/log', label: 'Study Log', icon: NotebookPen },
      { to: '/search', label: 'Search', icon: Search },
    ],
  },
  { group: 'Account', items: [{ to: '/settings', label: 'Settings', icon: Settings }] },
];

/** Sections not in the phone tab bar (the More page lists these). */
export const MORE = NAV.flatMap((g) => g.items).filter((i) => !['/today', '/syllabus', '/cards', '/practice'].includes(i.to));

const ALL_ITEMS = NAV.flatMap((g) => g.items);

export function Wordmark({ collapsed = false }: { collapsed?: boolean }) {
  // Unique per instance: a shared id resolves to the first copy, which may be hidden.
  const gid = `bm${useId().replace(/:/g, '')}`;
  return (
    <span className="flex items-center gap-2.5">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden className="shrink-0">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#5B8CFF" />
            <stop offset="1" stopColor="#8B7CF6" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="22" height="26" rx="6" fill={`url(#${gid})`} />
        <rect x="22" y="5" width="5" height="4" rx="1.5" fill="#E08A1E" />
        <rect x="22" y="11" width="5" height="4" rx="1.5" fill="#2A9461" />
        <rect x="22" y="17" width="5" height="4" rx="1.5" fill="#CF3F3F" />
        <path d="M7 8h5.2c2.2 0 3.6 1.1 3.6 2.9 0 1.2-.7 2.1-1.8 2.5 1.4.3 2.3 1.4 2.3 2.8 0 2-1.6 3.3-4 3.3H7V8Zm2.4 4.6h2.5c1 0 1.6-.5 1.6-1.3S12.9 10 11.9 10H9.4v2.6Zm0 4.9h2.9c1.1 0 1.8-.5 1.8-1.4s-.7-1.5-1.8-1.5H9.4v2.9Z" fill="#fff" />
      </svg>
      {!collapsed && <span className="text-[0.95rem] font-semibold tracking-[0.12em]">BARISTA</span>}
    </span>
  );
}

// Sync --------------------------------------------------------------------------

export function SyncBadge({ compact = false }: { compact?: boolean }) {
  const s = useStore(syncStatus);
  const [open, setOpen] = useState(false);
  if (!cloudEnabled)
    return compact ? null : (
      <span className="flex items-center gap-2 text-xs text-muted">
        <CloudOff className="h-3.5 w-3.5" aria-hidden /> On this device only
      </span>
    );
  const label =
    s.state === 'synced' || (s.state === 'syncing' && !s.pending)
      ? s.pending
        ? `${s.pending} changes waiting`
        : 'Synced'
      : s.state === 'offline'
        ? `Offline${s.pending ? `, ${s.pending} waiting` : ''}`
        : s.state === 'error'
          ? 'Sync failed'
          : s.state === 'signed_out'
            ? 'Not signed in'
            : s.state === 'syncing'
              ? `Syncing ${s.pending}`
              : 'Local';
  const color = s.state === 'error' ? 'var(--danger)' : s.state === 'offline' || s.state === 'signed_out' ? 'var(--ink-faint)' : 'var(--ok)';
  const Icon = s.state === 'offline' ? CloudOff : s.state === 'syncing' ? RefreshCw : Cloud;
  return (
    <>
      <button
        className="flex items-center gap-2 rounded-md text-xs text-muted hover:text-ink"
        onClick={() => setOpen(true)}
        aria-label={`Sync status: ${label}`}
        {...(compact ? { 'data-tip': label } : {})}
      >
        <span className="relative">
          <Icon className={`h-3.5 w-3.5 ${s.state === 'syncing' ? 'animate-spin' : ''}`} aria-hidden />
          <span className="absolute -right-0.5 -bottom-0.5 h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        </span>
        {!compact && label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Sync">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="t-eyebrow">Status</dt>
            <dd className="mt-0.5">{label}</dd>
          </div>
          <div>
            <dt className="t-eyebrow">Last synced</dt>
            <dd className="mt-0.5">{s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString() : 'Not yet'}</dd>
          </div>
          {s.error && (
            <div>
              <dt className="t-eyebrow">Error</dt>
              <dd className="mt-0.5 break-words text-danger">{s.error}</dd>
            </div>
          )}
        </dl>
        <p className="mt-4 text-sm text-muted">Changes save on this device first and upload when you're online. Nothing is lost while offline.</p>
        <button className="btn mt-4" onClick={() => void syncNow()}>
          <RefreshCw /> Sync now
        </button>
      </Modal>
    </>
  );
}

// Timer -------------------------------------------------------------------------

function TimerBar() {
  const timer = useLive(runningTimer);
  const subjects = useSubjects();
  const now = useNow(1000);
  const nav = useNavigate();
  if (!timer) return null;
  const subject = subjects.find((s) => s.id === timer.subject_id);
  return (
    <div className="panel no-print flex items-center gap-3 px-3 py-2 text-sm" style={tabStyle(subject?.color ?? '#5B8CFF')} role="status">
      <span className="subject-dot" aria-hidden />
      <button className="min-w-0 flex-1 truncate text-left" onClick={() => nav('/log')}>
        <span className="font-semibold">{subject?.code ?? 'Study'}</span>
        <span className="text-muted">
          {' '}
          · {timer.kind}
          {timer.paused_at ? ' · paused' : ''}
        </span>
      </button>
      <span className="flex items-center gap-1.5 font-semibold tabular-nums">
        <Timer className="h-4 w-4 text-muted" aria-hidden />
        {formatClock(elapsedSec(timer, now))}
      </span>
      <button className="btn btn-sm" onClick={() => void stopTimer(timer.id)}>
        <Square className="!h-3 !w-3 fill-current" /> Stop
      </button>
    </div>
  );
}

// Sidebar -----------------------------------------------------------------------

function SubjectSelector({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const subjects = useSubjects();
  const settings = useSettings();
  const [selected] = useSubjectFilter();
  const nav = useNavigate();
  const loc = useLocation();
  const nodes = useLive(async () => (await db.syllabus_nodes.toArray()).filter((n) => !n.deleted_at && !n.unmatched));
  const cov = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const s of subjects) m.set(s.id, subjectCoverage((nodes ?? []).filter((n) => n.subject_id === s.id), settings.leafScores));
    return m;
  }, [subjects, nodes, settings.leafScores]);

  return (
    <div>
      {!collapsed && (
        <div className="mb-1.5 flex items-center justify-between px-3">
          <span className="t-eyebrow">Subjects</span>
          {selected && (
            <button className="text-[0.6875rem] text-muted hover:text-ink" onClick={() => setSubjectFilter(null)}>
              Clear filter
            </button>
          )}
        </div>
      )}
      <ul className="space-y-0.5">
        {subjects.map((s) => {
          const active = selected === s.id || loc.pathname === `/syllabus/${s.code}`;
          const c = cov.get(s.id);
          return (
            <li key={s.id}>
              <button
                onClick={() => {
                  setSubjectFilter(s.id);
                  nav(`/syllabus/${s.code}`);
                  onNavigate?.();
                }}
                className={`relative flex w-full items-center gap-2.5 rounded-lg py-1.5 text-left text-sm transition-colors ${collapsed ? 'justify-center px-0' : 'px-3'} ${
                  active ? 'bg-[color-mix(in_srgb,var(--tab)_16%,transparent)] text-ink' : 'text-muted hover:bg-elevated hover:text-ink'
                }`}
                style={tabStyle(s.color)}
                aria-pressed={selected === s.id}
                aria-label={`${s.code}: ${s.name}${c != null ? `, ${Math.round(c * 100)}% covered` : ''}`}
                {...(collapsed ? { 'data-tip': `${s.code} · ${s.name}` } : { title: s.name })}
              >
                {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r bg-[var(--tab)]" aria-hidden />}
                {collapsed ? (
                  <span className="flex h-7 w-8 items-center justify-center rounded-md text-[0.625rem] font-bold" style={{ background: `color-mix(in srgb, ${s.color} 22%, transparent)` }}>
                    {s.code.slice(0, 3)}
                  </span>
                ) : (
                  <>
                    <span className="subject-dot" aria-hidden />
                    <span className="flex-1 truncate font-medium">{s.code}</span>
                    {c != null && (
                      <span className="flex w-16 items-center gap-1.5" aria-hidden>
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-elevated">
                          <span className="bar-grow block h-full rounded-full" style={{ width: `${Math.round(c * 100)}%`, background: s.color }} />
                        </span>
                        <span className="w-7 text-right text-[0.6875rem] tabular-nums">{Math.round(c * 100)}%</span>
                      </span>
                    )}
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const [closedGroups, setClosedGroups] = usePref<string[]>('nav.closed', []);
  const pending = useLive(() => db.attempts.filter((a) => a.status === 'in_progress' && !a.deleted_at).count());
  const loc = useLocation();
  return (
    <nav className={`scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 px-2 pb-4 ${collapsed ? 'overflow-visible' : 'overflow-y-auto'}`} aria-label="Main">
      {NAV.map((g) => {
        const closed = !collapsed && closedGroups.includes(g.group);
        return (
          <div key={g.group}>
            {!collapsed && (
              <button
                className="t-eyebrow mb-1 flex w-full items-center justify-between rounded-md px-3 py-0.5 text-left hover:text-ink"
                onClick={() => setClosedGroups(closed ? closedGroups.filter((x) => x !== g.group) : [...closedGroups, g.group])}
                aria-expanded={!closed}
              >
                {g.group}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${closed ? '-rotate-90' : ''}`} aria-hidden />
              </button>
            )}
            <ul className="space-y-0.5">
              {g.items
                .filter((i) => !closed || loc.pathname.startsWith(i.to))
                .map((i) => (
                  <li key={i.to}>
                    <NavLink
                      to={i.to}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        `relative flex items-center gap-3 rounded-lg py-[0.4rem] text-sm transition-colors ${collapsed ? 'justify-center px-0' : 'px-3'} ${
                          isActive ? 'bg-[var(--accent-soft)] font-medium text-ink' : 'text-muted hover:bg-elevated hover:text-ink'
                        }`
                      }
                      {...(collapsed ? { 'data-tip': i.label, 'aria-label': i.label } : {})}
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r bg-accent" aria-hidden />}
                          <i.icon className={`h-[1.05rem] w-[1.05rem] shrink-0 ${isActive ? 'text-accent' : ''}`} aria-hidden />
                          {!collapsed && <span className="flex-1 truncate">{i.label}</span>}
                          {i.to === '/practice' && !!pending && (
                            <span
                              className={`rounded-full bg-[var(--accent-fill)] px-1.5 text-[0.625rem] font-semibold text-white ${collapsed ? 'absolute top-1 right-1.5' : ''}`}
                              aria-label={`${pending} in progress`}
                            >
                              {pending}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
            </ul>
          </div>
        );
      })}
      <SubjectSelector collapsed={collapsed} onNavigate={onNavigate} />
    </nav>
  );
}

// Header controls ---------------------------------------------------------------

const THEMES: { value: SettingsData['theme']; label: string; icon: LucideIcon }[] = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'sepia', label: 'Sepia reading', icon: BookMarked },
];

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

export function ThemeSwitcher() {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  const current = THEMES.find((t) => t.value === settings.theme) ?? THEMES[0];
  return (
    <div className="relative" ref={ref}>
      <button className="btn btn-ghost btn-icon" onClick={() => setOpen(!open)} aria-label={`Theme: ${current.label}`} aria-haspopup="menu" aria-expanded={open}>
        <current.icon />
      </button>
      {open && (
        <div className="page-in absolute right-0 z-50 mt-2 w-48 rounded-xl border border-rule bg-surface p-1 shadow-[var(--shadow-lg)]" role="menu">
          {THEMES.map((t) => (
            <button
              key={t.value}
              role="menuitemradio"
              aria-checked={settings.theme === t.value}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-elevated ${settings.theme === t.value ? 'font-medium text-ink' : 'text-muted'}`}
              onClick={() => {
                void updateSettings({ theme: t.value });
                setOpen(false);
              }}
            >
              <t.icon className="h-4 w-4" aria-hidden /> {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const auth = useStore(authState);
  const settings = useSettings();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  const name = settings.greetingName || auth.email?.split('@')[0] || 'Reviewee';
  const initials = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <div className="relative" ref={ref}>
      <button
        className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#5B8CFF] to-[#8B7CF6] text-xs font-semibold text-white"
        onClick={() => setOpen(!open)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {initials || 'B'}
      </button>
      {open && (
        <div className="page-in absolute right-0 z-50 mt-2 w-64 rounded-xl border border-rule bg-surface p-1 shadow-[var(--shadow-lg)]" role="menu">
          <div className="border-b border-rule px-3 py-2.5">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted">{auth.email ?? 'Using this device only'}</p>
            <div className="mt-2">
              <SyncBadge />
            </div>
          </div>
          <button
            role="menuitem"
            className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted hover:bg-elevated hover:text-ink"
            onClick={() => {
              setOpen(false);
              nav('/settings');
            }}
          >
            <Settings className="h-4 w-4" aria-hidden /> Settings
          </button>
          {auth.email && (
            <button
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted hover:bg-elevated hover:text-ink"
              onClick={async () => {
                setOpen(false);
                if (confirm('Sign out? Your data stays in your account; this device will be cleared.')) await signOut();
              }}
            >
              <LogOut className="h-4 w-4" aria-hidden /> Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SearchButton() {
  const nav = useNavigate();
  return (
    <button
      className="flex h-9 w-full max-w-sm items-center gap-2.5 rounded-lg border border-rule bg-surface px-3 text-sm text-faint shadow-[var(--shadow-sm)] transition-colors hover:border-rule-strong hover:text-muted"
      onClick={() => nav('/search')}
      aria-label="Search (Ctrl K)"
    >
      <Search className="h-4 w-4" aria-hidden />
      <span className="flex-1 truncate text-left">Search provisions, cases, cards…</span>
      <span className="hidden items-center gap-0.5 md:flex" aria-hidden>
        <kbd className="kbd">Ctrl</kbd>
        <kbd className="kbd">K</kbd>
      </span>
    </button>
  );
}

// Shell -------------------------------------------------------------------------

const MOBILE_TABS = [
  { to: '/today', label: 'Today', icon: LayoutDashboard },
  { to: '/syllabus', label: 'Syllabus', icon: ListChecks },
  { to: '/cards', label: 'Cards', icon: Layers },
  { to: '/practice', label: 'Practice', icon: ClipboardList },
];

export default function Layout() {
  const loc = useLocation();
  const nav = useNavigate();
  const exam = loc.pathname.startsWith('/practice/attempt/');
  const [collapsed, setCollapsed] = usePref('sidebar.collapsed', false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
    setDrawer(false);
  }, [loc.pathname]);

  // Ctrl/⌘ K, or "/" outside a text field, opens search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]');
      if ((e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        nav('/search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  if (exam) return <Outlet />;
  const current = ALL_ITEMS.find((i) => loc.pathname.startsWith(i.to));

  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside
        className={`no-print sticky top-0 z-40 hidden h-dvh shrink-0 flex-col border-r border-rule bg-sidebar transition-[width] duration-200 lg:flex ${collapsed ? 'w-[4.25rem]' : 'w-64'}`}
        aria-label="Sidebar"
      >
        <div className={`flex h-14 shrink-0 items-center ${collapsed ? 'justify-center' : 'px-5'}`}>
          <NavLink to="/today" aria-label="BARISTA home">
            <Wordmark collapsed={collapsed} />
          </NavLink>
        </div>
        <SidebarContent collapsed={collapsed} />
        <div className={`flex shrink-0 items-center border-t border-rule py-3 ${collapsed ? 'flex-col gap-3' : 'justify-between px-4'}`}>
          <SyncBadge compact={collapsed} />
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            {...(collapsed ? { 'data-tip': 'Expand sidebar' } : {})}
          >
            {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => setDrawer(false)} aria-label="Close menu" />
          <div className="page-in absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col border-r border-rule bg-sidebar pt-[env(safe-area-inset-top)] shadow-[var(--shadow-lg)]">
            <div className="flex h-14 shrink-0 items-center justify-between px-4">
              <Wordmark />
              <button className="btn btn-ghost btn-icon" onClick={() => setDrawer(false)} aria-label="Close menu">
                <X />
              </button>
            </div>
            <SidebarContent collapsed={false} onNavigate={() => setDrawer(false)} />
            <div className="shrink-0 border-t border-rule px-4 py-3">
              <SyncBadge />
            </div>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 border-b border-rule bg-[color-mix(in_srgb,var(--paper)_85%,transparent)] pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="mx-auto flex h-14 w-full max-w-[90rem] items-center gap-3 px-4 lg:px-8">
            <button className="btn btn-ghost btn-icon lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
              <Menu />
            </button>
            <span className="lg:hidden">
              <Wordmark collapsed />
            </span>
            <span className="hidden min-w-0 items-center gap-2 text-sm text-muted lg:flex">
              {current && <current.icon className="h-4 w-4" aria-hidden />}
              <span className="truncate">{current?.label}</span>
            </span>
            <div className="ml-auto flex flex-1 items-center justify-end gap-1.5 sm:gap-2">
              <div className="hidden flex-1 justify-end sm:flex">
                <SearchButton />
              </div>
              <button className="btn btn-ghost btn-icon sm:hidden" onClick={() => nav('/search')} aria-label="Search">
                <Search />
              </button>
              <ThemeSwitcher />
              <UserMenu />
            </div>
          </div>
        </header>

        <div className="no-print mx-auto w-full max-w-[90rem] px-4 pt-4 empty:hidden lg:px-8">
          <TimerBar />
        </div>
        <main id="main" key={loc.pathname} className="page-in mx-auto w-full max-w-[90rem] flex-1 px-4 pt-5 pb-28 lg:px-8 lg:pt-7 lg:pb-12">
          <Outlet />
        </main>
      </div>

      {/* Phone tab bar */}
      <nav
        className="no-print fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-rule bg-[color-mix(in_srgb,var(--sidebar)_92%,transparent)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
        aria-label="Quick navigation"
      >
        {MOBILE_TABS.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => `flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium ${isActive ? 'text-accent' : 'text-muted'}`}>
            <t.icon className="h-5 w-5" aria-hidden />
            {t.label}
          </NavLink>
        ))}
        <button className="flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-muted" onClick={() => setDrawer(true)} aria-label="More sections">
          <Menu className="h-5 w-5" aria-hidden />
          More
        </button>
      </nav>
    </div>
  );
}
