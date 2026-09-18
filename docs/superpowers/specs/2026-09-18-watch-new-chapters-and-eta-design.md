# Design: Watch new chapters + remaining time ETA

Date: 2026-09-18
Status: Awaiting spec review

## 1. Objectives

1. **Watch stories + detect new chapters**: user enables "watch" for each story being read; when opening app (and when clicking "Check for new chapters"), tool compares current TOC with library and reports "N new chapters" — one click loads TOC then crawls exactly the missing chapters.
2. **Remaining time ETA**: during crawl, show estimated time remaining (with chapters/minute speed in story details) in JobStrip and story details — so a job running for tens of minutes remains easy to track.

Out of scope (non-goals):

- No background scheduled runs, no periodic checks when app is closed; no OS notifications.
- Do not auto-crawl when detecting new chapters — always require user click.
- Do not detect deleted/renamed/re-URL'd chapters; only count URLs in new TOC not already in library.
- Do not watch manually-entered stories (no TOC).
- ETA does not persist across server restart (crawl also stops on restart).

## 2. Current Context

- `POST /api/stories` (`src/routes/api.ts:229`) loads TOC, `mergeStory`
  (`src/services/storyService.ts:5`) preserves old chapters by URL, adds new chapters as `pending`, and removes chapters no longer in TOC.
- Story crawl runs in background (`api.ts:515`), progress pushed via SSE; in-memory state `runningCrawls: Map<storyId, {cursor,total}>` (`api.ts:199`), snapshot sent when connecting to `/api/stories/live`.
- `stories` table already has precedent for migration adding `language` column via
  `PRAGMA table_info` + `ALTER TABLE` (`src/services/storyStore.ts:89`).
- `StoredStory`/`StorySummary` (`src/types.ts`) don't have watch info yet;
  frontend types reflected in `frontend/src/types.ts`.
- `LibraryView` computes status chip via `crawlStatus` (`LibraryView.tsx:26`)
  from summary + `live`; StoryDetail (`StoryDetail.tsx`) shows `doneCount` and
  "Continue crawling" button.
- No ETA yet: events only carry `index/cursor/total` (`ProgressEvent`,
  `src/types.ts:40`).

## 3. Design

### 3.1 Remaining time ETA

**Pure function** in `src/services/crawl.ts`:

```ts
// Returns undefined when insufficient samples (noise) or already done.
export function estimateRemainingMs(input: {
  startedAt: number;
  completed: number;
  total: number;
  now?: number;
}): number | undefined;
```

- `now` defaults to `Date.now()`.
- Returns `undefined` if `completed < 3`, `completed >= total`, or
  `elapsed = now - startedAt <= 0`.
- Otherwise: `elapsed / completed * (total - completed)` (rounded to ms).
- Retry time is included in `elapsed`, so ETA naturally reflects slow chapters.

**Backend** (`src/routes/api.ts`):

- `runningCrawls` becomes
  `Map<string, { cursor: number; total: number; startedAt: number; etaMs?: number }>`;
  initialize `startedAt: Date.now()` when setting map (`api.ts:542`).
- After each chapter completes (success or error), recalculate
  `etaMs = estimateRemainingMs({ startedAt, completed: i + 1, total: plan.length })`
  and attach to `chapter-done`/`error` event; `/api/stories/live` snapshot includes current `etaMs` (session opened mid-crawl sees ETA immediately).
- Manual crawl `/api/extract` (`api.ts:44`): get `startedAt` at request start, attach
  `etaMs` similarly to `chapter-done`/`error` events.
- `ProgressEvent` adds `etaMs?: number` (`src/types.ts`).

**Frontend**:

- `frontend/src/types.ts`: `ProgressEvent.etaMs?`.
- `frontend/src/formatEta.ts` (new): `formatEta(ms)` → `"under 1 minute"`,
  `"~18 minutes"`, `"~1 hour 20 minutes"` (drop minutes when time rounds to hours).
- `frontend/src/useCrawlJob.ts`:
  - `CrawlJobState.etaMs?: number`, `LiveCrawl.etaMs?: number`.
  - `applyEvent` updates `etaMs` from event (preserves old value if event missing);
    `done`/`idle` events clear ETA; snapshot and `attach` also load ETA.
