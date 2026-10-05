// The explorer tree as rows: each story a folder, its chapters the files, shown a page at
// a time (a long story has thousands of chapters). Built flat, so the keyboard walks it
// as a list; the levels tell the screen reader how the rows nest.
import { ChapterLiveState, LiveCrawl } from "../../hooks/useCrawlJob";
import { chapterFileName, slugify } from "../../lib/skins/slug";
import { StoredChapter, StoredStory, StorySummary } from "../../types";

export const PAGE_SIZE = 200;

// One story's chapter list as the shell keeps it (fed by useStoryChapters).
export interface ChapterData {
  story: StoredStory | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export type FileState = "done" | "pending" | "error" | "running";

// The live crawl overlay (by chapter URL) of the story the shell follows: chapters the
// running crawl finished show as done before the list is refetched.
export interface LiveOverlay {
  storyId: string;
  chapters: Record<string, ChapterLiveState>;
}

export type TreeRow =
  | {
      kind: "folder";
      key: string;
      storyId: string;
      name: string;
      level: 1;
      expanded: boolean;
      errors: number;
      pending: boolean;
      crawl: LiveCrawl | null;
      posinset: number;
      setsize: number;
    }
  | {
      kind: "file";
      key: string;
      storyId: string;
      order: number;
      name: string;
      level: 2;
      state: FileState;
      error?: string;
      posinset: number;
      setsize: number;
    }
  | {
      kind: "page";
      key: string;
      storyId: string;
      level: 2;
      direction: 1 | -1;
      // 1-based file positions the page change shows.
      from: number;
      to: number;
      total: number;
      // The row to focus once the page has changed: the first (or last) file of it.
      focusAfter: string | null;
    }
  | {
      kind: "note";
      key: string;
      storyId: string;
      level: 2;
      note: "loading" | "error" | "empty";
      message?: string;
    };

export const folderKey = (storyId: string) => `f:${storyId}`;
export const fileKey = (storyId: string, order: number) => `c:${storyId}:${order}`;

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

export function pageOf(index: number): number {
  return Math.max(0, Math.floor(index / PAGE_SIZE));
}

// The [start, end) slice of a page, the page clamped to the list.
export function pageRange(total: number, page: number): { page: number; start: number; end: number } {
  const clamped = Math.min(Math.max(0, page), pageCount(total) - 1);
  const start = clamped * PAGE_SIZE;
  return { page: clamped, start, end: Math.min(total, start + PAGE_SIZE) };
}

export function fileState(chapter: Pick<StoredChapter, "status" | "url">, overlay?: Record<string, ChapterLiveState>): FileState {
  if (chapter.status !== "pending") return chapter.status;
  return overlay?.[chapter.url] ?? "pending";
}

export function chapterFile(chapter: Pick<StoredChapter, "order" | "title">, neutral: boolean): string {
  return chapterFileName(chapter.order, chapter.title, neutral);
}

export interface TreeInput {
  stories: StorySummary[];
  names: Map<string, string>;
  expanded: Set<string>;
  data: Record<string, ChapterData | undefined>;
  pages: Record<string, number>;
  live: Record<string, LiveCrawl | undefined>;
  overlay: LiveOverlay | null;
  neutral: boolean;
}

export function buildTree(input: TreeInput): TreeRow[] {
  const { stories, names, expanded, data, pages, live, overlay, neutral } = input;
  const rows: TreeRow[] = [];
  stories.forEach((summary, index) => {
    const id = summary.id;
    const loaded = data[id];
    const story = loaded?.story ?? null;
    const liveChapters = overlay && overlay.storyId === id ? overlay.chapters : undefined;
    let errors = summary.errorCount;
    let pending = summary.chapterCount - summary.doneCount - summary.errorCount > 0;
    const states = story ? story.chapters.map((chapter) => fileState(chapter, liveChapters)) : null;
    if (states) {
      errors = states.filter((state) => state === "error").length;
      pending = states.some((state) => state === "pending" || state === "running");
    }
    const isExpanded = expanded.has(id);
    rows.push({
      kind: "folder",
      key: folderKey(id),
      storyId: id,
      name: names.get(id) ?? `module-${index + 1}`,
      level: 1,
      expanded: isExpanded,
      errors,
      pending,
      crawl: live[id] ?? null,
      posinset: index + 1,
      setsize: stories.length,
    });
    if (!isExpanded) return;
    if (!story || !states) {
      const failed = !!loaded?.error && !loaded.loading;
      rows.push({
        kind: "note",
        key: `n:${id}`,
        storyId: id,
        level: 2,
        note: failed ? "error" : "loading",
        message: failed ? loaded?.error ?? undefined : undefined,
      });
      return;
    }
    const chapters = story.chapters;
    if (chapters.length === 0) {
      rows.push({ kind: "note", key: `n:${id}`, storyId: id, level: 2, note: "empty" });
      return;
    }
    const { start, end } = pageRange(chapters.length, pages[id] ?? 0);
    if (start > 0) {
      rows.push({
        kind: "page",
        key: `p:${id}:prev`,
        storyId: id,
        level: 2,
        direction: -1,
        from: Math.max(1, start - PAGE_SIZE + 1),
        to: start,
        total: chapters.length,
        focusAfter: fileKey(id, chapters[start - 1].order),
      });
    }
    for (let at = start; at < end; at++) {
      const chapter = chapters[at];
      rows.push({
        kind: "file",
        key: fileKey(id, chapter.order),
        storyId: id,
        order: chapter.order,
        name: chapterFile(chapter, neutral),
        level: 2,
        state: states[at],
        error: chapter.error,
        posinset: at + 1,
        setsize: chapters.length,
      });
    }
    if (end < chapters.length) {
      rows.push({
        kind: "page",
        key: `p:${id}:next`,
        storyId: id,
        level: 2,
        direction: 1,
        from: end + 1,
        to: Math.min(chapters.length, end + PAGE_SIZE),
        total: chapters.length,
        focusAfter: fileKey(id, chapters[end].order),
      });
    }
  });
  return rows;
}

// The folder row a row belongs to (ArrowLeft from a file goes there).
export function parentKey(row: TreeRow): string | null {
  return row.kind === "folder" ? null : folderKey(row.storyId);
}

// Search: every word of the query in the name, ignoring case and Vietnamese diacritics.
// Names are slugs already, so only the query needs folding.
export function queryWords(query: string): string[] {
  return slugify(query, 200).split("-").filter(Boolean);
}

export function nameMatches(words: string[], name: string): boolean {
  if (words.length === 0) return false;
  const haystack = name.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export interface SearchGroup {
  storyId: string;
  folder: string;
  folderMatch: boolean;
  files: { order: number; name: string; state: FileState }[];
}

export interface SearchResult {
  groups: SearchGroup[];
  // Files found (shown or not), and whether some were left out past the limit.
  count: number;
  truncated: boolean;
  // Folders whose file list is not loaded, so their files were not searched.
  unsearched: number;
}

export function searchTree(
  query: string,
  input: Pick<TreeInput, "stories" | "names" | "data" | "overlay" | "neutral">,
  limit = PAGE_SIZE
): SearchResult {
  const words = queryWords(query);
  const result: SearchResult = { groups: [], count: 0, truncated: false, unsearched: 0 };
  if (words.length === 0) return result;
  let shown = 0;
  for (const summary of input.stories) {
    const folder = input.names.get(summary.id) ?? summary.id;
    const story = input.data[summary.id]?.story ?? null;
    if (!story) result.unsearched++;
    const liveChapters = input.overlay && input.overlay.storyId === summary.id ? input.overlay.chapters : undefined;
    const group: SearchGroup = { storyId: summary.id, folder, folderMatch: nameMatches(words, folder), files: [] };
    for (const chapter of story?.chapters ?? []) {
      const name = chapterFile(chapter, input.neutral);
      if (!nameMatches(words, name)) continue;
      result.count++;
      if (shown >= limit) {
        result.truncated = true;
        continue;
      }
      shown++;
      group.files.push({ order: chapter.order, name, state: fileState(chapter, liveChapters) });
    }
    if (group.folderMatch || group.files.length > 0) result.groups.push(group);
  }
  return result;
}
