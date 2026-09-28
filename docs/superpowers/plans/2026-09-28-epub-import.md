# EPUB Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import an existing `.epub` file into the library as a story — readable, editable, highlightable, narratable and exportable like a crawled one.

**Architecture:** A new pure parser (`services/epubImport.ts`) unzips untrusted EPUB bytes with fflate (streaming, capped), reads container/OPF/spine, sanitizes each chapter DOM and turns it into `ContentBlock[]` through the existing `walkToBlocks`. A media store (`services/epubMedia.ts`) writes book images to `<dataDir>/epub-media/<storyId>/`; blocks keep a relative marker that the chapter route resolves to an API URL for the reader/editor and the export route resolves to a `file://` path for `embedImages`. The story keeps a stable `epub:<sha1>` URL, so re-importing the same file is the same story, and the route answers 409 unless `?overwrite=1`.

**Tech Stack:** TypeScript (CommonJS backend), Express, `fflate` (unzip + zip in tests), `jsdom`, React 18 + Vite + Tailwind 4, vitest, Node ≥ 22.5. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-epub-import-design.md`

## Global Constraints

- No new runtime dependencies; unzip with the already-installed `fflate`, parse with the already-installed `jsdom`.
- Imported content is untrusted: never execute scripts, never let `file://`, `javascript:` or `on*` attributes reach blocks, the reader, the editor or an exported book. `file://` may only be read by `embedImages` inside `localRoots`.
- Imported images live on disk; blocks in SQLite store only the marker `epub-media/<storyId>/<sha1-12>.<ext>` — origins and vault tokens never enter the DB.
- Server wording goes through `t()` in `src/services/lang.ts` (English keys, Vietnamese wordings); UI wording goes through `t()` with keys added to both `frontend/src/i18n/locales/en.ts` and `vi.ts` (`i18n/locales.test.ts` enforces key and placeholder parity).
- Tailwind utilities at the call site only; never add component classes to `styles.css`; never hand-edit `public/` or `dist/`.
- Tests are colocated (`**/*.test.ts`); fixtures live under `**/__fixtures__/` (excluded from the tsc build).
- `npm test`, `npx tsc -p frontend --noEmit` and `npm run build` must pass at the end of every task.
- Commit messages: conventional prefixes, Vietnamese or English (repo style). Do not push.

---

### Task 1: EPUB parser + fixtures

**Files:**
- Create: `src/services/__fixtures__/epubFixtures.ts`
- Create: `src/services/epubImport.ts`
- Test: `src/services/epubImport.test.ts`

**Interfaces:**
- Consumes: `walkToBlocks(root: Element, blocks: ContentBlock[])` and `sniffImageExtension(bytes: Buffer): string | undefined`.
- Produces:
  - `MAX_TOTAL_UNCOMPRESSED_BYTES = 500 * 1024 * 1024`, `MAX_ENTRIES = 10_000`
  - `class NotEpubError`, `class EpubTooLargeError`, `class DrmError`
  - `type StoreImage = (bytes: Buffer, extension: string) => string`
  - `interface ImportedBook { title: string; author?: string; language?: string; cover?: { bytes: Buffer; extension: string }; chapters: { title: string; blocks: ContentBlock[] }[] }`
  - `interface ParseEpubOptions { storeImage?: StoreImage; fallbackTitle?: string; maxTotalUncompressedBytes?: number }`
  - `async function parseEpub(bytes: Buffer, options?: ParseEpubOptions): Promise<ImportedBook>`
  - fixture helpers `TINY_PNG: Buffer`, `buildEpubFixture(options): Buffer`

- [ ] **Step 1: Write the fixtures builder**

Create `src/services/__fixtures__/epubFixtures.ts`:

```ts
import { zipSync } from "fflate";

// A real 1x1 PNG — sniffed by magic bytes, like any cover or book image.
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

export interface FixtureChapter {
  id: string;
  // Path inside the zip, always under OEBPS/ (the OPF sits at OEBPS/content.opf).
  file: string;
  // nav/NCX label. Omit to exercise the h1 / file-name fallbacks.
  title?: string;
  // Content of <body>.
  html: string;
}

export interface EpubFixtureOptions {
  version?: 2 | 3;
  title?: string;
  author?: string;
  language?: string;
  chapters?: FixtureChapter[];
  cover?: { file: string; bytes: Buffer; pointedBy?: "meta" | "properties" | "guide" };
  encryptionXml?: string;
  // 0 (stored, default — fast fixture builds) or 6 (deflate, what real books use).
  compressionLevel?: number;
  extraEntries?: Record<string, Uint8Array>;
}

const DEFAULT_CHAPTERS: FixtureChapter[] = [
  { id: "ch1", file: "OEBPS/ch1.xhtml", title: "Chương 1", html: "<h1>Chương 1</h1><p>Nội dung một.</p>" },
];

const hrefInBook = (file: string) => file.replace(/^OEBPS\//, "");

export function buildEpubFixture(options: EpubFixtureOptions = {}): Buffer {
  const version = options.version ?? 3;
  const title = options.title ?? "Truyện thử";
  const author = options.author ?? "Tác giả";
  const language = options.language ?? "vi";
  const chapters = options.chapters ?? DEFAULT_CHAPTERS;

  const files: Record<string, Uint8Array> = {
    mimetype: new Uint8Array(Buffer.from("application/epub+zip")),
    "META-INF/container.xml": new Uint8Array(
      Buffer.from(
        `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
      )
    ),
  };

  const manifest: string[] = [];
  const spine: string[] = [];
  for (const chapter of chapters) {
    files[chapter.file] = new Uint8Array(
      Buffer.from(
        `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${chapter.title ?? ""}</title></head><body>${chapter.html}</body></html>`
      )
    );
    manifest.push(`<item id="${chapter.id}" href="${hrefInBook(chapter.file)}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${chapter.id}"/>`);
  }

  if (version === 3) {
    const links = chapters
      .filter((chapter) => chapter.title)
      .map((chapter) => `<li><a href="${hrefInBook(chapter.file)}">${chapter.title}</a></li>`)
      .join("");
    files["OEBPS/nav.xhtml"] = new Uint8Array(
      Buffer.from(
        `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${links}</ol></nav></body></html>`
      )
    );
    manifest.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
  } else {
    const points = chapters
      .filter((chapter) => chapter.title)
      .map(
        (chapter) =>
          `<navPoint id="np-${chapter.id}"><navLabel><text>${chapter.title}</text></navLabel><content src="${hrefInBook(chapter.file)}"/></navPoint>`
      )
      .join("");
    files["OEBPS/toc.ncx"] = new Uint8Array(
      Buffer.from(
        `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>${points}</navMap></ncx>`
      )
    );
    manifest.push(`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`);
  }

  const metadata = [
    `<dc:title>${title}</dc:title>`,
    `<dc:creator>${author}</dc:creator>`,
    `<dc:language>${language}</dc:language>`,
  ];
  let guide = "";
  if (options.cover) {
    const { file, bytes, pointedBy = "meta" } = options.cover;
    files[file] = new Uint8Array(bytes);
    const properties = pointedBy === "properties" ? ` properties="cover-image"` : "";
    manifest.push(`<item id="cover-img" href="${hrefInBook(file)}" media-type="image/png"${properties}/>`);
    if (pointedBy === "meta") metadata.push(`<meta name="cover" content="cover-img"/>`);
    if (pointedBy === "guide") guide = `<guide><reference type="cover" href="${hrefInBook(file)}"/></guide>`;
  }

  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="${version === 3 ? "3.0" : "2.0"}" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${metadata.join("")}</metadata><manifest>${manifest.join("")}</manifest><spine${version === 2 ? ' toc="ncx"' : ""}>${spine.join("")}</spine>${guide}</package>`;
  files["OEBPS/content.opf"] = new Uint8Array(Buffer.from(opf));

  for (const [name, bytes] of Object.entries(options.extraEntries ?? {})) files[name] = bytes;
  if (options.encryptionXml) {
    files["META-INF/encryption.xml"] = new Uint8Array(Buffer.from(options.encryptionXml));
  }

  return Buffer.from(zipSync(files, { level: options.compressionLevel ?? 0 }));
}
```

- [ ] **Step 2: Write the failing parser tests**

