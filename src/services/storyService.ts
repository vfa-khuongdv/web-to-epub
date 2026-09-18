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
    // Thông tin người dùng đã sửa (nút "Lưu thông tin") thắng TOC khi nạp lại
    // danh sách chương; TOC chỉ điền lúc tạo truyện.
    title: params.existing?.title ?? params.toc.title ?? "Untitled",
    author: params.existing?.author ?? params.toc.author,
    language: params.existing?.language,
    coverUrl: params.toc.coverUrl ?? params.existing?.coverUrl,
    // Thông tin theo dõi không nằm trong TOC; giữ nguyên của truyện cũ (save()
    // cũng không ghi 4 field này nên giá trị thật vẫn nằm trong DB).
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

// Chương mới = URL có trong TOC hiện tại mà thư viện chưa từng thấy. Chương
// đổi URL cũng tính là mới; chương biến mất khỏi TOC không được tính.
export function countNewChapters(stored: { url: string }[], toc: TocChapter[]): number {
  const known = new Set(stored.map((c) => c.url));
  return toc.reduce((count, chapter) => (known.has(chapter.url) ? count : count + 1), 0);
}

export function toExtractedChapter(chapter: StoredChapter): ExtractedChapter {
  if (chapter.status === "error") {
    return { sourceUrl: chapter.url, title: chapter.title, blocks: [], error: chapter.error || "Lỗi không xác định" };
  }
  return { sourceUrl: chapter.url, title: chapter.title, blocks: chapter.blocks ?? [] };
}

/**
 * Mục lục cho tên ngắn gọn và đúng thứ tự, nhưng trang chương đôi khi có bản
 * đầy đủ hơn: mục lục xtruyen chỉ có "Quyển 1 Chương 2", trang chương mới có
 * "Quyển 1 Chương 2 : Mở cửa". Chỉ nhận tên của trang khi nó nối dài tên mục
 * lục — đủ để loại những <title> lẫn tên truyện và hậu tố site
 * ("Hãn Phu - Chương 1 - XTruyện").
 */
export function pickChapterTitle(tocTitle: string | undefined, pageTitle: string, chapterUrl: string): string {
  const toc = tocTitle?.trim();
  const page = pageTitle.trim();
  // Crawl thủ công không có mục lục: tên đang là chính URL.
  if (!toc || toc === chapterUrl) return page || toc || chapterUrl;
  if (!page) return toc;
  const normalize = (text: string) => text.replace(/\s+/g, " ").toLowerCase();
  const extendsToc = normalize(page).startsWith(normalize(toc)) && page.length > toc.length;
  return extendsToc ? page : toc;
}
