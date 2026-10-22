import { ImportedBook, parseEpub, StoreImage } from "./epubImport";
import { CloudflareBlockedError, isCloudflareResponse } from "./cloudflare";
import { t } from "./lang";

export const DTV_EBOOK_DOMAIN = "dtv-ebook.com.vn";

// A book bigger than this is refused before it is buffered; the biggest books on the site
// are long web novels in the 5-15 MB range, so this is generous.
export const MAX_DTV_EBOOK_BYTES = 100 * 1024 * 1024;

export class DtvEbookNotFoundError extends Error {
  constructor(url: string) {
    super(t("DTV Ebook could not serve this book: {url}", { url }));
  }
}

/** The book exists, but the site hosts no EPUB for it — only MOBI/CBZ/PDF downloads. */
export class DtvEbookNoEpubError extends Error {
  constructor(url: string) {
    super(t("This DTV Ebook book has no EPUB to import — the site only offers other formats: {url}", { url }));
  }
}

// Book pages are /<slug>_<id>.html; the id is the only part a book is identified by.
const BOOK_PATH_RE = /\/[^/?#]*_(\d+)\.html?$/i;

/** The book's numeric id, or undefined for any other URL (the add box uses this to route). */
export function dtvEbookId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.hostname.toLowerCase().replace(/^www\./, "") !== DTV_EBOOK_DOMAIN) return undefined;
  return BOOK_PATH_RE.exec(parsed.pathname)?.[1];
}

export function bookUrl(id: string): string {
  return `https://${DTV_EBOOK_DOMAIN}/book_${id}.html`;
}

// The site's own "Đọc online" link: the id base64-encoded, exactly as its pages build it.
export function readerUrl(id: string): string {
  return `https://${DTV_EBOOK_DOMAIN}/doconline.php?hash=${Buffer.from(id).toString("base64")}`;
}

// The reader page is an epub.js shell: it holds no text, only the path of the book file
// it loads. An empty path is how the site answers for a book it has no EPUB for.
export function epubPathFromReader(html: string): string | undefined {
  const match = /ePubReader\(\s*["']([^"']*)["']/.exec(html);
  const path = match?.[1]?.trim();
  return path || undefined;
}

// Reads at most `cap` bytes: the declared length first, then the stream, so a missing or
// lying Content-Length cannot make a huge file fill memory. undefined on any failure.
async function fetchBytes(fetchImpl: typeof fetch, url: string, cap: number): Promise<Buffer | undefined> {
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

export interface ImportDtvEbookOptions {
  fetchImpl?: typeof fetch;
  storeImage?: StoreImage;
  maxFileBytes?: number;
}

// Import a book straight from the site: the reader page names the EPUB the site hosts for
// it, and that file is read with the same parser as an uploaded .epub — so the chapters,
// the cover and the images are the book's own, not scraped page by page.
export async function importDtvEbook(id: string, options: ImportDtvEbookOptions = {}): Promise<ImportedBook> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cap = options.maxFileBytes ?? MAX_DTV_EBOOK_BYTES;
  const page = bookUrl(id);

  let html: string;
  try {
    const res = await fetchImpl(readerUrl(id), { headers: { "User-Agent": epubUserAgent } });
    if (isCloudflareResponse(res)) throw new CloudflareBlockedError(page);
    if (!res.ok) throw new DtvEbookNotFoundError(page);
    html = await res.text();
  } catch (err) {
    if (err instanceof DtvEbookNotFoundError || err instanceof CloudflareBlockedError) throw err;
    throw new DtvEbookNotFoundError(page);
  }

  const path = epubPathFromReader(html);
  if (!path) throw new DtvEbookNoEpubError(page);
  // The path is relative to the site root in every page seen ("images/files/…"). Resolve it and
  // keep the site's own host: a page (or a compromised response) must not send the server
  // anywhere else — an absolute or protocol-relative path would otherwise win over the base.
  const fileUrl = new URL(path, `https://${DTV_EBOOK_DOMAIN}/`);
  if (fileUrl.hostname.toLowerCase().replace(/^www\./, "") !== DTV_EBOOK_DOMAIN) throw new DtvEbookNotFoundError(page);
  const bytes = await fetchBytes(fetchImpl, fileUrl.toString(), cap);
  if (!bytes) throw new DtvEbookNotFoundError(page);

  return parseEpub(bytes, { storeImage: options.storeImage ?? (() => "") });
}

// The site sits behind Cloudflare but serves plain GETs to a normal browser UA; the file
// requests carry no Referer (the reader page is fetched with the same agent).
const epubUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
