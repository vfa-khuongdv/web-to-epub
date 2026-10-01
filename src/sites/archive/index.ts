import type { SiteModule } from "../types";

// Import-only (POST /stories/import-archive, services/archiveImport.ts): not in the crawl
// allowlist. The session is the login that lets the loans API act on the reader's behalf
// for borrow-only items.
export const archive: SiteModule = {
  id: "archive",
  imports: [{ domain: "archive.org", name: "Internet Archive" }],
  session: { slug: "archive", domain: "archive.org" },
};
