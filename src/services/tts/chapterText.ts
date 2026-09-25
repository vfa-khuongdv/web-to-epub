import { JSDOM } from "jsdom";
import { ContentBlock } from "../../types";

// VieNeu chunks input at 256 characters itself; splitting a little below that on our side
// gives the job a progress tick and a cancel point per part, and keeps a sentence from
// being cut mid-word by the model's own chunker.
export const MAX_PART_CHARS = 250;

// Block text is HTML-safe and may carry inline markup (<b>, <a>, entities), so read it
// through a DOM rather than with a regex.
function plainText(html: string): string {
  return (JSDOM.fragment(`<p>${html}</p>`).textContent ?? "").replace(/\s+/g, " ").trim();
}

// Split at sentence ends; a single sentence longer than the limit is split at the last
// comma or space before it. Never returns an empty part.
export function splitLongText(text: string, maxChars: number = MAX_PART_CHARS): string[] {
  if (text.length <= maxChars) return [text];
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g) ?? [text];
  const parts: string[] = [];
  let current = "";
  const push = (piece: string) => {
    const trimmed = piece.trim();
    if (trimmed) parts.push(trimmed);
  };
  for (const sentence of sentences) {
    if ((current + sentence).trimEnd().length <= maxChars) {
      current += sentence;
      continue;
    }
    push(current);
    current = "";
    let rest = sentence;
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars);
      const cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf(" "));
      const at = cut > 0 ? cut + 1 : maxChars;
      push(rest.slice(0, at));
      rest = rest.slice(at);
    }
    current = rest;
  }
  push(current);
  return parts;
}

/**
 * The text a chapter is narrated from, as the list of parts sent to the model: the
 * chapter title first, then headings and paragraphs in order. Images and media have
 * nothing to read. A heading equal to the title (sites often repeat it) is not read twice.
 */
export function chapterParts(title: string, blocks: ContentBlock[]): string[] {
  const texts: string[] = [];
  const cleanTitle = title.replace(/\s+/g, " ").trim();
  if (cleanTitle) texts.push(cleanTitle);
  for (const block of blocks) {
    if (block.type !== "heading" && block.type !== "paragraph") continue;
    const text = plainText(block.text ?? "");
    if (!text || (block.type === "heading" && text === cleanTitle)) continue;
    texts.push(text);
  }
  return texts.flatMap((text) => splitLongText(text));
}
