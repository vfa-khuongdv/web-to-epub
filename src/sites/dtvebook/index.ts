import type { SiteModule } from "../types";

// Import-only (POST /stories/import-dtvebook, services/dtvEbookImport.ts): every book is
// a single EPUB the site hosts, so there is nothing to crawl.
export const dtvebook: SiteModule = {
  id: "dtvebook",
  imports: [{ domain: "dtv-ebook.com.vn", name: "DTV Ebook" }],
};
