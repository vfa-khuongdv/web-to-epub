# Design: End-to-end test suite for the whole web app

Date: 2026-09-21
Status: Awaiting spec review

## 1. Objectives

1. **E2E suite covering all web flows**: a Playwright suite that drives the real
   built app (`dist/server.js` + `public/`) and exercises the whole product —
   library, crawl pipeline (real Chromium renderer + extractor), story detail,
   reader/highlights, EPUB export, private mode, and app chrome (i18n/theme).
2. **Hermetic and deterministic**: no real supported site, no flaky network.
   Chapters are crawled from a test-only local fixture site, so renderer,
   extractor, SQLite, SSE, EPUB builder all run for real.
3. **Zero production-code changes**: test state is seeded through the app's own
   compiled `StoryStore`; the crawl route has no allowlist check, so a seeded
   story with fixture URLs exercises the real pipeline (see §2).

Out of scope (non-goals):

- Add-by-URL happy path and watch/check happy path (both require a real
  allowlisted site + TOC adapter; already unit-tested, see §7).
- Electron packaging, Docker image, real-site smoke tests, visual regression.
- CI wiring was out of scope when this design was written and was added afterwards:
  `.github/workflows/ci.yml` runs `npm test`, both typechecks and
  `npm run test:e2e` on pushes and PRs.
- Changes to `npm test`: the vitest suite stays hermetic and untouched.

## 2. Current Context

- Existing tests are vitest unit tests (`src/**/*.test.ts`) with network and
  Chromium mocked; `npm test` runs in ~2s. No E2E exists. No CI. No
  `data-testid` anywhere (selectors must use roles/labels/`t()` text).
- `playwright` (library, ^1.47) is already a dependency for crawling; the test
  runner `@playwright/test` is not installed.
- `POST /api/stories` (add by URL) requires `findSupportedSite` **and** a
  matching `getTocAdapter` (`src/routes/stories.ts:45-56`), so it cannot be
  driven hermetically without touching production code.
- `POST /api/stories/:id/crawl` (`src/routes/crawl.ts:11`) only needs a story
  in the DB; it crawls whatever chapter URLs are stored. Chapter URLs can point
  at a local fixture server, so the real path
  `renderer.ts → extractor.ts → storyStore.ts → SSE` runs unmodified.
- Renderer acceptance thresholds for fixture pages: rendered HTML ≥ 1500 chars
  (`MIN_RENDERED_HTML_LENGTH`), settled text ≥ 500 chars (`MIN_SETTLED_TEXT`)
  after a stable round + 500ms (`SETTLE_MIN_MS`/`SETTLE_MAX_MS`).
- `extractWithRetry` retries up to 12 attempts; `LockedContentError` breaks out
  immediately (`src/services/crawl.ts:53-69`), so a "locked" fixture page is a
  fast, deterministic failure path.
- `storyStore.ts` uses `DatabaseSync` with **WAL**, and exports
  `createStoryStore(baseDir)` + `storyId(url)` — the test process can open its
  own connection to the same DB the server is using.
- `DATA_DIR` (default `./data`) resolves at import time
  (`src/config/paths.ts`); private mode uses `DATA_DIR/private`.
- Frontend: default language `vi` (`DEFAULT_LANG`), stored in `localStorage.lang`;
  theme in `localStorage.theme`; reader prefs `reader-prefs`, per-story reading
  position — keys in `frontend/src/lib/readerPreview.ts`.
- Vitest's default `include` matches `*.spec.ts` too, which is why this suite
  uses `*.e2e.ts` naming (see §3.1) — `npm test` must not pick up E2E specs.

## 3. Design

### 3.1 Harness & lifecycle

New files:

