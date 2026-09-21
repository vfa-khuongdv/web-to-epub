import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { ContentBlock, ExtractedChapter } from "../types";
import { mediaSrc } from "./chapterHtml";
import { t } from "./lang";

// Matches whole class/id tokens for common chrome (nav/ads/sidebar/etc), not
// substrings — a class like "gradient" or "loading" must NOT match "ad".
const CHROME_TOKEN_RE =
  /^(ads?|advert(isement)?s?|banner|sidebar|nav(bar)?|footer|header|comments?|share|social|related|promo|popup|modal|subscribe|newsletter)$/i;

// Some web-novel sites gate a chapter behind an anti-adblock notice instead of
// returning an error — the page loads fine but the "content" is just this message.
// Left undetected, it would silently become a nonsense 1-paragraph "chapter" in the
// exported book instead of a visible failure the user can retry or skip.
// This one matches text on the crawled page, not text this app writes, so it stays in
// the language the supported sites publish in — translating it turns the check off.
const LOCKED_CONTENT_RE = /nội dung (chương|chapter).{0,20}(đang bị khóa|bị khóa)|vui lòng (tắt|mở lại).{0,30}quảng cáo/i;

// Thrown when a chapter is locked behind an ad interaction. Retrying can't
// unlock it, so callers must not spend their retry budget on it.
export class LockedContentError extends Error {}

function stripChrome(document: Document): void {
  document.querySelectorAll("script, style, noscript, iframe, nav, header, footer, aside").forEach((el) => el.remove());

  document.querySelectorAll<HTMLElement>("[class],[id]").forEach((el) => {
    const tokens = [
      ...(el.className && typeof el.className === "string" ? el.className.split(/\s+/) : []),
      el.id || "",
    ].filter(Boolean);
    if (tokens.some((t) => CHROME_TOKEN_RE.test(t))) {
      el.remove();
    }
  });
}

export function walkToBlocks(root: Element, blocks: ContentBlock[]): void {
  for (const node of Array.from(root.children)) {
    const tag = node.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      const text = node.textContent?.trim();
      if (text) blocks.push({ type: "heading", level: Number(tag[1]), text });
      continue;
    }

    if (tag === "p" || tag === "blockquote") {
      const html = (node as HTMLElement).innerHTML.trim();
      if (node.textContent?.trim()) blocks.push({ type: "paragraph", text: html });
      continue;
    }

    if (tag === "img") {
      const img = node as HTMLImageElement;
      if (img.src) blocks.push({ type: "image", src: img.src, alt: img.alt || "" });
      continue;
    }

    // Catch before the recursion below: <video> usually has <source> children so it
    // would be treated as a container and lose content if not caught here.
    if (tag === "audio" || tag === "video") {
      const src = mediaSrc(node);
      if (src) blocks.push({ type: tag, src });
      continue;
    }

    if (tag === "figure") {
      const media = node.querySelector("audio, video");
      if (media) {
        const src = mediaSrc(media);
        if (src) blocks.push({ type: media.tagName.toLowerCase() as "audio" | "video", src });
      }
      const img = node.querySelector("img");
      if (img && (img as HTMLImageElement).src) {
        blocks.push({ type: "image", src: (img as HTMLImageElement).src, alt: (img as HTMLImageElement).alt || "" });
      }
      const caption = node.querySelector("figcaption");
      if (caption?.textContent?.trim()) {
        blocks.push({ type: "paragraph", text: caption.innerHTML.trim() });
      }
      continue;
    }

    // Container elements (div/section/ul/li/etc.): recurse to find nested
    // headings/paragraphs/images instead of dropping their content.
    if (node.children.length > 0) {
      walkToBlocks(node, blocks);
      continue;
    }

    const text = node.textContent?.trim();
    if (text) blocks.push({ type: "paragraph", text: (node as HTMLElement).innerHTML.trim() });
  }
}