- Display:
  - `JobStrip`: next to `12/150 chapters` add `· ~18 minutes remaining` when ETA available.
  - `LibraryView`: status chip unchanged (`Crawling 12/150`), no ETA added
    (decision on review: ETA only in progress bar and story details).
  - `StoryDetail`: next to "chapters crawled", when `job.running && job.etaMs` show
    `~18 minutes remaining · 12 ch/min`; speed calculated from
    `(job.total - job.cursor) / (etaMs / 60000)`, no extra backend field.

### 3.2 Watch stories + new chapters

#### 3.2.1 Data

Migration following existing pattern (`storyStore.ts:89`), add 4 columns to `stories`:

| Column | Type | Meaning |
|---|---|---|
| `watching` | `INTEGER NOT NULL DEFAULT 0` | Whether story is checked for updates |
| `new_chapter_count` | `INTEGER NOT NULL DEFAULT 0` | Number of new chapters from latest check |
| `last_checked_at` | `TEXT` | ISO, latest successful check time |
| `check_error` | `TEXT` | Error from latest check (if any) |

Conventions:

- These 4 columns are **not** in `upsertStory` → `save()` (refresh TOC, create
  story) never overwrites them; only modify via 2 new methods.
- Do not update `updated_at` when toggling watch or checking: this column
  represents "last content change", used for library sorting.
- `StoredStory` and `StorySummary` (`src/types.ts` + frontend) add:
  `watching: boolean`, `newChapterCount: number`, `lastCheckedAt?: string`,
  `checkError?: string`.
- `mergeStory` (`storyService.ts`) carries these 4 fields from `existing` (default
  `false`/`0`) so returned object has complete types; values still not written by `save()`.

New store methods:

```ts
setWatching(id: string, watching: boolean): Promise<boolean>;
// undefined = preserve old value; error: null = clear error.
setCheckResult(
  id: string,
  result: { newChapterCount?: number; checkedAt?: string; error?: string | null }
): Promise<boolean>;
```

- `setWatching(true)`: only set `watching = 1`.
- `setWatching(false)`: set `watching = 0`, also clear `new_chapter_count`
  and `check_error` (no chip shown when not watched).
- `setCheckResult` reads row then updates provided fields.
- `list()`, `get()`, `getOutline()` map 4 columns (INTEGER → boolean).

#### 3.2.2 Detect new chapters

Pure function in `src/services/storyService.ts`:

```ts
export function countNewChapters(
  stored: { url: string }[],
  toc: TocChapter[]
): number;
```

- Count URLs in `toc` not already in `stored`'s URL set (preserve order irrelevant since only returning count).
- Ignore chapters missing from TOC (current refresh behavior already handles this).

#### 3.2.3 API

| Endpoint | Description |
|---|---|
| `POST /api/stories/:id/watch` `{ watching: boolean }` | Toggle watch; return `{ story }` (outline) |
| `POST /api/stories/:id/check` | Fetch TOC, count new chapters, save result; return `{ newChapterCount, lastCheckedAt, checkError }` |
| `POST /api/stories/:id/refresh` | Reload TOC for existing story (like `POST /api/stories` but no need to send URL from client), merge + save cover; reset `new_chapter_count = 0`, update `last_checked_at`; return `{ story }` |

Details:

- `watch`: 404 if story not found; `watching` must be boolean, else → 400.
- `check`: 404 if story not found; 400 if no TOC adapter; 409
  `{ message: "Story is being crawled" }` if `runningCrawls.has(id)` (client
  filters first, this is safety gate).
  - Success: `setCheckResult(id, { newChapterCount, checkedAt: now, error: null })`.
  - TOC fetch error: **preserve** old `new_chapter_count` and `last_checked_at`,
    save `check_error`, return 502 `{ message }`.
- `refresh`: 404/409 as above; share helper with `POST /api/stories`
  (normalize URL → adapter → fetchToc → mergeStory → coverStore.save →
  storyStore.save). `POST /api/stories` after successful save also reset
  `new_chapter_count = 0` + `last_checked_at = now` (harmless for unwatched stories) to avoid showing stale chip after user loads TOC.

#### 3.2.4 Frontend

`frontend/src/api.ts` adds `setStoryWatch(id, watching)`,
`checkStoryUpdates(id)` (throw message on 502), `refreshStoryToc(id)`.

`LibraryView`:

- Bell watch button in action column (next to delete), `aria-pressed`, tooltip
  "Watch for new chapters"/"Stop watching"; call `setStoryWatch` then `loadStories()`.
- `crawlStatus` priority: crawling → `newChapterCount > 0` (new chip
  `"N new chapters"`) → remaining chapters → error → done. Add `ChipState = "new"` +
  `.chip-new` in `styles.css` (token select), `bell` icon.
