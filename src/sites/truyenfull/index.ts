import type { SiteModule } from "../types";
import { fetchTruyenfullChapter } from "./chapter";
import { truyenfullTemplateAdapter } from "./toc";

// truyenfull-template sites share one TOC adapter. truyencom.com has no chapter fetcher
// of its own (its chapters go through the shared renderer + extractor), hence the two
// domain lists. Truyenfull needs an imported browser session for the Cloudflare check on
// its story and chapter pages (services/cloudflare.ts).
export const truyenfull: SiteModule = {
  id: "truyenfull",
  supported: [
    { domain: "truyenfull.vn", name: "TruyenFull" },
    { domain: "truyenfull.live", name: "TruyenFull" }, // truyenfull.vn's current mirror domain
    { domain: "truyencom.com", name: "Đọc Truyện" }, // dtruyen.com's current domain
    { domain: "truyenhoan.com", name: "Truyện Hoàn" }, // truyenfull-template theme
  ],
  toc: truyenfullTemplateAdapter,
  chapter: { domains: ["truyenfull.vn", "truyenfull.live", "truyenhoan.com"], fetchChapter: fetchTruyenfullChapter },
  session: { slug: "truyenfull", domain: "truyenfull.live" },
};
