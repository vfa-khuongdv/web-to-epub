import { JSDOM } from "jsdom";
import { SiteSession, siteSessionHeaders } from "./siteSession";

/**
 * The reader's own endpoints for a borrow-only item, driven with the session the
 * reader saved from their browser. Files stay private and LCP stays encrypted —
 * only what the BookReader itself displays (page images) is captured, so the book
 * lands as image blocks, like a scanned PDF. Endpoints are pinned by
 * docs/superpowers/specs/2026-09-29-archive-borrow-import-design.md §2.
 */

export interface ReaderLeaf {
  leafNum: number;
  uri: string;
}

export interface ReaderConfig {
  bookId: string;
  subPrefix: string;
  bookTitle: string;
  leaves: ReaderLeaf[];
  lendingStatus: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export async function readerConfig(fetchImpl: typeof fetch, session: SiteSession, id: string): Promise<ReaderConfig> {
  const detailsUrl = `https://archive.org/details/${encodeURIComponent(id)}`;
  const details = await fetchImpl(detailsUrl, { headers: siteSessionHeaders(session, detailsUrl) });
  if (!details.ok) throw new Error(`archive details request failed (${details.status})`);
  const html = await details.text();
  const input = new JSDOM(html).window.document.querySelector("input.js-bookreader") as
    | (Element & { value?: string })
    | null;
  let configUrl: string | undefined;
  if (input?.value) {
    try {
      const parsed = JSON.parse(input.value) as { url?: unknown };
      if (typeof parsed.url === "string" && parsed.url) {
        configUrl = parsed.url.startsWith("//") ? `https:${parsed.url}` : parsed.url;
      }
    } catch {
      configUrl = undefined;
    }
  }
  if (!configUrl) throw new Error("archive reader config not found on the details page");

  // The endpoint lives on the storage host and only answers format=json there.
  const jsonUrl = configUrl.replace("format=jsonp", "format=json");
  const response = await fetchImpl(jsonUrl, { headers: siteSessionHeaders(session, jsonUrl) });
  if (!response.ok) throw new Error(`archive reader config request failed (${response.status})`);
  const body = (await response.json().catch(() => null)) as {
    data?: {
      brOptions?: { bookId?: unknown; subPrefix?: unknown; bookTitle?: unknown; data?: unknown };
      lendingInfo?: { lendingStatus?: unknown };
      metadata?: unknown;
    };
  } | null;
  const brOptions = body?.data?.brOptions;
  if (!brOptions || !Array.isArray(brOptions.data)) throw new Error("archive reader config has an unexpected shape");

  const leaves: ReaderLeaf[] = [];
  for (const group of brOptions.data) {
    if (!Array.isArray(group)) continue;
    for (const leaf of group) {
      if (leaf && typeof leaf.leafNum === "number" && typeof leaf.uri === "string") {
        leaves.push({ leafNum: leaf.leafNum, uri: leaf.uri });
      }
    }
  }
  const lendingStatus = (body?.data?.lendingInfo?.lendingStatus ?? {}) as Record<string, unknown>;
  return {
    bookId: typeof brOptions.bookId === "string" ? brOptions.bookId : id,
    subPrefix: typeof brOptions.subPrefix === "string" ? brOptions.subPrefix : id,
    bookTitle: typeof brOptions.bookTitle === "string" ? brOptions.bookTitle : "",
    leaves,
    lendingStatus,
    metadata: (body?.data?.metadata ?? {}) as Record<string, unknown>,
  };
}
