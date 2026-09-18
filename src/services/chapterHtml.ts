import { JSDOM } from "jsdom";
import { ContentBlock } from "../types";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

// Thẻ mở một khối mới. Mọi thẻ khác (b, i, em, strong, a, span, code, br…) là
// inline và được giữ nguyên bên trong đoạn văn.
const BLOCK_RE =
  /^(address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|img|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)$/;

// Rác không bao giờ nên đi vào sách, kể cả khi người dùng dán nguyên một khối
// HTML copy từ trang nguồn.
const DROP_RE = /^(script|style|noscript|iframe|object|embed|link|meta)$/;

const HEADING_RE = /^h([1-6])$/;

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Đoạn chỉ còn thẻ rỗng hoặc khoảng trắng (`&nbsp;` rất hay gặp khi dán từ
// trình duyệt) thì không đáng thành một đoạn văn.
function hasText(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim().length > 0;
}

// Khung soạn thảo dùng <br> cho mỗi lần xuống dòng mềm; tách ra thành từng đoạn
// để EPUB không dồn cả chương thành một khối chữ.
function pushParagraphs(html: string, blocks: ContentBlock[]): void {
  for (const part of html.split(/<br\s*\/?>/i)) {
    const text = part.trim();
    if (hasText(text)) blocks.push({ type: "paragraph", text });
  }
}

function isBlock(el: Element): boolean {
  return BLOCK_RE.test(el.tagName.toLowerCase());
}

function walk(root: ParentNode, blocks: ContentBlock[]): void {
  let inline: string[] = [];

  function flush(): void {
    const html = inline.join("").trim();
    inline = [];
    if (html) pushParagraphs(html, blocks);
  }

  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === TEXT_NODE) {
      inline.push(escapeText(node.textContent ?? ""));
      continue;
    }
    if (node.nodeType !== ELEMENT_NODE) continue;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP_RE.test(tag)) continue;

    if (!isBlock(el)) {
      inline.push(el.outerHTML);
      continue;
    }

    // Sang khối mới: chốt đoạn inline đang gom dở trước đã, nếu không chữ nằm
    // ngay trước một <p> sẽ bị nuốt mất.
    flush();

    const heading = HEADING_RE.exec(tag);
    if (heading) {
      const text = el.textContent?.trim();
      if (text) blocks.push({ type: "heading", level: Number(heading[1]), text });
      continue;
    }

    if (tag === "img") {
      // getAttribute thay vì .src: giữ nguyên URL người dùng thấy, không để
      // jsdom nối thêm base URL của fragment.
      const src = el.getAttribute("src")?.trim();
      if (src) blocks.push({ type: "image", src, alt: el.getAttribute("alt") || "" });
      continue;
    }

    // Khối lồng khối (div bọc p, figure bọc img…): đi tiếp vào trong thay vì
    // gộp cả cụm thành một đoạn.
    if (Array.from(el.children).some(isBlock)) {
      walk(el, blocks);
      continue;
    }

    pushParagraphs(el.innerHTML, blocks);
  }

  flush();
}

/**
 * Chuyển HTML người dùng vừa sửa trong khung soạn thảo về đúng dạng block đang
 * lưu trong DB. Giữ định dạng inline (b/i/a…) vì `text` của block vốn chứa HTML,
 * bỏ thẻ rác và đoạn rỗng.
 */
export function htmlToBlocks(html: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  walk(JSDOM.fragment(html), blocks);
  return blocks;
}

/**
 * Chiều ngược lại: dựng HTML chương từ block đã lưu. Giữ đúng cách frontend
 * dựng (frontend/src/blocksToHtml.ts) để EPUB xuất từ server giống hệt bản
 * xuất từ nội dung đang mở trên giao diện.
 */
export function blocksToHtml(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "heading") return `<h${block.level || 2}>${block.text}</h${block.level || 2}>`;
      if (block.type === "image") return `<img src="${block.src}" alt="${block.alt || ""}" />`;
      return `<p>${block.text}</p>`;
    })
    .join("\n");
}
