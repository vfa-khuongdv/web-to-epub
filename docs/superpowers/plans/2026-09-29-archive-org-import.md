# Internet Archive Book Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste an `archive.org/details/<id>` URL into the add box and get the openly downloadable book as an imported story (like EPUB/PDF import), refusing lending/DRM items with a clear Vietnamese error.

**Architecture:** A new `src/services/archiveImport.ts` reads `https://archive.org/metadata/<id>`, refuses `access-restricted-item` items, then imports the first public source: EPUB (`parseEpub`) → OCR text `_djvu.txt` (new `textToBook` page/chapter builder) → PDF (`parsePdf`). A new route `POST /api/stories/import-archive` saves it with `site: "epub"` and `storyUrl: archive:<id>`, so all imported-book behaviour (no crawl/watch, media route, export) comes for free. The frontend add box branches on the URL before the supported-sites check.

**Tech Stack:** TypeScript, Express, global `fetch` (Node ≥ 22.5), vitest, React 18 + Vite + Tailwind 4 frontend.

**Spec:** `docs/superpowers/specs/2026-09-29-archive-org-import-design.md`

## Global Constraints

- Never bypass login/paywall/DRM: `access-restricted-item: "true"` is refused before any file is fetched; no account, no session import.
- All server-facing user text goes through `t()` in `src/services/lang.ts` — English key, Vietnamese entry.
- Tests are hermetic: **no network**; archive.org is mocked through an injected `fetchImpl` (service) or `vi.stubGlobal("fetch", …)` with a passthrough to the real fetch for the test's own localhost client (route tests).
- No new npm dependencies.
- Imported books use `site: "epub"` and `storyUrl: archive:<id>`; chapters are `status: "done"` with URL `<storyUrl>#<index>`.
- Download cap: 100 MB per file (`MAX_ARCHIVE_FILE_BYTES`); text builder page cap `MAX_PAGES = 5000`.
- Commands: `npx vitest run <file>` for a test file, `npm test` for all, `npm run build:backend`, `npx tsc -p frontend --noEmit`.

---

### Task 1: URL parsing, error classes, catalog metadata

