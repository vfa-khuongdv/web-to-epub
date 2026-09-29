import { ExtractedChapter } from "../../types";
import type { EpubMediaStore } from "../epubMedia";

// Extra context a site fetcher may need beyond the chapter URL: the story's id and the
// library's media store, for sites whose content has to be stored as images (Scribd's
// scrambled-font documents are captured page by page).
export interface ChapterFetchContext {
  storyId: string;
  media: EpubMediaStore;
}

export interface ChapterFetcher {
  domains: string[];
  fetchChapter(url: string, context?: ChapterFetchContext): Promise<ExtractedChapter>;
}
