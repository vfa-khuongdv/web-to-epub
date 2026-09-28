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
  try {
    return new JSDOM(source, { contentType }).window.document;
  } catch (err) {
    // Malformed XML from an untrusted file is just "not an EPUB": jsdom's DOMException
    // carries a raw parser message (about:blank:1:7: unexpected close tag.) that must
    // never reach the user. The nav document is parsed as HTML, which is lenient and
    // never takes this path.
    if (contentType === "application/xml") throw new NotEpubError();
    throw err;
  }
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
