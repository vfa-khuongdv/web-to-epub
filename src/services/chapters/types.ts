import { ExtractedChapter } from "../../types";

export interface ChapterFetcher {
  domains: string[];
  fetchChapter(url: string): Promise<ExtractedChapter>;
}
