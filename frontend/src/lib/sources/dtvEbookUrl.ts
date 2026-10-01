// DTV Ebook book import: the add box recognises a book page so it can import the EPUB the
// site hosts instead of asking for a chapter list (the site has none). The server re-checks
// the host — this is UX only.
export function isDtvEbookUrl(url: string): boolean {
  return dtvEbookId(url) !== undefined;
}

// Book pages are /<slug>_<id>.html; the numeric id is the only identity the site gives.
export function dtvEbookId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.hostname.toLowerCase().replace(/^www\./, "") !== "dtv-ebook.com.vn") return undefined;
  return /\/[^/?#]*_(\d+)\.html?$/i.exec(parsed.pathname)?.[1];
}
