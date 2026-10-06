import { createAgentTocAdapter, fetchChapterWithAgent } from "../../services/agent/agentCrawler";
import type { SiteModule } from "../types";

const DOMAINS = ["docln.net"];

// No hand-written adapter: the AI crawler reads it, so it
// needs an AI provider configured in Settings → AI crawler.
export const docln: SiteModule = {
  id: "docln",
  supported: [{ domain: "docln.net", name: "Hako (docln)" }],
  toc: { ...createAgentTocAdapter(), domains: DOMAINS },
  chapter: { domains: DOMAINS, fetchChapter: fetchChapterWithAgent },
};
