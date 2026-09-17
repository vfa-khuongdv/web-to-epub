import { ExtractedChapter, StoredChapter, StoredStory } from "../types";
import { storyId } from "./storyStore";
import { TocResult } from "./toc/types";

export function mergeStory(params: {
  existing?: StoredStory;
  site: string;
  storyUrl: string;
  toc: TocResult;
  now?: string;
}): StoredStory {
  const now = params.now || new Date().toISOString();
  const existingByUrl = new Map((params.existing?.chapters ?? []).map((c) => [c.url, c]));

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
    title: params.toc.title || params.existing?.title || "Untitled",
    author: params.toc.author ?? params.existing?.author,
    coverUrl: params.toc.coverUrl ?? params.existing?.coverUrl,
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

export function toExtractedChapter(chapter: StoredChapter): ExtractedChapter {
  if (chapter.status === "error") {
    return { sourceUrl: chapter.url, title: chapter.title, blocks: [], error: chapter.error || "Lỗi không xác định" };
  }
  return { sourceUrl: chapter.url, title: chapter.title, blocks: chapter.blocks ?? [] };
}
