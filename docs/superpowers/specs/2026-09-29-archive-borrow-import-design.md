# Design: archive.org session + import borrow-only items as page images

Date: 2026-09-29
Status: Approved; implementation not started

Amends `2026-09-29-archive-org-import-design.md`, whose non-goal "No
lending/borrow, no account, no session import" the owner has reversed for the
browse path below. Everything else in that spec stands: no decryption, no
private files, no OCR, import-only (not crawlable).

## 1. Objectives

1. **Login for archive.org**: the reader saves a logged-in archive.org session
   from their own browser (cURL copy), exactly like Asianfanfics/TruyenFull —
   Settings → Site sessions, and a skippable prompt when adding an archive URL.
2. **Import borrow-only items**: for an `access-restricted-item`, instead of
   refusing, the app rides the reader's session to start (or reuse) a
   *browse/borrow* and captures the page images the BookReader itself displays
   — the same pixels the reader sees. Files stay private, LCP/ACSM stays
   encrypted; nothing is decrypted.
3. Content: image blocks only (the text APIs are blocked even with a loan —
   verified). Chapters chunked 20 pages each, like the PDF/text fallbacks.
4. Test URL (owner-supplied, verified during design):
   `https://archive.org/details/namiyazakkatenno0000higa/page/n161/mode/2up`
   — 420 leaves, currently on a 1-hour browse session.
5. No E2E: needs the live archive.org API and a real account; unit/route tests
   with a mocked `fetch`, plus one manual run by the owner.

Non-goals:

- No OCR, no translation of page images; the book lands as images (Narration
  cannot read it — same trait as a scanned PDF).
- No loan management beyond the import itself: renewing the loan being ridden
  while it runs, and returning a borrow this import started (§3.3). The
  reader's own loans are never started, returned or renewed outside an import.
- No watching/checking, no TOC adapter — archive.org stays import-only.
- No capture of text via search-inside snippets (partial text would be a worse
  book than none).

## 2. Verified facts (probed with the owner's live session, 2026-09-29)

- Blocked even while browsing: `GET /download/<id>/<id>_djvu.txt` → 401,
  `<id>.pdf` → 403, `https://<server>/BookReader/BookReaderGetTextWrapper.php`
  → 403 "Item not available". **No text source exists**; page images are the
  only content path.
- Details page carries the reader config: an
  `<input class="js-bookreader" type="hidden" value='{…}'>` whose JSON has `url`
  — a protocol-relative `//<server>/BookReader/BookReaderJSIA.php?id=…&
  itemPath=…&server=…&format=jsonp&subPrefix=…&requestUri=…`. Fetch it with
  `format=json` over `https:` (the endpoint 404s on `archive.org`; it lives on
  the storage host).
- `BookReaderJSIA.php` answers `{ data: { brOptions, data, lendingInfo,
  metadata } }`:
  - `brOptions`: `bookId`, `subPrefix`, `bookPath`, `server`, `zip`,
    `imageFormat: "jp2"`, `data` (leaf groups), `coverLeaf`, `unviewablePageURI`.
  - leaf: `{ leafNum, uri, width, height, pageType, viewable, origIndex, ppi,
    pageSide }`. `uri` is absolute, e.g.
    `https://<server>/BookReader/BookReaderPreview.php?id=…&page=leaf161&
    fail=preview&` — 420 leaves for the test item (2 Cover, 418 Normal).
  - `lendingInfo.lendingStatus`: `is_lendable`, `active_borrows`,
    `active_browses`, `next_borrow_expiration`, `next_browse_expiration`,
    `available_to_borrow`, `available_to_browse`, `users_on_waitlist`.
  - `metadata`: full catalog record (`title`, `creator`, `language`, …);
    `table_of_contents` is absent → no chapter structure to reuse.
