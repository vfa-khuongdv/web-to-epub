import { ImportedBook, StoreImage } from "./epubImport";
import { parsePdf } from "./pdfImport";
import { t } from "./lang";

export const HEYZINE_DOMAIN = "heyzine.com";

// Every book is a user-uploaded PDF behind the flipbook: cdnm.heyzine.com serves it with
// no session and no bot check, but a book bigger than this is refused before buffering.
export const MAX_HEYZINE_BYTES = 100 * 1024 * 1024;

const HEYZINE_CDN = "cdnm.heyzine.com";

export class HeyzineNotFoundError extends Error {
  constructor(url: string) {
    super(t("Heyzine could not serve this flipbook: {url}", { url }));
  }
}

/** The flipbook page is up but ships no flipbook: it is password-protected, private, or removed. */
export class HeyzineUnavailableError extends Error {
  constructor(url: string) {
    super(
      t("This Heyzine flipbook is not publicly readable (it may be password-protected or removed): {url}", { url })
    );
  }
}

// Flipbooks are /flip-book/<id>.html; the id is the only part a book is identified by.
const FLIPBOOK_PATH_RE = /^\/flip-book\/([a-z0-9-]+)\.html?$/i;

/** The flipbook's id, or undefined for any other URL (the add box uses this to route). */
export function heyzineId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.hostname.toLowerCase().replace(/^www\./, "") !== HEYZINE_DOMAIN) return undefined;
  return FLIPBOOK_PATH_RE.exec(parsed.pathname)?.[1];
}

export function flipbookUrl(id: string): string {
  return `https://${HEYZINE_DOMAIN}/flip-book/${id}.html`;
}

// The shell page names the file its viewer renders in a heyzine.load('…') call. The page
// supplies that URL, so only the site's own CDN is accepted — nothing else may be fetched.
export function pdfFileFromPage(html: string): string | undefined {
  const match = /heyzine\.load\(\s*['"]([^'"]+)['"]/.exec(html);
  if (!match) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(match[1]);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== HEYZINE_CDN) return undefined;
  return parsed.toString();
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

export interface ImportHeyzineOptions {
  fetchImpl?: typeof fetch;
  storeImage?: StoreImage;
  maxFileBytes?: number;
}

// Import a flipbook straight from the site: the shell page names the PDF its viewer
// renders, and that file is read with the same parser as an uploaded PDF — so chapters,
// cover and text are the book's own, not screenshots of a flip animation.
export async function importHeyzine(id: string, options: ImportHeyzineOptions = {}): Promise<ImportedBook> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cap = options.maxFileBytes ?? MAX_HEYZINE_BYTES;
  const page = flipbookUrl(id);

  let html: string;
  try {
    const res = await fetchImpl(page);
    if (!res.ok) throw new HeyzineNotFoundError(page);
    html = await res.text();
  } catch (err) {
    if (err instanceof HeyzineNotFoundError) throw err;
    throw new HeyzineNotFoundError(page);
  }
  // A removed or unknown id is answered with a 200 "Page not found", not a 404.
  if (/Page not found/i.test(html)) throw new HeyzineNotFoundError(page);

  const fileUrl = pdfFileFromPage(html);
  if (!fileUrl) throw new HeyzineUnavailableError(page);

  const bytes = await fetchBytes(fetchImpl, fileUrl, cap);
  if (!bytes) throw new HeyzineNotFoundError(page);

  return parsePdf(bytes, { storeImage: options.storeImage ?? (() => "") });
}
