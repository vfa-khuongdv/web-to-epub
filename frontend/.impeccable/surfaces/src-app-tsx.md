---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/components/LibraryView.tsx","src/components/StoryDetail.tsx","src/components/ManualCrawlView.tsx","src/components/ChapterCard.tsx","src/styles.css"]
---

# Surface: frontend — app shell + Crawl thủ công / Truyện của tôi

## Scope and visitor mode

**Operate.** The whole React frontend: app shell, the two tabs (Crawl thủ công,
Truyện của tôi), story detail, chapter rows, EPUB export. This is a **redesign**:
it replaces the incumbent plain-CSS world (default system font, one blue accent
used everywhere, hardcoded `#444`/`#ddd` that break in dark mode, `alert()` for
every error, emoji as icons, 150 full editable cards at once). The old look is
evidence of what the subject is, never authority over what it becomes.

## Audience, job, proof, constraints

One owner on their own desktop machine. Job: paste a story URL or a list of
chapter URLs, start a crawl, leave, come back, see exactly what finished and what
failed, repair a chapter in place, export an EPUB for the Kindle.

Proof on hand: `data/stories/*.json` holds real crawled stories (largest ~150
chapters) plus `stories.db`. Use that real content for every demonstration; never
invent commercial claims.

Must survive untouched (user-confirmed): two-tab shell · inline chapter
title/body editing + include/exclude per chapter · cover upload + `.epub`
download · chapter order = TOC order · Vietnamese copy.

Also confirmed by the user: chapter lists become **compact rows that expand to
edit** (not 150 open cards); a running crawl shows a **status list with the raw
per-attempt log collapsible**; the result must never read as a playful/consumer
app.

## Chosen direction

**Thư viện để bàn** — the archivist's desktop instrument, in the tradition of a
pro ebook library manager: a dense table with a metadata pane, and running jobs
that live in a queue you can watch. Memorable moment: a crawl is a *job in
flight* — the jobs strip carries its progress while the chapter table updates row
by row, each row wearing its own state.

Locked at the direction round, code-led (no image generation in this session).

## Unresolved

None.

## Direction contract

**THESIS.** The library is a dense table and a crawl is a job you watch. Refuses
the category-default converter page (centered card, textarea, blue button,
spinner) and equally the cream-paper-plus-serif rendition of anything bookish:
precision of state over warmth of subject.

**OWN-WORLD.** Light desktop chrome: `#ececec` field, `#f7f7f7` raised rows,
white content, hairline rules `#d4d4d4`, ink `#1c1c1c`. Two reserved colors
only — selection/primary `#3b6fb6`, error red — never decorative. Tabular
numerals in a mono face, 24–30px rows, 2–3px radii, no shadows at all;
separation is hairlines and rules. Components: command bar, column headers with
right-aligned figures, status chips, inline editable fields, progress bars, a
jobs strip.

**STORY.** The owner understands *this is my archive*; that a story sits at
148/150 with 2 failures; that the crawl is running right now; that closing the tab
loses nothing. They act: crawl, retry, fix a row, export.

**FIRST VIEWPORT.** A 44px command bar spans the top: product name left, the two
tabs as a segmented control, a live job indicator right. Below, a split: left
~58% the story table (columns: truyện, site, chương, xong, lỗi, cập nhật) with
compact numeric columns; right ~42% the selected story panel — one display-scale
progress numeral (~52px, tabular) as the eye's landing point, the `Crawl tiếp`
button directly under it, then metadata fields, then the chapter table. A ~60px
jobs strip is pinned across the bottom edge, carrying the live crawl's progress
bar, count, and the collapsible log toggle. No floating action button.

**FORM.** The archivist's desktop library instrument — position 3 of my ordered
list of seven grounded directions. Seed key `4325cf98`. Raised by four named
donations: edge-label rows, one monumental numeral, state written into the row,
one reserved color per state.

**FINISH.** unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance

## Finish record

**Build path.** Code-led (no image generation in this session). No comps were rendered; the
direction round locked a wireframe schematic card, and its `raised` lines are the critique
reference. Seed key `4325cf98`, kind `assigned`.