/**
 * Extracts the main-content structure from already-rendered page HTML.
 * Uses Readability to strip navigation/ads/sidebars/footers, then walks the
 * remaining DOM into typed blocks (heading/paragraph/image) for preview and
 * editing. Operates purely on the DOM tree, unaffected by any CSS/JS the
 * source page uses to block manual copy/selection.
 */
export function extractChapter(url: string, renderedHtml: string): ExtractedChapter {
  const dom = new JSDOM(renderedHtml, { url });
  // Capture the raw <title> before Readability runs — parse() heavily mutates/strips
  // the document and can leave document.title empty.
  const rawTitle = dom.window.document.title?.trim();
  // Full chapter titles on some sites sit outside Readability's kept region:
  // for example, they use "Volume 1 Chapter 2: Opening" in an <h2> right above
  // the content, while <title> only has "Story Name - Volume 1 Chapter 2 - Site".
  const pageHeading = dom.window.document
    .querySelector(".main-col > h2, .chapter-title")
    ?.textContent?.replace(/\s+/g, " ")
    .trim();

  // truyenfull.live ships the full chapter text inside #chapter-c but hides
  // it behind an "click an ad to unlock" overlay (the text itself is already
  // in the served HTML, only CSS-hidden). Drop the overlay and unhide the
  // container so the normal extraction path can read the served text — no ad
  // is clicked or loaded.
  dom.window.document
    .querySelectorAll(".ads-unlock-container, .ads-unlock-reminder")
    .forEach((el) => el.remove());

  dom.window.document.querySelectorAll<HTMLElement>("#chapter-c").forEach((el) => {
    el.style.display = "block";
  });

  stripChrome(dom.window.document);

  const reader = new Readability(dom.window.document, { keepClasses: false });
  // jsdom keeps the entire DOM tree until garbage collection runs. Each chapter creates
  // two windows (original page + Readability content) and each retry adds another pair.
  // Readability returns HTML as a string, so we won't touch `dom` after this — close
  // immediately even if parse throws.
  let article: ReturnType<Readability["parse"]>;
  try {
    article = reader.parse();
  } finally {
    dom.window.close();
  }

  if (!article || !article.content) {
    throw new Error(t("Could not extract main content from {url}", { url }));
  }

  const contentDom = new JSDOM(article.content, { url });
  const blocks: ContentBlock[] = [];
  try {
    // Blocks only hold strings, no nodes — can close immediately after walking.
    walkToBlocks(contentDom.window.document.body, blocks);
  } finally {
    contentDom.window.close();
  }

  const bodyText = blocks.map((b) => b.text || "").join(" ");
  if (LOCKED_CONTENT_RE.test(bodyText)) {
    throw new LockedContentError(
      t("Chapter is locked behind an ad blocker notice (requires disabling/enabling ads), cannot extract: {url}", {
        url,
      })
    );
  }

  // Readability's title heuristic often grabs the page's single <h1>, which on chapter
  // sites is the story name (identical on every chapter), not the chapter title.
  // Prefer, in order:
  //  1. Site-specific chapter title tag (targeted selector, most reliable,
  //     and full form: "Chapter 1: Volume 1: Start of Year").
  //  2. A heading found at the very start of the extracted content.
  //  3. The raw <title> tag — usually encodes "Story - Chapter - Site",
  //     which at least differs per page even if Readability's guess doesn't.
  //  4. Readability's own title guess, as a last resort.
  // Leading heading is always removed from content whether or not it becomes the title:
  // it's either the chapter name repeated, or site chrome (e.g., "SITE ANDROID APP!")
  // inserted at the start.
  const leadingHeadingIndex = blocks.findIndex((b, i) => i < 3 && b.type === "heading");
  const leadingHeading = leadingHeadingIndex >= 0 ? (blocks[leadingHeadingIndex].text as string) : undefined;
  if (leadingHeadingIndex >= 0) blocks.splice(leadingHeadingIndex, 1);

  const title = pageHeading || leadingHeading || rawTitle || article.title?.trim() || "Untitled";

  return {
    sourceUrl: url,
    title,
    blocks,
  };
}