Create `src/services/epubImport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildEpubFixture, TINY_PNG } from "./__fixtures__/epubFixtures";
import { DrmError, EpubTooLargeError, NotEpubError, parseEpub } from "./epubImport";

// In-memory stand-in for the library's media store: keeps parser tests hermetic.
function imageSink() {
  const stored: { bytes: Buffer; extension: string }[] = [];
  const store = (bytes: Buffer, extension: string) => {
    stored.push({ bytes, extension });
    return `epub-media/0123456789abcdef/img-${stored.length}.${extension}`;
  };
  return { stored, store };
}

describe("parseEpub", () => {
  it("reads metadata, spine order and nav titles from an EPUB3", async () => {
    const bytes = buildEpubFixture({
      version: 3,
      title: "Sách thử",
      author: "Tác giả",
      language: "vi",
      chapters: [
        { id: "ch1", file: "OEBPS/ch1.xhtml", title: "Mở đầu", html: "<h1>Mở đầu</h1><p>Một.</p>" },
        { id: "ch2", file: "OEBPS/ch2.xhtml", title: "Kết", html: "<h1>Kết</h1><p>Hai.</p>" },
      ],
    });

    const book = await parseEpub(bytes);

    expect(book.title).toBe("Sách thử");
    expect(book.author).toBe("Tác giả");
    expect(book.language).toBe("vi");
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Mở đầu", "Kết"]);
    // The leading heading duplicates the title, so it is dropped from the blocks.
    expect(book.chapters[0].blocks).toEqual([{ type: "paragraph", text: "Một." }]);
  });

  it("reads a deflate-compressed EPUB", async () => {
    const bytes = buildEpubFixture({ compressionLevel: 6 });

    const book = await parseEpub(bytes);

    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].blocks).toEqual([{ type: "paragraph", text: "Nội dung một." }]);
  });

  it("reads chapter titles from toc.ncx in an EPUB2", async () => {
    const bytes = buildEpubFixture({
      version: 2,
      chapters: [
        { id: "ch1", file: "OEBPS/ch1.xhtml", title: "Chương một", html: "<p>Một.</p>" },
        { id: "ch2", file: "OEBPS/ch2.xhtml", title: "Chương hai", html: "<p>Hai.</p>" },
      ],
    });

    const book = await parseEpub(bytes);

    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Chương một", "Chương hai"]);
  });

  it("falls back to h1, then the file name, when no TOC names a chapter", async () => {
    const bytes = buildEpubFixture({
      chapters: [
        { id: "ch1", file: "OEBPS/ch1.xhtml", html: "<h1>Tựa đề</h1><p>x</p>" },
        { id: "ch2", file: "OEBPS/khong-co-tua.xhtml", html: "<p>y</p>" },
      ],
    });

    const book = await parseEpub(bytes);

    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Tựa đề", "khong-co-tua"]);
  });

  it("uses the uploaded file name when the book has no title", async () => {
    const bytes = buildEpubFixture({ title: "" });
    const book = await parseEpub(bytes, { fallbackTitle: "Sach-cua-toi" });
    expect(book.title).toBe("Sach-cua-toi");
  });

  it("stores raster images with a marker src and drops the rest", async () => {
    const { stored, store } = imageSink();
    const bytes = buildEpubFixture({
      chapters: [
        {
          id: "ch1",
          file: "OEBPS/ch1.xhtml",
          html:
            `<p>Ảnh</p><img src="images/pic.png" alt="p"/>` +
            `<img src="images/missing.png"/>` +
            `<img src="images/notes.txt"/>` +
            `<img src="https://example.com/remote.png"/>` +
            `<img src="data:image/png;base64,${TINY_PNG.toString("base64")}" alt="inline"/>`,
        },
      ],
      extraEntries: {
        "OEBPS/images/pic.png": new Uint8Array(TINY_PNG),
        "OEBPS/images/notes.txt": new Uint8Array(Buffer.from("not an image")),
      },
    });

    const book = await parseEpub(bytes, { storeImage: store });

    expect(stored).toHaveLength(2);
    expect(stored[0].extension).toBe("png");
    expect(book.chapters[0].blocks).toEqual([
      { type: "paragraph", text: "Ảnh" },
      { type: "image", src: "epub-media/0123456789abcdef/img-1.png", alt: "p" },
      { type: "image", src: "epub-media/0123456789abcdef/img-2.png", alt: "inline" },
    ]);
  });

  it("strips scripts, event handlers, local and script links", async () => {
    const bytes = buildEpubFixture({
      chapters: [
        {
          id: "ch1",
          file: "OEBPS/ch1.xhtml",
          html:
            `<h1>An toàn</h1><script>alert(1)</script>` +
            `<p onclick="steal()">Đoạn <a href="javascript:alert(2)">độc</a>` +
            ` <a href="file:///etc/passwd">tệp</a> <a href="ch2.xhtml">chương sau</a>` +
            ` <a href="https://example.com">web</a></p>` +
            `<audio src="sound.mp3"></audio>`,
        },
      ],
    });

    const book = await parseEpub(bytes);
    const html = JSON.stringify(book.chapters[0].blocks);

    expect(html).not.toContain("script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("file:");
    expect(html).not.toContain("ch2.xhtml");
    expect(html).not.toContain("audio");
    // JSON.stringify escapes attribute quotes, hence the backslashes.
    expect(html).toContain('href=\\"https://example.com\\"');
  });

  it.each(["meta", "properties", "guide"] as const)("extracts the cover pointed at by %s", async (pointedBy) => {
    const bytes = buildEpubFixture({ cover: { file: "OEBPS/cover.png", bytes: TINY_PNG, pointedBy } });

    const book = await parseEpub(bytes);

    expect(book.cover?.extension).toBe("png");
    expect(book.cover?.bytes.equals(TINY_PNG)).toBe(true);
  });

  it("has no cover when the book has none", async () => {
    const book = await parseEpub(buildEpubFixture());
    expect(book.cover).toBeUndefined();
  });

  it("rejects an encrypted book but accepts obfuscated fonts", async () => {
    const drm = buildEpubFixture({
      encryptionXml:
        `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>`,
    });
    await expect(parseEpub(drm)).rejects.toBeInstanceOf(DrmError);

    const fonts = buildEpubFixture({
      encryptionXml:
        `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></EncryptedData></encryption>`,
    });
    await expect(parseEpub(fonts)).resolves.toBeTruthy();
  });

  it("rejects files that are not EPUB books", async () => {
    await expect(parseEpub(Buffer.from("definitely not a zip"))).rejects.toBeInstanceOf(NotEpubError);
    await expect(parseEpub(Buffer.alloc(0))).rejects.toBeInstanceOf(NotEpubError);
  });

  it("stops when the expanded book passes the cap", async () => {
    const bytes = buildEpubFixture({
      chapters: [{ id: "ch1", file: "OEBPS/ch1.xhtml", html: `<p>${"x".repeat(4096)}</p>` }],
    });

    await expect(parseEpub(bytes, { maxTotalUncompressedBytes: 1024 })).rejects.toBeInstanceOf(EpubTooLargeError);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/services/epubImport.test.ts`
Expected: FAIL — `Failed to resolve import "./epubImport"`.

- [ ] **Step 4: Implement the parser**

Create `src/services/epubImport.ts`:

