import type { SiteModule } from "../types";

// Import-only (POST /stories/import-heyzine, services/heyzineImport.ts): a flipbook is a
// hosted PDF with one page-flip viewer, so there is nothing to crawl.
export const heyzine: SiteModule = {
  id: "heyzine",
  imports: [{ domain: "heyzine.com", name: "Heyzine" }],
};
