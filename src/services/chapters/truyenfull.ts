import { ExtractedChapter } from "../../types";
import { extractChapter, LockedContentError } from "../extractor";
import { renderPageHtml } from "../renderer";
import { fetchText } from "../toc/http";

export const TRUYENFULL_DOMAINS = ["truyenfull.vn", "truyenfull.live"];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// Đủ chữ để tin rằng HTML phục vụ sẵn có toàn văn chương chứ không phải cái vỏ
// chờ JS dựng nội dung.
const MIN_SERVED_TEXT = 500;

function textLength(chapter: ExtractedChapter): number {
  return chapter.blocks.reduce((total, block) => total + (block.text?.length ?? 0), 0);
}

/**
 * truyenfull trả sẵn toàn văn chương trong #chapter-c ngay trong HTML — nó chỉ
 * bị CSS giấu sau lớp phủ "bấm quảng cáo để mở", mà extractChapter vốn đã gỡ
 * lớp đó (xem extractor.ts). Nên không cần mở trình duyệt: đo trên một chương
 * thật, fetch thuần mất 306ms so với 2.1s khi qua Chromium, cho ra đúng cùng
 * một bộ block.
 *
 * Khi HTML phục vụ sẵn không đủ chữ — site đổi cấu trúc, hoặc chương này lại
 * dựng bằng JS — thì quay về đường render bằng trình duyệt, thay vì lẳng lặng
 * lưu một chương cụt.
 */
export async function fetchTruyenfullChapter(url: string): Promise<ExtractedChapter> {
  const html = await fetchText(url, { headers: { "User-Agent": USER_AGENT } });

  let served: ExtractedChapter | undefined;
  try {
    served = extractChapter(url, html);
  } catch (err) {
    // Chương bị khoá thì render lại cũng khoá: báo ngay để không tốn lượt thử.
    if (err instanceof LockedContentError) throw err;
  }
  if (served && textLength(served) >= MIN_SERVED_TEXT) return served;

  return extractChapter(url, await renderPageHtml(url));
}