```ts
import path from "path";
import { JSDOM } from "jsdom";
import { Unzip, UnzipInflate } from "fflate";
import { ContentBlock } from "../types";
import { sniffImageExtension } from "./coverStore";
import { walkToBlocks } from "./extractor";
import { t } from "./lang";

// Guard rails for untrusted files: 500 MB expanded / 10k entries is past any real novel,
// so hitting either is a mistake or a zip bomb — and the input buffer is already capped.
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
export const MAX_ENTRIES = 10_000;
// One image kept from a book — the same cap as a cover.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export class NotEpubError extends Error {
  constructor() {
    super(t("This file is not an EPUB book"));
  }
}

export class EpubTooLargeError extends Error {
  constructor() {
    super(t("This EPUB file is too large to import"));
  }
}

export class DrmError extends Error {
  constructor() {
    super(t("This EPUB file is locked with DRM and cannot be imported"));
  }
}

export interface StoredImage {
  bytes: Buffer;
  extension: string;
}

// Called for every image kept from the book; returns the src written into the block.
// The route passes the library's media store (which writes to disk and returns the
// marker); tests pass an in-memory sink.
export type StoreImage = (bytes: Buffer, extension: string) => string;

export interface ImportedChapter {
  title: string;
  blocks: ContentBlock[];
}

export interface ImportedBook {
  title: string;
  author?: string;
  language?: string;
  cover?: StoredImage;
  chapters: ImportedChapter[];
}

export interface ParseEpubOptions {
  storeImage?: StoreImage;
  fallbackTitle?: string;
  // Overridable so tests can exercise the cap without a 500 MB file.
  maxTotalUncompressedBytes?: number;
}

function unzipEntries(bytes: Buffer, maxTotal: number): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Buffer>();
    let total = 0;
    let count = 0;
    let aborted = false;
    const fail = (error: Error) => {
      aborted = true;
      reject(error);
    };
    try {
      const unzip = new Unzip((file) => {
        count += 1;
        if (aborted || count > MAX_ENTRIES) return;
        const chunks: Uint8Array[] = [];
        file.ondata = (error, chunk, final) => {
          if (aborted) return;
          if (error) {
            fail(new NotEpubError());
            return;
          }
          total += chunk.length;
          if (total > maxTotal) {
            fail(new EpubTooLargeError());
            return;
          }
          chunks.push(chunk);
          if (final) entries.set(file.name, Buffer.concat(chunks));
        };
        file.start();
      });
      // fflate's streaming Unzip registers only stored (0) by default; deflate (8) is
      // what every real EPUB uses, so register it or the archive silently yields nothing.
      unzip.register(UnzipInflate);
      unzip.push(bytes, true);
    } catch {
      fail(new NotEpubError());
      return;
    }
    if (!aborted) resolve(entries);
  });
}

function xmlDocument(source: string, contentType: "application/xml" | "text/html" = "application/xml"): Document {
  return new JSDOM(source, { contentType }).window.document;
}

function textOf(element: Element | undefined | null): string | undefined {
  const text = element?.textContent?.replace(/\s+/g, " ").trim();
  return text || undefined;
}

// Zip entry names are literal; XML hrefs are URIs and may be percent-encoded.
function resolveEntryPath(base: string, href: string): string {
  let decoded = href.split("#")[0];
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* keep the raw name */
  }
  return path.posix.normalize(path.posix.join(path.posix.dirname(base), decoded));
}

// Font obfuscation (IDPF / Adobe) is not DRM — we drop fonts anyway and the text is
// readable. Any other encryption means the content itself is encrypted.
const FONT_OBFUSCATION_ALGORITHMS = [
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
];

function assertNoDrm(encryptionXml: string): void {
  const doc = xmlDocument(encryptionXml);
  const encrypted = Array.from(doc.getElementsByTagName("EncryptedData"));
  const contentLocked = encrypted.some((node) => {
    const algorithm = node.getElementsByTagName("EncryptionMethod")[0]?.getAttribute("Algorithm") ?? "";
    return !FONT_OBFUSCATION_ALGORITHMS.includes(algorithm);
  });
  if (contentLocked) throw new DrmError();
}

interface ManifestItem {
  href: string;
  mediaType: string;
  properties: string[];
}

function readManifest(opfDoc: Document): Map<string, ManifestItem> {
  const manifest = new Map<string, ManifestItem>();
  for (const item of Array.from(opfDoc.getElementsByTagName("item"))) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (!id || !href) continue;
    manifest.set(id, {
      href: href.split("#")[0],
      mediaType: (item.getAttribute("media-type") ?? "").trim().toLowerCase(),
      properties: (item.getAttribute("properties") ?? "").split(/\s+/).filter(Boolean),
    });
  }
  return manifest;
}

function findCoverHref(opfDoc: Document, manifest: Map<string, ManifestItem>): string | undefined {
  const metaCover = Array.from(opfDoc.getElementsByTagName("meta")).find((meta) => meta.getAttribute("name") === "cover");
  const byMeta = metaCover?.getAttribute("content");
  if (byMeta && manifest.has(byMeta)) return manifest.get(byMeta)!.href;
  for (const item of manifest.values()) if (item.properties.includes("cover-image")) return item.href;
  const reference = Array.from(opfDoc.getElementsByTagName("reference")).find(
    (ref) => (ref.getAttribute("type") ?? "").trim() === "cover"
  );
  return reference?.getAttribute("href")?.split("#")[0];
}

function addTitle(titles: Map<string, string>, key: string, title: string): void {
  if (!titles.has(key)) titles.set(key, title);
}

function navTitles(entries: Map<string, Buffer>, manifest: Map<string, ManifestItem>, opfPath: string): Map<string, string> {
  const titles = new Map<string, string>();
  const navItem = [...manifest.values()].find((item) => item.properties.includes("nav"));
  if (!navItem) return titles;
  const navPath = resolveEntryPath(opfPath, navItem.href);
  const bytes = entries.get(navPath);
  if (!bytes) return titles;
  const doc = xmlDocument(bytes.toString("utf8"), "text/html");
  const navs = Array.from(doc.querySelectorAll("nav"));
  const toc = navs.find((nav) => (nav.getAttribute("epub:type") ?? "").split(/\s+/).includes("toc")) ?? navs[0];
  if (!toc) return titles;
  for (const link of Array.from(toc.querySelectorAll("a[href]"))) {
    const title = textOf(link);
    const href = link.getAttribute("href");
    if (title && href) addTitle(titles, resolveEntryPath(navPath, href), title);
  }
  return titles;
}

function ncxTitles(
  entries: Map<string, Buffer>,
  manifest: Map<string, ManifestItem>,
  opfDoc: Document,
  opfPath: string
): Map<string, string> {
  const titles = new Map<string, string>();
  const tocId = opfDoc.getElementsByTagName("spine")[0]?.getAttribute("toc");
  const ncxItem =
    (tocId ? manifest.get(tocId) : undefined) ??
    [...manifest.values()].find((item) => item.mediaType === "application/x-dtbncx+xml");
  if (!ncxItem) return titles;
  const ncxPath = resolveEntryPath(opfPath, ncxItem.href);
  const bytes = entries.get(ncxPath);
  if (!bytes) return titles;
  const doc = xmlDocument(bytes.toString("utf8"));
  for (const navPoint of Array.from(doc.getElementsByTagName("navPoint"))) {
    const title = textOf(navPoint.getElementsByTagName("navLabel")[0]);
    const src = navPoint.getElementsByTagName("content")[0]?.getAttribute("src");
    if (title && src) addTitle(titles, resolveEntryPath(ncxPath, src), title);
  }
  return titles;
}

const DROP_TAGS =
  "script, style, link, meta, base, iframe, frame, frameset, object, embed, form, input, button, textarea, select, audio, video, source, track, canvas, svg";

// Chapter HTML comes from an untrusted file: everything that can execute, load a local
// file or fight the reader's own stylesheet goes before walkToBlocks sees it.
function sanitize(doc: Document): void {
  doc.querySelectorAll(DROP_TAGS).forEach((element) => element.remove());
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "style" || name === "srcset") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "href" && !/^(https?:|mailto:)/i.test(attribute.value.trim())) {
        element.removeAttribute(attribute.name);
      }
    }
  }
}

function storeDataImage(src: string, storeImage: StoreImage): string | undefined {
  const match = src.match(/^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i);
  if (!match) return undefined;
  const bytes = Buffer.from(match[1], "base64");
  const extension = sniffImageExtension(bytes);
  if (!extension || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return undefined;
  return storeImage(bytes, extension);
}

function resolveImages(
  doc: Document,
  chapterPath: string,
  entries: Map<string, Buffer>,
  storeImage: StoreImage
): void {
  for (const image of Array.from(doc.querySelectorAll("img"))) {
    const src = image.getAttribute("src") ?? "";
    let stored: string | undefined;
    if (/^data:image\//i.test(src)) {
      stored = storeDataImage(src, storeImage);
    } else {
      const bytes = entries.get(resolveEntryPath(chapterPath, src));
      const extension = bytes ? sniffImageExtension(bytes) : undefined;
      if (bytes && extension && bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES) {
        stored = storeImage(bytes, extension);
      }
    }
    if (stored) image.setAttribute("src", stored);
    else image.remove();
  }
}

function firstHeadingText(doc: Document): string | undefined {
  return textOf(doc.querySelector("h1, h2"));
}

function stripTitleHeading(blocks: ContentBlock[], title: string): void {
  const first = blocks[0];
  if (first?.type !== "heading") return;
  const normalize = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (normalize(first.text) === normalize(title)) blocks.shift();
}

export async function parseEpub(bytes: Buffer, options: ParseEpubOptions = {}): Promise<ImportedBook> {
  const entries = await unzipEntries(bytes, options.maxTotalUncompressedBytes ?? MAX_TOTAL_UNCOMPRESSED_BYTES);

  const containerBytes = entries.get("META-INF/container.xml");
  const opfHref = containerBytes
    ? xmlDocument(containerBytes.toString("utf8")).querySelector("rootfile")?.getAttribute("full-path")
    : undefined;
  const opfPath = opfHref ? path.posix.normalize(opfHref) : undefined;
  const opfBytes = opfPath ? entries.get(opfPath) : undefined;
  if (!opfPath || !opfBytes) throw new NotEpubError();

  const encryption = entries.get("META-INF/encryption.xml");
  if (encryption) assertNoDrm(encryption.toString("utf8"));

  const opfDoc = xmlDocument(opfBytes.toString("utf8"));
  const manifest = readManifest(opfDoc);

  const metaTitle = textOf(opfDoc.getElementsByTagName("dc:title")[0]);
  const title = metaTitle ?? (options.fallbackTitle?.trim() || undefined) ?? "Untitled";
  const author =
    Array.from(opfDoc.getElementsByTagName("dc:creator"))
      .map((element) => textOf(element))
      .filter((value): value is string => !!value)
      .join(", ") || undefined;
  const language = textOf(opfDoc.getElementsByTagName("dc:language")[0]);

  const titles = navTitles(entries, manifest, opfPath);
  for (const [key, value] of ncxTitles(entries, manifest, opfDoc, opfPath)) addTitle(titles, key, value);

  let cover: StoredImage | undefined;
  const coverHref = findCoverHref(opfDoc, manifest);
  if (coverHref) {
    const coverBytes = entries.get(resolveEntryPath(opfPath, coverHref));
    const extension = coverBytes ? sniffImageExtension(coverBytes) : undefined;
    if (coverBytes && extension && coverBytes.length > 0 && coverBytes.length <= MAX_IMAGE_BYTES) {
      cover = { bytes: coverBytes, extension };
    }
  }

  const storeImage = options.storeImage ?? (() => "");
  const chapters: ImportedChapter[] = [];
  for (const itemref of Array.from(opfDoc.getElementsByTagName("itemref"))) {
    const item = manifest.get(itemref.getAttribute("idref") ?? "");
    if (!item || item.mediaType !== "application/xhtml+xml" || item.properties.includes("nav")) continue;
    const chapterPath = resolveEntryPath(opfPath, item.href);
    const chapterBytes = entries.get(chapterPath);
    if (!chapterBytes) continue;

    const dom = new JSDOM(chapterBytes.toString("utf8"));
    try {
      const doc = dom.window.document;
      const headingTitle = firstHeadingText(doc);
      const fileTitle = path.posix.basename(chapterPath).replace(/\.[^.]+$/, "");
      const chapterTitle = titles.get(chapterPath) ?? headingTitle ?? (fileTitle || "Untitled");

      sanitize(doc);
      resolveImages(doc, chapterPath, entries, storeImage);
      const blocks: ContentBlock[] = [];
      walkToBlocks(doc.body, blocks);
      stripTitleHeading(blocks, chapterTitle);
      chapters.push({ title: chapterTitle, blocks });
    } finally {
      dom.window.close();
    }
  }

  return { title, author, language, cover, chapters };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/services/epubImport.test.ts`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/epubImport.ts src/services/epubImport.test.ts src/services/__fixtures__/epubFixtures.ts
