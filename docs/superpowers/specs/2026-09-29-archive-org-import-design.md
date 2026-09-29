# Design: Import Internet Archive books (open items only)

Date: 2026-09-29
Status: Approved; implementation not started

## 1. Objectives

1. **Add by URL**: pasting an `archive.org/details/<id>` URL into the add box
   imports the book into the library like an EPUB/PDF import — reader, chapter
   editing, highlights, export to EPUB.
2. **Open items only**: items flagged `access-restricted-item` (lending library,
   LCP/ACS-encrypted) are refused with a clear Vietnamese message. The app never
   borrows, signs in or decrypts anything.
3. **Content**: prefer the item's public EPUB; otherwise its OCR text
   (`_djvu.txt`); otherwise its public PDF. Metadata (title/author/language)
   comes from the catalog.
4. Import lands in the library currently open (`libraryFor`), so private mode
   works without extra code.
5. No E2E — the flow needs the live archive.org API; it stays unit/route tested
   with a mocked `fetch`.

Decisions made with the owner:

- Path **A — automatic source pick**: EPUB → text OCR → PDF (see §3.3). The
  first two reuse existing parsers; text-only books get a small builder.
- The two example URLs the owner supplied (`storekeeper0000pear`,
  `namiyazakkatenno0000higa`) are both lending-restricted and must fail with the
  restricted-item message, not partial content.

Non-goals:

- No lending/borrow, no account, no session import, no DRM.
- No audio/video items, no `audio`/`movies` mediatypes, no search pages.
- No page images for the text path (a public-domain novel is text); PDF stays
  the image-bearing fallback.
- No watching/checking for new content — an item is a book, not a serial.

## 2. Current Context

- Import pattern (EPUB/PDF): `POST /api/stories/import-epub` in
  `routes/stories.ts`, parser returns `ImportedBook`
  (`src/services/epubImport.ts:49`), story stored with `site = "epub"`,
  `watching = false`, every chapter `status = "done"`, chapter URL
  `<storyUrl>#<index>`. A story URL `<scheme>:<hash>` gives a stable id
  (`storyId`), so re-adding answers 409 `{ code: "exists", story }` until
  `?overwrite=1`.
- `site === "epub"` already makes the server refuse crawl (`routes/crawl.ts:23`)
  and watch (`routes/stories.ts:294`), and `check`/`refresh` fail without a TOC
  adapter. The UI hides those controls and labels the row by URL prefix
  (`LibraryView.tsx:751`, `StoryDetail.tsx:454`).
- Images from imported books are stored through `library.epubMedia`
  (`epub-media/<storyId>/<sha1-12>.<ext>`, content-addressed) and served by
  `GET /api/stories/:id/media/:name`.
- `parsePdf` already handles scanned pages, chapter detection
  (`CHAPTER_HEADING_RE`), page-number filtering, hyphen joining and 20-page
  chunk fallback (`src/services/pdfImport.ts`).
- `SUPPORTED_SITES` (`src/config/supportedSites.ts`) feeds both the server
  trust boundary and the frontend hint via `GET /api/supported-sites`.
- Server wording: English keys in `t()` with Vietnamese entries in
  `services/lang.ts`; frontend strings go through `frontend/src/i18n`.

## 3. Design

### 3.1 URL and route

- Accepted URL shapes on `archive.org` (host only; `www.` stripped):
  `/details/<id>[/…]` (e.g. a `/page/n5/mode/2up` deep link),
  `/metadata/<id>`, `/download/<id>/…`. `<id>` is the first path segment after
  the prefix; anything else on the host is refused.
- `POST /api/stories/import-archive` in `routes/stories.ts`, next to
  `import-epub`. Body `{ url }` (JSON), `?overwrite=1`. The route validates the
  host and extracts the id itself — the frontend detection is convenience, not
  the trust boundary.
- Flow: fetch metadata → refuse/resolve source (§3.2–3.3) → parse → write
  images and cover → save `StoredStory` → respond `{ story }` (outline), 201 new
  / 200 overwrite. Existing id without `?overwrite=1` → 409 `{ code: "exists",
  story }` before any download.
- Story fields: `storyUrl = "archive:<id>"`, `site = "epub"`, `watching =
  false`, all chapters `done`, `createdAt` kept on overwrite, missing
  author/language fall back to `settingsStore` defaults.
