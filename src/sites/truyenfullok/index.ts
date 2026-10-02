import { createAiTocAdapter, fetchChapterWithAi } from "../../services/ai/aiLocate";
import type { SiteModule } from "../types";

const DOMAINS = ["truyenfullok.com"];

// No hand-written adapter: the AI crawler reads it, so it
// needs an AI provider configured in Settings → AI crawler.
export const truyenfullok: SiteModule = {
  id: "truyenfullok",
  supported: [{ domain: "truyenfullok.com", name: "Truyện Full OK" }],
  toc: { ...createAiTocAdapter(), domains: DOMAINS },
  chapter: { domains: DOMAINS, fetchChapter: fetchChapterWithAi },
};
