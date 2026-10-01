import type { SiteModule } from "../types";
import { fetchFanfictionChapter } from "./chapter";
import { FANFICTION_DOMAINS, fanfictionAdapter } from "./toc";

// Cloudflare-protected like Asianfanfics (rendered through a real browser), but its
// M-rated stories are publicly readable: no login.
export const fanfiction: SiteModule = {
  id: "fanfiction",
  supported: [{ domain: "fanfiction.net", name: "FanFiction.net" }], // English site
  toc: fanfictionAdapter,
  chapter: { domains: FANFICTION_DOMAINS, fetchChapter: fetchFanfictionChapter },
};