git commit -m "feat(epub): parse imported EPUB files into content blocks"
```

---

### Task 2: Book-media store + library wiring

**Files:**
- Create: `src/services/epubMedia.ts`
- Test: `src/services/epubMedia.test.ts`
- Modify: `src/routes/library.ts`

**Interfaces:**
- Consumes: `ContentBlock` from `../types`.
- Produces:
  - `createEpubMediaStore(dataDir: string): EpubMediaStore` with `save(storyId, bytes, extension): string`, `find(storyId, name): StoredMedia | undefined`, `remove(storyId): Promise<void>`
  - `mediaMarker(storyId: string, name: string): string`
  - `storyMediaDir(dataDir: string, storyId: string): string`
  - `resolveMediaHtml(html, storyId, vaultToken?): string`, `restoreMediaHtml(html, storyId): string`, `exportMediaHtml(html, storyId, dataDir): string`, `mapBlockMedia(blocks, transform): ContentBlock[]`
  - `Library.epubMedia: EpubMediaStore`

- [ ] **Step 1: Write the failing store tests**

Create `src/services/epubMedia.test.ts`:

```ts
import { existsSync, mkdtempSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEpubMediaStore,
  exportMediaHtml,
  mapBlockMedia,
  resolveMediaHtml,
  restoreMediaHtml,
} from "./epubMedia";

const STORY_ID = "0123456789abcdef";
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

describe("createEpubMediaStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "epub-media-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stores an image once and returns its marker", async () => {
    const store = createEpubMediaStore(dir);

    const first = store.save(STORY_ID, TINY_PNG, "png");
    const again = store.save(STORY_ID, TINY_PNG, "png");

    expect(first).toBe(again);
    expect(first).toMatch(new RegExp(`^epub-media/${STORY_ID}/[0-9a-f]{12}\\.png$`));
    const files = await readdir(path.join(dir, "epub-media", STORY_ID));
    expect(files).toHaveLength(1);
    expect(store.find(STORY_ID, path.basename(first))?.contentType).toBe("image/png");
  });

  it("rejects traversal names and unknown story ids", () => {
    const store = createEpubMediaStore(dir);
    expect(store.find(STORY_ID, "../../secret.png")).toBeUndefined();
    expect(store.find("../evil", "abcdef123456.png")).toBeUndefined();
    expect(store.find(STORY_ID, "abcdef123456.svg")).toBeUndefined();
  });

  it("removes the story's media directory", async () => {
    const store = createEpubMediaStore(dir);
    store.save(STORY_ID, TINY_PNG, "png");

    await store.remove(STORY_ID);

    expect(existsSync(path.join(dir, "epub-media", STORY_ID))).toBe(false);
  });
});

