import { CONTENT_ID, HIGHLIGHT_CSS } from "./highlightDom";

// Keep in sync with KINDLE_CSS in src/services/epubBuilder.ts. The preview is only
// honest if it uses the exact stylesheet the exported book carries — epub-gen replaces
// its own template.css with this one, so it is the book's entire styling.
const KINDLE_CSS = `
body { font-family: serif; line-height: 1.5; }
h1, h2, h3 { font-family: sans-serif; }
img, audio, video { display: block; margin: 0.6em auto; max-width: 100%; }
img, video { height: auto; }
`;

export type ReaderTheme = "light" | "sepia" | "dark";

export type ReaderFont = "book" | "georgia" | "palatino" | "system" | "verdana";

export interface ReaderPrefs {
  fontSize: number;
  lineHeight: number;
  theme: ReaderTheme;
  font: ReaderFont;
  // Whether the chapter list stays docked beside the page. Remembered because it is
  // how someone navigates a long story, not a panel they open once.
  toc: boolean;
}

// line-height 1.5 is what KINDLE_CSS sets, so the default preview matches the book
// exactly; changing it is a reading comfort choice that does not affect the export.
export const DEFAULT_PREFS: ReaderPrefs = {
  fontSize: 18,
  lineHeight: 1.5,
  theme: "light",
  font: "book",
  toc: true,
};

// Only families a machine already has: the app reads offline, so a web font would be a
// blank page on a bad day. "book" is the `serif` KINDLE_CSS sets, so the default preview
// still matches the export exactly; the rest are a reading comfort choice, like the
// font button on a Kindle, and are not written into the file.
export const READER_FONTS: { id: ReaderFont; label: string; stack: string }[] = [
  { id: "book", label: "Book serif", stack: "serif" },
  { id: "georgia", label: "Georgia", stack: "Georgia, serif" },
  { id: "palatino", label: "Palatino", stack: '"Palatino Linotype", Palatino, "Book Antiqua", serif' },
  { id: "system", label: "System sans", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { id: "verdana", label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
];

const FONT_STACK = Object.fromEntries(READER_FONTS.map((f) => [f.id, f.stack])) as Record<
  ReaderFont,
  string
>;

export const FONT_SIZE_RANGE = { min: 14, max: 28, step: 2 };
export const LINE_HEIGHTS = [1.4, 1.5, 1.8];

const PAGE_THEME: Record<ReaderTheme, { bg: string; fg: string }> = {
  light: { bg: "#ffffff", fg: "#1c1c1c" },
  sepia: { bg: "#f4ecd8", fg: "#3b3226" },
  dark: { bg: "#17191b", fg: "#c9ccd1" },
};

// epub-gen escapes chapter titles with entities.encodeXML before writing the <h1>.
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build the srcdoc for the reader iframe: the book's own stylesheet, then a page frame
 * (column width, margins, reading colours) on top — the frame is the e-reader device,
 * not the book, so it only sets what a reader app would decide anyway.
 *
 * epub-gen prepends `<h1>{title}</h1>` to every chapter (appendChapterTitles defaults to
 * true and buildEpub does not override it), so the preview must do the same.
 */
export function readerDocument(
  title: string,
  contentHtml: string,
  language: string,
  prefs: ReaderPrefs
): string {
  const page = PAGE_THEME[prefs.theme];
  const font = FONT_STACK[prefs.font] ?? FONT_STACK.book;
  return `<!doctype html>
<html lang="${escapeXml(language || "en")}">
<head>
<meta charset="utf-8" />
<!-- Some CDNs (Google Drive) block hotlinked images by Referer, same as the cover thumbnail. -->
<meta name="referrer" content="no-referrer" />
<style>${KINDLE_CSS}</style>
<style>${HIGHLIGHT_CSS}</style>
<style>
html { background: ${page.bg}; }
body {
  max-width: 34em;
  margin: 0 auto;
  padding: 2.4em 1.5em 6em;
  background: ${page.bg};
  color: ${page.fg};
  font-family: ${font};
  font-size: ${prefs.fontSize}px;
  line-height: ${prefs.lineHeight};
}
</style>
</head>
<body>
<h1>${escapeXml(title)}</h1>
<!-- The wrapper is the reader's, not the book's: highlight offsets are measured
     inside it so an edited chapter title cannot shift them. It is a plain block
     element, so it changes nothing about how the chapter renders. -->
<div id="${CONTENT_ID}">
${contentHtml}
</div>
</body>
</html>`;
}

const PREFS_KEY = "reader-prefs";
const PRIVATE_POSITION_PREFIX = "reader-position:private:";

// Reading positions are per-browser, same as public ones, and persist the same way —
// closing or locking private mode does not forget them. Kept under their own prefix so
// a story shared between both libraries (same URL, same id) can't mix up a public and
// a private reading position.
let privateScope = false;

export function setPrivateScope(on: boolean): void {
  privateScope = on;
}

const positionKey = (storyId: string) =>
  privateScope ? `${PRIVATE_POSITION_PREFIX}${storyId}` : `reader-position:${storyId}`;

// localStorage can throw (private window, cookies blocked): reading still works, the
// preference or position just is not remembered — same handling as the theme switch.
export function readPrefs(): ReaderPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "");
    return {
      fontSize: typeof saved.fontSize === "number" ? saved.fontSize : DEFAULT_PREFS.fontSize,
      lineHeight: typeof saved.lineHeight === "number" ? saved.lineHeight : DEFAULT_PREFS.lineHeight,
      theme: saved.theme === "sepia" || saved.theme === "dark" ? saved.theme : DEFAULT_PREFS.theme,
      font: READER_FONTS.some((f) => f.id === saved.font) ? saved.font : DEFAULT_PREFS.font,
      toc: typeof saved.toc === "boolean" ? saved.toc : DEFAULT_PREFS.toc,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: ReaderPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* Not remembered next time, reading is unaffected */
  }
}

export interface ReadingPosition {
  order: number;
  scroll: number;
}

export function readPosition(storyId: string): ReadingPosition | null {
  try {
    const saved = JSON.parse(localStorage.getItem(positionKey(storyId)) || "");
    if (typeof saved.order !== "number") return null;
    return { order: saved.order, scroll: typeof saved.scroll === "number" ? saved.scroll : 0 };
  } catch {
    return null;
  }
}

export function savePosition(storyId: string, position: ReadingPosition): void {
  try {
    localStorage.setItem(positionKey(storyId), JSON.stringify(position));
  } catch {
    /* Not remembered next time, reading is unaffected */
  }
}