```
playwright.config.ts
e2e/tsconfig.json           # editor/typecheck only (root tsconfig untouched)
e2e/fixture-site.mjs        # test-only HTTP server (fake novel pages + assets)
e2e/helpers/fixtures.ts     # test.extend: pins lang=en via addInitScript
e2e/helpers/env.ts          # ports, DATA_DIR, base URLs
e2e/helpers/seed.ts         # seed stories/chapters/highlights through dist store
e2e/helpers/epub.ts         # download + fflate.unzipSync + EPUB assertions
e2e/tests/*.e2e.ts          # one file per area (see §3.4)
```

- **Runner**: `@playwright/test` (same 1.47 line as `playwright`). Chromium is
  already required by the app (`npx playwright install chromium`) and the
  renderer and test browser share the same browser cache.
- **Naming**: specs are `*.e2e.ts` and Playwright is configured with
  `testMatch: "**/*.e2e.ts"`, so vitest keeps matching only `*.test.ts`.
  `npm test` behavior is unchanged.
- **Config**: `testDir: e2e/tests`, `workers: 1`, `fullyParallel: false`,
  `retries: 1`, `trace: "on-first-retry"`, `screenshot: "only-on-failure"`,
  `reporter: [["list"], ["html", { open: "never" }]]`,
  `use.baseURL: http://127.0.0.1:4310`.
- **Isolation**: `DATA_DIR = <repo>/e2e/.data`, wiped by the app's `webServer`
  command (`rm -rf e2e/.data && node dist/server.js`) so the wipe and the DB
  open happen in the same process — Playwright config modules can be
  re-evaluated per worker, so the wipe must not live there. Kept after the run
  for DB inspection. Gitignored. Ports 4310 (app) / 4311 (fixture) avoid the
  dev server's 3100.
- **webServer array**:
  - app: `node dist/server.js` with `PORT=4310`, `DATA_DIR`, readiness
    `GET /api/supported-sites`;
  - fixture: `node e2e/fixture-site.mjs` with `PORT=4311`, readiness `/healthz`.
- **Build step**: `package.json` gets
  `"test:e2e": "npm run build && playwright test"` so the suite always tests
  the real artifact; `--headed`/`--debug` pass through
  (`npm run test:e2e -- --headed`).
- **Serial by design**: one app process holds the library, vault session,
  `runningCrawls` and SSE subscribers in memory; one worker keeps specs
  deterministic. Spec files that mutate global state (vault) are additionally
  `test.describe.serial`.

### 3.2 Fixture site (`e2e/fixture-site.mjs`)

Plain Node `http` server, no dependencies, stateless except per-URL hit
counters for `mode=flaky`.

| Route | Purpose |
|---|---|
| `GET /healthz` | readiness for `webServer` |
| `GET /truyen/:slug/chuong-:n` | chapter page: realistic shell (nav/header/footer) + `<article>` with ≥ 5 Vietnamese paragraphs containing a unique marker token `E2E-<slug>-<n>`; page text ≥ 1200 chars and HTML ≥ 1500 chars so the renderer accepts it |
| same, `?mode=flaky&fails=N` | first N hits return a short shell (< 1500 chars → renderer throws → real retry), then the full page |
| same, `?mode=locked` | body contains the exact Vietnamese anti-adblock notice that `LOCKED_CONTENT_RE` matches (copy the wording from `src/services/extractor.ts` when implementing) → `LockedContentError` |
| `GET /cover/:slug.png` | tiny valid PNG (magic bytes matter for cover download) |
| `GET /media/pixel.png` | tiny valid PNG used as an inline `<img>` in chapter pages |
| `GET /media/tone.mp3` | synthetic MP3 stub (frame-sync bytes) for the `<audio>` export-patch case — verifies wiring, not decodable audio |

Chapter pages deliberately contain no `<audio>`: the export spec seeds an audio
block directly, so ordinary crawls and exports never depend on media downloads.
Chapter pages use semantic markup Readability extracts cleanly, and images
resolve to the fixture host so `epubBuilder`'s own download path runs for real.
Hit counters mean a Playwright retry of a flaky test sees the page already
"healed"; the test still asserts the end state it wants (done, not error).

### 3.3 Seeding (`e2e/helpers/seed.ts`)

