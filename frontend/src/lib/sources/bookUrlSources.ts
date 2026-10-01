import { importArchive, importDtvEbook } from "../api";
import { isArchiveItemUrl } from "./archiveUrl";
import { isDtvEbookUrl } from "./dtvEbookUrl";
import type { StoredStory } from "../../types";

/**
 * Sites that host whole books instead of chapter pages: a URL from one is imported, not
 * crawled. The match is on the URL's shape, not just its host — a search page on either
 * site is not a book. The server re-checks the host; this is UX only. Adding a source is
 * one row here plus its API call in lib/api/stories.ts.
 */
export interface BookUrlSource {
  matches(url: string): boolean;
  importBook(url: string, options: { overwrite?: boolean }): Promise<StoredStory>;
}

export const BOOK_URL_SOURCES: BookUrlSource[] = [
  { matches: isArchiveItemUrl, importBook: importArchive },
  { matches: isDtvEbookUrl, importBook: importDtvEbook },
];

export function bookUrlSourceFor(url: string): BookUrlSource | undefined {
  return BOOK_URL_SOURCES.find((source) => source.matches(url));
}
