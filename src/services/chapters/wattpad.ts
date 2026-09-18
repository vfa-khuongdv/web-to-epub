import { JSDOM } from "jsdom";
import { ContentBlock, ExtractedChapter } from "../../types";
import { LockedContentError } from "../extractor";
import { fetchText } from "../toc/http";

export const WATTPAD_DOMAINS = ["wattpad.com"];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// Paid chapters (Wattpad Originals / Paid Stories) have no content in the HTML —
// only a paywall block offering purchase with Coins. Detect to report a clear error,
// not hide purchase ads inside the book.
const PAID_RE = /paid stories program|buy this (story )?part|paywall/i;

// Part URLs like https://www.wattpad.com/1537742464-story-name-chapter-name
const PART_ID_RE = /wattpad\.com\/(\d+)/;

function collectBlocks(paragraphs: NodeListOf<Element>): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  paragraphs.forEach((p) => {
    if (!p.textContent?.trim()) {
      // Images embedded in stories appear as text-less paragraphs:
      // <p data-media-type="image"><img src="https://img.wattpad.com/..."></p>
      const img = p.querySelector("img") as HTMLImageElement | null;
      if (img?.src) blocks.push({ type: "image", src: img.src, alt: img.alt || "" });
      return;
    }
    blocks.push({ type: "paragraph", text: (p as HTMLElement).innerHTML.trim() });
  });
  return blocks;
}

/**
 * Extract chapter from Wattpad part page HTML. Wattpad server-renders the full chapter
 * content into a <pre> tag (each paragraph is a <p data-p-id>), so no need for browser
 * rendering. Divs between paragraphs (audio placeholders, ads) are skipped because we
 * only take <p> tags.
 */
export function parseWattpadChapter(html: string, url: string): ExtractedChapter {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  // Part page has exactly one <h1> which is the chapter title; <title> (shape
  // "Story - Chapter - Wattpad") is fallback if <h1> is missing.
  const title =
    doc.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ||
    doc.title.replace(/\s*-\s*Wattpad\s*$/i, "").trim() ||
    url;

  const blocks = collectBlocks(doc.querySelectorAll("pre p"));

  if (blocks.length === 0) {
    if (doc.querySelector(".story-part-paywall") || PAID_RE.test(doc.body?.textContent || "")) {
      throw new LockedContentError(
        `This chapter is part of Wattpad's Paid Stories program and cannot be extracted: ${url}`
      );
    }
    throw new Error(
      `Could not find chapter content at ${url} — the site may have changed structure or the chapter is locked`
    );
  }

  return { sourceUrl: url, title, blocks };
}

/**
 * Long parts are paginated by Wattpad: the HTML returns only the first page in <pre>,
 * the rest (with images in it) only loads via JS when scrolling. The storytext endpoint
 * returns the full part content in one call — the part ID is the number at the start of
 * the URL. Returns an empty array if fetch fails so the caller uses the first page instead
 * of corrupting the entire chapter.
 */
async function fetchFullPartBlocks(url: string): Promise<ContentBlock[]> {
  const partId = url.match(PART_ID_RE)?.[1];
  if (!partId) return [];
  try {
    const fragment = await fetchText(`https://www.wattpad.com/apiv2/storytext?id=${partId}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    const doc = new JSDOM(fragment, { url }).window.document;
    return collectBlocks(doc.querySelectorAll("p"));
  } catch {
    return [];
  }
}

export async function fetchWattpadChapter(url: string): Promise<ExtractedChapter> {
  const html = await fetchText(url, { headers: { "User-Agent": USER_AGENT } });
  // HTML page for title and paywall detection; storytext for full content.
  const chapter = parseWattpadChapter(html, url);
  const full = await fetchFullPartBlocks(url);
  if (full.length > chapter.blocks.length) chapter.blocks = full;
  return chapter;
}