- Loan lifecycle: `POST https://archive.org/services/loans/loan` with
  `FormData: action, identifier`; actions `browse_book`, `borrow_book`,
  `create_token`, `renew_loan`, `return_loan` (read off
  `details-bookreader.min.js`). Cookies: `loan-<id> = <epoch>-<sig>` (expiry in
  the first segment), `br-loan-<id>` / `br-browse-<id>` markers. The test item
  has 0 borrow copies, 1 browse copy → browse is the mode that works.
- Page grant: `GET https://archive.org/services/bookreader/request_page?id=<
  bookId>&subprefix=<subPrefix>&leafNum=<n>` with the session →
  `{"success":true,"value":[161,162]}` (grants the leaf and its spread pair).
- Page image: `GET leaf.uri` **after** the grant with the session → 200 JPEG
  (~250 KB, 1414×2048-class). Without a grant (or without the session) → 302 to
  `https://archive.org/bookreader/static/preview-unavailable.png` — the failure
  signal.
- Cookies are scoped to `.archive.org`, so they also reach
  `<server>.us.archive.org` hosts; `sessionRequestHeaders(url)` already filters
  by that rule and carries the saved UA.

## 3. Design

### 3.1 Site session (login)

- `src/routes/siteSessions.ts`: slug allowlist gains
  `archive: "archive.org"` (comment updated).
- `frontend/src/lib/siteSessions.ts`: new `SESSION_SITES` entry, slug
  `archive`, domain `archive.org`, label "Internet Archive". Dialog copy in the
  same i18n-key style: intro (login needed for borrow-only books; the tool never
  sees the password), steps (log in → DevTools → Network → reload the details
  page → Copy as cURL on the page request → paste), notes (a request from a
  logged-out page carries no login; the loan itself is shown per book by IA;
  public items work without it), placeholder
  `curl 'https://archive.org/details/<id>' -H 'cookie: …'`,
  `skipNote` "You can skip this — public items still import.", `showsExpiry:
  false` (archive has no JWT expiry cookie), no `accountUrl`.
- `sessionAccountName` (`siteSession.ts`): after the JWT claims, fall back to
  the `logged-in-user` cookie (URL-decoded email) — display only, same purpose.
  `sessionExpiresAt` stays JWT-only; per-loan expiry is item-scoped and lives in
  §3.3, not in the settings row.
- `parseSessionCurl(curl, "archive.org")` needs no change: it already checks
  the pasted request's host.
- Add flow (`LibraryView.handleCreate`): the archive branch currently returns
  *before* the session check. Reorder so the `sessionSiteForUrl` check runs for
  archive URLs too; `sessionPrompt` gains the pending action (`story` |
  `archive`) so `onSaved`/`onSkip` dispatch to `createStoryFrom` or
  `importArchiveFrom`. Prompt only when `!configured` (`showsExpiry` is false).

### 3.2 Service — `src/services/archiveBorrow.ts` (new)

All functions take an injected `fetch` (default global) and a `SiteSession`;
no Express, no `Library` — same rule as `archiveImport.ts`.

1. `readerConfig(fetch, session, id)`:
   - `GET https://archive.org/details/<id>` with `sessionRequestHeaders` →
     parse with JSDOM (already a dependency) → `.js-bookreader` value → `url`.
     Missing input → the session is not logged in / page changed → error (§3.4).
   - `GET https:<url>&format=json` (rewrite `format=jsonp`) with session
     headers → `{ brOptions, lendingInfo, metadata }`. Response shape checked
     against `data.brOptions`; anything else is the generic import failure.
2. `ensureLoan(fetch, session, id, lendingStatus)`:
   - Active session (`active_borrows > 0 || active_browses > 0`) → use it;
     note `next_*_expiration` and renew before it (step 3).
   - None: `borrow_book` when `available_to_borrow`, else `browse_book` when
     `available_to_browse` (FormData POST, `credentials: "include"`-equivalent:
     session headers). Neither → "no copy available" error.
   - Response `{ success: false, error }` or a logged-out page → the
     "session not logged in" / "loan failed" error as appropriate.
3. `renewLoan(fetch, session, id)`: `action=renew_loan`, called when the
   remaining loan window (cookie `loan-<id>` epoch, else
   `next_*_expiration`) falls under 10 minutes during a long capture.
