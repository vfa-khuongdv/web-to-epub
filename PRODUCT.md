# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the tool's owner, a Vietnamese web-novel reader working from their own
desktop machine. They read long serialized stories (a typical story is ~150
chapters; outliers run to thousands) on a Kindle, and they crawl in batches over
days or weeks — resuming a story, retrying failed chapters, checking how far the
crawl got — rather than in a single sitting.

## Product Purpose

Turn a web page's rendered text into a Kindle-ready EPUB file, including pages
that use CSS/JS to block selecting, copying, or right-clicking. Two paths serve
that work: a manual paste-URLs-then-export flow for one-off grabs, and a
persistent story library that stores a story's chapter list and crawl progress in
local SQLite so a crawl can be paused, resumed, and retried across sessions.
Success is a valid EPUB side-loaded onto a Kindle without ever touching the
browser's copy button, plus the confidence to return to a half-crawled story
weeks later and know exactly where it stopped.

## Positioning

Copy protection is bypassed at the rendering layer, not the input layer:
Playwright loads the page in a real headless Chromium with JS/CSS fully executed,
and extraction reads `page.content()` — the rendered DOM — directly.
`user-select: none`, `oncopy`, `oncontextmenu`, and keyboard-blocking scripts
only stop a human in a browser; they are irrelevant to a server-side DOM read.
That is what a clipboard-scraping bookmarklet or manual copy-paste cannot
truthfully claim.

## Operating Context

- Runs locally on the owner's machine; one Express process serves both the API
  and the built frontend. No accounts, no sharing, nothing leaves the machine.
- Desktop browser only: crawling needs Playwright on the same machine.
- Sources are Vietnamese serial-novel sites; the eventual reading device is a
  Kindle, so EPUB is the deliverable format, not an in-app reader.
- Bulk work is the norm. Crawls run for minutes, produce per-chapter successes
  and failures, and continue server-side even if the tab is closed, so progress,
  per-chapter status, and partial failure must stay legible while work runs.
- Chapters fail individually and often transiently — retry one, retry all,
  paste content in manually, or exclude a chapter are everyday operations, not
  edge cases.
- Extracted chapter titles and body text are edited in place before export,
  because extraction is a best-effort heuristic.
- TOC auto-loading (paste one story URL, get every chapter as `pending`) is
  available for `truyenfull.live`, `truyenfull.vn`, `truyencom.com`, and
  `xtruyen.vn`; `metruyenchu.com` requires manual chapter URLs.

## Capabilities and Constraints

- Curated allowlist of Vietnamese novel sites (`src/config/supportedSites.ts`)
  is the trust boundary, enforced on both frontend and backend.
- Never bypasses login, paywall, or DRM; only content the owner can already
  access in a normal browser.
- Local state only: SQLite `stories`/`chapters` tables for the library; manual
  crawls live in browser state. No accounts.
- Story crawls run server-side and publish progress on one shared SSE channel
  (`GET /api/stories/live`) tagged with the story id, so every session sees
  which stories are crawling — and how far along — without selecting one; a
  session that just reloaded sees the same state. The manual batch crawl still
  streams NDJSON over `fetch`. Starts return `202` immediately; progress is
  pushed.
- No WebSocket.
- Each story's cover is fetched from its page and kept under `data/covers/`
  (one file per story, downloaded once) so an export has a cover without a
  manual upload.
- Story info (title, author, language, cover) is saved to the library with the
  "Lưu thông tin" button and beats the site's TOC when the chapter list is
  re-loaded. Chapter title/body edits stay session-only and are not persisted.
- Opening a very long story loads all crawled chapters at once — a known
  heaviness limit.
- Stack: backend Node.js + TypeScript + Express; frontend React 18 + TypeScript
  + Vite, built into `public/`.
- UI copy is Vietnamese and stays Vietnamese. Terminology in use: "chapter" /
  "chương", "crawl", "trích xuất", "xuất EPUB", "Truyện của tôi",
  "Crawl thủ công", "Crawl tiếp".

## Brand Commitments

No formal brand: no logo, no palette, no voice guide exists. The in-app product
name is "Web → EPUB cho Kindle". The UI language is Vietnamese, and that is
binding.

## Evidence on Hand

No marketing assets, logos, testimonials, or benchmark data. `README.md`
documents architecture, mechanics, and the supported-site list;
`docs/superpowers/specs/2026-09-17-crawl-story-management-design.md` documents
the library feature. No crawl data is committed, so UI demonstrations need real
or explicitly labeled synthetic chapters.

## Product Principles

1. A crawl is a long-running job, not a transaction: resume, retry, and
   per-chapter truth outrank a fast happy path.
2. Fix in place — every extracted chapter is editable and individually
   includable, because extraction is never the authority.
3. Trust lives at the boundary, and the interface should say so plainly:
   allowed sites only, no login/paywall/DRM bypass, nothing leaves the machine.
4. The deliverable is the EPUB on the Kindle, not time spent in the tool: make
   bulk progress legible at a glance and get out of the way.
