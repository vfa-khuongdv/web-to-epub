export interface SupportedSite {
  domain: string;
  name: string;
}

// Curated allowlist of web-novel sites this tool is meant to support. Only
// xtruyen.vn has been exercised end-to-end against this extractor so far —
// the rest are well-known sites of the same kind, added on request; verify
// extraction quality before relying on them. Wattpad has its own chapter
// fetcher (services/chapters/) instead of the shared renderer/extractor.
export const SUPPORTED_SITES: SupportedSite[] = [
  { domain: "xtruyen.vn", name: "XTruyện" },
  { domain: "truyenfull.vn", name: "TruyenFull" },
  { domain: "truyenfull.live", name: "TruyenFull" }, // truyenfull.vn's current mirror domain
  { domain: "truyencom.com", name: "Đọc Truyện" }, // dtruyen.com's current domain
  { domain: "truyenhoan.com", name: "Truyện Hoàn" }, // truyenfull-template theme
  { domain: "wattpad.com", name: "Wattpad" }, // English site; paid chapters (Paid Stories) not supported
];

export function findSupportedSite(url: string): SupportedSite | undefined {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
  return SUPPORTED_SITES.find((site) => hostname === site.domain || hostname.endsWith(`.${site.domain}`));
}