4. `capturePages(fetch, session, config, storeImage, opts)`:
   - Walk leaves in order (`brOptions.data` flattened, `leafNum` ascending).
   - Before a leaf's image: if its `leafNum` is not in the granted set, call
     `request_page` and merge the returned `value` into the set (one grant
     covers the spread pair).
   - Fetch `leaf.uri` with session headers, following redirects; a final URL
     containing `preview-unavailable`, a non-200, or non-JPEG magic bytes →
     retry once (grant again first), then fail naming the page.
   - Bytes ≤ `MAX_IMAGE_BYTES` (8 MB, `epubImport`) → `storeImage(bytes,
     "jpg")` → `{ type: "image", src, alt: "" }` (the scan path's block shape,
     `pdfImport.ts:154`). Sequential requests — deterministic, gentle on IA;
     measured throughput is checked during implementation and parallelism is
     raised only if the manual run proves too slow.
   - Page cap: leaves > `MAX_PAGES` (5000) refused with the existing
     "too many pages" error.
5. `borrowedBook(config, leafBlocks, metadata)` → `ImportedBook`: title
   (`metadata.title`), author (`creator`), language, chapters every
   `PAGES_PER_CHUNK = 20` leaves with the existing `"Pages {from}–{to}"`
   titles (`t()` from `lang.ts`), the first chapter keeping the book title when
   the book fits in one chunk (same rule as `textToBook`).
   Cover stays the catalog fetch already in `archiveImport.ts`
   (`/services/img/<id>`).

### 3.3 Integration — `archiveImport.ts` / route

- `importArchiveItem(id, options)` gains `session?: SiteSession`.
- The `access-restricted-item` branch becomes:
  - **no session** → `ArchiveLoginRequiredError` (§3.4);
  - **session, `is_lendable` false** (or the item is LCP-only with no browse)
    → the existing `ArchiveRestrictedError` — still never decrypted;
  - **session, lendable** → `archiveBorrow` flow above; the public
    EPUB/text/PDF candidates are not attempted (they are `private: true` and
    401 anyway).
- `routes/stories.ts` (`POST /api/stories/import-archive`): resolve the
  session with `loadSiteSession("https://archive.org/details/" + id)` and pass
  it into the options. Nothing else changes: story id `archive:<id>`,
  `site = "epub"`, overwrite/409 semantics, private library via `libraryFor`,
  media via `library.epubMedia` (page images land in `epub-media/<storyId>/`,
  so reader, chapter edit and EPUB export need no new code).
- A loan started by the import is returned in a `finally` **only when this
  import started a `borrow_book`** (a 14-day slot should not be left behind
  because the import crashed). A `browse_book` session and any loan that
  existed before the import are left alone — the reader may be using them.
- Long-running: same synchronous busy state as the PDF import; no progress
  channel in v1 (§4).

### 3.4 Errors (`services/lang.ts`, English keys / Vietnamese wording)

- `This Internet Archive item is borrow-only. Sign in to archive.org (Settings
  → Site sessions) and import again: {url}` — `ArchiveLoginRequiredError`,
  restricted + no session.
- `No copy of this Internet Archive book is available to borrow right now —
  try again later: {url}` — lendable, zero free copies/waitlist.
- `The saved archive.org session is not logged in — import a fresh one
  (Settings → Site sessions).` — loans API / details page says anonymous.
- `The archive.org loan ended while importing — run the import again: {url}` —
  grant/image 403s mid-capture after renewal failed.
- `Could not read page {page} of this Internet Archive book: {url}` — a single
  page kept failing after its retry.
- Existing: `Could not import from Internet Archive` (generic wrapper), too
  many pages, not found, not a book, unavailable, `ArchiveRestrictedError`
  (lendable false).
- The route keeps mapping thrown messages to the response as it does today —
  classes exist for tests and wording for the reader.

## 4. Trade-offs

