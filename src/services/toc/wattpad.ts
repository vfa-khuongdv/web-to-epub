import { fetchText } from "./http";
import { TocAdapter, TocChapter, TocResult } from "./types";

export const WATTPAD_DOMAINS = ["wattpad.com"];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// Trang truyện của Wattpad là SPA — HTML server trả về không chứa danh sách
// chương, nên adapter dùng API nội bộ mà chính web Wattpad gọi. API trả toàn
// bộ parts trong một request (đã kiểm chứng với truyện 110 chương), không cần
// phân trang.
const STORY_FIELDS = "id,title,user(name),cover,parts(id,title,url)";

interface WattpadStoryResponse {
  title?: string;
  user?: { name?: string };
  cover?: string;
  parts?: { url?: string; title?: string }[];
  error_type?: string;
  message?: string;
}

function storyApiUrl(storyId: string): string {
  return `https://www.wattpad.com/api/v3/stories/${storyId}?fields=${STORY_FIELDS}`;
}

export function parseWattpadStoryId(url: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const m = pathname.match(/^\/story\/(\d+)(?:[/-]|$)/);
  return m ? m[1] : undefined;
}

// Trả nguyên URL nếu không phải trang truyện (thay vì throw): /api/stories gọi
// hàm này ngoài try/catch, lỗi rõ ràng sẽ được fetchToc báo sau đó.
export function normalizeWattpadStoryUrl(url: string): string {
  const storyId = parseWattpadStoryId(url);
  return storyId ? `https://www.wattpad.com/story/${storyId}` : url;
}

export function parseWattpadStory(text: string, storyUrl: string): TocResult {
  let data: WattpadStoryResponse;
  try {
    data = JSON.parse(text) as WattpadStoryResponse;
  } catch {
    throw new Error(`API danh sách chương của Wattpad trả về không phải JSON (${storyUrl})`);
  }

  if (data.error_type) {
    const detail = data.message ? `: ${data.message}` : "";
    if (data.error_type === "NotFound") {
      throw new Error(`Không tìm thấy truyện trên Wattpad${detail} — kiểm tra lại URL truyện (${storyUrl})`);
    }
    throw new Error(`API Wattpad báo lỗi (${data.error_type})${detail} (${storyUrl})`);
  }

  const chapters: TocChapter[] = (Array.isArray(data.parts) ? data.parts : [])
    .filter((p): p is { url: string; title?: string } => !!p && typeof p.url === "string" && p.url.length > 0)
    .map((p) => ({ url: p.url, title: p.title?.trim() || p.url }));

  if (chapters.length === 0) {
    throw new Error(`Không tìm thấy danh sách chương tại ${storyUrl} — kiểm tra lại URL truyện`);
  }

  return {
    title: data.title?.trim() || "Untitled",
    author: data.user?.name?.trim() || undefined,
    coverUrl: data.cover || undefined,
    chapters,
  };
}

export async function fetchToc(storyUrl: string): Promise<TocResult> {
  const storyId = parseWattpadStoryId(storyUrl);
  if (!storyId) {
    throw new Error(
      `URL này không phải trang truyện Wattpad: ${storyUrl} — cần dán URL dạng https://www.wattpad.com/story/<id>`
    );
  }
  const text = await fetchText(storyApiUrl(storyId), { headers: { "User-Agent": USER_AGENT } });
  return parseWattpadStory(text, storyUrl);
}

export const wattpadAdapter: TocAdapter = {
  domains: WATTPAD_DOMAINS,
  fetchToc,
  normalizeStoryUrl: normalizeWattpadStoryUrl,
};
