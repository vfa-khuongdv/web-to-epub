# Design: Import an EPUB file into the library

Date: 2026-09-28
Status: Approved; implementation not started

## 1. Objectives

1. **Import**: take an existing `.epub` file and make it a story like a crawled
   one — reader, chapter editing, highlights, narration (Vietnamese stories) and
   re-export to EPUB or audio.
2. **UI**: an "Import EPUB" button beside the add-by-URL box, with a file picker
   and drag-and-drop. Works in the packaged (Electron) app.
3. **Server**: `POST /api/stories/import-epub`, the file as the request body
   (like music / custom voice uploads), with a size limit.
4. **Local parsing, untrusted input**: metadata, spine order, chapter titles,
   images and cover are parsed by the app; nothing in the file may execute or
   reach `file://`.
5. Import lands in the library currently open (`libraryFor`), so private mode
   works without extra code.

Decisions made with the owner:

- Re-importing the same file (same id) **asks before overwriting**. Overwriting
  refreshes metadata + chapters from the file and keeps highlights — the file is
  identical, so text and offsets still line up.
- **One file per import.**
- The book's own CSS is **dropped**; content is normalized to `KINDLE_CSS` like
  crawled stories, so the in-app reader stays an honest preview of the export.

Non-goals:

- No audio/video from inside the book (dropped), no SVG images, no font
  embedding, no keeping the book's CSS.
- No multiple-file import.
- No E2E in this round (the issue marks it optional).

## 2. Current Context

- `storyId(storyUrl) = sha1(storyUrl).slice(0, 16)`; a chapter is
  `{ order, url, title, status, blocks }` and `blocks` is `ContentBlock[]`.
- `storyStore.save()` replaces the whole chapter set in one transaction and does
  not touch the `highlights` table — overwrite is a single `save()` on the same id.
- `walkToBlocks()` (`src/services/extractor.ts`) walks a DOM into
  `ContentBlock[]` (heading/paragraph/image/audio/video); `stripChrome()` already
  removes scripts/styles/nav from crawled pages.
- Upload pattern: `express.raw({ type: () => true, limit })` (`routes/music.ts`,
  `routes/tts.ts` custom voices) — errors phrased with `t()`.
- Covers: `coverStore` writes `<dataDir>/covers/<id>.<ext>` and the DB keeps the
  relative path (`covers/<id>.jpg`); `coverPathForExport` makes it absolute for
  epub-gen. Private libraries get their own store via `Library`.
- Image export: `embedImages` handles only `data:`/`http(s):` sources; local
  `file://` sources are dropped. Audio/media already resolves `file://` through
  `localMediaPath` + `localMediaRoots` (`embedMedia`).
- Frontend renders blocks with `blocksToHtml`; the reader iframe has no
  `allow-scripts`; the chapter editor round-trips HTML through `htmlToBlocks`
  (`src/services/chapterHtml.ts`) on save.

## 3. Design

### 3.1 Route

- `POST /api/stories/import-epub` in `routes/stories.ts`:
  `express.raw({ type: () => true, limit: MAX_IMPORT_BYTES + 1 MB })`,
  `MAX_IMPORT_BYTES = 100 MB`. `?overwrite=1` allows replacing an existing story,
  `?name=<file name>` supplies a title fallback and is never trusted as a path.
- Flow:
  1. `sha1(bytes)` → `storyUrl = epub:<hash>` → `id = storyId(storyUrl)`.
  2. Existing story and no `overwrite` → **409 `{ code: "exists", story }`**
     before parsing (hash only, cheap).
  3. Parse (§3.2); write images and cover; build the `StoredStory`; `save()`.
  4. Respond `{ story }` (outline): 201 new, 200 overwritten.
- New story fields: `site = "epub"`, `watching = false`, `newChapterCount = 0`,
  every chapter `status = "done"`, chapter `url = epub:<hash>#<spineIndex>`,
  `createdAt` kept on overwrite, `updatedAt = now`. Missing author/language fall
  back to the `settingsStore` defaults, the same as a newly crawled story.
