// A story's chapters as every disguise skin walks them: in reading order, with the running
// crawl's progress laid over the stored status, skipping the ones without text.
import { ChapterLiveState } from "../../hooks/useCrawlJob";
import { StoredChapter } from "../../types";

export type ShownStatus = "done" | "pending" | "error" | "running";

// A chapter's status with the running crawl laid over the stored one: the stored list is
// refetched only when the crawl ends, the live channel says what finished meanwhile.
export function shownStatus(chapter: StoredChapter, liveStates?: Record<string, ChapterLiveState>): ShownStatus {
  if (chapter.status !== "pending" || !liveStates) return chapter.status;
  return liveStates[chapter.url] ?? "pending";
}

// Chapters in reading order.
export function sortChapters(chapters: StoredChapter[]): StoredChapter[] {
  return chapters.slice().sort((a, b) => a.order - b.order);
}

// The next (+1) or previous (-1) chapter that has text, skipping pending and failed ones.
export function adjacentChapter(
  sorted: StoredChapter[],
  order: number,
  direction: 1 | -1,
  liveStates?: Record<string, ChapterLiveState>
): number | null {
  const readable = (chapter: StoredChapter) => shownStatus(chapter, liveStates) === "done";
  if (direction === 1) {
    for (const chapter of sorted) if (chapter.order > order && readable(chapter)) return chapter.order;
  } else {
    for (let index = sorted.length - 1; index >= 0; index--) {
      const chapter = sorted[index];
      if (chapter.order < order && readable(chapter)) return chapter.order;
    }
  }
  return null;
}
