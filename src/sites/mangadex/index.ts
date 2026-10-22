import type { SiteModule } from "../types";
import { fetchMangadexChapter } from "./chapter";
import { MANGADEX_DOMAINS, mangadexAdapter } from "./toc";

// The site is an SPA; both the chapter list and the pages come from api.mangadex.org. Each
// translation is its own story (`?lang=` in the story URL). Pages are stored while crawling
// because their addresses expire; chapters hosted on MangaPlus are skipped.
export const mangadex: SiteModule = {
  id: "mangadex",
  supported: [{ domain: "mangadex.org", name: "MangaDex" }], // comics; chapters hosted on other sites are skipped
  toc: mangadexAdapter,
  chapter: { domains: MANGADEX_DOMAINS, fetchChapter: fetchMangadexChapter },
};
