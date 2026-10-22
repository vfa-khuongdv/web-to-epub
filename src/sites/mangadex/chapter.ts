import { ContentBlock, ExtractedChapter } from "../../types";
import { ChapterFetchContext } from "../../services/chapters/types";
import { sniffImageExtension } from "../../services/coverStore";
import { t } from "../../services/lang";
import { assertPublicUrl } from "../../services/netPolicy";
import { fetchWithRetry, readBodyCapped, sleep } from "../../services/toc/http";
import { chapterTitle, FeedChapter, MANGADEX_HEADERS, mangadexApi, parseMangadexId } from "./toc";

// The at-home endpoint is limited to 40 requests a minute per client.
const AT_HOME_INTERVAL_MS = 1500;
// Same limits as the agent crawler's picture download (agent/pictures.ts).
const PARALLEL_PAGES = 4;
const MAX_PAGE_BYTES = 32 * 1024 * 1024;

interface AtHome {
  baseUrl?: string;
  chapter?: { hash?: string; data?: string[]; dataSaver?: string[] };
}

let lastAtHomeCall = 0;

// Each call takes the next free slot before it waits: crawls running side by side then queue
// behind one another instead of reading the same last call and firing together.
async function waitForAtHome(): Promise<void> {
  const slot = Math.max(Date.now(), lastAtHomeCall + AT_HOME_INTERVAL_MS);
  lastAtHomeCall = slot;
  const wait = slot - Date.now();
  if (wait > 0) await sleep(wait);
}

// Pages come from MangaDex's own upload server or a MangaDex@Home node. The API names the
// node, so any other host it might name is refused instead of fetched.
export function isMangadexPageHost(baseUrl: string): boolean {
  try {
    const { protocol, hostname } = new URL(baseUrl);
    return protocol === "https:" && (hostname === "uploads.mangadex.org" || hostname.endsWith(".mangadex.network"));
  } catch {
    return false;
  }
}

export interface PageSource {
  full: string;
  saver?: string;
}

// Page addresses come from a MangaDex@Home node chosen per request and stop working after
// about 15 minutes, so they are never kept: every page is downloaded while the chapter is
// crawled and stored next to the book (like Scribd's page captures).
export function pageSources(atHome: AtHome): PageSource[] {
  const { baseUrl, chapter } = atHome;
  if (!baseUrl || !chapter?.hash || !chapter.data?.length) return [];
  return chapter.data.map((file, i) => ({
    full: `${baseUrl}/data/${chapter.hash}/${file}`,
    saver: chapter.dataSaver?.[i] ? `${baseUrl}/data-saver/${chapter.hash}/${chapter.dataSaver[i]}` : undefined,
  }));
}

// The page's bytes and their image type, read from the bytes themselves (like covers); undefined
// when the download fails or what came back is not a picture.
async function download(src: string): Promise<{ bytes: Buffer; extension: string } | undefined> {
  try {
    const res = await fetchWithRetry(src, { headers: { Accept: "image/*" } }, { maxAttempts: 3, validateUrl: assertPublicUrl });
    if (!res.ok) return undefined;
    const bytes = await readBodyCapped(res, MAX_PAGE_BYTES);
    const extension = bytes && sniffImageExtension(bytes);
    return bytes && extension ? { bytes, extension } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fetch one chapter: ask the API which MangaDex@Home node serves it, then store every page.
 * A page that fails in full quality is tried once in the smaller "data saver" copy; a page
 * that still fails fails the chapter (retryable) instead of saving a chapter with holes.
 */
export async function fetchMangadexChapter(url: string, context?: ChapterFetchContext): Promise<ExtractedChapter> {
  const id = parseMangadexId(url, "chapter");
  if (!id) {
    throw new Error(t("This is not a MangaDex chapter page: {url}", { url }));
  }
  if (!context) {
    throw new Error(t("Could not store this MangaDex chapter's pages — retry the crawl ({url})", { url }));
  }

  const { data: info } = await mangadexApi<{ data: FeedChapter }>(`/chapter/${id}`, url);
  if (info.attributes.externalUrl) {
    throw new Error(t("This chapter is hosted on another site, not on MangaDex ({url})", { url }));
  }
  await waitForAtHome();
  const atHome = await mangadexApi<AtHome>(`/at-home/server/${id}`, url);
  if (atHome.baseUrl && !isMangadexPageHost(atHome.baseUrl)) {
    throw new Error(t("MangaDex named an unexpected server for this chapter's pages — retry the chapter ({url})", { url }));
  }
  const pages = pageSources(atHome);
  if (pages.length === 0) {
    throw new Error(t("MangaDex returned no page for this chapter ({url})", { url }));
  }

  const blocks: ContentBlock[] = new Array(pages.length);
  let next = 0;
  let failed: number | undefined;
  const worker = async () => {
    while (failed === undefined && next < pages.length) {
      const i = next++;
      const page = pages[i];
      const image = (await download(page.full)) ?? (page.saver ? await download(page.saver) : undefined);
      if (!image) {
        failed = i + 1;
        return;
      }
      blocks[i] = { type: "image", src: context.media.save(context.storyId, image.bytes, image.extension), alt: "" };
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_PAGES, pages.length) }, worker));
  if (failed !== undefined) {
    throw new Error(t("Could not download page {page} of this MangaDex chapter — retry the chapter ({url})", { page: failed, url }));
  }

  return { sourceUrl: url, title: chapterTitle(info), blocks };
}
