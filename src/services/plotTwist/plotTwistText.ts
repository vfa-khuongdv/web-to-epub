import { ARABIC_DIGITS, countWords, FORBIDDEN_SYMBOLS } from "../rewrite/rewriteText";

/**
 * Prompts, reply parsing and checks for the plot-twist chapter. Pure, so they are tested
 * without an agent. Two passes: every window of the story is scanned for twists (the whole
 * story never fits in one prompt), then the candidates are written up as one narration-ready
 * chapter.
 */
export const WINDOW_WORDS = 6000;
export const MAX_TWISTS = 5;
export const MIN_CHAPTER_WORDS = 120;

export interface TwistCandidate {
  order: number;
  title: string;
  what: string;
  importance: number;
}

export interface Problem {
  attempt: string;
  problem: string;
}

function retryNote(previous?: Problem): string[] {
  return previous
    ? ["", "Lần thử trước đã trả lời:", previous.attempt.slice(0, 1500), `và chưa đạt: ${previous.problem}`, "Hãy trả lời lại, sửa đúng lỗi đó."]
    : [];
}

export function scanPrompt(text: string, previous?: Problem): string {
  return [
    "Bạn đọc một đoạn truyện tiếng Việt và tìm các PLOT TWIST: tình tiết đảo ngược điều người đọc tưởng đã biết, bí mật được tiết lộ, thân phận thật, phản bội, kết quả bất ngờ.",
    "Chỉ nêu twist THẬT SỰ CÓ trong đoạn dưới đây. Không bịa, không suy đoán thêm. Nếu đoạn không có twist, trả về danh sách rỗng.",
    'Mỗi đoạn được đánh dấu bằng dòng [Chương N]. Trường "order" là N của chương chứa twist.',
    '"what" viết 2-4 câu nêu rõ: người đọc tưởng gì, sự thật hoá ra là gì, ai liên quan (giữ nguyên tên riêng).',
    '"importance" từ 1 (nhỏ) đến 5 (twist thay đổi cả câu chuyện).',
    "",
    "Trả về DUY NHẤT một JSON, không giải thích thêm:",
    '{"twists": [{"order": 12, "title": "tên ngắn", "what": "mô tả", "importance": 4}]}',
    "",
    "Văn bản:",
    text,
    ...retryNote(previous),
  ].join("\n");
}

function parseJson(reply: string): unknown {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("the agent did not return JSON");
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    throw new Error("the agent returned unreadable JSON");
  }
}

// `orders` are the chapters of the window the reply answers: a twist pointing anywhere
// else is invented.
export function parseScanReply(reply: string, orders: number[]): TwistCandidate[] {
  const twists = (parseJson(reply) as { twists?: unknown }).twists;
  if (!Array.isArray(twists)) throw new Error('the JSON has no "twists" array');
  const allowed = new Set(orders);
  const result: TwistCandidate[] = [];
  for (const item of twists as Record<string, unknown>[]) {
    const order = Number(item?.order);
    const what = typeof item?.what === "string" ? item.what.replace(/\s+/g, " ").trim() : "";
    if (!allowed.has(order)) throw new Error(`"order" ${String(item?.order)} is not one of the chapters shown (${orders.join(", ")})`);
    if (!what) throw new Error('a twist has no "what"');
    const importance = Math.min(5, Math.max(1, Math.round(Number(item.importance)) || 1));
    result.push({ order, title: typeof item.title === "string" ? item.title.trim() : "", what, importance });
  }
  return result;
}

export function writePrompt(storyTitle: string, twists: TwistCandidate[], previous?: Problem): string {
  return [
    `Bạn viết MỘT chương đặc biệt tên "Plot twist" cho bản audio của truyện "${storyTitle}", đặt ở ĐẦU truyện để gây tò mò.`,
    "Chương này kể lại các plot twist có thật trong truyện, theo ghi chú dưới đây. Chỉ dùng thông tin trong ghi chú, không bịa thêm tình tiết, giữ nguyên tên riêng.",
    `Chọn tối đa ${MAX_TWISTS} twist đáng nhớ nhất (ưu tiên importance cao), sắp theo thứ tự xuất hiện trong truyện, mỗi twist một vài đoạn văn, giọng người dẫn truyện, mở đầu bằng lời dẫn ngắn, kết bằng lời mời nghe truyện.`,
    "Viết để máy đọc (TTS): số viết thành chữ, không markdown, không emoji, không dùng các ký tự * # > [ ] ( ) _ | { } và không có chữ số Ả Rập. Mỗi đoạn một phần tử.",
    "",
    "Trả về DUY NHẤT một JSON, không giải thích thêm:",
    '{"paragraphs": ["đoạn một", "đoạn hai"]}',
    "",
    "Ghi chú các twist:",
    ...twists.map((twist) => `- [Chương ${twist.order}] (importance ${twist.importance}) ${twist.title ? twist.title + ": " : ""}${twist.what}`),
    ...retryNote(previous),
  ].join("\n");
}

export function parseWriteReply(reply: string): string[] {
  const paragraphs = (parseJson(reply) as { paragraphs?: unknown }).paragraphs;
  if (!Array.isArray(paragraphs)) throw new Error('the JSON has no "paragraphs" array');
  return paragraphs
    .filter((paragraph): paragraph is string => typeof paragraph === "string")
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function validateWrite(paragraphs: string[]): string | null {
  const text = paragraphs.join(" ");
  if (countWords(text) < MIN_CHAPTER_WORDS) return `too short (${countWords(text)} words, at least ${MIN_CHAPTER_WORDS})`;
  const symbol = text.match(FORBIDDEN_SYMBOLS);
  if (symbol) return `it still has the symbol "${symbol[0]}"`;
  if (ARABIC_DIGITS.test(text)) return "it still has digits; numbers must be written as words";
  return null;
}

export interface Segment {
  order: number;
  text: string;
}

// Consecutive segments grouped into windows of about `maxWords`, each rendered with its
// [Chương N] markers.
export function windowSegments(segments: Segment[], maxWords: number = WINDOW_WORDS): { orders: number[]; text: string }[] {
  const windows: { orders: number[]; text: string }[] = [];
  let parts: string[] = [];
  let orders: number[] = [];
  let words = 0;
  const push = () => {
    if (parts.length) windows.push({ orders: [...new Set(orders)], text: parts.join("\n\n") });
    parts = [];
    orders = [];
    words = 0;
  };
  for (const segment of segments) {
    const count = countWords(segment.text);
    if (words > 0 && words + count > maxWords) push();
    parts.push(`[Chương ${segment.order}]\n${segment.text}`);
    orders.push(segment.order);
    words += count;
  }
  push();
  return windows;
}
