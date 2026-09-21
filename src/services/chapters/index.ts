import { ChapterFetcher } from "./types";
import { ASIANFANFICS_DOMAINS, fetchAsianfanficsChapter } from "./asianfanfics";
import { fetchTruyenfullChapter, TRUYENFULL_DOMAINS } from "./truyenfull";
import { fetchWattpadChapter, WATTPAD_DOMAINS } from "./wattpad";

const FETCHERS: ChapterFetcher[] = [
  { domains: WATTPAD_DOMAINS, fetchChapter: fetchWattpadChapter },
  { domains: TRUYENFULL_DOMAINS, fetchChapter: fetchTruyenfullChapter },
  { domains: ASIANFANFICS_DOMAINS, fetchChapter: fetchAsianfanficsChapter },
];

export function getChapterFetcher(url: string): ChapterFetcher | undefined {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
  return FETCHERS.find((fetcher) => fetcher.domains.includes(hostname));
}
