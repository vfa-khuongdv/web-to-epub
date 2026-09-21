import { ExtractedChapter, StoredChapter, StoredStory } from "../types";
import { storyId } from "./storyStore";
import { TocChapter, TocResult } from "./toc/types";

export function mergeStory(params: {
  existing?: StoredStory;
  site: string;
  storyUrl: string;
  toc: TocResult;
  now?: string;
}): StoredStory {
  const now = params.now || new Date().toISOString();
  const existingByUrl = new Map((params.existing?.chapters ?? []).map((c) => [c.url, c]));

  // Chapters absent from the refreshed TOC are intentionally dropped, so upstream-renamed chapters lose their crawled progress — revisit if that becomes a real case.
  const chapters: StoredChapter[] = params.toc.chapters.map((c, i) => {
    const old = existingByUrl.get(c.url);
    if (old && old.status !== "pending") {
      return { ...old, order: i + 1, title: old.title || c.title };
    }
    return { order: i + 1, url: c.url, title: c.title, status: "pending" };
  });

  return {
    id: storyId(params.storyUrl),
    storyUrl: params.storyUrl,
    site: params.site,
    // User-edited info (the "Save info" button) beats the TOC when reloading the chapter list;
    // the TOC is only used when creating a story.
    title: params.existing?.title ?? params.toc.title ?? "Untitled",
    author: params.existing?.author ?? params.toc.author,
    language: params.existing?.language,
    coverUrl: params.toc.coverUrl ?? params.existing?.coverUrl,
    // Watch information doesn't come from TOC; keep the old story's values (save() also
    // doesn't write these 4 fields, so the real values remain in the DB).
    watching: params.existing?.watching ?? false,
    newChapterCount: params.existing?.newChapterCount ?? 0,
    lastCheckedAt: params.existing?.lastCheckedAt,
    checkError: params.existing?.checkError,
    chapters,
    createdAt: params.existing?.createdAt || now,
    updatedAt: now,
  };
}

export function chaptersToCrawl(story: StoredStory, orders?: number[]): StoredChapter[] {
  if (orders && orders.length > 0) {
    const wanted = new Set(orders);
    return story.chapters.filter((c) => wanted.has(c.order)).sort((a, b) => a.order - b.order);
  }
  return story.chapters.filter((c) => c.status !== "done").sort((a, b) => a.order - b.order);
}

// New chapters = URLs in the current TOC that the library hasn't seen before. A chapter
// with a changed URL also counts as new; chapters that disappear from the TOC don't count.
export function countNewChapters(stored: { url: string }[], toc: TocChapter[]): number {
  const known = new Set(stored.map((c) => c.url));
  return toc.reduce((count, chapter) => (known.has(chapter.url) ? count : count + 1), 0);
}

export function toExtractedChapter(chapter: StoredChapter): ExtractedChapter {
  if (chapter.status === "error") {
    return { sourceUrl: chapter.url, title: chapter.title, blocks: [], error: chapter.error || "Unknown error" };
  }
  return { sourceUrl: chapter.url, title: chapter.title, blocks: chapter.blocks ?? [] };
}

/**
 * TOC provides short, correct names, but chapter page sometimes has a fuller version:
 * xtruyen TOC has only "Book 1 Chapter 2", chapter page has "Book 1 Chapter 2 : Opening Door".
 * Only accept page name when it extends the TOC name — enough to exclude <title> tags,
 * story names, and site suffixes ("Han Phu - Chapter 1 - XTruyen").
 */
export function pickChapterTitle(tocTitle: string | undefined, pageTitle: string, chapterUrl: string): string {
  const toc = tocTitle?.trim();
  const page = pageTitle.trim();
  // A TOC entry with no name keeps the URL as its title.
  if (!toc || toc === chapterUrl) return page || toc || chapterUrl;
  if (!page) return toc;
  const normalize = (text: string) => text.replace(/\s+/g, " ").toLowerCase();
  const extendsToc = normalize(page).startsWith(normalize(toc)) && page.length > toc.length;
  return extendsToc ? page : toc;
}