- Errors go through `t()`: not a zip / no container/OPF ("not an EPUB"), DRM,
  unreadable structure → 400; oversized body → the Express raw limit error
  (same behaviour as music).
- `GET /api/stories/:id/media/:name` (next to the cover route): serves a stored
  book image; `libraryFor` makes the private library's `?vault=` work.
- `DELETE /stories/:id` also removes the story's media directory.
- Guards (defense in depth; the UI hides the buttons): `POST /stories/:id/crawl`
  and `POST /stories/:id/watch` refuse `site === "epub"` with a clear message.
  `check`/`refresh` already refuse because there is no TOC adapter.

### 3.2 Parser — `src/services/epubImport.ts`

`parseEpub(bytes, options): ImportedBook` — no fs, no HTTP, so it is testable
with in-memory bytes.

```ts
interface ImportedBook {
  title: string;
  author?: string;
  language?: string;
  cover?: { bytes: Buffer; extension: string };
  chapters: { title: string; blocks: ContentBlock[] }[];
}
```

- **Unzip** with `fflate`'s streaming `Unzip` into a name → bytes map; abort past
  `MAX_TOTAL_UNCOMPRESSED = 500 MB` (zip-bomb guard) and past
  `MAX_ENTRIES = 10_000`.
- **Container**: `META-INF/container.xml` → first `rootfile` `full-path` → OPF;
  missing → "not an EPUB".
- **DRM**: `META-INF/encryption.xml` is allowed only when every `EncryptedData`
  uses a font-obfuscation algorithm (IDPF / Adobe); anything else is rejected
  with the DRM message.
- **OPF** (JSDOM, XML): `dc:title` (fallback: uploaded file stem, else
  "Untitled"), `dc:creator` (joined with ", "), first `dc:language`; manifest
  `id → { href, mediaType, properties }`; spine `idref`s in order.
- **Cover**: `meta[name="cover"]` → item, else item with `cover-image` in
  `properties`, else guide `type="cover"`. Keep only if the bytes sniff as a
  raster image and are ≤ the `coverStore` cap; otherwise no cover.
