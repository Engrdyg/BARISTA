# Tiyaga — Bar review companion

A personal, installable web app (PWA) for one reviewee preparing for the **2027 Philippine Bar Examinations**: syllabus tracker, codals with highlights, spaced-repetition cards, case digests, essay drills and mock exams, a planner, and progress projections. Works offline; syncs a laptop and a phone when Supabase is set up.

Built from `spec v0.1` (October 26, 2026). Exam facts (dates, weights, coverage cutoff) live in seed data (`src/seed/bar2027.json`) and are editable in Settings.

## What's in it

| Area | Route | Notes |
|---|---|---|
| Today | `/today` | Countdown, Baon note, today's plan or "pick up where you left off", cards due, suggested drill, this week, neglect alert. Exam days show only that day's sessions and checklist. |
| Syllabus | `/syllabus`, `/syllabus/:code` | Paste the official syllabus → preview (indent, outdent, merge, delete) → save. Re-import keeps status, notes and links; removed items go to Unmatched. |
| Codals | `/codals`, `/codals/:law` | Paste a law → split into provisions (patterns editable) → reading view with Mark read, highlights, notes, links, cloze cards. Keys `j`/`k`/`r`/`h`. |
| Cards | `/cards`, `/cards/review` | Basic and cloze cards, FSRS scheduling (`ts-fsrs`), undo, leeches, cram, CSV/Anki import, CSV export, 30-day forecast. Keys Space, 1–4, U, E. |
| Digests | `/digests` | Quick add (title + doctrine), coverage badge against the cutoff, duplicate G.R. No. warning, one-tap doctrine card. |
| Practice | `/practice`, `/practice/attempt/:id`, `/practice/grade/:id` | Problem bank (bulk paste, CSV), drills, full mocks, mock Bar days. Exam screen autosaves every change and resumes after a crash. Keyboard grading with ALAC checklist and error tags. |
| Mistakes | `/mistakes` | Mistake log and ranked weak spots (feed Today's suggested drill). |
| Planner | `/planner` | Weekly hours by weight × difficulty, at most N subjects a day, every subject at least once a week, fixed events, phases, exam-week order, missed blocks, regenerate from today. |
| Progress | `/progress` | Coverage and trend, hours vs plan, card retention, mock scores, projected GWA, where points are cheapest. |
| LMT sheets | `/lmt` | Starred doctrines, provisions (with highlights) and open mistakes in a two-column print layout; Listen reads them aloud. |
| Also | `/search`, `/log`, `/settings`, `/baon` | Offline search with `Art. 1156`, `1156 NCC` and G.R. No. shortcuts; study log and timer; settings and JSON/CSV backup; the supporter's Baon screen. |

## Run it

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # unit tests (parsers, cloze, coverage, GWA, pacing, planner)
npm run test:e2e   # full mock: start, kill the page, reopen, submit, grade
npm run build      # production build in dist/
```

Without Supabase settings the app runs **local-only**: everything stays in the browser's IndexedDB on that device. Export a backup from Settings regularly.

## Deploy

Every push runs typecheck, unit tests and the end-to-end test (`.github/workflows/deploy.yml`). Pushes to the default branch then publish to **GitHub Pages**. If the first deploy fails at "configure pages", open the repository's **Settings → Pages** and set **Source** to **GitHub Actions**, then re-run the workflow.

Vercel also works: import the repository, keep the defaults (`vercel.json` sets the SPA rewrites), and add the two environment variables below.

## Turn on sync (Supabase)

1. Create a Supabase project. In **SQL Editor**, run `supabase/migrations/0001_init.sql`.
2. In **Authentication → Users**, create two users: hers, and (optionally) the supporter's. Then link and set the supporter's role:
   ```sql
   update profiles set role = 'supporter', partner_id = '<her user id>' where id = '<supporter user id>';
   ```
3. Turn off public sign-ups (**Authentication → Sign In / Providers → Allow new users to sign up**: off).
4. Give the build the project URL and anon key:
   - GitHub Pages: **Settings → Secrets and variables → Actions → Variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, then re-run the workflow.
   - Vercel: the same two names as environment variables.
5. Open the app and sign in. Anything added while using "this device only" uploads to the account.

How sync works: the UI reads only from IndexedDB (Dexie). Every write goes to IndexedDB and an outbox; the sync worker pushes on start, on reconnect, on focus, every 60 seconds and shortly after changes, then pulls rows changed since the last pull. Conflicts resolve last-write-wins on `updated_at` (enforced by a database trigger). Deletes are soft. Row Level Security restricts every table to its owner; the supporter can only write Baon notes addressed to her and reads nothing else.

### Optional: AI notes on essays

Phase 3, off by default. Deploy the edge function and set its secret:

```bash
supabase functions deploy essay-feedback
supabase secrets set ANTHROPIC_API_KEY=... ESSAY_FEEDBACK_MODEL=claude-sonnet-5-5
```

Then turn on **AI notes** in Settings. It compares her answer only with her own reference answer and is labeled "check against the reference"; her score stays the official one.

## Project layout

```
src/lib/          data layer (Dexie, outbox sync, auth), parsers, FSRS, planner, calculations, search
src/pages/        one file per screen
src/components/   layout, dialogs, shared UI
src/seed/         2027 exam config and subjects (Appendix B)
supabase/         SQL migration (tables, RLS, triggers) and the essay-feedback edge function
tests/, e2e/      Vitest unit tests and the Playwright mock-exam test
```

## Open questions from the spec

The working name is still "Tiyaga"; review-center schedule, existing Anki decks, phone platform and whether to skip First read are left to set in the app (Planner, Cards → Import, Settings).
