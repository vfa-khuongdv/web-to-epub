// Disguise skins: the whole app drawn as another program (a code editor, a spreadsheet)
// so a story can be read at a desk without looking like one. "default" is the app as it
// always was. Kept per browser in localStorage, like the theme.
export type SkinId = "default" | "code" | "sheet";

export const SKIN_IDS: SkinId[] = ["default", "code", "sheet"];

const SKIN_KEY = "skin";
// What the tab showed last time (title + favicon), so index.html can put it back before
// the first paint instead of flashing the app's real name. Written by the stealth layer.
export const HEAD_CACHE_KEY = "skin-head";

export function isSkinId(value: unknown): value is SkinId {
  return typeof value === "string" && (SKIN_IDS as string[]).includes(value);
}

// localStorage can throw (private window, blocked storage): the skin still switches, it
// just is not remembered — same handling as the theme.
export function readSkin(): SkinId {
  try {
    const saved = localStorage.getItem(SKIN_KEY);
    return isSkinId(saved) ? saved : "default";
  } catch {
    return "default";
  }
}

export function saveSkin(skin: SkinId): void {
  try {
    if (skin === "default") localStorage.removeItem(SKIN_KEY);
    else localStorage.setItem(SKIN_KEY, skin);
  } catch {
    /* Not remembered next time */
  }
}

export function applySkin(skin: SkinId): void {
  document.documentElement.dataset.skin = skin;
}

export interface DocumentHead {
  title: string;
  // A data: URI (see faviconDataUri) or a path such as /favicon.svg.
  favicon: string;
}

export function readHeadCache(): DocumentHead | null {
  try {
    const raw = localStorage.getItem(HEAD_CACHE_KEY);
    const head = raw ? (JSON.parse(raw) as Partial<DocumentHead>) : null;
    return head && typeof head.title === "string" && typeof head.favicon === "string"
      ? { title: head.title, favicon: head.favicon }
      : null;
  } catch {
    return null;
  }
}

export function writeHeadCache(head: DocumentHead | null): void {
  try {
    if (head) localStorage.setItem(HEAD_CACHE_KEY, JSON.stringify(head));
    else localStorage.removeItem(HEAD_CACHE_KEY);
  } catch {
    /* The tab shows the real name for a moment on the next load, nothing worse */
  }
}

// A favicon drawn from a glyph on a coloured square: generic enough to sit among other
// tabs, and never another product's logo (those are trademarks).
export function faviconDataUri(glyph: string, background: string, foreground = "#ffffff"): string {
  const escaped = glyph.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const size = glyph.length > 1 ? 13 : 20;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="5" fill="${background}"/>` +
    `<text x="16" y="17" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" font-weight="700" ` +
    `fill="${foreground}" text-anchor="middle" dominant-baseline="central">${escaped}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// The page's own head, as index.html ships it: what is put back when no skin is on.
export const REAL_HEAD: DocumentHead = { title: "Web → EPUB cho Kindle", favicon: "/favicon.svg" };

export function applyHead(head: DocumentHead): void {
  if (document.title !== head.title) document.title = head.title;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  if (link.getAttribute("href") !== head.favicon) {
    link.type = head.favicon.startsWith("data:image/svg") || head.favicon.endsWith(".svg") ? "image/svg+xml" : "";
    link.setAttribute("href", head.favicon);
  }
}
