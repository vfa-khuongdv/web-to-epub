import type { SiteModule } from "../types";
import { fetchScribdChapter } from "./chapter";
import { SCRIBD_DOMAINS, scribdAdapter } from "./toc";

// The viewer page lists every page's payload URL; a document the account cannot view
// fully is refused instead of partially imported (toc.ts). Documents that only load for
// a logged-in account use an imported browser session.
export const scribd: SiteModule = {
  id: "scribd",
  supported: [{ domain: "scribd.com", name: "Scribd" }], // document pages; pages the account cannot view are refused
  toc: scribdAdapter,
  chapter: { domains: SCRIBD_DOMAINS, fetchChapter: fetchScribdChapter },
  session: { slug: "scribd", domain: "scribd.com" },
};