- **Chapter titles**: EPUB3 nav (manifest item whose `properties` include `nav`,
  `<nav epub:type="toc">` anchors) → href map; EPUB2 `toc.ncx` via
  `<spine toc="…">` → flattened `navMap`; hrefs normalized (fragment stripped,
  URL-decoded, resolved against the chapter's path). Fallbacks: first `h1`/`h2`
  inside the chapter, then the file name stem.
- **Chapters**: spine items in order, only `application/xhtml+xml`, nav document
  skipped. Each is parsed with JSDOM (scripts never enabled), then sanitized:
  - remove `script, style, link, meta, base, iframe, object, embed, form, input,
    button, textarea, select, audio, video` and every `on*` attribute;
  - drop `srcset`; drop `href`/`src` with `javascript:`, `file:` or non-image
    `data:`; links to other files inside the book lose their `href` (text stays);
  - images: resolve `src` against the chapter path; sniff raster bytes
    (jpg/png/webp/gif, ≤ 8 MB) and store them through the injected
    `storeImage(bytes, extension) → src` callback (the route passes the media
    store, which returns the marker `epub-media/<storyId>/<name>`); any other
    image is removed.
  - `walkToBlocks`; drop the leading heading when it duplicates the chapter title.
  - Every spine chapter is kept even if its blocks end up empty (e.g. a cover-page
    XHTML whose only image was unsupported), so chapter order matches the book;
    the user can delete it like any chapter.
- **Media store — `src/services/epubMedia.ts`**:
  - `save(storyId, bytes, extension) → "epub-media/<storyId>/<sha1(bytes).slice(0,12)>.<ext>"`
    (content-addressed, dedupes identical images, skips an existing file);
  - `find(storyId, name) → { filePath, contentType }`, validated by
    `STORY_ID_RE` and `/^[0-9a-f]{12}\.(jpg|png|webp|gif)$/`;
  - `remove(storyId)`.
  - `Library` gains `epubMedia`, created from the library's `dataDir` like `covers`.

### 3.3 Media in reading, editing and export

- Blocks keep the **marker**; it is resolved only at the edges:
  - `routes/chapters.ts`: GET/PATCH responses map markers to
    `/api/stories/<id>/media/<name>` plus `?vault=` when the request carries a
    token; PATCH maps that URL back to the marker before storing (editor
    round-trip, so user edits cannot bake origins into the DB).
  - `routes/exports.ts`: maps markers **and** resolved URLs to `file://<abs>`
    before building, and adds `<dataDir>/epub-media/<id>` to `localMediaRoots`.
- `epubBuilder.ts`: `saveImage` learns `file://` sources restricted by
  `localMediaPath` (the existing allowlist used for audio); `embedImages` and
  `buildEpub` thread the existing `localMediaRoots` through. A `file://` path
  outside the roots is dropped, never read.
- Narration is unaffected (it reads text only); an imported Vietnamese book
  narrates like any other story.

### 3.4 Frontend

- `LibraryView`: "Import EPUB" button beside the URL box and a drop zone over the
  same box (drag-over highlight). Hidden `<input type="file" accept=".epub">`;
  one file per action; "Importing…" while busy.
- A 409 shows an inline confirm ("This book is already in your library —
  overwrite?") with Overwrite / Cancel; Overwrite repeats the request with
  `?overwrite=1`. Success selects the new story, pushes a notice and reloads.
- `lib/api.ts`: `importEpub(file, { overwrite })` posts the `File` as the body
  with `?name=`, reads JSON errors and the `code: "exists"` payload.
- `site === "epub"` hides crawl/watch/check/retry/URL-edit controls and the
  source link in `StoryDetail` / `ChapterCard` / the library row; the site column
  shows "EPUB file".
- New strings in `frontend/src/i18n/locales/en.ts` + `vi.ts`; server messages in
  `services/lang.ts` (Vietnamese wording, English keys).

## 4. Trade-offs

- **Memory / abuse**: streaming unzip with a compressed cap (100 MB) and an
  expanded cap (500 MB); images go to disk, blocks to SQLite. A big book still
  parses in seconds and holds entries in RAM briefly — accepted for a local,
  single-user app.
- **Marker in DB**: keeps `file://` and origins out of stored data and makes
  re-import stable; the cost is one symmetric rewrite in the chapter route,
  covered by tests. Same trade-off as `covers/<id>.jpg`.
- **Same file = same story**: a second import of an identical file prompts; a
  modified copy of the same book is a different hash → a new story.
- Cross-chapter links inside the book are dropped (they would point at nothing).
- Cover over 8 MB or SVG is skipped, like the existing cover rules.

## 5. Testing

- `epubImport.test.ts` + `__fixtures__/epubFixtures.ts` (fixtures built with
  `zipSync`): EPUB2 (ncx) and EPUB3 (nav) end to end, metadata, spine order,
  every title fallback, image extraction + dedupe + marker rewrite, cover by
  meta / properties / guide, sanitize (script, `on*`, `file://`, `javascript:`,
  `srcset`, audio/video dropped), DRM rejected, junk rejected, expanded cap.
- `epubMedia.test.ts`: save/find/remove, traversal names rejected, dedupe.
- `stories.test.ts`: import into the public and private library (vault token),
  409 → overwrite keeps highlights, delete removes media, crawl/watch guards.
- `chapters.test.ts`: marker → URL on GET, URL → marker on PATCH.
- `epubBuilder.test.ts`: a `file://` image inside the allowlist is embedded;
  outside it is dropped.
- The i18n locale test covers the new keys automatically.

## 6. Build order

1. `epubImport.ts` + fixtures + tests.
2. `epubMedia.ts` + `Library.epubMedia`.
3. Import route + media route + delete cleanup + crawl/watch guards + `lang.ts`.
4. Chapter route resolve/restore; export rewrite; `epubBuilder` local images.
5. Frontend: API helper, button + drop + overwrite confirm, hidden crawl UI, i18n.
6. AGENTS.md notes; `npm test`, both typechecks.
