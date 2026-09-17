export interface SupportedSite {
  domain: string;
  name: string;
}

// Curated allowlist of Vietnamese web-novel sites this tool is meant to
// support. Only xtruyen.vn has actually been exercised against this
// extractor so far — the rest are well-known sites of the same kind,
// added on request; verify extraction quality before relying on them.
export const SUPPORTED_SITES: SupportedSite[] = [
  { domain: "xtruyen.vn", name: "XTruyện" },
  { domain: "truyenfull.vn", name: "TruyenFull" },
  { domain: "truyenfull.live", name: "TruyenFull" }, // truyenfull.vn's current mirror domain
  { domain: "metruyenchu.com", name: "Mê Truyện Chữ" },
  { domain: "truyencom.com", name: "Đọc Truyện" }, // dtruyen.com's current domain
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