Runs inside the Playwright worker:

- Sets `process.env.DATA_DIR` first, then
  `createRequire(__filename)("../../dist/services/storyStore.js")` — seeding
  uses the app's real store code, so a schema change breaks loudly instead of
  silently diverging.
- API:
  - `seedStory({ title, url?, author?, language?, coverUrl?, watching?,
    newChapterCount?, checkError?, chapters: [{ title, url, status, blocks? }] })
    → { id, url }` — URL defaults to a fixture URL derived from the title;
  - `removeStory(id)`, `resetLibrary()` (list + remove all, for the empty-state
    and bulk-delete specs);
  - `privateStore()` — `createStoryStore(path.join(DATA_DIR, "private"))` for
    vault specs;
  - `seedHighlights(id, highlights)`, `setChapterStatus(...)` as thin wrappers.
- Reader/export specs seed `blocks` directly (heading/paragraph/image), so they
  don't depend on a crawl; crawl specs seed `status: "pending"` + fixture URLs.
- SQLite WAL allows the worker's connection while the server reads/writes;
  writes are short and the suite is serial. If `SQLITE_BUSY` shows up, add
  `PRAGMA busy_timeout` in the helper's own connection (not in the app).

### 3.4 Spec coverage

Language is pinned to English by `e2e/helpers/fixtures.ts` (init script sets
`localStorage.lang = "en"`) so accessible names match the `t()` keys.

| Spec | Scenarios |
|---|---|
| `library.e2e.ts` | empty state; seeded stories listed with counts; open story; add-by-URL rejection for an unsupported domain (localized notice, nothing added); delete one story; bulk-select delete; watch toggle persists across reload |
| `crawl.e2e.ts` | real crawl of 3 fixture chapters via "Continue crawl": progress chip + JobStrip reach done (`expect.poll`), DB all `done` with extracted marker text, title updated from the page, cover downloaded (`GET /stories/:id/cover` 200); `mode=flaky` chapter recovers after retries; `mode=locked` chapter ends `error` with the Vietnamese locked message + Retry; a UI Retry on a seeded error chapter flips it to done |
| `story-detail.e2e.ts` | metadata edit/save incl. clearing author, persisted after reload; cover upload via `setInputFiles` (helper writes a tiny PNG to `e2e/.data/`), 404 placeholder case; chapter edit → "Save chapter" → persisted (PATCH route); seeded `watching`/`newChapterCount`/`checkError` chips render; "Load N new chapters" surfaces the no-TOC-adapter error branch |
| `reader.e2e.ts` | overlay renders seeded blocks inside the sandboxed iframe; prev/next navigation; reading position restored after close/reopen; reader prefs persist across reload; one UI-driven highlight created by selecting text in the frame (`frameLocator` + mouse drag), then recolor + delete; API-seeded highlights render in-frame and in the panel, panel jump to another chapter |
| `export.e2e.ts` | there is no export dialog — export uses the metadata form, so: seed 2 done chapters + 1 error + 1 pending, edit the open chapter without saving, click "Export EPUB", catch the Playwright `download`, `fflate.unzipSync` and assert `mimetype`, `OEBPS/content.opf` (title/author/language/cover), the unsaved edit is present, error and pending chapters are absent, the inline image file + manifest item exist, and an `<audio>` chapter keeps its media file, manifest item and `controls` after `packMedia` |
| `vault.e2e.ts` | Cmd/Ctrl+Shift+N setup flow (6-digit validation, wrong code error); private library shows a seeded private story and the public library never does (isolation both directions); lock returns to public; a private crawl gets live progress (per-library crawl state); stale session — `POST /vault/lock` with the token captured from an outgoing request header (the token lives in memory, never in localStorage) — then the next UI request gets 401 and the app drops back to the public library |
| `chrome.e2e.ts` | vi↔en toggle changes visible strings and persists, and server errors come back localized; theme cycle auto→light→dark sets `data-theme` + persists, `emulateMedia` drives auto; supported-sites popover lists all 6 allowlist entries and closes on Escape |

