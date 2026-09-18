import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { ContentBlock, ExtractedChapter } from "../types";
import { mediaSrc } from "./chapterHtml";

// Matches whole class/id tokens for common chrome (nav/ads/sidebar/etc), not
// substrings — a class like "gradient" or "loading" must NOT match "ad".
const CHROME_TOKEN_RE =
  /^(ads?|advert(isement)?s?|banner|sidebar|nav(bar)?|footer|header|comments?|share|social|related|promo|popup|modal|subscribe|newsletter)$/i;

// Some Vietnamese web-novel sites gate a chapter behind an anti-adblock
// notice instead of returning an error — the page loads fine but the
// "content" is just this message. Left undetected, it would silently become
// a nonsense 1-paragraph "chapter" in the exported book instead of a visible
// failure the user can retry or skip.
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

function walkToBlocks(root: Element, blocks: ContentBlock[]): void {
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

    // Trước nhánh đệ quy bên dưới: <video> thường có <source> con nên sẽ bị
    // coi là container và mất nội dung nếu không bắt ở đây.
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
  // Capture the raw <title> before Readability runs — parse() heavily
  // mutates/strips the document and can leave document.title empty.
  const rawTitle = dom.window.document.title?.trim();
  // Tên chương đầy đủ của một số site nằm ngoài phần Readability giữ lại:
  // xtruyen để "Quyển 1 Chương 2 : Mở cửa" ở <h2> ngay trên khối nội dung,
  // còn <title> chỉ có "<tên truyện> - Quyển 1 Chương 2 - XTruyện".
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
  const article = reader.parse();

  if (!article || !article.content) {
    throw new Error(`Không trích xuất được nội dung chính từ ${url}`);
  }

  const contentDom = new JSDOM(article.content, { url });
  const blocks: ContentBlock[] = [];
  walkToBlocks(contentDom.window.document.body, blocks);

  const bodyText = blocks.map((b) => b.text || "").join(" ");
  if (LOCKED_CONTENT_RE.test(bodyText)) {
    throw new LockedContentError(
      `Chương này đang bị website khóa nội dung (yêu cầu tắt/mở lại quảng cáo), không thể trích xuất: ${url}`
    );
  }

  // Readability's title heuristic often grabs the page's single <h1>, which
  // on chapter/serial sites is the story name (identical on every chapter),
  // not the chapter title. Prefer, in order:
  //  1. Thẻ tiêu đề chương của chính site (selector nhắm đích, đáng tin nhất
  //     và là bản đầy đủ: "Chương 1: Quyển 1: Năm bắt đầu ấy").
  //  2. A heading found at the very start of the extracted content.
  //  3. The raw <title> tag — usually encodes "Story - Chapter - Site",
  //     which at least differs per page even if Readability's h1-based
  //     guess collapses to the story name.
  //  4. Readability's own title guess, as a last resort.
  // Heading mở đầu luôn bị lấy ra khỏi nội dung dù có được chọn làm tiêu đề
  // hay không: nó hoặc là tên chương lặp lại, hoặc là khối chrome của site
  // (xtruyen chèn banner "X-TRUYỆN ANDROID APP !" ngay đầu bài).
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
