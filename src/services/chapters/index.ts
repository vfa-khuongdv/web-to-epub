import { ChapterFetcher } from "./types";
import { fetchWattpadChapter, WATTPAD_DOMAINS } from "./wattpad";

const FETCHERS: ChapterFetcher[] = [{ domains: WATTPAD_DOMAINS, fetchChapter: fetchWattpadChapter }];

export function getChapterFetcher(url: string): ChapterFetcher | undefined {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
  return FETCHERS.find((fetcher) => fetcher.domains.includes(hostname));
}
