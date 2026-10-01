import { Translate } from "../../i18n";
import { ExtractedChapter, StoredChapter } from "../../types";

export interface ChapterState {
  id: string;
  order: number;
  data: ExtractedChapter;
  title: string;
  retrying: boolean;
  version: number;
  retriedOnce: boolean;
  spellChecked: boolean;
}

export function toChapterState(chapter: StoredChapter, version: number, t: Translate): ChapterState {
  const data: ExtractedChapter =
    chapter.status === "error"
      ? {
          sourceUrl: chapter.url,
          title: chapter.title,
          blocks: [],
          error: chapter.error || t("Unknown error"),
          errorKind: chapter.errorKind,
        }
      : { sourceUrl: chapter.url, title: chapter.title, blocks: chapter.blocks ?? [] };
  return {
    id: `stored-${chapter.order}`,
    order: chapter.order,
    data,
    title: chapter.title,
    retrying: false,
    version,
    retriedOnce: chapter.status === "error",
    spellChecked: !!chapter.spellChecked,
  };
}
