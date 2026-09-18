import { JSDOM } from "jsdom";
import { ContentBlock, ExtractedChapter } from "../../types";
import { LockedContentError } from "../extractor";
import { fetchText } from "../toc/http";

export const WATTPAD_DOMAINS = ["wattpad.com"];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// Chương trả phí (Wattpad Originals / Paid Stories) không có nội dung trong
// HTML — chỉ có khối paywall mời mua bằng Coins. Nhận diện để báo lỗi rõ ràng,
// không nhét nội dung quảng cáo mua chương vào sách.
const PAID_RE = /paid stories program|buy this (story )?part|paywall/i;

// URL part dạng https://www.wattpad.com/1537742464-ten-truyen-ten-chuong
const PART_ID_RE = /wattpad\.com\/(\d+)/;

function collectBlocks(paragraphs: NodeListOf<Element>): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  paragraphs.forEach((p) => {
    if (!p.textContent?.trim()) {
      // Ảnh chèn giữa truyện là một đoạn không có chữ:
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
 * Trích xuất chương từ HTML trang part của Wattpad. Wattpad server-render
 * toàn bộ nội dung chương vào một thẻ <pre> (mỗi đoạn là một <p data-p-id>),
 * nên không cần render bằng trình duyệt. Các div chèn giữa các đoạn (audio
 * placeholder, quảng cáo) bị bỏ qua vì chỉ lấy thẻ <p>.
 */
export function parseWattpadChapter(html: string, url: string): ExtractedChapter {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  // Trang part có đúng một <h1> là tiêu đề chương; <title> (dạng
  // "Truyện - Chương - Wattpad") là fallback khi thiếu <h1>.
  const title =
    doc.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ||
    doc.title.replace(/\s*-\s*Wattpad\s*$/i, "").trim() ||
    url;

  const blocks = collectBlocks(doc.querySelectorAll("pre p"));

  if (blocks.length === 0) {
    if (doc.querySelector(".story-part-paywall") || PAID_RE.test(doc.body?.textContent || "")) {
      throw new LockedContentError(
        `Chương này thuộc chương trình trả phí (Paid Stories) của Wattpad, không thể trích xuất: ${url}`
      );
    }
    throw new Error(
      `Không tìm thấy nội dung chương tại ${url} — trang có thể đã đổi cấu trúc hoặc chương bị khoá`
    );
  }

  return { sourceUrl: url, title, blocks };
}

/**
 * Part dài được Wattpad chia trang: HTML trả về chỉ chứa trang đầu trong <pre>,
 * phần còn lại (kèm ảnh nằm trong đó) chỉ tải bằng JS khi cuộn. Endpoint
 * storytext trả về toàn bộ nội dung part trong một lần gọi — id part chính là
 * số mở đầu URL. Trả về mảng rỗng khi không lấy được để bên gọi dùng nội dung
 * trang đầu thay vì làm hỏng cả chương.
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
  // Trang HTML cho tiêu đề và nhận diện paywall; storytext cho nội dung đầy đủ.
  const chapter = parseWattpadChapter(html, url);
  const full = await fetchFullPartBlocks(url);
  if (full.length > chapter.blocks.length) chapter.blocks = full;
  return chapter;
}