**Inspection.** Two rounds, batched. Captured at 1440×900 and 390×844 plus dark scheme,
both expanded chapter states, the manual tab, and the running crawl with its log — the
running state produced by answering the crawl endpoint with a synthetic NDJSON stream, so no
real crawl touched the library. Fixes after round one: titles ellipsize instead of wrapping;
the library hint dedupes site names; empty-state lists number correctly; the "N/M chương sẽ
được xuất" line dropped. Round one also proved two real defects since fixed: an unwrapped
error string widened the chapter table (970px in a 604px pane) and `.visually-hidden`
escaped its scroll container, growing the document to 7616px with 233 rows.

**Mechanical gate.** `impeccable detect --json` over every changed file returns `[]`. One
width-animation finding fixed (progress fill is now a transform); two type-ramp advisories
resolved by documenting the intentional 17px denominator and 42px compact numeral as ramp
steps instead of changing reviewed pixels. Tailwind scans only app code (`source(none)` plus
explicit sources) so documentation cannot inflate the bundle: 23.26 kB → 19.54 kB, with
pixel-identical re-render verified.

**Finish review.** Degraded in-thread pass (this harness has no named agents). First pass
`fix` with six findings — all resolved and scored resolved in the verdict pass, which
returned `ship` covering those six fixes only, not whole-surface approval. Accepted
adaptations: collapsed titles ellipsize (the edge-label donation still holds: number, name,
and state all readable while collapsed), and below 700px the story table scrolls sideways.
Two minor items remain open and are reported, not repaired: the raw `[2m` fragment still
prints in the jobs log (left raw by design), and the manual tab's first-pass hint state was
not captured.

**Documentation.** `frontend/DESIGN.md` (token-bearing, 8 sections) and
`frontend/.impeccable/design.json` (schemaVersion 2) were written from the built world by the
degraded documenter. Recorded drift: the strip is 36px idle / 58px active rather than ~60px;
one inset press cue is the only shadow; the hairline exists at two weights; and the locked
brief's "sortable column headers" is documented as "column headers with right-aligned
figures" — sorting was never built, and no unrequested feature was added to satisfy the word.

**Post-verdict micro-fixes (disclosed, not re-reviewed).** `.btn-danger` hover keeps its
error tint (it was losing to the base hover rule); dead CSS (`.note`, `.bar-thin`) and the
unused `thin` prop were removed; the skeleton's 4px radius came under the 3px ceiling.

**Later pass (realtime + cover).** The crawl dock now runs on a real channel: a story crawl
returns `202` and publishes over `GET /api/stories/:id/live` (SSE), so a session that reloads —
or never started the crawl — sees the same per-chapter state, progress and log; the view
refetches once the run ends, so new chapter bodies appear without F5. Verifying against a live
crawl found one defect: a run started *after* attach only emitted `progress`, which never
flipped the job to running, so the end-of-run refetch never fired (fixed — a progress/error
event now marks the job running). The detail pane gained the `Ảnh bìa` field: a 96×140 preview
with a placeholder when no cover is stored, fed by `GET /api/stories/:id/cover`; a chosen file
still overrides it for a single export, and the library table is untouched. Covers are fetched
once per story during crawl into `data/covers/`, sniffed by magic bytes after a real CDN
(`img.xtruyen.vn`) served one as `application/octet-stream`. Detector over the changed files
returns `[]`.

**Later pass (save + library-wide live state + cover rail).** The detail pane now has a
"Lưu thông tin" button that persists title/author/language/cover (`POST /api/stories/:id/meta`;
the cover file is sniffed by magic bytes and replaces the story's stored cover); saved info
beats the site TOC on re-load. The library reads one shared SSE channel
(`GET /api/stories/live`) so every crawling row carries its own "Đang crawl N/M" chip with no
story selected — previously only the selected story could show it. The cover preview became the
detail block's left rail (96×140, `grid-template-columns: 96px minmax(0,1fr)`), so it adds no
height at all: the detail block measures 384px and the chapter table starts at y=499 with 663px
of body, versus y=528 before the rail. Detector over the changed files returns `[]`.

