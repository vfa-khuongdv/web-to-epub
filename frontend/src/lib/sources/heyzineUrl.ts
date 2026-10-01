// Heyzine flipbook import: the add box recognises a flipbook page so it can import the PDF
// the viewer renders instead of asking for a chapter list (a flipbook has none). The server
// re-checks the host — this is UX only.
export function isHeyzineUrl(url: string): boolean {
  return heyzineId(url) !== undefined;
}

// Flipbooks are /flip-book/<id>.html; the id is the only identity the site gives.
export function heyzineId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.hostname.toLowerCase().replace(/^www\./, "") !== "heyzine.com") return undefined;
  return /^\/flip-book\/([a-z0-9-]+)\.html?$/i.exec(parsed.pathname)?.[1];
}
