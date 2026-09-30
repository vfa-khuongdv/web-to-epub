import type { LiveCrawl } from "../hooks/useCrawlJob";
import type { Translate } from "../i18n";
import type { ChipState } from "../components/StatusChip";
import type { StorySummary } from "../types";

// Crawl status for the entire story, combining saved count with running crawl: if
// chapters are waiting, report how many remain; if all waiting chapters are done,
// report crawl complete (with error count if any) — at a glance, know which stories
// are fully crawled. Watched stories with new chapters are prioritized before remaining.
export function crawlStatus(
  total: number,
  done: number,
  errors: number,
  newChapterCount: number,
  crawling: LiveCrawl | undefined,
  t: Translate
): { state: ChipState; label: string } {
  if (crawling) {
    return {
      state: "running",
      label:
        crawling.total > 0
          ? t("Crawling {done}/{total}", { done: crawling.cursor, total: crawling.total })
          : t("Crawling"),
    };
  }
  if (newChapterCount > 0) {
    return { state: "new", label: t("{count} new chapters", { count: newChapterCount }) };
  }
  const remaining = total - done - errors;
  if (remaining > 0) return { state: "pending", label: t("{count} chapters pending", { count: remaining }) };
  if (errors > 0) return { state: "error", label: `${t("Done")} · ${t("{count} errors", { count: errors })}` };
  return { state: "done", label: t("Crawl complete") };
}

export const PAGE_SIZE = 10;

export type SortKey = "title" | "site" | "chapterCount" | "done" | "errors" | "remaining" | "updatedAt";
export interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

// Multi-level sort: first element is primary criteria, subsequent elements are
// tie-breakers. Shift+click adds a secondary column, regular click replaces all.
export const DEFAULT_SORTS: SortState[] = [{ key: "updatedAt", dir: "desc" }];

// A table row: combines saved data plus running crawl, pre-calculated for
// filtering/sorting to work on the same numbers the user sees.
export interface StoryRow extends StorySummary {
  done: number;
  errors: number;
  remaining: number;
  crawling?: LiveCrawl;
  status: { state: ChipState; label: string };
}

// Remove diacritics so typing "van" still finds "Văn".
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export function compareRows(a: StoryRow, b: StoryRow, key: SortKey): number {
  switch (key) {
    case "title":
      return a.title.localeCompare(b.title, "vi");
    case "site":
      return a.site.localeCompare(b.site, "vi");
    case "updatedAt":
      // ISO format, so string comparison = time comparison.
      return a.updatedAt.localeCompare(b.updatedAt);
    default:
      return a[key] - b[key];
  }
}
