import { ContentBlock } from "../../types";

// A chapter as the disguise skins draw it: one line per paragraph — an editor line in the
// code skin, a row in the spreadsheet. Long lines wrap on screen; they are never split,
// so a line number always points at a whole paragraph.
export interface ChapterLine {
  kind: "heading" | "text" | "media";
  text: string;
}

// Block text can carry inline HTML (<em>, <br>, entities). Parsed by DOMParser into an
// inert document — scripts never run and nothing is fetched — and only its text is kept;
// the skins render that text as text, never as HTML.
export function plainText(html: string): string {
  if (!/[<&]/.test(html)) return collapse(html);
  if (typeof DOMParser === "undefined") return collapse(html.replace(/<[^>]*>/g, " "));
  const doc = new DOMParser().parseFromString(`<body>${html.replace(/<br\s*\/?>/gi, " ")}</body>`, "text/html");
  return collapse(doc.body.textContent ?? "");
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Pictures, audio and video become a placeholder line with no address: loading them
// here would show a comic page in the middle of a "source file", and a request to a
// story site's CDN is exactly the trace a disguise should not leave.
const LINE_BREAKS = /(?:<br\s*\/?>\s*)+/i;

export function chapterLines(blocks: ContentBlock[]): ChapterLine[] {
  const lines: ChapterLine[] = [];
  for (const block of blocks) {
    if (block.type === "heading") {
      const text = plainText(block.text ?? "");
      if (text) lines.push({ kind: "heading", text });
    } else if (block.type === "paragraph") {
      // Some sites send a whole chapter as one block whose paragraphs are <br> runs; the
      // reader shows them as breaks, so each becomes its own line here.
      for (const part of (block.text ?? "").split(LINE_BREAKS)) {
        const text = plainText(part);
        if (text) lines.push({ kind: "text", text });
      }
    } else {
      const alt = block.alt ? plainText(block.alt) : "";
      lines.push({ kind: "media", text: alt ? `[${block.type}: ${alt}]` : `[${block.type}]` });
    }
  }
  return lines;
}

// With neutral names on, a chapter's own title must not show either: most chapters open
// with it as a heading ("Chương 1: Trở về"), so a leading heading is left out.
export function withoutTitleHeading(lines: ChapterLine[]): ChapterLine[] {
  return lines[0]?.kind === "heading" ? lines.slice(1) : lines;
}

// Words, for the status bars that show a count beside the cursor.
export function wordCount(lines: ChapterLine[]): number {
  let count = 0;
  for (const line of lines) if (line.kind !== "media") count += line.text.split(/\s+/).filter(Boolean).length;
  return count;
}
