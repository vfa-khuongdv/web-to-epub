# AGENTS.md

Local-first tool that crawls rendered pages of web novel sites and exports Kindle EPUBs. One Express process serves both `/api` and the built React frontend; the story library lives in local SQLite.

## Commands (from repo root)

- `npm install` — installs backend + `frontend/` (npm workspaces). Add `npx playwright install chromium` to actually crawl/render.
- `npm test` — vitest, all tests in ~2s; tests are hermetic (network and Chromium mocked), no setup needed.
- `npx vitest run src/services/crawl.test.ts -t "test name"` — single file / single test.
- `npm run build` — `tsc` → `dist/` then `vite build` → `public/`. Required before `npm start` (it only runs `dist/server.js`); `make start` builds first.
- `npm run dev` (backend watch: `tsc --watch` + nodemon) and `npm run dev:frontend` (Vite dev server proxies `/api` → `localhost:3100`).
- `npx tsc -p frontend --noEmit` — frontend typecheck; `vite build` does NOT typecheck frontend.
- No lint/format tooling in this repo. `make help` lists Docker/packaging targets (`docker-build`, `docker-push`, `app`, `release-mac`).

## Architecture

- Entry: `src/server.ts` (Express, serves `public/` + `/api`).
- Crawl pipeline: `services/renderer.ts` (Playwright + auto-scroll) → `services/extractor.ts` (Readability + custom chrome filter) → typed `ContentBlock[]` → `services/storyStore.ts` (SQLite) → `services/epubBuilder.ts` (epub-gen).
- Reader/preview: `frontend/src/components/ReaderOverlay.tsx` renders a chapter in a sandboxed iframe (no `allow-scripts`, chapter HTML is crawled) using the export's own `KINDLE_CSS`, so what is on screen is what the EPUB will contain. Highlights live in the `highlights` table and anchor by character offsets into the chapter's plain text (`frontend/src/highlightDom.ts`); reading position and reader preferences are per-browser in `localStorage`.
- UI language: everything user-facing goes through `t()` — `frontend/src/i18n/` on the client (one file per language under `i18n/locales/`, registered in `i18n/locales/index.ts`) and `src/services/lang.ts` on the server (Vietnamese wording only, English keys). Keys are the English source text, so a missing entry renders English; `i18n/locales.test.ts` keeps every language's key set and placeholders aligned with `en.ts`, so adding a language is a new locale file plus one registry entry.
- Per-site TOC adapters live in `src/services/toc/` (register in `index.ts`); direct chapter fetchers in `src/services/chapters/`. `services/crawl.ts` dispatches by URL: site fetcher if present, else renderer+extractor; retries 3 times.
- Story crawls run server-side after a `202` response; progress goes over SSE (`/api/stories/live` shared channel tagged `storyId`, `/api/stories/:id/live`). `runningCrawls` and SSE subscriber maps are in-memory in `src/routes/api.ts` — single process only.
- Trust boundary is the allowlist in `src/config/supportedSites.ts`, enforced server-side (frontend reads it from `/api/supported-sites`). New domains go there; optionally add a TOC adapter.
- `DATA_DIR` (default `./data`) holds `stories.db` + `covers/`; nothing under `data/` is committed. The Electron app points `DATA_DIR` at userData.
- Private mode ("ẩn danh", Cmd/Ctrl+Shift+N — also +K, because Chrome keeps +N): a second library under `DATA_DIR/private/` (own `stories.db`, `covers/`, `lock.json`) behind a 6-digit code. `services/vault.ts` hashes the code with scrypt and hands out an in-memory session token; every route in `src/routes/api.ts` picks its `Library` via `libraryFor(req, res)` (token in `X-Vault-Token`, or `?vault=` for the SSE channel and cover `<img>`), so crawl state and live channels are per library too. Frontend: `frontend/src/vault.tsx` + `vaultToken.ts`; switching modes remounts `<App>` from `main.tsx`.
- Frontend is React 18 + Vite + Tailwind 4 and builds into `../public`; never hand-edit `public/` or `dist/`.

## Gotchas

- Requires Node ≥ 22.5: SQLite is `node:sqlite` `DatabaseSync` (no better-sqlite3), experimental warning is expected in test output.
- `epubBuilder.ts` downloads chapter images itself and derives extensions from magic bytes, because epub-gen guesses `mime.getType(url)` and breaks on extension-less CDN URLs. Don't hand image URLs back to epub-gen.
- `epubBuilder.ts` also embeds `<audio>`/`<video>`: epub-gen ignores them and strips `controls`, so the finished `.epub` is unzipped and patched (media files + manifest items + `controls` restored) via `packMedia`. That patch assumes epub-gen's fixed layout (`OEBPS/content.opf`, chapters at `OEBPS/*.xhtml`).
- Chapter edits ARE persisted via `PATCH /api/stories/:id/chapters/:order` ("Save Chapter").
- Crawl code re-reads the story from SQLite before `updateMeta` because a user may save meta mid-crawl — keep that read-before-write pattern.
- Never bypass login/paywall/DRM (product constraint); locked chapters must fail with a clear Vietnamese error.
- Private mode is a lock on the app, not encryption: `data/private/stories.db` is a plain SQLite file. Don't describe it as encrypted, and don't let an invalid token fall back to the public library — `libraryFor` answers 401 and returns `null` for exactly that reason.
- `LOCKED_CONTENT_RE` in `extractor.ts` matches text on the *crawled page*, not text this app writes — the supported sites publish their anti-adblock notices in Vietnamese. Translating it silently turns the check off (it already happened once).
- `KINDLE_CSS` is exported from `epubBuilder.ts` and mirrored in `frontend/src/readerPreview.ts`; they must stay identical or the reader stops being an honest preview.
- Server-side wording is module state in `services/lang.ts`, set per request from the `X-Lang` header. Fine because the app is single-process and single-reader; it would have to be per-request in a multi-user server. It defaults to English when the header is absent, which is what the tests rely on.
- Docker runtime relies on `CHROMIUM_NO_SANDBOX=1` and expects a volume at `/app/data`. `npm run app:mac` is arm64-only, ad-hoc signed, and bundles Playwright shell Chromium via `build/ms-playwright`.

## Conventions

- Tests are colocated as `**/*.test.ts` — backend under `src/` (excluded from the tsc build), frontend under `frontend/src/`; fixtures in `__fixtures__/`.
- Style UI with **Tailwind utilities at the call site** — the `@theme` tokens in `frontend/src/styles.css` are utilities too (`bg-raised`, `text-ink-2`, `border-rule-2`, `rounded-tool`, …), so dark mode follows automatically. Do not add new component classes to `styles.css`; the ones already there are legacy and get removed only when the element using them is reworked.
- Conventional commit prefixes; messages in Vietnamese or English (`feat(chapter): ...`).
- Product intent: `PRODUCT.md`. Design tokens/typography: `frontend/DESIGN.md`. Feature specs/plans: `docs/superpowers/`.