**Files:**
- Create: `src/services/archiveImport.ts`
- Create: `src/services/archiveImport.test.ts`
- Modify: `src/services/lang.ts` (append the archive messages at the end of the `vi` map, before the closing `};`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `archiveItemId(url: string): string | undefined`
  - `class ArchiveNotFoundError extends Error` (message via `t()`)
  - `class ArchiveNotBookError extends Error`
  - `class ArchiveRestrictedError extends Error`
  - `class ArchiveUnavailableError extends Error`
  - `class ArchiveTooManyPagesError extends Error`
  - `interface ArchiveFile { name: string; format?: string; source?: string; private?: string | boolean; size?: string }`
  - `interface ArchiveItem { id: string; title: string; author?: string; language?: string; pdfDegraded: boolean; files: ArchiveFile[] }`
  - `fetchItem(fetchImpl: typeof fetch, id: string): Promise<ArchiveItem>`

- [ ] **Step 1: Append the server messages to `src/services/lang.ts`**

Add to the `vi` object, right after the `"Imported books have no chapter list to watch"` line:

```ts
  // Internet Archive import
  "This is not an Internet Archive book page: {url} — paste a URL like https://archive.org/details/<id>":
    "URL này không phải trang sách Internet Archive: {url} — hãy dán URL dạng https://archive.org/details/<id>",
  "Internet Archive item not found: {id}": "Không tìm thấy sách trên Internet Archive: {id}",
  "This Internet Archive item is not a book: {url}": "Mục này trên Internet Archive không phải là sách: {url}",
  "This Internet Archive item is access-restricted (borrow-only) and cannot be imported: {url}":
    "Sách này trên Internet Archive bị giới hạn truy cập (phải mượn/đăng nhập), không thể nhập: {url}",
  "No readable EPUB, PDF, or text file is available for this Internet Archive item: {url}":
    "Không có file EPUB, PDF hay text đọc được cho sách này trên Internet Archive: {url}",
  "This Internet Archive book has too many pages to import (maximum {count})":
    "Sách từ Internet Archive có quá nhiều trang để nhập (tối đa {count})",
  "Could not import from Internet Archive": "Không nhập được sách từ Internet Archive",
  "Internet Archive books are imported, not crawled": "Sách Internet Archive được nhập về, không crawl",
```

- [ ] **Step 2: Write the failing tests**

Create `src/services/archiveImport.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  archiveItemId,
  ArchiveNotBookError,
  ArchiveNotFoundError,
  ArchiveRestrictedError,
  fetchItem,
} from "./archiveImport";

type FakeFile = { name: string; format: string; source?: string; private?: string | boolean; size?: string };

interface ArchiveFetchOptions {
  metadata?: Record<string, unknown> | null;
  files?: FakeFile[];
  bodies?: Record<string, Buffer | string | number>;
  cover?: Buffer | number;
}

// One mock for every archive.org call an import can make: the metadata API, a file
// download, and the item image. A `null` metadata means the endpoint answers 404.
export function archiveFetch(options: ArchiveFetchOptions = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const metadataMatch = /^https:\/\/archive\.org\/metadata\/(.+)$/.exec(url);
    if (metadataMatch) {
      if (options.metadata === null) return new Response("", { status: 404 });
      const metadata = { identifier: decodeURIComponent(metadataMatch[1]), ...options.metadata };
      return new Response(JSON.stringify({ metadata, files: options.files ?? [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const downloadMatch = /^https:\/\/archive\.org\/download\/[^/]+\/(.+)$/.exec(url);
    if (downloadMatch) {
      const body = options.bodies?.[decodeURIComponent(downloadMatch[1])];
      if (body === undefined) return new Response("", { status: 404 });
      if (typeof body === "number") return new Response("", { status: body });
      return new Response(new Uint8Array(typeof body === "string" ? Buffer.from(body) : body));
    }
    if (url.startsWith("https://archive.org/services/img/")) {
      const cover = options.cover;
      if (typeof cover === "number") return new Response("", { status: cover });
      if (cover) return new Response(new Uint8Array(cover));
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("archiveItemId", () => {
  it("reads the id from the accepted URL shapes", () => {
    expect(archiveItemId("https://archive.org/details/storekeeper0000pear")).toBe("storekeeper0000pear");
    expect(archiveItemId("https://archive.org/details/namiya0000higa/page/n5/mode/2up")).toBe("namiya0000higa");
    expect(archiveItemId("https://archive.org/metadata/proceedings1922mcle")).toBe("proceedings1922mcle");
    expect(archiveItemId("https://www.archive.org/download/alice/alice.pdf")).toBe("alice");
  });

  it("rejects other hosts and paths", () => {
    expect(archiveItemId("https://example.com/details/x")).toBeUndefined();
    expect(archiveItemId("https://archive.org/search?query=alice")).toBeUndefined();
    expect(archiveItemId("https://archive.org/details/")).toBeUndefined();
    expect(archiveItemId("not a url")).toBeUndefined();
  });
});

describe("fetchItem", () => {
  it("returns the catalog fields and public files", async () => {
    const fetchImpl = archiveFetch({
      metadata: { title: "The Storekeeper", creator: "Pearson, Tracey Campbell", language: "eng", mediatype: "texts" },
      files: [{ name: "book_djvu.txt", format: "DjVuTXT" }],
    });
    const item = await fetchItem(fetchImpl, "storekeeper0000pear");
    expect(item).toMatchObject({
      id: "storekeeper0000pear",
      title: "The Storekeeper",
      author: "Pearson, Tracey Campbell",
      language: "eng",
      pdfDegraded: false,
    });
    expect(item.files).toHaveLength(1);
  });

  it("refuses a lending item before looking at files", async () => {
    const fetchImpl = archiveFetch({
      metadata: { "access-restricted-item": "true" },
      files: [{ name: "x_djvu.txt", format: "DjVuTXT" }],
    });
    await expect(fetchItem(fetchImpl, "x")).rejects.toBeInstanceOf(ArchiveRestrictedError);
  });

  it("answers not-found for an unknown item", async () => {
    await expect(fetchItem(archiveFetch({ metadata: null }), "missing")).rejects.toBeInstanceOf(ArchiveNotFoundError);
    const empty = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    await expect(fetchItem(empty as unknown as typeof fetch, "missing")).rejects.toBeInstanceOf(ArchiveNotFoundError);
  });

  it("refuses a non-text mediatype", async () => {
    const fetchImpl = archiveFetch({ metadata: { mediatype: "audio" } });
    await expect(fetchItem(fetchImpl, "song")).rejects.toBeInstanceOf(ArchiveNotBookError);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/services/archiveImport.test.ts`
Expected: FAIL — `Cannot find module './archiveImport'`.

- [ ] **Step 4: Write `src/services/archiveImport.ts`**

```ts
import { t } from "./lang";

// An Internet Archive item whose catalog entry marks it lending/access-restricted is
// refused before any file is fetched. The app never borrows, signs in or decrypts.
export class ArchiveNotFoundError extends Error {
  constructor(id: string) {
    super(t("Internet Archive item not found: {id}", { id }));
  }
}

export class ArchiveNotBookError extends Error {
  constructor(url: string) {
    super(t("This Internet Archive item is not a book: {url}", { url }));
  }
}

export class ArchiveRestrictedError extends Error {
  constructor(url: string) {
    super(t("This Internet Archive item is access-restricted (borrow-only) and cannot be imported: {url}", { url }));
  }
}

export class ArchiveUnavailableError extends Error {
  constructor(url: string) {
    super(t("No readable EPUB, PDF, or text file is available for this Internet Archive item: {url}", { url }));
  }
}

export class ArchiveTooManyPagesError extends Error {
  constructor(count: number) {
    super(t("This Internet Archive book has too many pages to import (maximum {count})", { count }));
  }
}

export interface ArchiveFile {
  name: string;
  format?: string;
  source?: string;
  private?: string | boolean;
  size?: string;
}

export interface ArchiveItem {
  id: string;
  title: string;
  author?: string;
  language?: string;
  pdfDegraded: boolean;
  files: ArchiveFile[];
}

const ITEM_PATH_RE = /^\/(?:details|metadata|download)\/([^/?#]+)/;

// The item id from an archive.org URL: /details/<id> (book-reader deep links included),
// /metadata/<id>, /download/<id>/<file>. Any other path, or another host, is not ours.
export function archiveItemId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname !== "archive.org") return undefined;
  const match = ITEM_PATH_RE.exec(parsed.pathname);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function metaString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim() || undefined;
  return undefined;
}

// A network failure propagates as the raw fetch error (the route turns that into the
// generic message); an unknown id answers 404 or an empty body, both "not found".
export async function fetchItem(fetchImpl: typeof fetch, id: string): Promise<ArchiveItem> {
  const res = await fetchImpl(`https://archive.org/metadata/${encodeURIComponent(id)}`);
  if (!res.ok) throw new ArchiveNotFoundError(id);
  const data = (await res.json().catch(() => null)) as
    | { metadata?: Record<string, unknown>; files?: unknown }
    | null;
  const metadata = data?.metadata;
  if (!metadata || metaString(metadata.identifier) !== id) throw new ArchiveNotFoundError(id);
  const url = `https://archive.org/details/${id}`;
  const mediatype = metaString(metadata.mediatype);
  if (mediatype && mediatype !== "texts") throw new ArchiveNotBookError(url);
  if (metadata["access-restricted-item"] === "true" || metadata["access-restricted-item"] === true) {
    throw new ArchiveRestrictedError(url);
  }
  return {
    id,
    title: metaString(metadata.title) ?? id,
    author: metaString(metadata.creator),
    language: metaString(metadata.language),
    pdfDegraded: !!metaString(metadata.pdf_degraded),
    files: Array.isArray(data.files) ? (data.files as ArchiveFile[]) : [],
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/services/archiveImport.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/archiveImport.ts src/services/archiveImport.test.ts src/services/lang.ts
git commit -m "feat(archive): read archive.org item URLs and catalog metadata"
```

---

### Task 2: Pick and download public files

**Files:**
- Modify: `src/services/archiveImport.ts` (append)
- Modify: `src/services/archiveImport.test.ts` (append)

**Interfaces:**
- Consumes: `ArchiveFile`, `MAX_ARCHIVE_FILE_BYTES` from Task 1's file.
- Produces:
  - `const MAX_ARCHIVE_FILE_BYTES = 100 * 1024 * 1024`
  - `pickEpubFile(files: ArchiveFile[], maxBytes?: number): ArchiveFile | undefined`
  - `pickTextFile(files: ArchiveFile[], maxBytes?: number): ArchiveFile | undefined`
  - `pickPdfFile(files: ArchiveFile[], options?: { degraded?: boolean; maxBytes?: number }): ArchiveFile | undefined`
  - `fetchBytes(fetchImpl: typeof fetch, url: string, cap: number): Promise<Buffer | undefined>`
  - `downloadUrl(id: string, name: string): string` (also produced here, used by Task 4)

- [ ] **Step 1: Write the failing tests**

Append to `src/services/archiveImport.test.ts` (add the new names to the existing import from `./archiveImport`, and `MAX_ARCHIVE_FILE_BYTES` too):

```ts
describe("archive file picking", () => {
  it("prefers an original EPUB and skips LCP, private and oversized files", () => {
    const files: FakeFile[] = [
      { name: "book_lcp.epub", format: "EPUB" },
      { name: "book.epub", format: "EPUB", source: "derivative", size: "1000" },
      { name: "book_orig.epub", format: "EPUB", source: "original", size: "2000" },
      { name: "big.epub", format: "EPUB", source: "original", size: String(MAX_ARCHIVE_FILE_BYTES + 1) },
      { name: "secret.epub", format: "EPUB", private: "true" },
    ];
    expect(pickEpubFile(files, MAX_ARCHIVE_FILE_BYTES)?.name).toBe("book_orig.epub");
  });

  it("prefers the OCR text file and the derivative Text PDF", () => {
    const text = pickTextFile(
      [
        { name: "book_hocr_searchtext.txt.gz", format: "OCR Search Text" },
        { name: "book_djvu.txt", format: "DjVuTXT" },
      ],
      MAX_ARCHIVE_FILE_BYTES
    );
    expect(text?.name).toBe("book_djvu.txt");

    const pdf = pickPdfFile(
      [
        { name: "book_encrypted.pdf", format: "ACS Encrypted PDF" },
        { name: "book_orig.pdf", format: "Text PDF" },
        { name: "book.pdf", format: "Additional Text PDF" },
      ],
      { degraded: false, maxBytes: MAX_ARCHIVE_FILE_BYTES }
    );
    expect(pdf?.name).toBe("book_orig.pdf");
  });

  it("gives up on a degraded PDF", () => {
    expect(pickPdfFile([{ name: "book.pdf", format: "Text PDF" }], { degraded: true })).toBeUndefined();
  });
});

describe("fetchBytes", () => {
  const impl = (res: Response | Error) =>
    vi.fn(async () => {
      if (res instanceof Error) throw res;
      return res;
    }) as unknown as typeof fetch;

  it("returns the body bytes", async () => {
    const bytes = await fetchBytes(impl(new Response(new Uint8Array(Buffer.from("hello")))), "https://x", 1024);
    expect(bytes?.toString()).toBe("hello");
  });

  it("returns undefined for HTTP errors and network failures", async () => {
    expect(await fetchBytes(impl(new Response("", { status: 403 })), "https://x", 1024)).toBeUndefined();
    expect(await fetchBytes(impl(new TypeError("fetch failed")), "https://x", 1024)).toBeUndefined();
  });

  it("cuts a response that runs past the cap", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    expect(await fetchBytes(impl(new Response(stream)), "https://x", 10)).toBeUndefined();
  });

  it("refuses a declared size over the cap without reading it", async () => {
    let read = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        read = true;
        controller.enqueue(new Uint8Array(4));
        controller.close();
      },
    });
    const res = { ok: true, headers: new Headers({ "content-length": "999" }), body: stream } as unknown as Response;
    expect(await fetchBytes(impl(res), "https://x", 100)).toBeUndefined();
    expect(read).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/archiveImport.test.ts`
Expected: FAIL — `pickEpubFile is not a function` (or undefined).

- [ ] **Step 3: Append the implementation to `src/services/archiveImport.ts`**

```ts
// A book file bigger than this is not read; the metadata's own `size` is checked first,
// the stream second, so a missing or wrong Content-Length cannot run away.
export const MAX_ARCHIVE_FILE_BYTES = 100 * 1024 * 1024;

function isPrivateFile(file: ArchiveFile): boolean {
  return file.private === "true" || file.private === true;
}

function sizeOf(file: ArchiveFile): number {
  const size = Number(file.size);
  return Number.isFinite(size) ? size : Infinity;
}

// LCP-wrapped EPUBs are the lending copies, never plain files.
const isEpubFile = (file: ArchiveFile): boolean => file.format === "EPUB" && !/_lcp\.epub$/i.test(file.name);
const isTextFile = (file: ArchiveFile): boolean => file.format === "DjVuTXT";
const isPdfFile = (file: ArchiveFile): boolean => /\.pdf$/i.test(file.name) && !/encrypted/i.test(file.format ?? "");
const epubRank = (file: ArchiveFile): number => (file.source === "original" ? 0 : 1);
const pdfRank = (file: ArchiveFile): number => (file.format === "Text PDF" ? 0 : 1);

function pickFile(
  files: ArchiveFile[],
  accept: (file: ArchiveFile) => boolean,
  rank: (file: ArchiveFile) => number,
  maxBytes: number
): ArchiveFile | undefined {
  return files
    .filter((file) => !isPrivateFile(file) && sizeOf(file) <= maxBytes && accept(file))
    .sort((a, b) => rank(a) - rank(b) || sizeOf(a) - sizeOf(b))[0];
}

export function pickEpubFile(files: ArchiveFile[], maxBytes = MAX_ARCHIVE_FILE_BYTES): ArchiveFile | undefined {
  return pickFile(files, isEpubFile, epubRank, maxBytes);
}

export function pickTextFile(files: ArchiveFile[], maxBytes = MAX_ARCHIVE_FILE_BYTES): ArchiveFile | undefined {
  return pickFile(files, isTextFile, () => 0, maxBytes);
}

export function pickPdfFile(
  files: ArchiveFile[],
  options: { degraded?: boolean; maxBytes?: number } = {}
): ArchiveFile | undefined {
  if (options.degraded) return undefined;
  return pickFile(files, isPdfFile, pdfRank, options.maxBytes ?? MAX_ARCHIVE_FILE_BYTES);
}

export function downloadUrl(id: string, name: string): string {
  const filePath = name.split("/").map(encodeURIComponent).join("/");
  return `https://archive.org/download/${encodeURIComponent(id)}/${filePath}`;
}

// Reads at most `cap` bytes from the response; undefined on any failure, so a caller
// can fall through to the next source.
export async function fetchBytes(fetchImpl: typeof fetch, url: string, cap: number): Promise<Buffer | undefined> {
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch {
    return undefined;
  }
  if (!res.ok || !res.body) return undefined;
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) return undefined;
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    let result: { done: boolean; value?: Uint8Array };
    try {
      result = await reader.read();
    } catch {
      return undefined;
    }
    if (result.done || !result.value) break;
    total += result.value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(result.value);
  }
  return total > 0 ? Buffer.concat(chunks) : undefined;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/archiveImport.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/archiveImport.ts src/services/archiveImport.test.ts
git commit -m "feat(archive): pick and download openly available item files"
```

---

### Task 3: Build a book from the OCR text

**Files:**
- Modify: `src/services/pdfImport.ts:13` (`PAGES_PER_CHUNK` → exported), `:69` (`CHAPTER_HEADING_RE` → exported), `:197` (`joinLine` → exported)
- Modify: `src/services/archiveImport.ts` (append)
- Modify: `src/services/archiveImport.test.ts` (append)

**Interfaces:**
- Consumes: `CHAPTER_HEADING_RE`, `MAX_PAGES`, `PAGES_PER_CHUNK`, `joinLine` from `./pdfImport`; `ImportedBook`, `ImportedChapter` from `./epubImport`; `ContentBlock` from `../types`; `ArchiveTooManyPagesError` from Task 1.
- Produces:
  - `const MIN_TEXT_CHARS = 200`
  - `textToBook(text: string, meta: { title: string; author?: string; language?: string }): ImportedBook`

- [ ] **Step 1: Export the shared heuristics from `src/services/pdfImport.ts`**

Change line 13 from `const PAGES_PER_CHUNK = 20;` to `export const PAGES_PER_CHUNK = 20;`
Change line 69 from `const CHAPTER_HEADING_RE = …` to `export const CHAPTER_HEADING_RE = …` (keep the regex unchanged).
Change line 70 from `const SENTENCE_END_RE = …` to `export const SENTENCE_END_RE = …` (keep the regex unchanged).
Change line 197 from `function joinLine(` to `export function joinLine(`.

- [ ] **Step 2: Write the failing tests**

Append to `src/services/archiveImport.test.ts` (import `MAX_PAGES` from `./pdfImport`, `ArchiveTooManyPagesError`, `textToBook`):

```ts
describe("textToBook", () => {
  it("splits on chapter headings and rebuilds paragraphs", () => {
    const text = ["Chapter 1", "It was a dark night.", "The wind howled.", "Chapter 2", "Morning came slow."].join("\n");
    const book = textToBook(text, { title: "Sách" });
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Chapter 2"]);
    expect(book.chapters[0].blocks).toEqual([
      { type: "paragraph", text: "It was a dark night." },
      { type: "paragraph", text: "The wind howled." },
    ]);
  });

  it("keeps the text before the first chapter as its own chapter", () => {
    const text = ["Title page words.", "Chapter 1", "Body line.", "Chapter 2", "More body."].join("\n");
    const book = textToBook(text, { title: "Sách" });
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Sách", "Chapter 1", "Chapter 2"]);
  });

  it("starts a new paragraph on an indented line", () => {
    const text = [
      "Chapter 1",
      "First line of the page continues here.",
      "   Indented new paragraph starts here.",
      "Chapter 2",
      "End.",
    ].join("\n");
    const book = textToBook(text, { title: "Sách" });
    expect(book.chapters[0].blocks).toEqual([
      { type: "paragraph", text: "First line of the page continues here." },
      { type: "paragraph", text: "Indented new paragraph starts here." },
    ]);
  });

  it("joins hyphen-broken words and drops bare page numbers at page edges", () => {
    const text = "1\nsome-\nthing continued here\n42";
    const book = textToBook(text, { title: "Sách" });
    expect(book.chapters[0].blocks).toEqual([{ type: "paragraph", text: "something continued here" }]);
  });

  it("falls back to 20-page chunks when there are no chapter headings", () => {
    const text = Array.from({ length: 25 }, (_, index) => `Page ${index + 1} has text.`).join("\n\f");
    const book = textToBook(text, { title: "Sách" });
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Pages 1–20", "Pages 21–25"]);
  });

  it("refuses a book past the page cap", () => {
    const text = Array.from({ length: MAX_PAGES + 1 }, () => "text").join("\n\f");
    expect(() => textToBook(text, { title: "Sách" })).toThrow(ArchiveTooManyPagesError);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/services/archiveImport.test.ts`
Expected: FAIL — `textToBook is not a function`.

- [ ] **Step 4: Append the implementation to `src/services/archiveImport.ts`**

Add the imports at the top of the file (merge with the existing `import { t } from "./lang";`):

```ts
import { ContentBlock } from "../types";
import { ImportedBook, ImportedChapter } from "./epubImport";
import { t } from "./lang";
import { CHAPTER_HEADING_RE, joinLine, MAX_PAGES, PAGES_PER_CHUNK, SENTENCE_END_RE } from "./pdfImport";
```

Then append:

```ts
// A text file with less than this is a scan without a text layer (or a picture book):
// the PDF source is tried instead, which keeps the page images.
export const MIN_TEXT_CHARS = 200;

const PAGE_NUMBER_RE = /^[-–—\s]*\d+[-–—\s]*$/;

interface FlatLine {
  text: string;
  indented: boolean;
  page: number;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// One page of a DjVuTXT file: trailing spaces gone, bare leading/trailing page numbers
// dropped, empty lines gone. Leading indentation is kept — it marks a new paragraph.
function pageLines(page: string): string[] {
  const lines = page.split("\n").map((line) => line.replace(/\s+$/, ""));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const kept = lines.filter((line) => line.trim());
  return kept.filter((line, index) => {
    const edge = index === 0 || index === kept.length - 1;
    return !(edge && PAGE_NUMBER_RE.test(line.trim()));
  });
}

// Turn OCR text into a book: pages split on form feeds, chapters from heading lines
// (otherwise 20-page chunks), paragraphs from indentation, sentence ends and the page's
// own line width — there are no coordinates to use, unlike a PDF.
export function textToBook(text: string, meta: { title: string; author?: string; language?: string }): ImportedBook {
  const pages = text.split("\f").map(pageLines).filter((lines) => lines.length > 0);
  if (pages.length > MAX_PAGES) throw new ArchiveTooManyPagesError(MAX_PAGES);

  const flat: FlatLine[] = [];
  const pageWidth = new Map<number, number>();
  pages.forEach((lines, page) => {
    for (const raw of lines) {
      const line = raw.trim();
      flat.push({ text: line, indented: /^\s/.test(raw), page });
      pageWidth.set(page, Math.max(pageWidth.get(page) ?? 0, line.length));
    }
  });

  const starts: { index: number; title: string }[] = [];
  flat.forEach((line, index) => {
    if (line.text.length <= 120 && CHAPTER_HEADING_RE.test(line.text)) starts.push({ index, title: line.text });
  });

  const chapters: ImportedChapter[] = [];
  if (starts.length >= 2) {
    const segments = [
      { start: 0, end: starts[0].index, title: meta.title, skipHeading: false },
      ...starts.map((start, index) => ({
        start: start.index,
        end: starts[index + 1]?.index ?? flat.length,
        title: start.title,
        skipHeading: true,
      })),
    ];
    for (const segment of segments) {
      const blocks = blocksFor(flat, pageWidth, segment.start, segment.end, segment.skipHeading);
      if (blocks.length) chapters.push({ title: segment.title, blocks });
    }
  } else {
    for (let page = 0; page < pages.length; page += PAGES_PER_CHUNK) {
      const last = Math.min(page + PAGES_PER_CHUNK, pages.length);
      const start = flat.findIndex((line) => line.page === page);
      const end = flat.findIndex((line) => line.page === last);
      const title = pages.length <= PAGES_PER_CHUNK ? meta.title : t("Pages {from}–{to}", { from: page + 1, to: last });
      const blocks = blocksFor(flat, pageWidth, start, end === -1 ? flat.length : end, false);
      if (blocks.length) chapters.push({ title, blocks });
    }
  }

  return { title: meta.title, author: meta.author, language: meta.language, chapters };
}

function blocksFor(
  flat: FlatLine[],
  pageWidth: Map<number, number>,
  from: number,
  to: number,
  skipHeading: boolean
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let paragraph: string | undefined;
  let previous: FlatLine | undefined;
  const flush = () => {
    if (paragraph) blocks.push({ type: "paragraph", text: escapeHtml(paragraph) });
    paragraph = undefined;
  };
  for (let i = skipHeading ? from + 1 : from; i < to; i++) {
    const line = flat[i];
    const endsSentence = previous ? SENTENCE_END_RE.test(previous.text) : true;
    let breaks = !paragraph || !previous || line.indented;
    if (!breaks && previous) {
      breaks =
        previous.page !== line.page
          ? endsSentence
          : endsSentence && previous.text.length < (pageWidth.get(previous.page) ?? previous.text.length) * 0.9;
    }
    if (breaks) {
      flush();
      paragraph = line.text;
    } else {
      paragraph = joinLine(paragraph ?? "", line.text);
    }
    previous = line;
  }
  flush();
  return blocks;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/services/archiveImport.test.ts`
Expected: PASS (19 tests).

- [ ] **Step 6: Run the PDF tests to make sure the exports changed nothing**

Run: `npx vitest run src/services/pdfImport.test.ts`
Expected: PASS (unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/services/archiveImport.ts src/services/archiveImport.test.ts src/services/pdfImport.ts
git commit -m "feat(archive): build a book from an item's OCR text"
```

---

### Task 4: Orchestrate EPUB → text → PDF with cover

**Files:**
- Modify: `src/services/archiveImport.ts` (append)
- Modify: `src/services/archiveImport.test.ts` (append)

**Interfaces:**
- Consumes: everything from Tasks 1–3; `parseEpub`, `StoreImage` from `./epubImport`; `parsePdf` from `./pdfImport`; `MAX_COVER_BYTES`, `sniffImageExtension` from `./coverStore`.
- Produces:
  - `interface ImportArchiveOptions { fetchImpl?: typeof fetch; storeImage?: StoreImage; maxFileBytes?: number }`
  - `importArchiveItem(id: string, options?: ImportArchiveOptions): Promise<ImportedBook>`

- [ ] **Step 1: Write the failing tests**

Append to `src/services/archiveImport.test.ts` (add `readFileSync` from `node:fs`, `path` from `node:path`, `buildEpubFixture` + `TINY_PNG` from `./__fixtures__/epubFixtures`, `importArchiveItem`, `ArchiveUnavailableError`):

```ts
describe("importArchiveItem", () => {
  const epubBytes = buildEpubFixture({
    title: "EPUB title",
    chapters: [{ id: "ch1", file: "OEBPS/ch1.xhtml", title: "Một", html: "<p>Nội dung.</p>" }],
  });

  it("prefers the public EPUB and takes catalog metadata", async () => {
    const fetchImpl = archiveFetch({
      metadata: { title: "Catalog title", creator: "Pearson, Tracey Campbell", language: "eng" },
      files: [
        { name: "book.epub", format: "EPUB", source: "original" },
        { name: "book_djvu.txt", format: "DjVuTXT" },
      ],
      bodies: { "book.epub": epubBytes, "book_djvu.txt": "Chapter 1\ntext" },
    });
    const book = await importArchiveItem("x", { fetchImpl });
    expect(book).toMatchObject({ title: "Catalog title", author: "Pearson, Tracey Campbell", language: "eng" });
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Một"]);
  });

  it("falls back to the OCR text when there is no EPUB", async () => {
    // Past MIN_TEXT_CHARS (200 non-space characters), or the PDF fallback would run.
    const text = [
      "Chapter 1",
      "It was a dark night, and the wind howled through the narrow streets.",
      "Nobody was outside, so the storekeeper locked the door early.",
      "She counted the till twice before turning off the lamps.",
      "Chapter 2",
      "Morning came slow, with the first light creeping over the rooftops.",
      "The cat was already waiting by the back door.",
    ].join("\n");
    const fetchImpl = archiveFetch({
      files: [{ name: "book_djvu.txt", format: "DjVuTXT" }],
      bodies: { "book_djvu.txt": text },
    });
    const book = await importArchiveItem("x", { fetchImpl });
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Chapter 2"]);
  });

  it("uses the PDF when the text layer is too thin", async () => {
    const pdf = readFileSync(path.join(__dirname, "__fixtures__", "pdf-scan.pdf"));
    const fetchImpl = archiveFetch({
      files: [
        { name: "book_djvu.txt", format: "DjVuTXT" },
        { name: "book.pdf", format: "Text PDF" },
      ],
      bodies: { "book_djvu.txt": "nearly nothing", "book.pdf": pdf },
    });
    const book = await importArchiveItem("x", {
      fetchImpl,
      storeImage: (bytes, extension) => `media/${extension}/${bytes.length}`,
    });
    const image = book.chapters.flatMap((chapter) => chapter.blocks).find((block) => block.type === "image");
    expect(image?.src).toMatch(/^media\/jpg\//);
  });

  it("adds the item image as the cover", async () => {
    // 20 lines: past MIN_TEXT_CHARS, so the text source is used.
    const text = Array.from({ length: 20 }, (_, index) => `Line ${index} of text.`).join("\n");
    const fetchImpl = archiveFetch({
      files: [{ name: "book_djvu.txt", format: "DjVuTXT" }],
      bodies: { "book_djvu.txt": text },
      cover: TINY_PNG,
    });
    const book = await importArchiveItem("x", { fetchImpl });
    expect(book.cover?.bytes.equals(TINY_PNG)).toBe(true);
  });

  it("answers unavailable when every source is private or missing", async () => {
    const fetchImpl = archiveFetch({
      files: [
        { name: "book.epub", format: "EPUB", private: "true" },
        { name: "book_djvu.txt", format: "DjVuTXT", private: "true" },
      ],
    });
    await expect(importArchiveItem("x", { fetchImpl })).rejects.toBeInstanceOf(ArchiveUnavailableError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/archiveImport.test.ts`
Expected: FAIL — `importArchiveItem is not a function`.

- [ ] **Step 3: Append the implementation to `src/services/archiveImport.ts`**

Merge these into the existing imports at the top:

```ts
import { ImportedBook, parseEpub, StoreImage } from "./epubImport";
import { parsePdf } from "./pdfImport";
import { MAX_COVER_BYTES, sniffImageExtension } from "./coverStore";
```

Then append:

```ts
export interface ImportArchiveOptions {
  fetchImpl?: typeof fetch;
  storeImage?: StoreImage;
  maxFileBytes?: number;
}

// The item's title/author/language come from the catalog when present; the parser's own
// metadata is the fallback. The item image is only a cover if the book has none.
async function withItemMeta(
  book: ImportedBook,
  item: ArchiveItem,
  fetchImpl: typeof fetch,
  maxBytes: number
): Promise<ImportedBook> {
  if (!book.cover) {
    const bytes = await fetchBytes(
      fetchImpl,
      `https://archive.org/services/img/${encodeURIComponent(item.id)}`,
      Math.min(maxBytes, MAX_COVER_BYTES)
    );
    const extension = bytes && sniffImageExtension(bytes);
    if (bytes && extension) book.cover = { bytes, extension };
  }
  return {
    ...book,
    title: item.title || book.title,
    author: item.author ?? book.author,
    language: item.language ?? book.language,
  };
}

// EPUB first (real chapters and images), then the OCR text (small, always there for a
// scan), then the PDF (the image-bearing fallback for items with no text layer). A
// source that fails or has nothing readable falls through to the next one.
export async function importArchiveItem(id: string, options: ImportArchiveOptions = {}): Promise<ImportedBook> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxFileBytes ?? MAX_ARCHIVE_FILE_BYTES;
  const item = await fetchItem(fetchImpl, id);
  const parseOptions = { fallbackTitle: item.title, storeImage: options.storeImage ?? (() => "") };

  const epubFile = pickEpubFile(item.files, maxBytes);
  if (epubFile) {
    const bytes = await fetchBytes(fetchImpl, downloadUrl(id, epubFile.name), maxBytes);
    if (bytes) {
      const book = await parseEpub(bytes, parseOptions).catch(() => undefined);
      if (book) return withItemMeta(book, item, fetchImpl, maxBytes);
    }
  }

  const textFile = pickTextFile(item.files, maxBytes);
  if (textFile) {
    const bytes = await fetchBytes(fetchImpl, downloadUrl(id, textFile.name), maxBytes);
    const text = bytes?.toString("utf8");
    if (text && text.replace(/\s/g, "").length >= MIN_TEXT_CHARS) {
      return withItemMeta(textToBook(text, item), item, fetchImpl, maxBytes);
    }
  }

  const pdfFile = pickPdfFile(item.files, { degraded: item.pdfDegraded, maxBytes });
  if (pdfFile) {
    const bytes = await fetchBytes(fetchImpl, downloadUrl(id, pdfFile.name), maxBytes);
    if (bytes) {
      const book = await parsePdf(bytes, parseOptions).catch(() => undefined);
      if (book) return withItemMeta(book, item, fetchImpl, maxBytes);
    }
  }

  throw new ArchiveUnavailableError(`https://archive.org/details/${id}`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/archiveImport.test.ts`
Expected: PASS (24 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/archiveImport.ts src/services/archiveImport.test.ts
git commit -m "feat(archive): import an item from EPUB, OCR text or PDF with its cover"
```

---

### Task 5: Route `POST /stories/import-archive` + `POST /stories` guard

**Files:**
- Modify: `src/routes/stories.ts` (imports at top, guard in `POST /stories` after the `url` check, new route after the `import-epub` block, before `GET /stories`)
- Create: `src/routes/importArchive.test.ts`

**Interfaces:**
- Consumes: `archiveItemId`, `importArchiveItem`, the five archive error classes from Task 1/4.
- Produces: `POST /api/stories/import-archive` (body `{ url }`, `?overwrite=1`) → 201/200 `{ story }`, 409 `{ code: "exists", story }`, 400 `{ message }`.

- [ ] **Step 1: Write the failing route tests**

Create `src/routes/importArchive.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEpubFixture, TINY_PNG } from "../services/__fixtures__/epubFixtures";

/**
 * POST /stories/import-archive over a throwaway library, like importEpub.test.ts. The
 * server's own archive.org fetches are intercepted by a stubbed global fetch; the test
 * client calls the local server with the real fetch captured before stubbing.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "import-archive-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const EPUB = buildEpubFixture({
  title: "Sách Archive",
  chapters: [{ id: "ch1", file: "OEBPS/ch1.xhtml", title: "Một", html: "<p>Nội dung.</p>" }],
});
// Past MIN_TEXT_CHARS (200 non-space characters), so the text source is chosen.
const TEXT = [
  "Chapter 1",
  "It was a dark night, and the wind howled through the narrow streets.",
  "Nobody was outside, so the storekeeper locked the door early.",
  "She counted the till twice before turning off the lamps.",
  "Chapter 2",
  "Morning came slow, with the first light creeping over the rooftops.",
  "The cat was already waiting by the back door.",
].join("\n");

describe("POST /stories/import-archive", () => {
  let server: Server;
  let base: string;
  let stories: typeof import("../services/storyStore").storyStore;
  let storyId: typeof import("../services/storyStore").storyId;
  let privateStore: ReturnType<typeof import("../services/storyStore").createStoryStore>;
  let id: string;
  let realFetch: typeof fetch;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { storiesRouter } = await import("./stories");
    const store = await import("../services/storyStore");
    stories = store.storyStore;
    storyId = store.storyId;
    privateStore = store.createStoryStore(path.join(DATA_DIR, "private"));
    id = storyId("archive:testitem");

    const app = express();
    app.use(express.json());
    app.use("/api", storiesRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}`;
    realFetch = globalThis.fetch;
  });

  beforeEach(async () => {
    await stories.remove(id);
    await privateStore.remove(id);
    await rm(path.join(DATA_DIR, "epub-media"), { recursive: true, force: true });
    await rm(path.join(DATA_DIR, "covers"), { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  interface StubOptions {
    restricted?: boolean;
    files?: { name: string; format: string; private?: string }[];
    bodies?: Record<string, Buffer | string | number>;
    cover?: Buffer;
  }

  function stubArchive(options: StubOptions) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://archive.org/metadata/")) {
          const identifier = decodeURIComponent(url.split("/metadata/")[1]);
          return new Response(
            JSON.stringify({
              metadata: {
                identifier,
                title: "Sách Archive",
                creator: "Tác giả",
                language: "eng",
                mediatype: "texts",
                ...(options.restricted ? { "access-restricted-item": "true" } : {}),
              },
              files: options.files ?? [],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.startsWith("https://archive.org/download/")) {
          const name = decodeURIComponent(url.split("/download/")[1].split("/").slice(1).join("/"));
          const body = options.bodies?.[name];
          if (body === undefined) return new Response("", { status: 404 });
          if (typeof body === "number") return new Response("", { status: body });
          return new Response(new Uint8Array(typeof body === "string" ? Buffer.from(body) : body));
        }
        if (url.startsWith("https://archive.org/services/img/")) {
          return options.cover ? new Response(new Uint8Array(options.cover)) : new Response("", { status: 404 });
        }
        return realFetch(input, init);
      })
    );
  }

  function importArchive(
    query = "",
    body: unknown = { url: "https://archive.org/details/testitem" },
    headers: Record<string, string> = {}
  ) {
    return realFetch(`${base}/api/stories/import-archive${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  it("imports an open item as an EPUB-style book", async () => {
    stubArchive({ files: [{ name: "book.epub", format: "EPUB" }], bodies: { "book.epub": EPUB }, cover: TINY_PNG });
    const res = await importArchive();
    expect(res.status).toBe(201);

    const { story } = await res.json();
    expect(story).toMatchObject({
      id,
      site: "epub",
      storyUrl: "archive:testitem",
      title: "Sách Archive",
      watching: false,
    });
    expect(story.chapters).toHaveLength(1);
    expect(story.chapters[0]).toMatchObject({ order: 1, title: "Một", status: "done" });
    expect(story.coverUrl).toBe(`covers/${id}.png`);
  });

  it("uses the OCR text when the item has no EPUB", async () => {
    stubArchive({ files: [{ name: "book_djvu.txt", format: "DjVuTXT" }], bodies: { "book_djvu.txt": TEXT } });
    const res = await importArchive();
    expect(res.status).toBe(201);

    const { story } = await res.json();
    expect(story.chapters.map((chapter: { title: string }) => chapter.title)).toEqual(["Chapter 1", "Chapter 2"]);
  });

  it("imports into the private library when a vault token is sent", async () => {
    stubArchive({ files: [{ name: "book_djvu.txt", format: "DjVuTXT" }], bodies: { "book_djvu.txt": TEXT } });
    const vault = (await import("../services/vault")).vault;
    const setup = vault.setup("123456");
    if (!setup.ok) throw new Error(setup.reason);

    const res = await importArchive("", { url: "https://archive.org/details/testitem" }, { "X-Vault-Token": setup.token });
    expect(res.status).toBe(201);
    expect(await privateStore.getOutline(id)).toBeTruthy();
    expect(await stories.getOutline(id)).toBeUndefined();
  });

  it("answers 409 for an item already in the library, then overwrites", async () => {
    stubArchive({ files: [{ name: "book_djvu.txt", format: "DjVuTXT" }], bodies: { "book_djvu.txt": TEXT } });
    await importArchive();

    const conflict = await importArchive();
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe("exists");

    const overwrite = await importArchive("?overwrite=1");
    expect(overwrite.status).toBe(200);
  });

  it("refuses a lending item with the translated message", async () => {
    stubArchive({
      restricted: true,
      files: [{ name: "book_djvu.txt", format: "DjVuTXT" }],
      bodies: { "book_djvu.txt": TEXT },
    });
    const res = await importArchive("", { url: "https://archive.org/details/testitem" }, { "X-Lang": "vi" });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("giới hạn truy cập");
  });

  it("refuses a URL that is not an archive.org item page", async () => {
    const res = await importArchive("", { url: "https://example.com/details/x" });
    expect(res.status).toBe(400);
  });

  it("refuses to load an archive.org book through POST /stories", async () => {
    const res = await realFetch(`${base}/api/stories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://archive.org/details/testitem" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("Internet Archive books are imported, not crawled");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/routes/importArchive.test.ts`
Expected: FAIL — 404s (route not defined) and the guard test gets the "url is required" / not-supported message.

- [ ] **Step 3: Add the imports to `src/routes/stories.ts`**

```ts
import {
  ArchiveNotBookError,
  ArchiveNotFoundError,
  ArchiveRestrictedError,
  ArchiveTooManyPagesError,
  ArchiveUnavailableError,
  archiveItemId,
  importArchiveItem,
} from "../services/archiveImport";
```

- [ ] **Step 4: Add the `POST /stories` guard**

In `storiesRouter.post("/stories", …)`, right after the `if (!url) { … }` block, insert:

```ts
  if (archiveItemId(url)) {
    res.status(400).json({ message: t("Internet Archive books are imported, not crawled") });
    return;
  }
```

- [ ] **Step 5: Add the route**

Insert after the `import-epub` route (after its closing `);` at line ~185) and before `storiesRouter.get("/stories", …)`:

```ts
// Import an Internet Archive book. The item id is the story URL, so re-adding the same
// item asks before overwriting, exactly like a file import. Only openly downloadable
// items are ever read — lending/restricted items are refused in services/archiveImport.ts.
storiesRouter.post("/stories/import-archive", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { url } = (req.body ?? {}) as { url?: string };
  if (!url) {
    res.status(400).json({ message: t("url is required") });
    return;
  }
  const itemId = archiveItemId(url);
  if (!itemId) {
    res.status(400).json({
      message: t(
        "This is not an Internet Archive book page: {url} — paste a URL like https://archive.org/details/<id>",
        { url }
      ),
    });
    return;
  }
  const storyUrl = `archive:${itemId}`;
  const id = storyId(storyUrl);
  const overwrite = req.query.overwrite === "1";
  const existing = await library.stories.getOutline(id);
  if (existing && !overwrite) {
    res.status(409).json({ code: "exists", message: t("This book is already in the library"), story: existing });
    return;
  }

  try {
    const book = await importArchiveItem(itemId, {
      storeImage: (imageBytes, extension) => library.epubMedia.save(id, imageBytes, extension),
    });

    let coverUrl = existing?.coverUrl;
    if (book.cover) {
      const saved = library.covers.saveBytes(id, book.cover.bytes);
      if (saved) coverUrl = saved;
    }

    const defaults = settingsStore.get();
    const now = new Date().toISOString();
    const story: StoredStory = {
      id,
      storyUrl,
      site: "epub",
      title: book.title,
      author: book.author ?? existing?.author ?? (defaults.defaultAuthor || undefined),
      language: book.language ?? existing?.language ?? defaults.defaultBookLanguage,
      coverUrl,
      watching: false,
      newChapterCount: 0,
      chapters: book.chapters.map((chapter, index) => ({
        order: index + 1,
        url: `${storyUrl}#${index + 1}`,
        title: chapter.title,
        status: "done" as const,
        blocks: chapter.blocks,
      })),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await library.stories.save(story);
    res.status(existing ? 200 : 201).json({ story: await library.stories.getOutline(id) });
  } catch (err) {
    // Only the service's own, already-translated errors are safe to echo; anything else
    // (network failure, parser internals) gets the generic wording.
    const message =
      err instanceof ArchiveNotFoundError ||
      err instanceof ArchiveNotBookError ||
      err instanceof ArchiveRestrictedError ||
      err instanceof ArchiveTooManyPagesError ||
      err instanceof ArchiveUnavailableError
        ? err.message
        : t("Could not import from Internet Archive");
    res.status(400).json({ message });
  }
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/routes/importArchive.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Run the other route tests**

Run: `npx vitest run src/routes/stories.test.ts src/routes/importEpub.test.ts`
Expected: PASS (unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/routes/stories.ts src/routes/importArchive.test.ts
git commit -m "feat(archive): POST /stories/import-archive and the /stories guard"
```

---

### Task 6: Frontend add box, labels and i18n

**Files:**
- Create: `frontend/src/lib/archiveUrl.ts`
- Modify: `frontend/src/lib/api.ts` (after `importEpub`, line ~197)
- Modify: `frontend/src/components/LibraryView.tsx` (imports ~1-23; state ~167; `handleCreate` ~284; `handleImport` ~336; render ~563-587; site label ~751)
- Modify: `frontend/src/components/StoryDetail.tsx:454`
- Modify: `frontend/src/i18n/locales/en.ts` and `frontend/src/i18n/locales/vi.ts` (near "PDF file")

**Interfaces:**
- Consumes: `POST /api/stories/import-archive` from Task 5.
- Produces:
  - `frontend/src/lib/archiveUrl.ts`: `archiveItemId(url: string): string | undefined`, `isArchiveItemUrl(url: string): boolean`
  - `frontend/src/lib/api.ts`: `importArchive(url: string, options?: { overwrite?: boolean }): Promise<StoredStory>`

- [ ] **Step 1: Create `frontend/src/lib/archiveUrl.ts`**

```ts
// Internet Archive book import: the add box recognises an item URL so it can import
// instead of asking for a chapter list. The server re-checks the host — this is UX only.
const ITEM_PATH_RE = /^\/(?:details|metadata|download)\/([^/?#]+)/;

export function archiveItemId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.hostname.toLowerCase().replace(/^www\./, "") !== "archive.org") return undefined;
  const match = ITEM_PATH_RE.exec(parsed.pathname);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function isArchiveItemUrl(url: string): boolean {
  return archiveItemId(url) !== undefined;
}
```

- [ ] **Step 2: Add `importArchive` to `frontend/src/lib/api.ts`**

```ts
// Import an archive.org book by item URL. `overwrite` is the user confirming the "already in
// the library" dialog; without it the server answers 409 with code "exists".
export async function importArchive(url: string, options: { overwrite?: boolean } = {}): Promise<StoredStory> {
  const params = new URLSearchParams();
  if (options.overwrite) params.set("overwrite", "1");
  const query = params.toString();
  const res = await apiFetch(`/api/stories/import-archive${query ? `?${query}` : ""}`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw apiError(
      data?.message || tr("Could not import from Internet Archive"),
      res.status,
      data?.code,
      data?.story
    );
  }
  const data = await res.json();
  return data.story as StoredStory;
}
```

- [ ] **Step 3: Wire `LibraryView`**

Add to the imports from `../lib/api`: `importArchive`. Add a new import line:

```ts
import { isArchiveItemUrl } from "../lib/archiveUrl";
```

Change the state declaration from:

```ts
const [pendingImport, setPendingImport] = useState<File | null>(null);
```

to:

```ts
const [pendingImport, setPendingImport] = useState<{ kind: "file"; file: File } | { kind: "url"; url: string } | null>(null);
```

In `handleCreate`, insert after the empty-URL check and before the `isSupportedUrl` check:

```ts
    if (isArchiveItemUrl(url)) {
      await importArchiveFrom(url);
      return;
    }
```

In `handleImport`, change the 409 branch from `setPendingImport(file)` to:

```ts
      if (!overwrite && (err as { code?: string }).code === "exists") setPendingImport({ kind: "file", file });
```

Add the archive importer next to `handleImport`:

```ts
  // Import an archive.org item by URL; a 409 asks before overwriting, like a file import.
  async function importArchiveFrom(url: string, overwrite = false) {
    setImportBusy(true);
    setError(null);
    try {
      const imported = await importArchive(url, { overwrite });
      setPendingImport(null);
      setStoryUrl("");
      await loadStories();
      setSelected(imported);
      pushNotice({ kind: "epub-imported", title: imported.title });
    } catch (err) {
      if (!overwrite && (err as { code?: string }).code === "exists") setPendingImport({ kind: "url", url });
      else setError((err as Error).message);
    } finally {
      setImportBusy(false);
    }
  }
```

In the overwrite banner, change the two `pendingImport` uses:

```tsx
                {t("This book is already in the library. Overwrite it with “{name}”?", {
                  name: pendingImport.kind === "file" ? pendingImport.file.name : pendingImport.url,
                })}
```

and:

```tsx
                  onClick={() =>
                    void (pendingImport.kind === "file"
                      ? handleImport(pendingImport.file, true)
                      : importArchiveFrom(pendingImport.url, true))
                  }
```

- [ ] **Step 4: Label the site in both views**

`frontend/src/components/LibraryView.tsx:751`, replace the site cell expression with:

```tsx
                    <td className="dim">
                      {s.site === "epub"
                        ? s.storyUrl.startsWith("pdf:")
                          ? t("PDF file")
                          : s.storyUrl.startsWith("archive:")
                            ? t("Internet Archive")
                            : t("EPUB file")
                        : s.site}
                    </td>
```

`frontend/src/components/StoryDetail.tsx:454`, replace with:

```tsx
            <span>
              {imported
                ? story.storyUrl.startsWith("pdf:")
                  ? t("PDF file")
                  : story.storyUrl.startsWith("archive:")
                    ? t("Internet Archive")
                    : t("EPUB file")
                : story.site}
            </span>
```

- [ ] **Step 5: Add the locale keys**

In `frontend/src/i18n/locales/en.ts`, after `"PDF file": "PDF file",`:

```ts
  "Internet Archive": "Internet Archive",
  "Could not import from Internet Archive": "Could not import from Internet Archive",
```

In `frontend/src/i18n/locales/vi.ts`, after `"PDF file": "File PDF",`:

```ts
  "Internet Archive": "Internet Archive",
  "Could not import from Internet Archive": "Không nhập được sách từ Internet Archive",
```

- [ ] **Step 6: Typecheck the frontend and run the locale test**

Run: `npx tsc -p frontend --noEmit && npx vitest run frontend/src/i18n/locales.test.ts`
Expected: no type errors, locale test PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/archiveUrl.ts frontend/src/lib/api.ts frontend/src/components/LibraryView.tsx frontend/src/components/StoryDetail.tsx frontend/src/i18n/locales/en.ts frontend/src/i18n/locales/vi.ts
git commit -m "feat(archive): import archive.org books from the add box"
```

---

### Task 7: Document and verify

**Files:**
- Modify: `AGENTS.md` (Architecture section, after the PDF import bullet)

**Interfaces:**
- Consumes: everything above.
- Produces: docs only.

- [ ] **Step 1: Add the AGENTS.md bullet**

After the PDF import paragraph, add:

```markdown
- Internet Archive import: `POST /api/stories/import-archive` takes an
  `archive.org/details/<id>` URL and saves it as an imported book (`site: "epub"`,
  story URL `archive:<id>`), so the crawl/watch guards and the EPUB export apply
  unchanged. `services/archiveImport.ts` reads `https://archive.org/metadata/<id>`
  and refuses `access-restricted-item` items (lending/LCP — never borrowed, never
  decrypted); otherwise it imports the first public source: EPUB (`parseEpub`) → OCR
  text `_djvu.txt` (`textToBook` page/chapter heuristics) → PDF (`parsePdf`).
  archive.org is deliberately NOT in `SUPPORTED_SITES` (it is import-only, not an
  auto-loaded chapter list): the add box branches on the URL itself and the route
  validates the host.
```

- [ ] **Step 2: Run the full unit suite and both typechecks**

Run: `npm test && npm run build:backend && npx tsc -p frontend --noEmit`
Expected: all tests PASS, both typechecks clean.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(archive): note the Internet Archive import in AGENTS.md"
```
