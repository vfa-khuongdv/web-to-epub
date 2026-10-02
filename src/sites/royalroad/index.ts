import { createAiTocAdapter, fetchChapterWithAi } from "../../services/ai/aiLocate";
import type { SiteModule } from "../types";

const DOMAINS = ["royalroad.com"];

// No hand-written adapter: the AI crawler reads it (tested on a 100+ chapter story), so it
// needs an AI provider configured in Settings → AI crawler.
export const royalroad: SiteModule = {
  id: "royalroad",
  supported: [{ domain: "royalroad.com", name: "Royal Road" }],
  toc: { ...createAiTocAdapter(), domains: DOMAINS },
  chapter: { domains: DOMAINS, fetchChapter: fetchChapterWithAi },
};
