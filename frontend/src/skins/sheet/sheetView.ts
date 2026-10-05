// What the active sheet draws, from whatever its data hooks have so far: the rows (or a
// loading / empty / error row under the header), its columns, and how many items the
// paged sheets hold in all.

import { ChapterLiveState, LiveCrawl } from "../../hooks/useCrawlJob";
import { ChapterText } from "../../hooks/useChapterLines";
import { Translate } from "../../i18n";
import { StoredChapter, StorySummary } from "../../types";
import { COLUMNS, SheetRow, chapterRows, libraryRows, messageRows, storyRows } from "./sheetRows";
import { SheetRef } from "./workbook";

export interface SheetView {
  columns: readonly string[];
  rows: SheetRow[];
  // Items on the paged sheets (stories, chapters); 0 on a chapter sheet.
  total: number;
  // The data rows are drawn (not a loading row), so a remembered scroll can be restored.
  ready: boolean;
  wrap: boolean;
  // The header row stays in view (the list sheets).
  freeze: boolean;
  fillerRows: number;
}

export interface SheetData {
  stories: { list: StorySummary[]; loading: boolean; error: string | null };
  // The active story's chapters, sorted; null until loaded.
  chapters: { list: StoredChapter[] | null; loading: boolean; error: string | null };
  text: { value: ChapterText | null; loading: boolean; error: string | null };
  live: Record<string, LiveCrawl | undefined>;
  liveStates?: Record<string, ChapterLiveState>;
  words: Record<number, number>;
  neutral: boolean;
  page: number;
}

export function buildSheet(ref: SheetRef, data: SheetData, t: Translate): SheetView {
  if (ref.kind === "library") {
    const { list, loading, error } = data.stories;
    const header = libraryRows([], {}, false, 0);
    const base = { columns: COLUMNS.library, wrap: false, freeze: true, fillerRows: 40 };
    if (list.length === 0) {
      const message = loading
        ? messageRows(t("Loading…"), "", "dim")
        : error
          ? messageRows(t("Could not load story list"), error, "negative")
          : messageRows(t("Library is empty"), t("Press F1 and choose “Open in the normal view” to add data."), "dim");
      return { ...base, rows: [...header, ...message], total: 0, ready: !loading };
    }
    return { ...base, rows: libraryRows(list, data.live, data.neutral, data.page), total: list.length, ready: true };
  }

  if (ref.kind === "story") {
    const { list, loading, error } = data.chapters;
    const header = storyRows([], 0, false, {});
    const base = { columns: COLUMNS.story, wrap: false, freeze: true };
    if (!list || list.length === 0) {
      const message =
        !list && error
          ? messageRows(t("Could not load story"), error, "negative")
          : !list || loading
            ? messageRows(t("Loading…"), "", "dim")
            : messageRows(t("This sheet is empty."), "", "dim");
      return { ...base, rows: [...header, ...message], total: 0, ready: !!list, fillerRows: 40 };
    }
    return {
      ...base,
      rows: storyRows(list, data.page, data.neutral, data.words, data.liveStates),
      total: list.length,
      ready: true,
      fillerRows: 12,
    };
  }

  const { value, loading, error } = data.text;
  const header = chapterRows([]);
  const base = { columns: COLUMNS.chapter, wrap: true, freeze: false, total: 0 };
  if (!value || value.lines.length === 0) {
    const message = error
      ? messageRows(t("Could not load chapter content"), error, "negative")
      : loading || !value
        ? messageRows(t("Loading chapter content…"), "", "dim")
        : messageRows(t("This sheet has no data."), "", "dim");
    return { ...base, rows: [...header, ...message], ready: !!value || !!error, fillerRows: 30 };
  }
  return { ...base, rows: chapterRows(value.lines), ready: true, fillerRows: 16 };
}
