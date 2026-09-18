# Design: Story management + automatic load all chapters

Date: 2026-09-17
Status: Awaiting spec review

## 1. Objectives

1. **Story management**: save crawl progress per story (completed/error/pending chapters + extracted content), so users know where the crawler is and can resume later (even after closing the tab/browser).
2. **Enter story URL → load all chapters**: just paste a story page URL
   (e.g., `https://truyenfull.live/dau-xuan-tuoi-sang/`), the system automatically fetches the chapter list and loads it into the story for gradual crawling.

Out of scope (non-goals):

- Do not persist manual edits (edit chapter title/content) — as currently, edits only serve export in the current session.
- Do not automatically crawl immediately after loading the chapter list (user clicks "Continue crawling").
- Do not support TOC adapter for `metruyenchu.com` (currently blocked by Cloudflare, manual chapter crawling still works as before).

## 2. Current Context

- Express backend (`src/`), React+Vite frontend (`frontend/`), no persistence: closing the tab loses all crawl results.
- `/api/extract` receives a list of chapter URLs, renders each page with Playwright
  (`src/services/renderer.ts`), extracts using Readability + DOM walking
  (`src/services/extractor.ts`), retries via `extractWithRetry`
  (`src/routes/api.ts`).
- Frontend single page: chapter URL textarea → crawl → preview/edit → export EPUB.

## 3. Architecture

### 3.1 Story store (JSON file)

- Stored at `data/stories/<id>.json` (add `data/` to `.gitignore`).
- `id = sha1(normalizedStoryUrl).slice(0, 16)` (node crypto) — stable across runs, prevents collisions when two different stories have the same content.
- Atomic write: write to `<id>.json.tmp` then `rename` to overwrite the main file.
- `list()` skips corrupted files (logs warning), does not crash the API.

Data model:

```ts
interface StoredChapter {
  order: number;                                  // position in TOC
  url: string;
  title: string;                                  // from TOC, updated from extract result
  status: "pending" | "done" | "error";
  error?: string;
  blocks?: ContentBlock[];                        // extracted content
}

interface StoredStory {
  id: string;
  storyUrl: string;                               // normalized story URL
  site: string;                                   // domain, e.g. "truyenfull.live"
  title: string;
  author?: string;
  coverUrl?: string;
  chapters: StoredChapter[];
  createdAt: string;                              // ISO
  updatedAt: string;
}
```

Conventions:

- `GET /api/stories` returns summary: `{id, storyUrl, site, title, chapterCount,
  doneCount, errorCount, updatedAt}` (no blocks included).
- Refresh TOC for existing story: preserve `status`/`blocks`/`error` of old chapters by URL; new chapters added as `pending`; `order` updated per new TOC; update `title`/`author`/`coverUrl` from TOC.
- Do not persist user edits (v1 limitation, document in README).

### 3.2 TOC adapters

Common interface (`src/services/toc/`):

```ts
interface TocResult {
  title: string;
  author?: string;
  coverUrl?: string;
  chapters: { url: string; title: string }[];
}

interface TocAdapter {
  domains: string[];                              // exact hostname match
  fetchToc(storyUrl: string): Promise<TocResult>;
  normalizeStoryUrl(url: string): string;         // convert chapter URL → story URL
}
```

`src/services/toc/index.ts` selects adapter by hostname; returns clear error
("This page does not yet support automatic chapter list loading") if no adapter exists.

**a) Truyenfull template adapter** (`truyenfullTemplate.ts`), used for
`truyenfull.live`, `truyenfull.vn`, `truyencom.com`:

- Fetch HTML using regular `fetch` (server-rendered, no Playwright needed).
- Story page: title from `[itemprop="name"]` → `h1` → `<title>`; author
  from `a[itemprop="author"]`; cover from `img[itemprop="image"]`.
- TOC: `#list-chapter ul.list-chapter a[href]`, preserve document order, deduplicate.
- Total pages: from `#total-page` if present; otherwise (truyencom): get largest page number from `ul.pagination`; if still undetermined then loop until page has no new chapters.
- Next pages: `{storyUrl}trang-N/`, merge chapters in order.
- `normalizeStoryUrl`: strip trailing `chuong-...` segment from path (including `.html`).

**b) Xtruyen adapter** (`xtruyen.ts`), used for `xtruyen.vn`:

- Fetch story page HTML → get `manga_id` from
  `#manga-chapters-holder[data-id]`; title/author best-effort from `h1`/`title`.
- Call `POST {origin}/api/api-chapters.php` with body
  `manga_id=<id>&from=<a>&to=<b>&vol=`, headers:
  `x-custom-auth: abC0000011111`, `X-Requested-With: XMLHttpRequest`,
  `Referer: <storyUrl>`, content-type form-urlencoded.
- Loop in windows of 200 chapters (`1-200`, `201-400`, ...) until response is empty or smaller than window; response JSON `[{"s":"chuong-1","n":"Chương 1","e":""}]`.
- Chapter URL = `{storyUrl}{s}/`; title = `n`.
- `normalizeStoryUrl`: strip trailing `chuong-...` segment from path.

### 3.3 Shared crawl service

- Move `MAX_ATTEMPTS` + `extractWithRetry` from `src/routes/api.ts` to
  `src/services/crawl.ts`; both `/api/extract` and story crawling use it.
- Keep existing retry logic unchanged (preserve `LockedContentError` handling).

