import { lazy, Suspense, useEffect } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import Layout from './components/Layout';
import { authState } from './lib/auth';
import { useSettings } from './lib/hooks';
import { useStore } from './lib/store';
import SignIn from './pages/SignIn';
import Today from './pages/Today';

const Syllabus = lazy(() => import('./pages/Syllabus'));
const SyllabusSubject = lazy(() => import('./pages/SyllabusSubject'));
const Cards = lazy(() => import('./pages/Cards'));
const Review = lazy(() => import('./pages/Review'));
const Digests = lazy(() => import('./pages/Digests'));
const Codals = lazy(() => import('./pages/Codals'));
const LawView = lazy(() => import('./pages/LawView'));
const Practice = lazy(() => import('./pages/Practice'));
const Attempt = lazy(() => import('./pages/Attempt'));
const Grade = lazy(() => import('./pages/Grade'));
const Mistakes = lazy(() => import('./pages/Mistakes'));
const Planner = lazy(() => import('./pages/Planner'));
const Progress = lazy(() => import('./pages/Progress'));
const Search = lazy(() => import('./pages/Search'));
const Settings = lazy(() => import('./pages/Settings'));
const Log = lazy(() => import('./pages/Log'));
const More = lazy(() => import('./pages/More'));
const Lmt = lazy(() => import('./pages/Lmt'));
const Baon = lazy(() => import('./pages/Baon'));

const wrap = (el: React.ReactNode) => (
  <Suspense fallback={<div className="p-6 text-muted">Loading…</div>}>{el}</Suspense>
);

const revieweeRouter = () =>
  createBrowserRouter(
    [
      {
        element: <Layout />,
        children: [
          { path: '/', element: <Navigate to="/today" replace /> },
          { path: '/today', element: <Today /> },
          { path: '/syllabus', element: wrap(<Syllabus />) },
          { path: '/syllabus/:subject', element: wrap(<SyllabusSubject />) },
          { path: '/cards', element: wrap(<Cards />) },
          { path: '/cards/review', element: wrap(<Review />) },
          { path: '/digests', element: wrap(<Digests />) },
          { path: '/codals', element: wrap(<Codals />) },
          { path: '/codals/:law', element: wrap(<LawView />) },
          { path: '/practice', element: wrap(<Practice />) },
          { path: '/practice/attempt/:id', element: wrap(<Attempt />) },
          { path: '/practice/grade/:id', element: wrap(<Grade />) },
          { path: '/mistakes', element: wrap(<Mistakes />) },
          { path: '/planner', element: wrap(<Planner />) },
          { path: '/progress', element: wrap(<Progress />) },
          { path: '/search', element: wrap(<Search />) },
          { path: '/settings', element: wrap(<Settings />) },
          { path: '/log', element: wrap(<Log />) },
          { path: '/lmt', element: wrap(<Lmt />) },
          { path: '/more', element: wrap(<More />) },
          { path: '*', element: <Navigate to="/today" replace /> },
        ],
      },
    ],
    { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
  );

const supporterRouter = () =>
  createBrowserRouter(
    [
      { path: '/baon', element: wrap(<Baon />) },
      { path: '*', element: <Navigate to="/baon" replace /> },
    ],
    { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
  );

let routers: { reviewee?: ReturnType<typeof revieweeRouter>; supporter?: ReturnType<typeof supporterRouter> } = {};

function useTheme() {
  const s = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = s.theme === 'system' ? '' : s.theme;
    if (s.theme === 'system') delete root.dataset.theme;
    root.style.setProperty('--text-scale', String(s.textSize / 100));
    root.style.setProperty('--read-line', String(s.lineHeight));
    const dark =
      s.theme === 'dark' || (s.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#161920' : '#F5F6F8');
  }, [s.theme, s.textSize, s.lineHeight]);
}

export default function App() {
  const auth = useStore(authState);
  useTheme();
  if (!auth.ready) return <div className="p-6 text-muted">Opening…</div>;
  if (!auth.email && !auth.localOnly) return <SignIn />;
  if (auth.role === 'supporter') {
    routers.supporter ??= supporterRouter();
    return <RouterProvider router={routers.supporter} />;
  }
  routers.reviewee ??= revieweeRouter();
  return <RouterProvider router={routers.reviewee} />;
}

export function resetRouters() {
  routers = {};
}