- `POST /stories` gains a specific guard for the host: archive.org books are
  imported, not crawled (the frontend branches before it; this is defense in
  depth).

### 3.2 Service — `src/services/archiveImport.ts`

`importArchiveItem(id, options): Promise<ImportedBook>` with an injected
`fetch` (default global) so tests stay hermetic. No Express, no `Library`.

1. **Metadata**: `GET https://archive.org/metadata/<id>`. Missing
   `metadata.identifier` → *not found*. `metadata.mediatype !== "texts"` →
   *not a book*.
2. **Restriction**: `metadata["access-restricted-item"] === "true"` →
   `ArchiveRestrictedError` (clear borrow-only wording). Collections alone
   (`inlibrary`, `printdisabled`) are not enough — the flag is the signal.
3. **Candidates** from `files[]`, skipping entries with `private === "true"`
   and encrypted formats (`LCP Encrypted EPUB/PDF`, `ACS Encrypted PDF`):
   - EPUB: `format === "EPUB"`, prefer `source === "original"`;
   - text: `format === "DjVuTXT"` (the `<id>_djvu.txt`);
   - PDF: name ends `.pdf`, format not containing "Encrypted", prefer
     `Text PDF`; skip when `metadata.pdf_degraded` is set.
4. **Download** `https://archive.org/download/<id>/<file name>`, following
   redirects, streaming with a byte cap (`MAX_ARCHIVE_FILE_BYTES = 100 MB`).
   A candidate whose metadata `size` exceeds the cap is skipped; a 401/403
   response means unavailable.