- **Images, not text**: the only content IA exposes to a loan. The book is
  readable and exportable but silent to Narration and in-book search — stated
  up front rather than discovered later.
- **Reverse-engineered endpoints**: `BookReaderJSIA`, `request_page` and
  `BookReaderPreview` are the reader's own APIs, not documented contracts; an
  IA redesign breaks the import until the module is re-pointed. Confined to one
  new file, tests pin the response shapes.
- **Loan etiquette**: browse sessions are 1 hour and shared per account; a
  failed import that started a borrow returns it in `finally`, and renewal
  only ever happens mid-import, for the loan that import is riding — once an
  import ends, the app touches no loan it did not start.
- **Synchronous import**: 420 grants + 420 images ≈ 105 MB and a few minutes,
  bounded by `MAX_PAGES`/`MAX_IMAGE_BYTES`; the existing busy state covers it.
  A job/SSE channel stays deferred, as in the first archive spec.
- **One session, whole host**: archive.org cookies are as powerful as the
  account; unchanged handling (owner-only file under `sessions/`, never echoed
  back by the API).
- **No partial books**: any page failing after retry fails the import —
  half-captured books are worse than a clear error.

## 5. Testing

- `src/services/archiveBorrow.test.ts` (mock `fetch`, fixtures built from the
  probed responses — details HTML snippet, JSIA JSON, grant JSON, JPEG magic):
  - config parse: `.js-bookreader` found / missing; `format=json` URL on the
    storage host; malformed response → generic error.
  - loan: active browse reused (no loans POST); none → `browse_book`;
    `available_to_borrow` prefers `borrow_book`; neither → no-copy error;
    `success:false` → not-logged-in error; window < 10 min → `renew_loan`.
  - capture: grant issued once per spread pair and reused; image bytes
    stored via `storeImage` and become `image` blocks; `preview-unavailable`
    → one re-grant retry, then page error; oversized page skipped per
    `MAX_IMAGE_BYTES`; `> MAX_PAGES` refused.
  - assembly: 420 leaves → 21 chapters of 20 with `"Pages {from}–{to}"`;
    title/author/language from metadata.
- `src/services/archiveImport.test.ts` (extend): restricted + no session →
  `ArchiveLoginRequiredError`; restricted + session → borrow path taken and
  public candidates not fetched; restricted + session + `is_lendable:false` →
  `ArchiveRestrictedError` unchanged; open item + session → unchanged public
  path (session ignored).
- `src/routes/importArchive.test.ts` (extend): 201 with image-block chapters
  when a session file exists in the test `DATA_DIR`; 400 + login message when
  not; overwrite keeps `createdAt`.
- Session plumbing: `sessionAccountName` reads `logged-in-user`;
  `POST/GET/DELETE /api/site-sessions/archive` round-trip (mirror the existing
  site-session route tests); frontend `sessionSiteForUrl("https://archive.org/
  details/x")` returns the archive entry; add-flow prompt dispatches the
  archive action (`LibraryView` behavior covered by the existing test style).
- `npm test`, `npm run build` (`tsc` + vite), `npx tsc -p frontend --noEmit`;
  `i18n/locales.test.ts` must see the new keys in every locale (vi
  translations for the dialog copy and the new error messages).
- Manual: owner re-pastes a fresh cURL (the probe session expires ~1 h) and
  imports the test URL; verify reader shows pages, EPUB export embeds them.

## 6. Build order

1. `siteSession.ts` (`logged-in-user`) + route allowlist + frontend
   `SESSION_SITES` entry + locales + unit tests.
2. `archiveBorrow.ts` + fixtures + tests (config, loan, capture, assembly).
3. `archiveImport.ts` restricted branch + `lang.ts` messages + tests.
4. Route passes the session; route tests.
5. `LibraryView` prompt ordering/dispatch + tests.
6. AGENTS.md: session allowlist, the amended rule (browse-page capture with the
   reader's own session, still no decryption), and the "images only" trait.
7. `npm test` + both typechecks + the owner's manual import.