describe("media src rewriting", () => {
  const marker = `epub-media/${STORY_ID}/abcdef123456.png`;

  it("resolves markers for the reader and restores them on save", () => {
    const resolved = resolveMediaHtml(`<img src="${marker}">`, STORY_ID, "tok+1");
    expect(resolved).toBe(`<img src="/api/stories/${STORY_ID}/media/abcdef123456.png?vault=tok%2B1">`);

    const restored = restoreMediaHtml(`<img src="/api/stories/${STORY_ID}/media/abcdef123456.png?vault=tok%2B1">`, STORY_ID);
    expect(restored).toBe(`<img src="${marker}">`);
  });

  it("leaves external urls alone", () => {
    const html = `<img src="https://example.com/a.png">`;
    expect(resolveMediaHtml(html, STORY_ID, "tok")).toBe(html);
    expect(restoreMediaHtml(html, STORY_ID)).toBe(html);
  });

  it("exports markers and resolved urls as local files", () => {
    const dataDir = "/tmp/library";
    const html = `<img src="${marker}"><img src="/api/stories/${STORY_ID}/media/abcdef123456.png?vault=tok">`;
    const out = exportMediaHtml(html, STORY_ID, dataDir);
    expect(out.match(new RegExp(`file:///tmp/library/epub-media/${STORY_ID}/abcdef123456\\.png`, "g"))).toHaveLength(2);
  });

  it("maps src and text fields of blocks", () => {
    const blocks = mapBlockMedia(
      [
        { type: "paragraph", text: `<img src="${marker}">` },
        { type: "image", src: marker, alt: "x" },
      ],
      (html) => html.replace("epub-media/", "media/")
    );
    expect(blocks[0].text).toContain("media/");
    expect(blocks[1].src).toBe(`media/${STORY_ID}/abcdef123456.png`);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/epubMedia.test.ts`
Expected: FAIL — `Failed to resolve import "./epubMedia"`.

- [ ] **Step 3: Implement the media store**

Create `src/services/epubMedia.ts`:

```ts
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { ContentBlock } from "../types";

// Story ID = sha1(storyUrl).slice(0, 16) (storyStore) — same guard as the cover store:
// reject unknown IDs so a crafted name cannot write outside the media directory.
const STORY_ID_RE = /^[0-9a-f]{16}$/;
const IMAGE_NAME_RE = /^([0-9a-f]{12})\.(jpg|png|webp|gif)$/;

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export interface StoredMedia {
  filePath: string;
  contentType: string;
}

export interface EpubMediaStore {
  // Write one image from an imported book; returns the src stored in the block
  // ("epub-media/<storyId>/<sha1-12>.<ext>"). Identical bytes are stored once.
  save(storyId: string, bytes: Buffer, extension: string): string;
  find(storyId: string, name: string): StoredMedia | undefined;
  remove(storyId: string): Promise<void>;
}

export function mediaMarker(storyId: string, name: string): string {
  return `epub-media/${storyId}/${name}`;
}

export function storyMediaDir(dataDir: string, storyId: string): string {
  return path.join(dataDir, "epub-media", storyId);
}

export function createEpubMediaStore(dataDir: string): EpubMediaStore {
  const mediaRoot = path.join(dataDir, "epub-media");

  function save(storyId: string, bytes: Buffer, extension: string): string {
    if (!STORY_ID_RE.test(storyId) || !IMAGE_CONTENT_TYPES[extension]) {
      throw new Error(`Invalid media save: ${storyId} .${extension}`);
    }
    const name = `${crypto.createHash("sha1").update(bytes).digest("hex").slice(0, 12)}.${extension}`;
    const dir = path.join(mediaRoot, storyId);
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(dir, { recursive: true });
      // Temp then rename, like covers: a reader never sees a half-written file.
      fs.writeFileSync(`${filePath}.tmp`, bytes);
      fs.renameSync(`${filePath}.tmp`, filePath);
    }
    return mediaMarker(storyId, name);
  }

  function find(storyId: string, name: string): StoredMedia | undefined {
    if (!STORY_ID_RE.test(storyId)) return undefined;
    const match = name.match(IMAGE_NAME_RE);
    if (!match) return undefined;
    const filePath = path.join(mediaRoot, storyId, name);
    if (!fs.existsSync(filePath)) return undefined;
    return { filePath, contentType: IMAGE_CONTENT_TYPES[match[2]] };
  }

  async function remove(storyId: string): Promise<void> {
    if (!STORY_ID_RE.test(storyId)) return;
    await fs.promises.rm(path.join(mediaRoot, storyId), { recursive: true, force: true });
  }

  return { save, find, remove };
}

const MEDIA_NAME = "([0-9a-f]{12}\\.(?:jpg|png|webp|gif))";

const markerRe = (storyId: string) => new RegExp(`epub-media/${storyId}/${MEDIA_NAME}`, "g");
const apiRe = (storyId: string) => new RegExp(`/api/stories/${storyId}/media/${MEDIA_NAME}(?:\\?[^"'\\s>]*)?`, "g");

// DB → reader/editor: markers become something a browser can load, with the private-mode
// token appended when the request carries one (the cover <img> does the same).
export function resolveMediaHtml(html: string, storyId: string, vaultToken?: string): string {
  if (!storyId || !html.includes("epub-media/")) return html;
  const suffix = vaultToken ? `?vault=${encodeURIComponent(vaultToken)}` : "";
  return html.replace(markerRe(storyId), (_match, name: string) => `/api/stories/${storyId}/media/${name}${suffix}`);
}

// Editor content → DB: the resolved URL (and any token/query) goes back to the marker,
// so a saved chapter never bakes an origin or a token into the library.
export function restoreMediaHtml(html: string, storyId: string): string {
  if (!storyId || !html.includes(`/api/stories/${storyId}/media/`)) return html;
  return html.replace(apiRe(storyId), (_match, name: string) => mediaMarker(storyId, name));
}

// DB/client HTML → the export: local files inside the story's media folder, which
// embedImages may read (localRoots). Anything else keeps the existing rules.
export function exportMediaHtml(html: string, storyId: string, dataDir: string): string {
  const toFileUrl = (_match: string, name: string) =>
    pathToFileURL(path.join(storyMediaDir(dataDir, storyId), name)).href;
  return html.replace(markerRe(storyId), toFileUrl).replace(apiRe(storyId), toFileUrl);
}

export function mapBlockMedia(blocks: ContentBlock[], transform: (html: string) => string): ContentBlock[] {
  return blocks.map((block) => {
    const next: ContentBlock = { ...block };
    if (next.src) next.src = transform(next.src);
    if (next.text) next.text = transform(next.text);
    return next;
  });
}
```

- [ ] **Step 4: Run the store tests to verify they pass**

Run: `npx vitest run src/services/epubMedia.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Add the store to the library**

Modify `src/routes/library.ts`:

```ts
import { EpubMediaStore, createEpubMediaStore } from "../services/epubMedia";
```

In `interface Library`, after `covers: CoverStore;` add:

```ts
  // Book images imported from an EPUB file, kept under <dataDir>/epub-media/<storyId>/.
  epubMedia: EpubMediaStore;
```

In `createLibrary`, after `covers: createCoverStore(dataDir),` add:

```ts
    epubMedia: createEpubMediaStore(dataDir),
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test` and `npx tsc --noEmit`
Expected: all tests PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/services/epubMedia.ts src/services/epubMedia.test.ts src/routes/library.ts
git commit -m "feat(epub): store imported book images per library"
```

---

### Task 3: Import route, media route and guards

**Files:**
- Modify: `src/routes/stories.ts`
- Modify: `src/services/coverStore.ts`
- Modify: `src/services/coverStore.test.ts`
- Modify: `src/services/lang.ts`
- Test: `src/routes/importEpub.test.ts`

**Interfaces:**
- Consumes: `parseEpub`, `library.epubMedia`, `library.covers.saveBytes`, `settingsStore`.
- Produces:
  - `POST /api/stories/import-epub` (`?overwrite=1`, `?name=`) → 201/200 `{ story }`, 409 `{ code: "exists", message, story }`, 400 with a translated message
  - `GET /api/stories/:id/media/:name` → the image bytes
  - `CoverStore.saveBytes(storyId: string, bytes: Buffer): string | undefined`
  - guards in `POST /stories/:id/crawl` and `POST /stories/:id/watch`

- [ ] **Step 1: Write the failing cover-store test**

Modify `src/services/coverStore.test.ts` — add this top-level `describe` block at the end of the file. It creates its own tmp dir, so it does not depend on the existing `describe("createCoverStore")` setup (`existsSync`, `mkdtemp`, `path` and `rm` are already imported):

```ts
describe("saveBytes", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "cover-store-bytes-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes sniffed bytes as the story cover", async () => {
    const store = createCoverStore(dir);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );

    const saved = store.saveBytes(STORY_ID, png);

    expect(saved).toBe(`covers/${STORY_ID}.png`);
    expect(existsSync(path.join(dir, saved!))).toBe(true);
  });

  it("rejects bytes that are not a known image", () => {
    const store = createCoverStore(dir);
    expect(store.saveBytes(STORY_ID, Buffer.from("not an image"))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/services/coverStore.test.ts -t "saveBytes"`
Expected: FAIL — `store.saveBytes is not a function`.

- [ ] **Step 3: Implement `saveBytes` and reuse it from `saveUpload`**

Modify `src/services/coverStore.ts`. Add `saveBytes` to the `CoverStore` interface:

```ts
  // Save bytes that came out of an imported book (no fetch, no temp file), replacing
  // the old cover. Returns the path for the DB, or undefined when the bytes aren't a
  // known image / are too large.
  saveBytes(storyId: string, bytes: Buffer): string | undefined;
```

Inside `createCoverStore`, replace the body of `saveUpload` with a call to the new shared function and add `saveBytes`:

```ts
  function saveBytes(storyId: string, bytes: Buffer): string | undefined {
    if (!STORY_ID_RE.test(storyId)) return undefined;
    const extension = sniffImageExtension(bytes);
    if (!extension || bytes.length === 0 || bytes.length > MAX_COVER_BYTES) return undefined;

    fs.mkdirSync(coversDir, { recursive: true });
    const filePath = path.join(coversDir, `${storyId}.${extension}`);
    const existing = find(storyId);
    if (existing && existing.filePath !== filePath) fs.rmSync(existing.filePath, { force: true });
    fs.writeFileSync(`${filePath}.tmp`, bytes);
    fs.renameSync(`${filePath}.tmp`, filePath);
    return path.join("covers", `${storyId}.${extension}`);
  }

  async function saveUpload(storyId: string, tmpPath: string): Promise<string | undefined> {
    if (!STORY_ID_RE.test(storyId)) return undefined;
    let bytes: Buffer;
    try {
      bytes = await fs.promises.readFile(tmpPath);
    } catch {
      return undefined;
    }
    const saved = saveBytes(storyId, bytes);
    await fs.promises.rm(tmpPath, { force: true });
    return saved;
  }
```

Add `saveBytes` to the returned object: `return { save, saveUpload, saveBytes, find, remove };`.

- [ ] **Step 4: Run the cover tests**

Run: `npx vitest run src/services/coverStore.test.ts`
Expected: all tests PASS (existing save/saveUpload behaviour unchanged).

- [ ] **Step 5: Write the failing route tests**

Create `src/routes/importEpub.test.ts`:

```ts
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildEpubFixture, TINY_PNG } from "../services/__fixtures__/epubFixtures";

/**
 * POST /stories/import-epub and GET /stories/:id/media/:name — a real Express server
 * over a throwaway library, like stories.test.ts: what matters is that the file lands
 * in the right library and that a re-import asks before replacing it.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "import-epub-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const fixture = buildEpubFixture({
  title: "Sách nhập",
  chapters: [
    {
      id: "ch1",
      file: "OEBPS/ch1.xhtml",
      title: "Một",
      html: `<h1>Một</h1><p>Nội dung.</p><img src="images/pic.png" alt="p"/>`,
    },
  ],
  extraEntries: { "OEBPS/images/pic.png": new Uint8Array(TINY_PNG) },
});
const STORY_URL = `epub:${createHash("sha1").update(fixture).digest("hex")}`;

describe("POST /stories/import-epub", () => {
  let server: Server;
  let base: string;
  let stories: typeof import("../services/storyStore").storyStore;
  let storyId: typeof import("../services/storyStore").storyId;
  let id: string;
  let privateStore: ReturnType<typeof import("../services/storyStore").createStoryStore>;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { storiesRouter } = await import("./stories");
    const store = await import("../services/storyStore");
    stories = store.storyStore;
    storyId = store.storyId;
    id = storyId(STORY_URL);
    privateStore = store.createStoryStore(path.join(DATA_DIR, "private"));

    const app = express();
    app.use(express.json());
    app.use("/api", storiesRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await stories.remove(id);
    await privateStore.remove(id);
    await rm(path.join(DATA_DIR, "epub-media"), { recursive: true, force: true });
    await rm(path.join(DATA_DIR, "covers"), { recursive: true, force: true });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  function importEpub(bytes: Buffer, query = "", headers: Record<string, string> = {}) {
    return fetch(`${base}/api/stories/import-epub${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/epub+zip", ...headers },
      body: new Uint8Array(bytes),
    });
  }

  it("imports a book with done chapters, blocks and a cover route", async () => {
    const res = await importEpub(fixture, "?name=Sach-nhap.epub");
    expect(res.status).toBe(201);

    const { story } = await res.json();
    expect(story.site).toBe("epub");
    expect(story.watching).toBe(false);
    expect(story.title).toBe("Sách nhập");
    expect(story.chapters).toHaveLength(1);
    expect(story.chapters[0]).toMatchObject({ order: 1, title: "Một", status: "done" });

    const stored = await stories.get(id);
    const image = stored?.chapters[0].blocks?.find((block) => block.type === "image");
    expect(image?.src).toMatch(new RegExp(`^epub-media/${id}/[0-9a-f]{12}\\.png$`));

    const name = image!.src!.split("/").pop()!;
    const media = await fetch(`${base}/api/stories/${id}/media/${name}`);
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await media.arrayBuffer()).equals(TINY_PNG)).toBe(true);
  });

  it("answers 409 for a book already in the library, then overwrites on request", async () => {
    await importEpub(fixture);
    await stories.addHighlight(id, { chapterOrder: 1, start: 0, end: 1, color: "yellow", text: "M" });

    const conflict = await importEpub(fixture);
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe("exists");

    const overwrite = await importEpub(fixture, "?overwrite=1");
    expect(overwrite.status).toBe(200);
    // The file is identical, so highlight offsets still line up and are kept.
    expect(await stories.listHighlights(id)).toHaveLength(1);
  });

  it("imports into the private library when a vault token is sent", async () => {
    const vault = (await import("../services/vault")).vault;
    const setup = vault.setup("123456");
    if (!setup.ok) throw new Error(setup.reason);

    const res = await importEpub(fixture, "", { "X-Vault-Token": setup.token });
    expect(res.status).toBe(201);

    expect(await privateStore.getOutline(id)).toBeTruthy();
    expect(await stories.getOutline(id)).toBeUndefined();
  });

  it("rejects a file that is not an EPUB and one locked with DRM", async () => {
    const junk = await importEpub(Buffer.from("hello"));
    expect(junk.status).toBe(400);

    const drmBytes = buildEpubFixture({
      encryptionXml:
        `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>`,
    });
    const drm = await importEpub(drmBytes);
    expect(drm.status).toBe(400);
    expect((await drm.json()).message).toContain("DRM");
  });

  it("refuses the watch toggle on an imported book", async () => {
    await importEpub(fixture);
    const res = await fetch(`${base}/api/stories/${id}/watch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watching: true }),
    });
    expect(res.status).toBe(400);
  });

  it("removes a story's media directory with the story", async () => {
    await importEpub(fixture);
    const stored = await stories.get(id);
    const name = stored!.chapters[0].blocks!.find((block) => block.type === "image")!.src!.split("/").pop()!;

    const res = await fetch(`${base}/api/stories/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await fetch(`${base}/api/stories/${id}/media/${name}`)).toHaveProperty("status", 404);
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run src/routes/importEpub.test.ts`
Expected: FAIL — 404 on `/api/stories/import-epub` (route not defined).

- [ ] **Step 7: Implement the routes and the guards**

Modify `src/routes/stories.ts`:

First, the imports:

```ts
import express, { Router } from "express";
import multer from "multer";
import os from "os";
import path from "path";
import { parseEpub } from "../services/epubImport";
```

Then a constant and the two new routes (put the import route right after `storiesRouter.post("/stories", …)` and the media route right after the cover route):

```ts
// A book bigger than this is refused before parsing: the raw body parser's own limit
// sits just above so an oversized file still gets our JSON message.
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
const IMPORT_BODY_LIMIT = MAX_IMPORT_BYTES + 1024 * 1024;

// Import an .epub file as a story. A file hash gives the story a stable URL and id, so
// re-importing the same file targets the same story; without ?overwrite=1 that answers
// 409 and the UI asks first. Parsing and the cover/media writes happen here, in the
// library the request is talking to (private mode included).
storiesRouter.post(
  "/stories/import-epub",
  express.raw({ type: () => true, limit: IMPORT_BODY_LIMIT }),
  async (req, res) => {
    const library = libraryFor(req, res);
    if (!library) return;
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (bytes.length === 0) {
      res.status(400).json({ message: t("Please choose an EPUB file") });
      return;
    }
    if (bytes.length > MAX_IMPORT_BYTES) {
      res.status(400).json({ message: t("The EPUB file is too large (maximum {size} MB)", { size: 100 }) });
      return;
    }

    const hash = crypto.createHash("sha1").update(bytes).digest("hex");
    const storyUrl = `epub:${hash}`;
    const id = storyId(storyUrl);
    const overwrite = req.query.overwrite === "1";
    const existing = await library.stories.getOutline(id);
    if (existing && !overwrite) {
      res.status(409).json({ code: "exists", message: t("This book is already in the library"), story: existing });
      return;
    }
    const name = typeof req.query.name === "string" ? path.basename(req.query.name) : "";
    const fallbackTitle = name ? path.parse(name).name : undefined;

    try {
      const book = await parseEpub(bytes, {
        fallbackTitle,
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
        // The file wins when it carries metadata; otherwise a re-import keeps what the
        // reader edited, and a new story starts from the settings defaults.
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
      res.status(400).json({ message: err instanceof Error ? err.message : t("Could not import the EPUB file") });
    }
  }
);
```

Media route, after the cover route:

```ts
// Book image stored by an import, served to the reader/editor. `libraryFor` makes the
// private library's ?vault= work, like the cover route.
storiesRouter.get("/stories/:id/media/:name", (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const media = library.epubMedia.find(req.params.id, req.params.name);
  if (!media) {
    res.status(404).json({ message: t("Book image not found") });
    return;
  }
  res.type(media.contentType);
  res.sendFile(media.filePath);
});
```

Delete cleanup in `DELETE /stories/:id`, next to `library.covers.remove`:

```ts
  await library.epubMedia.remove(req.params.id);
```

Watch guard in `POST /stories/:id/watch`, after the `if (!story)` check:

```ts
  if (story.site === "epub") {
    res.status(400).json({ message: t("Imported books have no chapter list to watch") });
    return;
  }
```

- [ ] **Step 8: Add the crawl guard**

Modify `src/routes/crawl.ts` — inside `POST /stories/:id/crawl`, after the `if (!story) { … }` check:

```ts
  if (story.site === "epub") {
    res.status(400).json({ message: t("Imported books cannot be crawled") });
    return;
  }
```

- [ ] **Step 9: Add the Vietnamese wordings**

Modify `src/services/lang.ts` — add to the `vi` map (keep keys byte-identical to the `t()` calls):

```ts
  "This file is not an EPUB book": "File này không phải là sách EPUB",
  "This EPUB file is too large to import": "File EPUB quá lớn để nhập",
  "This EPUB file is locked with DRM and cannot be imported": "File EPUB này bị khoá DRM, không thể nhập",
  "Please choose an EPUB file": "Hãy chọn một file EPUB",
  "The EPUB file is too large (maximum {size} MB)": "File EPUB quá lớn (tối đa {size} MB)",
  "This book is already in the library": "Truyện này đã có trong thư viện",
  "Could not import the EPUB file": "Không nhập được file EPUB",
  "Book image not found": "Không tìm thấy ảnh của sách",
  "Imported books cannot be crawled": "Truyện nhập từ file không crawl được",
  "Imported books have no chapter list to watch": "Truyện nhập từ file không có danh sách chương để theo dõi",
```

- [ ] **Step 10: Run the route tests**

Run: `npx vitest run src/routes/importEpub.test.ts src/services/coverStore.test.ts`
Expected: all tests PASS.

- [ ] **Step 11: Add the crawl-guard test**

Modify `src/routes/crawl.test.ts` — add this test inside the existing `describe`:

```ts
  it("refuses to crawl a story imported from an EPUB file", async () => {
    const { storyId } = await import("../services/storyStore");
    const epubId = storyId("epub:0123456789abcdef");
    await stories.save({
      id: epubId,
      storyUrl: "epub:0123456789abcdef",
      site: "epub",
      title: "Sách nhập",
      watching: false,
      newChapterCount: 0,
      chapters: [{ order: 1, url: "epub:0123456789abcdef#1", title: "Một", status: "done", blocks: [] }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await fetch(`${base}/api/stories/${epubId}/crawl`, { method: "POST" });

    expect(res.status).toBe(400);
    await stories.remove(epubId);
  });
```

- [ ] **Step 12: Run the full suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 13: Commit**

```bash
git add src/routes/stories.ts src/routes/crawl.ts src/routes/crawl.test.ts src/routes/importEpub.test.ts src/services/coverStore.ts src/services/coverStore.test.ts src/services/lang.ts
git commit -m "feat(epub): import route, media serving and crawl guards"
```

---

### Task 4: Reader/editor resolution and export of local book images

**Files:**
- Modify: `src/routes/chapters.ts`
- Modify: `src/routes/exports.ts`
- Modify: `src/services/epubBuilder.ts`
- Test: `src/routes/chapters.test.ts`
- Test: `src/services/epubBuilder.test.ts`

**Interfaces:**
- Consumes: `mapBlockMedia`, `resolveMediaHtml`, `restoreMediaHtml`, `exportMediaHtml`, `storyMediaDir`, `localMediaPath` (existing, private), `embedImages` (existing).
- Produces:
  - chapter GET/PATCH responses carry resolved image URLs (with `?vault=`); PATCH stores markers
  - `embedImages(chapters, dir, onProgress?, localRoots?: string[])` reads `file://` images inside `localRoots` only
  - `buildEpub(..., localMediaRoots)` passes those roots to `embedImages`
  - the export route rewrites imported image srcs to `file://` and adds the media dir to `localMediaRoots`

- [ ] **Step 1: Write the failing chapter-route test**

Modify `src/routes/chapters.test.ts` — add this test inside the existing `describe`:

```ts
  it("resolves imported book images for the editor and stores markers back", async () => {
    const marker = `epub-media/${id}/abcdef123456.png`;
    const contentHtml = `<p>Ảnh</p><img src="/api/stories/${id}/media/abcdef123456.png?vault=v1" alt="p"/>`;

    const res = await fetch(`${base}/api/stories/${id}/chapters/2`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Chương 1", contentHtml }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Stored: the marker, never the URL or the token.
    const stored = await stories.getChapter(id, 2);
    expect(JSON.stringify(stored?.blocks)).toContain(marker);
    expect(JSON.stringify(stored?.blocks)).not.toContain("/api/stories/");

    // Answered: the URL the browser can load (no token on a request that had none).
    const image = body.chapter.blocks.find((block: { type: string }) => block.type === "image");
    expect(image.src).toBe(`/api/stories/${id}/media/abcdef123456.png`);
  });

  it("resolves stored markers when a chapter is read", async () => {
    const marker = `epub-media/${id}/abcdef123456.png`;
    await stories.saveChapter(id, {
      order: 3,
      url: "https://example.com/c3",
      title: "Chương 3",
      status: "done",
      blocks: [{ type: "image", src: marker, alt: "" }],
    });

    const res = await fetch(`${base}/api/stories/${id}/chapters/3`);
    const body = await res.json();

    expect(body.chapter.blocks[0].src).toBe(`/api/stories/${id}/media/abcdef123456.png`);
    expect(JSON.stringify(await stories.getChapter(id, 3))).toContain(marker);
  });
```

Note: the test file's `stories.getChapter` works because `stories` is the store module. The PATCH test above patches chapter 2 (seeded as done).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/routes/chapters.test.ts -t "imported book images"`
Expected: FAIL — stored blocks contain `/api/stories/…` (no reverse mapping yet).

- [ ] **Step 3: Implement resolve/restore in `routes/chapters.ts`**

Add near the imports:

```ts
import type { Request } from "express";
import { mapBlockMedia, resolveMediaHtml, restoreMediaHtml } from "../services/epubMedia";
```

Add the helpers:

```ts
function requestVaultToken(req: Request): string | undefined {
  return req.header("X-Vault-Token") ?? (typeof req.query.vault === "string" ? req.query.vault : undefined);
}

// Imported book images are stored as markers; the reader/editor needs a loadable URL.
// The same mapping is reversed on PATCH, so edits never bake an origin or token into DB.
function presentChapter(chapter: StoredChapter, storyId: string, token?: string): StoredChapter {
  if (!chapter.blocks) return chapter;
  const blocks = mapBlockMedia(chapter.blocks, (html) => resolveMediaHtml(html, storyId, token));
  return { ...chapter, blocks };
}
```

GET: `res.json({ chapter: presentChapter(chapter, req.params.id, requestVaultToken(req)) });`

PATCH content: replace

```ts
  const blocks = htmlToBlocks(contentHtml);
```

with

```ts
  const blocks = mapBlockMedia(htmlToBlocks(contentHtml), (html) => restoreMediaHtml(html, id));
```

and its response with

```ts
  res.json({ chapter: presentChapter(updated, id, requestVaultToken(req)) });
```

The URL and title PATCH routes end with `res.json({ chapter: updated })` — change both to:

```ts
  res.json({ chapter: presentChapter(updated, id, requestVaultToken(req)) });
```

- [ ] **Step 4: Run the chapter tests**

Run: `npx vitest run src/routes/chapters.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Write the failing epubBuilder test**

Modify `src/services/epubBuilder.test.ts` — add `import { TINY_PNG } from "./__fixtures__/epubFixtures";` next to the other imports (`fs`, `os`, `path`, `embedImages` and `ExportChapter` are already imported), then add this describe block at the end of the file:

```ts
describe("embedImages with local book images", () => {
  // localMediaPath only trusts file:// paths inside `localRoots` — the import route
  // points these at the story's media dir, and nothing else may be read from disk.
  let root: string;
  let out: string;

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "epub-img-root-"));
    out = await fs.promises.mkdtemp(path.join(os.tmpdir(), "epub-img-out-"));
  });

  afterEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
    await fs.promises.rm(out, { recursive: true, force: true });
  });

  it("embeds an image file inside the allowed roots", async () => {
    const imagePath = path.join(root, "pic.png");
    await fs.promises.writeFile(imagePath, TINY_PNG);
    const chapters: ExportChapter[] = [
      { title: "Chương 1", includeInBook: true, contentHtml: `<p>x</p><img src="file://${imagePath}" />` },
    ];

    const result = await embedImages(chapters, out, undefined, [root]);

    expect(result[0].contentHtml).not.toContain(imagePath);
    expect(result[0].contentHtml).toMatch(/<img src="file:\/\/.+\.png"/);
  });

  it("drops a file:// image outside the allowed roots", async () => {
    const imagePath = path.join(root, "pic.png");
    await fs.promises.writeFile(imagePath, TINY_PNG);
    const chapters: ExportChapter[] = [
      { title: "Chương 1", includeInBook: true, contentHtml: `<p>x</p><img src="file://${imagePath}" />` },
    ];

    const result = await embedImages(chapters, out, undefined, []);

    expect(result[0].contentHtml).toBe("<p>x</p>");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/services/epubBuilder.test.ts -t "local book images"`
Expected: FAIL — outside the allowlist the image is dropped, but inside it is also dropped (no `file://` support yet).

- [ ] **Step 7: Teach `saveImage` and `embedImages` about local roots**

Modify `src/services/epubBuilder.ts`:

`saveImage` signature and start:

```ts
async function saveImage(src: string, dir: string, index: number, localRoots: string[] = []): Promise<string | undefined> {
  let bytes: Buffer;
  let contentType = "";
  const localPath = localMediaPath(src, localRoots);
  if (localPath) {
    try {
      bytes = await fs.readFile(localPath);
    } catch {
      return undefined;
    }
  } else {
    const dataUri = src.match(DATA_URI_RE);
    if (dataUri) {
      bytes = Buffer.from(dataUri[1], "base64");
    } else if (/^https?:/i.test(src)) {
      try {
        const res = await fetchWithRetry(
          src,
          { headers: { "User-Agent": IMAGE_USER_AGENT, Accept: "image/*" } },
          { maxAttempts: 2 }
        );
        if (!res.ok) return undefined;
        const declaredLength = Number(res.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_DOWNLOAD_BYTES) return undefined;
        bytes = Buffer.from(await res.arrayBuffer());
        contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      } catch {
        return undefined;
      }
    } else {
      return undefined;
    }
  }
```

(The rest of `saveImage` — the size checks, compression and file write — stays as it is.)

`embedImages` gains the parameter and passes it down:

```ts
export async function embedImages(
  chapters: ExportChapter[],
  dir: string,
  onProgress?: OnBuildProgress,
  localRoots: string[] = []
): Promise<ExportChapter[]> {
```

and inside its `mapWithConcurrency` callback: `const filePath = await saveImage(src, dir, index, localRoots);`

`buildEpub` passes the existing roots through:

```ts
    const withImages = await embedImages(included, imageDir, onProgress, localMediaRoots);
```

- [ ] **Step 8: Run the epubBuilder tests**

Run: `npx vitest run src/services/epubBuilder.test.ts`
Expected: all tests PASS.

- [ ] **Step 9: Export route: rewrite imported media and add its root**

Modify `src/routes/exports.ts`:

```ts
import { exportMediaHtml, storyMediaDir } from "../services/epubMedia";
```

Inside the chapter loop, after `if (!contentHtml) continue;`:

```ts
      // Imported book images: markers (from the DB) and resolved URLs (from an edited
      // chapter) both become file:// paths embedImages may read from the media dir.
      contentHtml = exportMediaHtml(contentHtml, id, library.dataDir);
```

Replace the `localRoots` construction and the `streamExport` call:

```ts
    // Imported books keep their images under the library's media dir; the export reads
    // those local files instead of re-fetching anything. Narration adds its own dir.
    const localRoots = [storyMediaDir(library.dataDir, id)];
    if (withNarration) localRoots.push(storyAudioDir(library.dataDir, id));

    await streamExport(res, metadata, included, metadata.title || story.title || "book", library.dataDir, localRoots);
```

- [ ] **Step 10: Run the full suite and typechecks**

Run: `npm test`, `npx tsc -p frontend --noEmit`, `npm run build`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add src/routes/chapters.ts src/routes/chapters.test.ts src/routes/exports.ts src/services/epubBuilder.ts src/services/epubBuilder.test.ts
git commit -m "feat(epub): resolve imported images in reader and embed them in exports"
```

---

### Task 5: Frontend — import button, drop zone, overwrite dialog and hidden crawl UI

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/hooks/useCrawlJob.ts`
- Modify: `frontend/src/components/NoticeStack.tsx`
- Modify: `frontend/src/components/LibraryView.tsx`
- Modify: `frontend/src/components/StoryDetail.tsx`
- Modify: `frontend/src/components/ChapterCard.tsx`
- Modify: `frontend/src/i18n/locales/en.ts`
- Modify: `frontend/src/i18n/locales/vi.ts`

**Interfaces:**
- Consumes: `POST /api/stories/import-epub` (409 `{ code: "exists", story }`), `site === "epub"`.
- Produces: `importEpub(file: File, options?: { overwrite?: boolean }): Promise<StoredStory>`; notice kind `{ kind: "epub-imported"; title: string }`; `ChapterCard` prop `imported?: boolean`.

- [ ] **Step 1: API helper**

Modify `frontend/src/lib/api.ts` — extend `ApiError` and `apiError`, then add `importEpub` after `createStory`:

```ts
// Errors the UI has to react to by kind, not by wording — matching the message text
// would break the moment it is translated.
export interface ApiError extends Error {
  status?: number;
  // "exists" on an import whose file is already in the library.
  code?: string;
  story?: StoredStory;
}

function apiError(message: string, status: number, code?: string, story?: StoredStory): ApiError {
  const error: ApiError = new Error(message);
  error.status = status;
  error.code = code;
  error.story = story;
  return error;
}

// Import an .epub file as a story. `overwrite` is the user confirming the "already in
// the library" dialog; without it the server answers 409 with code "exists".
export async function importEpub(file: File, options: { overwrite?: boolean } = {}): Promise<StoredStory> {
  const params = new URLSearchParams({ name: file.name });
  if (options.overwrite) params.set("overwrite", "1");
  const res = await apiFetch(`/api/stories/import-epub?${params}`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/epub+zip" }),
    body: file,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw apiError(data?.message || tr("Could not import the EPUB file"), res.status, data?.code, data?.story);
  }
  const data = await res.json();
  return data.story as StoredStory;
}
```

- [ ] **Step 2: Notice kind**

Modify `frontend/src/hooks/useCrawlJob.ts` — add to the `NoticeInput` union:

```ts
  | { kind: "epub-imported"; title: string }
```

Modify `frontend/src/components/NoticeStack.tsx` — add beside the other kinds:

```tsx
        {notice.kind === "epub-imported" && t("Imported {title}", { title: notice.title })}
```

- [ ] **Step 3: LibraryView button, drop zone and overwrite dialog**

Modify `frontend/src/components/LibraryView.tsx`:

Add `importEpub` to the `../lib/api` import list. Add state next to the existing `storyUrl`/`busy` state:

```ts
  const [importBusy, setImportBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
```

Add the handlers next to `createStoryFrom`:

```tsx
  // Import one .epub file. A 409 comes back as code "exists" — ask before overwriting
  // (the file hash is the story id, so it is the same book), then retry with the flag.
  async function handleImport(file: File, overwrite = false) {
    setImportBusy(true);
    setError(null);
    try {
      const imported = await importEpub(file, { overwrite });
      setPendingImport(null);
      await loadStories();
      setSelected(imported);
      pushNotice({ kind: "epub-imported", title: imported.title });
    } catch (err) {
      if (!overwrite && (err as { code?: string }).code === "exists") setPendingImport(file);
      else setError((err as Error).message);
    } finally {
      setImportBusy(false);
    }
  }

  function handleImportFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!/\.epub$/i.test(file.name)) {
      setError(t("Please choose an .epub file."));
      return;
    }
    void handleImport(file);
  }
```

Replace the add-story box (`<div className="border-b border-rule p-3">` containing the URL input, ending after the hint paragraph) with:

```tsx
        <div
          className={`border-b border-rule p-3${dragging ? " bg-sunken" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            handleImportFiles(event.dataTransfer.files);
          }}
        >
          <div className="flex gap-2">
            <label className="visually-hidden" htmlFor="story-url">
              {t("Story page URL")}
            </label>
            <input
              id="story-url"
              type="text"
              className="input"
              placeholder="https://example.com/story-title/"
              value={storyUrl}
              onChange={(e) => setStoryUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
            <button type="button" className="btn btn-primary" disabled={busy} onClick={handleCreate}>
              {busy ? t("Loading…") : t("Load chapters")}
            </button>
            <button type="button" className="btn" disabled={importBusy} onClick={() => fileInput.current?.click()}>
              <Icon name="upload" size={13} />
              {importBusy ? t("Importing…") : t("Import EPUB")}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".epub,application/epub+zip"
              className="hidden"
              onChange={(event) => {
                handleImportFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
          {pendingImport ? (
            <div className="banner banner-new mt-2">
              <Icon name="alert" size={14} />
              <p className="min-w-0">
                {t("This book is already in the library. Overwrite it with “{name}”?", { name: pendingImport.name })}
              </p>
              <span className="ml-auto flex gap-1.5">
                <button
                  type="button"
                  className="btn btn-tiny btn-danger"
                  disabled={importBusy}
                  onClick={() => void handleImport(pendingImport, true)}
                >
                  {t("Overwrite")}
                </button>
                <button
                  type="button"
                  className="btn btn-tiny btn-quiet"
                  disabled={importBusy}
                  onClick={() => setPendingImport(null)}
                >
                  {t("Cancel")}
                </button>
              </span>
            </div>
          ) : (
            <p className="mt-1.5 text-xs text-ink-3">
              {t("Paste a story page URL to load the full chapter list. Auto-loading sites:")}{" "}
              {[...new Set(supportedSites.map((s) => s.name))].join(", ") || t("loading…")}
              <span className="block">{t("Or drop an .epub file here to import it.")}</span>
            </p>
          )}
        </div>
```

In the table rows, replace the site cell and hide the watch bell:

```tsx
                    <td className="dim">{s.site === "epub" ? t("EPUB file") : s.site}</td>
```

and wrap the bell button:

```tsx
                          {s.site !== "epub" && (
                            <button
                              type="button"
                              className={`btn btn-quiet btn-tiny${s.watching ? " text-select-deep" : ""}`}
                              title={s.watching ? t("Stop watching for new chapters") : t("Watch for new chapters")}
                              aria-label={s.watching ? t("Stop watching {title}", { title: s.title }) : t("Watch {title}", { title: s.title })}
                              aria-pressed={s.watching}
                              onClick={() => handleWatchToggle(s)}
                            >
                              <Icon name="bell" size={13} filled={s.watching} />
                            </button>
                          )}
```

- [ ] **Step 4: StoryDetail hides crawl controls for imported books**

Modify `frontend/src/components/StoryDetail.tsx`:

After `const narrationLoaded = narration.state !== null;` (or next to the other derived values), add:

```ts
  // A book imported from a file has no TOC to crawl, check or watch; those controls
  // and the source link would all point at an epub: URL that no site can answer.
  const imported = story.site === "epub";
```

Source row (the `story-src` div):

```tsx
          <div className="story-src mt-1">
            <span>{imported ? t("EPUB file") : story.site}</span>
            {!imported && (
              <>
                <span aria-hidden="true">·</span>
                <a href={story.storyUrl} target="_blank" rel="noreferrer" className="break-all">
                  {story.storyUrl}
                </a>
              </>
            )}
          </div>
```

Wrap the "Continue crawl" button (the primary button at the start of the action row):

```tsx
            {!imported && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={job.running || remaining === 0}
                onClick={() => handleCrawl()}
              >
                <Icon name="play" size={12} className={job.running ? "animate-pulse" : undefined} />
                {job.running ? t("Crawling…") : t("Continue crawl ({count} chapters)", { count: remaining })}
              </button>
            )}
```

Wrap the watch button:

```tsx
            {!imported && (
              <button
                type="button"
                className={`btn${story.watching ? " text-select-deep" : ""}`}
                aria-pressed={story.watching}
                title={story.watching ? t("Stop watching for new chapters") : t("Check for new chapters when opening app")}
                onClick={handleWatchToggle}
              >
                <Icon name="bell" size={13} filled={story.watching} />
                {story.watching ? t("Watching") : t("Watch for new chapters")}
              </button>
            )}
```

Pass the flag to `ChapterCard` (the props list around `onRetry`):

```tsx
                  imported={imported}
```

- [ ] **Step 5: ChapterCard hides retry/recrawl/source for imported books**

Modify `frontend/src/components/ChapterCard.tsx`:

Add to `ChapterCardProps` and the destructuring:

```ts
  // Imported books have no source page to open, retry or re-crawl.
  imported?: boolean;
```

Hide the source-page link in the collapsed row:

```tsx
            {!imported && (
              <a
                className="btn btn-quiet btn-tiny"
                href={url}
                target="_blank"
                rel="noreferrer"
                title={t("Open source page")}
              >
                <Icon name="open" size={13} />
                <span className="visually-hidden">{t("Open source page for chapter {order}", { order })}</span>
              </a>
            )}
```

Hide the retry and re-crawl buttons:

```tsx
              {failed && !imported && (
                <button type="button" className="btn btn-tiny" disabled={retrying} onClick={onRetry}>
                  <Icon name="retry" size={13} className={retrying ? "animate-spin" : undefined} />
                  {retrying ? t("Retrying…") : t("Retry")}
                </button>
              )}
              {chip === "done" && !imported && (
                <button
                  type="button"
                  className="btn btn-quiet btn-tiny"
                  title={retrying ? t("Retrying…") : t("Re-crawl")}
                  disabled={retrying}
                  onClick={handleRecrawl}
                >
                  <Icon name="retry" size={13} className={retrying ? "animate-spin" : undefined} />
                  <span className="visually-hidden">{retrying ? t("Retrying…") : t("Re-crawl")}</span>
                </button>
              )}
```

In the expanded panel, show the source-URL block only when not imported — change `{urlEditing ? ( … ) : ( … )}` to `{!imported && (urlEditing ? ( … ) : ( … ))}`. The whole `urlEditing ? ... : ...` expression is wrapped, and `urlError` stays outside.

- [ ] **Step 6: i18n strings**

Modify `frontend/src/i18n/locales/en.ts` — add a section at the end:

```ts
  // EPUB import
  "Import EPUB": "Import EPUB",
  "Importing…": "Importing…",
  "Please choose an .epub file.": "Please choose an .epub file.",
  "This book is already in the library. Overwrite it with “{name}”?": "This book is already in the library. Overwrite it with “{name}”?",
  "Overwrite": "Overwrite",
  "Or drop an .epub file here to import it.": "Or drop an .epub file here to import it.",
  "Imported {title}": "Imported {title}",
  "EPUB file": "EPUB file",
  "Could not import the EPUB file": "Could not import the EPUB file",
```

Modify `frontend/src/i18n/locales/vi.ts` with the same keys and Vietnamese values:

```ts
  // EPUB import
  "Import EPUB": "Nhập file EPUB",
  "Importing…": "Đang nhập…",
  "Please choose an .epub file.": "Hãy chọn file .epub.",
  "This book is already in the library. Overwrite it with “{name}”?": "Truyện này đã có trong thư viện. Ghi đè bằng “{name}”?",
  "Overwrite": "Ghi đè",
  "Or drop an .epub file here to import it.": "Hoặc kéo-thả file .epub vào đây để nhập.",
  "Imported {title}": "Đã nhập {title}",
  "EPUB file": "File EPUB",
  "Could not import the EPUB file": "Không nhập được file EPUB",
```

- [ ] **Step 7: Typecheck and run the i18n test**

Run: `npx tsc -p frontend --noEmit` and `npx vitest run frontend/src/i18n/locales.test.ts`
Expected: typecheck clean; the locale parity test PASSES.

- [ ] **Step 8: Manual check**

Run `npm run dev` + `npm run dev:frontend`, open the app, and:
1. Import a real `.epub` — the story appears, the reader shows its text and images, editing a chapter and saving keeps its images.
2. Drag the same file again — the overwrite banner appears; Overwrite re-imports and the reader still works.
3. Drop a `.txt` — the "Please choose an .epub file." error appears.
4. Export the imported book — open the `.epub` and confirm the images are inside.
5. With private mode open, import again — the book lands in the private library.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/hooks/useCrawlJob.ts frontend/src/components/NoticeStack.tsx frontend/src/components/LibraryView.tsx frontend/src/components/StoryDetail.tsx frontend/src/components/ChapterCard.tsx frontend/src/i18n/locales/en.ts frontend/src/i18n/locales/vi.ts
git commit -m "feat(epub): import button, drop zone and overwrite dialog"
```

---

### Task 6: Documentation and full verification

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Document the feature**

Modify `AGENTS.md` — add a bullet to the Architecture section, after the crawl pipeline bullet:

```markdown
- EPUB import: `POST /api/stories/import-epub` (raw body, ≤ 100 MB, `?overwrite=1`) hashes the file into the story URL `epub:<sha1>`, parses it with `services/epubImport.ts` (streaming unzip with expanded-size caps, DRM rejected unless it is font obfuscation, DOM sanitized before `walkToBlocks`) and saves every image on disk via `services/epubMedia.ts` (`epub-media/<storyId>/<sha1-12>.<ext>`). Blocks store that relative marker; `routes/chapters.ts` maps it to `/api/stories/:id/media/:name` (+ `?vault=`) on the way out and restores it on save, and the export maps it to `file://` with the story's media dir in `localMediaRoots` — `embedImages` only reads `file://` inside those roots. Imported stories are `site: "epub"`, `watching: false`, all chapters `done`; there is no TOC, so crawl/watch controls are hidden and the crawl/watch routes refuse them.
```

- [ ] **Step 2: Run everything**

Run: `npm test`, `npx tsc -p frontend --noEmit`, `npx tsc -p e2e --noEmit`, `npm run build`
Expected: all tests PASS, both typechecks clean, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(epub): describe the import pipeline"
```

---

## Self-Review Notes (for the implementer)

- Tasks 1–6 map one-to-one onto spec §3.1–§3.4, §5 and §6; the E2E item was explicitly out of scope in the spec.
- Names are consistent across tasks: `parseEpub`, `storeImage`, `epubMedia.save/find/remove`, `resolveMediaHtml` / `restoreMediaHtml` / `exportMediaHtml`, `mapBlockMedia`, `saveBytes`, `importEpub` (frontend).
- If a commit step is skipped (the owner asked not to commit), keep the working tree clean and note it; do not amend earlier commits.