5. If no candidate downloads → `ArchiveUnavailableError` ("no readable
   EPUB/PDF/text file"). That covers items not flagged restricted but fully
   private, and items whose download suddenly 403s.

Title/author/language come from `metadata` (`title`, `creator`, `language`)
when present, falling back to what the parser found.

**Cover**: fetch `https://archive.org/services/img/<id>` (public item image),
capped like a cover, returned as `ImportedBook.cover`. A parsed EPUB/PDF cover
wins when it exists; a failed cover fetch is not fatal.

### 3.3 Source paths

- **EPUB** → `parseEpub(bytes, { fallbackTitle, storeImage })`; images land in
  `epubMedia` like a file import.
- **Text** (`_djvu.txt`) → built in `archiveImport.ts`, no new dependency:
  - split pages on `\f`, drop empty pages, drop bare page numbers at page
    edges (same rule as `pdfImport`'s `readLines`);
  - paragraphs by heuristics: a line indented, or a line that ends a sentence
    and is shorter than the page's typical width, starts a paragraph;
    hyphen-broken words are joined (`joinLine` logic);
  - chapter starts: lines matching `CHAPTER_HEADING_RE` (exported from
    `pdfImport`) with ≥ 2 matches; otherwise pages chunked by
    `PAGES_PER_CHUNK = 20` with the existing `"Pages {from}–{to}"` titles;
  - block/inline text escaped like `pdfImport` (`escapeHtml`);
  - more than `MAX_PAGES = 5000` pages (reused from `pdfImport`) is refused;
  - a text yielding almost nothing (< ~200 characters) is treated as "no text
    layer" and the PDF candidate is tried instead — this is how an illustrated
    scan keeps its images.
- **PDF** → `parsePdf(bytes, { fallbackTitle, storeImage })` unchanged.
- `storeImage` is the route's `library.epubMedia.save(id, bytes, extension)`.

### 3.4 Frontend

- `handleCreate` checks `archiveItemId(url)` **before** `isSupportedUrl` and calls
  `importArchive` — archive.org is deliberately not in `SUPPORTED_SITES`, because
  that list renders as "Auto-loading sites" in the hint and an archive.org item
  does not auto-load chapters; the add box accepts its URL directly. The server
  route is the trust boundary, not this check.
- `frontend/src/lib/archiveUrl.ts`: `archiveItemId(url)` (same shapes as §3.1,
  shared by the add box), plus `isArchiveItemUrl`.
- `LibraryView.handleCreate`: archive.org URL → `importArchive(url)` instead of
  `createStory` (archive.org is not a session site, so no session prompt).
  Overwrite confirm
  reuses the current dialog: `pendingImport` becomes
  `{ kind: "file"; file } | { kind: "url"; url }`, and Overwrite repeats the
  matching call with `overwrite: true`.
- `lib/api.ts`: `importArchive(url, { overwrite })` → `POST
  /api/stories/import-archive?overwrite=…`, JSON body `{ url }`, reads
  `code: "exists"` and JSON errors like `importEpub`.
- Labels: URL prefix `archive:` → "Internet Archive" in `LibraryView.tsx:751`
  and `StoryDetail.tsx:454`; the source link stays hidden like an imported
  book. Notice reuses `{ kind: "epub-imported", title }`.
- New frontend i18n keys: the "Internet Archive" label only (same in vi);
  server-side errors are already translated by `services/lang.ts`.

### 3.5 Errors (`services/lang.ts`)

- `This is not an Internet Archive book page: {url} — paste a URL like https://archive.org/details/<id>`
- `Internet Archive item not found: {id}`
- `This Internet Archive item is not a book: {url}`
- `This Internet Archive item is access-restricted (borrow-only) and cannot be imported: {url}`
  — wording states plainly the app does not borrow or bypass; never partial.
- `No readable EPUB, PDF, or text file is available for this Internet Archive item: {url}`
- `This Internet Archive book has too many pages to import (maximum {count})`
- `Could not import from Internet Archive` (network/parse failures, so raw
  upstream errors never reach the user)
- `Internet Archive books are imported, not crawled` (`POST /stories` guard)

## 4. Trade-offs

- **Text quality**: `_djvu.txt` is OCR; paragraphs depend on heuristics and can
  be wrong, but chapters remain editable. Same class of imperfection the PDF
  import already accepts.
- **Three source paths**: EPUB and PDF reuse parsers as-is; the text builder is
  the only new parsing code, kept small and page-structured.
- **Prefer original EPUB**: for born-digital open books this keeps real
  structure and images; scanned items fall to text (fast, small) and only
  image-only items pay the PDF download.
- **Overwrite re-imports from whatever source is chosen now** (a new derivative
  may appear), so highlights could misanchor in the rare case the source
  changed; the user confirms the overwrite dialog, same as EPUB import.
- **No streaming progress in v1**: the request is synchronous with the existing
  busy state; the 100 MB cap bounds the wait. A job/SSE design is deferred
  unless it proves needed.
- **`archive:<id>` is not a fetchable URL**, so the source link stays hidden;
  the story keeps its identity and title for search/export.

## 5. Testing

- `src/services/archiveImport.test.ts` (mock `fetch`; reuse EPUB/PDF fixture
  builders from the existing tests):
  - restricted flag → `ArchiveRestrictedError`; missing item → not found;
    audio mediatype → not a book; non-archive host → refused;
  - file pick: original EPUB preferred, `_lcp.epub`/private skipped; text when
    no EPUB; PDF when text is empty/absent; `pdf_degraded` skipped;
  - download 401/403 → unavailable error; over-cap candidate skipped; no
    candidate → unavailable;
  - text builder: form-feed pages, page-number edges dropped, indented and
    sentence-end paragraphs, hyphen join, `Chapter N` starts, 20-page chunk
    fallback, > 5000 pages refused;
  - URL normalization: `/details/<id>/page/n5/mode/2up`, `/metadata/<id>`,
    `/download/<id>/<file>`, `www.`.
- `src/routes/importArchive.test.ts` (mirror `importEpub.test.ts`: real Express
  server, mocked fetch): 201 with `site: "epub"`, `storyUrl: archive:<id>`,
  chapters done; 409 `exists`; overwrite 200 keeps `createdAt`; restricted →
  400 with the translated message; non-archive URL → 400; private library works
  via `X-Vault-Token`.
- `POST /stories` answers the specific guard message for an archive.org URL
  (the host is not on the allowlist, so without the guard it would read
  "site not yet supported"); crawl/watch already covered by `site === "epub"`
  tests.
- `npm test`, `npm run build:backend`, `npx tsc -p frontend --noEmit`; no E2E.

## 6. Build order

1. `archiveImport.ts` + `lang.ts` messages + unit tests.
2. Route `POST /stories/import-archive` + `POST /stories` guard + route tests.
3. Frontend: `archiveUrl.ts`, `api.ts` helper, `handleCreate` branch,
   overwrite dialog, labels, i18n key.
4. `POST /stories` guard + AGENTS.md note.
5. `npm test` + both typechecks.
