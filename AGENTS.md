# AGENTS.md

Local-first tool that crawls rendered pages of web novel sites and exports Kindle EPUBs. One Express process serves both `/api` and the built React frontend; the story library lives in local SQLite.

## Commands (from repo root)

- `npm install` — installs backend + `frontend/` (npm workspaces). Add `npx playwright install chromium` to actually crawl/render.
- `npm test` — vitest, all tests in ~2s; tests are hermetic (network and Chromium mocked), no setup needed.
- `npx vitest run src/services/crawl.test.ts -t "tên test"` — single file / single test.
- `npm run build` — `tsc` → `dist/` then `vite build` → `public/`. Required before `npm start` (it only runs `dist/server.js`); `make start` builds first.
- `npm run dev` (backend watch: `tsc --watch` + nodemon) and `npm run dev:frontend` (Vite dev server proxies `/api` → `localhost:3100`).
- `npx tsc -p frontend --noEmit` — frontend typecheck; `vite build` does NOT typecheck frontend.
- No lint/format tooling in this repo. `make help` lists Docker/packaging targets (`docker-build`, `docker-push`, `app`, `release-mac`).

## Architecture

- Entry: `src/server.ts` (Express, serves `public/` + `/api`).
- Crawl pipeline: `services/renderer.ts` (Playwright + auto-scroll) → `services/extractor.ts` (Readability + custom chrome filter) → typed `ContentBlock[]` → `services/storyStore.ts` (SQLite) → `services/epubBuilder.ts` (epub-gen).
- Per-site TOC adapters live in `src/services/toc/` (register in `index.ts`); direct chapter fetchers in `src/services/chapters/`. `services/crawl.ts` dispatches by URL: site fetcher if present, else renderer+extractor; retries 3 times.
- Story crawls run server-side after a `202` response; progress goes over SSE (`/api/stories/live` shared channel tagged `storyId`, `/api/stories/:id/live`). The manual batch crawl streams NDJSON (`POST /api/extract`). `runningCrawls` and SSE subscriber maps are in-memory in `src/routes/api.ts` — single process only.
- Trust boundary is the allowlist in `src/config/supportedSites.ts`, enforced server-side (frontend reads it from `/api/supported-sites`). New domains go there; optionally add a TOC adapter.
- `DATA_DIR` (default `./data`) holds `stories.db` + `covers/`; nothing under `data/` is committed. The Electron app points `DATA_DIR` at userData.
- Frontend is React 18 + Vite + Tailwind 4 and builds into `../public`; never hand-edit `public/` or `dist/`.

## Gotchas

- Requires Node ≥ 22.5: SQLite is `node:sqlite` `DatabaseSync` (no better-sqlite3), experimental warning is expected in test output.
- `epubBuilder.ts` downloads chapter images itself and derives extensions from magic bytes, because epub-gen guesses `mime.getType(url)` and breaks on extension-less CDN URLs. Don't hand image URLs back to epub-gen.
- `epubBuilder.ts` also embeds `<audio>`/`<video>`: epub-gen ignores them and strips `controls`, so the finished `.epub` is unzipped and patched (media files + manifest items + `controls` restored) via `packMedia`. That patch assumes epub-gen's fixed layout (`OEBPS/content.opf`, chapters at `OEBPS/*.xhtml`).
- Chapter edits ARE persisted via `PATCH /api/stories/:id/chapters/:order` ("Save Chapter").
- Crawl code re-reads the story from SQLite before `updateMeta` because a user may save meta mid-crawl — keep that read-before-write pattern.
- Never bypass login/paywall/DRM (product constraint); locked chapters must fail with a clear Vietnamese error.
- Docker runtime relies on `CHROMIUM_NO_SANDBOX=1` and expects a volume at `/app/data`. `npm run app:mac` is arm64-only, ad-hoc signed, and bundles Playwright shell Chromium via `build/ms-playwright`.

## Conventions

- Tests are colocated as `src/**/*.test.ts` (excluded from the tsc build); fixtures in `__fixtures__/`.
- Conventional commit prefixes; messages in Vietnamese or English (`feat(chapter): ...`).
- Product intent: `PRODUCT.md`. Design tokens/typography: `frontend/DESIGN.md`. Feature specs/plans: `docs/superpowers/`.
