import type { SiteModule } from "../types";
import { fetchAsianfanficsChapter } from "./chapter";
import { ASIANFANFICS_DOMAINS, asianfanficsAdapter } from "./toc";

// Cloudflare-protected, so its adapter/fetcher render through a real browser. Rated-M /
// subscribers-only stories need a logged-in account with mature content enabled: the
// reader imports a browser session (the token lives about an hour).
export const asianfanfics: SiteModule = {
  id: "asianfanfics",
  supported: [{ domain: "asianfanfics.com", name: "Asianfanfics" }], // English site
  toc: asianfanficsAdapter,
  chapter: { domains: ASIANFANFICS_DOMAINS, fetchChapter: fetchAsianfanficsChapter },
  session: { slug: "asianfanfics", domain: "asianfanfics.com" },
};
