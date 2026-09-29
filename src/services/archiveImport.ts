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