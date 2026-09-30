import { IMPORT_SOURCES as SITE_IMPORT_SOURCES, SUPPORTED_SITES as SITE_SUPPORTED_SITES } from "../sites";
import type { SupportedSite } from "../sites/types";

export type { SupportedSite };

// The crawl allowlist: every site that declares `supported` rows in src/sites/<id>/. Only
// xtruyen.vn has been exercised end-to-end against the shared extractor; the others are
// well-known sites of the same kind, added on request, and most have their own TOC adapter
// and chapter fetcher — how each works (sessions, Cloudflare, members-only refusals) is
// written in that site's index.ts. Adding a site: src/sites/README.md.
export const SUPPORTED_SITES: SupportedSite[] = SITE_SUPPORTED_SITES;

export function findSupportedSite(url: string): SupportedSite | undefined {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
  return SUPPORTED_SITES.find((site) => hostname === site.domain || hostname.endsWith(`.${site.domain}`));
}

// Sources that host a whole book file instead of chapter pages: a URL from one of these is
// imported (its book file is read directly), never crawled. Deliberately kept OUT of
// SUPPORTED_SITES, which is the crawl allowlist findSupportedSite trusts — putting them
// there would make POST /stories accept a URL it cannot crawl. The add box still lists
// them as supported, under a separate heading, because a reader can paste one.
// archive.org: POST /stories/import-archive. dtv-ebook.com.vn: POST /stories/import-dtvebook.
export const IMPORT_SOURCES: SupportedSite[] = SITE_IMPORT_SOURCES;
