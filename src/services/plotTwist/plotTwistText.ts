import { countWords } from "../rewrite/rewriteText";

/**
 * Prompts, reply parsing and checks for the plot-twist chapter. Pure, so they are tested
 * without an agent. Every window of the story is scanned for twists (the whole story never
 * fits in one prompt); the agent only points at them by quoting one or two sentences of the
 * text word for word, and the chapter is those quotes, so nothing in it is invented.
 */
export const WINDOW_WORDS = 6000;
export const MAX_TWISTS = 5;
export const MAX_QUOTE_WORDS = 80;

export interface TwistCandidate {
  order: number;
  title: string;
  quote: string;
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
    `"quote" là 1-2 câu liền nhau CHÉP NGUYÊN VĂN từ văn bản dưới đây (từng chữ, không sửa, không tóm tắt, không bỏ dấu), câu thể hiện rõ nhất twist đó, tối đa ${MAX_QUOTE_WORDS} từ.`,
    '"importance" từ 1 (nhỏ) đến 5 (twist thay đổi cả câu chuyện).',
    "",
    "Trả về DUY NHẤT một JSON, không giải thích thêm:",
    '{"twists": [{"order": 12, "title": "tên ngắn", "quote": "câu chép nguyên văn", "importance": 4}]}',
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

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

// `orders` are the chapters of the window the reply answers: a twist pointing anywhere
// else is invented. `text` is what the agent read: a quote that is not in it is invented too.
export function parseScanReply(reply: string, orders: number[], text: string): TwistCandidate[] {
  const twists = (parseJson(reply) as { twists?: unknown }).twists;
  if (!Array.isArray(twists)) throw new Error('the JSON has no "twists" array');
  const allowed = new Set(orders);
  const source = squash(text);
  const result: TwistCandidate[] = [];
  for (const item of twists as Record<string, unknown>[]) {
    const order = Number(item?.order);
    const quote = typeof item?.quote === "string" ? squash(item.quote) : "";
    if (!allowed.has(order)) throw new Error(`"order" ${String(item?.order)} is not one of the chapters shown (${orders.join(", ")})`);
    if (!quote) throw new Error('a twist has no "quote"');
    if (countWords(quote) > MAX_QUOTE_WORDS) throw new Error(`a "quote" is longer than ${MAX_QUOTE_WORDS} words; quote one or two sentences`);
    if (!source.includes(quote)) throw new Error(`the "quote" is not word for word in the text: ${quote.slice(0, 120)}`);
    const importance = Math.min(5, Math.max(1, Math.round(Number(item.importance)) || 1));
    result.push({ order, title: typeof item.title === "string" ? item.title.trim() : "", quote, importance });
  }
  return result;
}

// The strongest twists, back in story order, as the chapter's paragraphs.
export function chapterFromTwists(twists: TwistCandidate[]): string[] {
  const top = [...twists].sort((a, b) => b.importance - a.importance).slice(0, MAX_TWISTS).sort((a, b) => a.order - b.order);
  return [...new Set(top.map((twist) => twist.quote))];
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