### 3.4 New API

| Endpoint | Description |
|---|---|
| `POST /api/stories` `{url}` | Normalize URL, check site support + adapter, fetch TOC, create/update record, return full story (with chapters) |
| `GET /api/stories` | List of summaries + progress |
| `GET /api/stories/:id` | Full story (with blocks of `done` chapters) |
| `POST /api/stories/:id/crawl` `{orders?}` | NDJSON like `/api/extract`. By default crawl `pending` + `error`; if `orders` provided then only those chapters (including `done` — for "re-crawl"). Each completed/errored chapter saved to store immediately |
| `DELETE /api/stories/:id` | Delete record; return 409 if crawling |

`/crawl` details:

- In-memory lock per `storyId` (Set) — duplicate crawl returns 409
  (`{message: "Story is being crawled"}`). Delete lock in `finally`.
- NDJSON events preserve current format: `progress` (each attempt),
  `error` (errored chapter), `done` (with full chapter from store after crawl completes). Frontend logs realtime like manual tab.
- If client disconnects mid-crawl, loop continues and keeps saving each chapter (reopen to see progress later). Document clearly in README.
- After each chapter: update `status`, `title` (from extract result), `error`,
  `blocks`, `updatedAt` then write file.

Errors:

- URL not from supported site → 400 as before.
- Site supported but no TOC adapter (metruyenchu) → 400 with specific message.
- Fetch TOC fails/timeout → 502 `{message}`; do not create orphaned record.

### 3.5 Frontend

- `App.tsx` serves as shell + 2 tabs (local state, default "Manual crawl" tab):
  - **"Manual crawl"** tab: move entire current UI as-is to
    `frontend/src/components/ManualCrawlView.tsx` (no behavior change).
  - **"My Stories"** tab: `LibraryView.tsx` + `StoryDetail.tsx`.
- Export section (upload cover + call `exportEpub` + download file) extracted to shared component/hook for both tabs, avoid code duplication.
- `LibraryView`:
  - Story URL input + "Load chapter list" button → `POST /api/stories`
    → open StoryDetail directly.
  - Story list: name, site, progress `done/total` (progress bar), error count,
    `updatedAt`; click to open details; delete button (confirm).
- `StoryDetail`:
  - Story info: title/author/cover (from TOC; cover displays thumbnail only,
    export v1 still uses uploaded cover file like before).
  - Progress + "Continue crawling (N chapters)" button (N = pending + error) and progress log.
  - Chapter list reuses `ChapterCard`, add status badge
    `pending | error | done`; errored chapters have "Retry" calling
    `POST /api/stories/:id/crawl {orders:[n]}`.
  - Export EPUB with metadata (title/author/language) prefilled from story.
  - After crawl completes (done event), update chapters from store payload.
- `frontend/src/api.ts` + `types.ts`: add functions/types for 4 endpoints above.

## 4. Testing & verification

- Add `vitest` (devDependency) + script `"test": "vitest run"`; place tests alongside
  source (`src/services/...test.ts`), fixtures in `__fixtures__/`.
  - Test TOC template parser truyenfull: fixture HTML of story page
    (truyenfull.live) → title/author/cover, chapter list, total pages calculation.
  - Test truyencom parser (no `#total-page`).
  - Test xtruyen parser: fixture HTML + fixture JSON API → assemble chapter URLs.
  - Test `normalizeStoryUrl` for both adapter groups (chapter URL with/without `.html`).
  - Test storyStore: create/update/list/delete + atomic write (tmp directory).
- Manual verification (after coding):
  1. `POST /api/stories` with `https://truyenfull.live/dau-xuan-tuoi-sang/`
     → ~150 chapters / 3 pages.
  2. Partial crawl → close tab → reopen: correct number of `done` chapters, "Continue crawling"
     only crawls remainder.
  3. Add story from `xtruyen.vn` → chapter list matches web TOC.
  4. Export EPUB from crawled story to readable file.
  5. "Manual crawl" tab works exactly as before (no regression).
  6. `npm test` pass; `npm run build` pass.

## 5. Affected Components

- `.gitignore` (add `data/`), `package.json` (vitest + test script), `README.md`.
- Backend: `src/services/storyStore.ts` (new), `src/services/crawl.ts` (new,
  extracted from routes), `src/services/toc/{index,truyenfullTemplate,xtruyen}.ts`
  (new), `src/routes/api.ts`, `src/types.ts`.
- Frontend: `App.tsx`, `api.ts`, `types.ts`,
  `components/{ManualCrawlView,LibraryView,StoryDetail}.tsx` (new).

## 6. Success Criteria

- Enter supported story URL → see complete chapter list with `pending` status.
- Partial crawl then close tab → reopen shows correct progress; "Continue crawling" only runs unfinished chapters; errored chapters can be retried.
- Export EPUB from crawled story works like current flow.
- No regression in manual tab; unit tests for TOC/store pass.

## 7. Known Limitations (document in README)

- Only automatically load TOC for `truyenfull.live`, `truyenfull.vn`, `truyencom.com`,
  `xtruyen.vn`; `metruyenchu.com` requires manual chapter URL entry.
- Do not persist chapter/book edits (only save raw crawl results).
- Very long stories (thousands of chapters) may cause heavy UI when opening details due to loading all crawled content.
- If a site changes HTML/API structure, the TOC adapter may break (clear error, no orphaned records).