### 3.5 Selector strategy

`getByRole` + accessible name, `getByTitle`/`aria-label` where the app already
provides them, scoped locators inside cards/rows. No `data-testid` additions are
planned; if an element turns out to be genuinely unselectable, stop and raise it
rather than editing components.

### 3.6 Diagnostics

Trace on first retry, screenshot on failure, `list` + `html` report (never
auto-opened). `e2e/.data` retained after the run; Playwright's
`test-results/` and `playwright-report/` are gitignored.

### 3.7 Scripts & docs

- `package.json`: devDependency `@playwright/test`; script `test:e2e`.
- `Makefile`: `e2e` target (`npm run test:e2e`), listed in `make help`.
- `.gitignore`: `/e2e/.data/`, `/test-results/`, `/playwright-report/`.
- `AGENTS.md`: new "E2E tests" note — run command, Chromium requirement, temp
  data dir, serial execution, intentional gaps, `npm test` stays hermetic,
  `npx tsc -p e2e --noEmit` typechecks the suite.
- No changes to `README.md`, `src/**`, or `frontend/**`.

## 4. Testing & verification of the suite itself

1. `npm run build` and `npx tsc -p e2e --noEmit` pass.
2. `npm run test:e2e` green on a clean checkout with Chromium installed; target
   runtime under ~4 minutes; repeat run green (idempotent, fresh `.data`).
3. `npm test` still passes unchanged and fast.
4. Sabotage check once during development: break one expectation/selector
   intentionally to confirm the suite fails (no false-green), then revert.
5. `npm run test:e2e -- --headed` works for debugging (documented).

## 5. Affected Components

- New: `playwright.config.ts`, `e2e/` (config, fixture site, helpers, specs).
- Edited: `package.json` (devDep + script), `Makefile` (`e2e` target),
  `.gitignore`, `AGENTS.md`.
- Untouched: all of `src/`, `frontend/`, `public/`, `dist/` semantics; `npm test`
  and vitest behavior.

## 6. Success Criteria

- One command (`npm run test:e2e`) runs every web flow against the real built
  app, including a real Chromium crawl from the fixture site, real SSE progress,
  a real EPUB download validated by unzip, and real private-mode isolation.
- The suite is deterministic on repeat runs, has useful failure artifacts, and
  leaves `data/`, `npm test`, and the dev workflow untouched.
- Known gaps are documented rather than papered over.

## 7. Known Gaps & Limitations

- **Add-by-URL happy path** (`POST /stories` → TOC adapter) and **watch/check
  happy path** cannot run hermetically without a test seam in production code;
  they stay covered by unit tests (`src/services/toc/*.test.ts`,
  `storyService.test.ts`). Their error branches are covered in E2E.
- Chapter-title refinement (`pickChapterTitle`) stays unit-tested, not E2E'd: the
  crawl spec asserts extracted content and status, not title rewriting.
- Only the `error`/`new chapters` UI branches for those routes are E2E'd.
- Real-site behavior (anti-bot blanking, custom adapters) is not covered; the
  renderer's blanked-page path is unit-level only.
- Electron app, Docker/`CHROMIUM_NO_SANDBOX`, and arm64 packaging are out of
  scope.
- The suite is serial by design; adding parallel workers would need per-worker
  app processes and data dirs.
- The audio fixture is a synthetic MP3 stub (frame-sync bytes, not decodable
  audio): it verifies the manifest/file/`controls` patch, not playback.
- The reader paints highlights only when the chapter iframe loads; a highlights
  fetch that resolves after the first load leaves marks unpainted until the
  next load. The E2E reader spec forces one chapter reload before asserting
  marks (the app-side repaint is left as a known limitation, out of scope).
- Highlight creation by mouse-selecting text inside a sandboxed iframe is the
  most fragile interaction in the suite; if it proves unstable after one
  attempt, keep API-seeded highlights + UI recolor/delete and note the gap.