- Toolbar: "Check for new chapters" button shown when at least one story is
  `watching`; run checks on max 2 stories in parallel, skip crawling stories; each result updates its row immediately, finally `loadStories()` to sync; check error shows warning icon + tooltip `checkError`, preserves old count.
- App opens: after first `loadStories()`, run above flow once for all `watching`
  stories (ref guard), no confirmation, no UI blocking.

`StoryDetail`:

- "Watch"/"Watching" button (icon `bell`, `aria-pressed`) next to "Save info";
  show `timeAgo(lastCheckedAt)` ("Last checked …").
- Banner when `story.newChapterCount > 0`: "N new chapters since last crawl." + **"Load N new chapters"** button:
  1. `refreshStoryToc(id)` → new chapters become `pending`, old chapters keep content;
  2. `await onStoryChanged()` so prop `story` has new list;
  3. `handleCrawl()` → crawl all unfinished chapters (i.e. new chapters).
  Button disabled while running, label "Loading new chapters…".
- Change `onStoryChanged` signature to `() => void | Promise<void>` for await.
- Move `timeAgo` from `LibraryView` to `frontend/src/timeAgo.ts` for sharing.
- Add `bell` icon to `Icon.tsx`.

## 4. Testing & verification

Unit tests (vitest, alongside source):

- `estimateRemainingMs`: `completed` 0/1/2 → undefined; `completed >= total` →
  undefined; `elapsed <= 0` → undefined; correct formula; rounded values.
- `countNewChapters`: TOC longer, shorter, complete URL overlap, empty TOC.
- `storyStore`: old DB missing columns still opens and auto-adds 4 columns; `setWatching` on
  preserves count, off deletes count + error; `setCheckResult` partial updates
  (count / checkedAt / error null); `save()` doesn't override 4 fields; `list()`
  returns correct new fields.

Manual verification:

1. Crawl ~10-chapter story: see `~… minutes remaining` in JobStrip and story details; reload tab mid-crawl sees ETA immediately; crawl done ETA disappears.
2. Enable watch on completed story → click "Check for new chapters" → no new chapters then count = 0, `last_checked_at` updated.
3. Delete a few `chapters` rows of test story in DB (or use story with real TOC increase) → open app see "N new chapters" chip → click "Load N new chapters": TOC reloaded, only missing chapters crawled, old chapters keep content and edits.
4. Disconnect network then click "Check for new chapters": row shows warning, old new-chapter count preserved; reconnect then check succeeds and removes warning.
5. Disable watch: new chip vanishes, no check when app opens.
6. `npm test`, `npm run build`, `npx tsc -p frontend --noEmit` all pass.

## 5. Affected Components

- Backend: `src/types.ts`, `src/services/crawl.ts` (ETA function),
  `src/services/storyService.ts` (`countNewChapters`, merge preserves fields),
  `src/services/storyStore.ts` (migration + 2 methods + mapping),
  `src/routes/api.ts` (ETA in 2 crawl flows + 3 new endpoints + refresh
  helper, `runningCrawls`).
- Frontend: `frontend/src/types.ts`, `api.ts`, `useCrawlJob.ts`,
  `formatEta.ts` (new), `timeAgo.ts` (new), `components/{JobStrip,
  LibraryView, StoryDetail, StatusChip, Icon}.tsx`, `styles.css` (`.chip-new`).
- Tests: `src/services/crawl.test.ts`, `storyService.test.ts`,
  `storyStore.test.ts`.
- Docs: `README.md` (Features + Known Limitations sections).

## 6. Success Criteria

- During crawl, ETA shows in progress bar and story details, updates per chapter,
  hidden when insufficient samples or done; tab reload still shows immediately.
- Watched stories checked when opening app and on button click; new chapters show
  chip/banner with correct count; one button loads TOC + crawls only missing;
  unwatched stories untouched.
- No background process, no auto-crawl, no notifications.
- Check errors don't lose old data and display clearly.
- Tests + build pass, no regression in current crawl/export flows.

## 7. Known Limitations (document in README)

- Checks only run when app is open; each watched story costs one TOC fetch
  (multi-page stories may take seconds, max 2 in parallel).
- New chapter detection based on URL: chapter with changed URL/name still counts as new;
  chapters deleted from TOC not reported.
- Two tabs open simultaneously may check same story (only redundant fetch, no data error).
- ETA is average estimate, changes on slow chapters/retries; doesn't persist across
  server restart.
