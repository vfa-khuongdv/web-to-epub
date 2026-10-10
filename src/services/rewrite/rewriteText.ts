import { JSDOM } from "jsdom";
import { splitLongText } from "../tts/chapterText";

/**
 * Turning a crawled chapter into the text a voice can read, without changing what it says.
 * The rules are the ones the workspace's rewrite skill uses (numbers to words, quotes,
 * no markdown), written for a model that only sees this prompt. Everything here is pure so
 * the checks can be tested without an agent.
 */

// A model's answer gets cut off at some point; ~1600 words of input keeps the whole reply
// (which is about as long) comfortably inside every agent's default output budget.
export const REWRITE_CHUNK_WORDS = 1600;

// Block text is HTML-safe and may carry inline markup, so read it through a DOM.
export function blockText(html: string): string {
  return (JSDOM.fragment(`<p>${html}</p>`).textContent ?? "").replace(/\s+/g, " ").trim();
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Paragraphs are the unit the model must not merge (splitting one into several is allowed
// and expected for dialogue). Long chapters go in chunks so nothing is truncated.
export function chunkParagraphs(paragraphs: string[], maxWords: number = REWRITE_CHUNK_WORDS): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let words = 0;
  const push = () => {
    if (current.length) chunks.push(current);
    current = [];
    words = 0;
  };
  for (const paragraph of paragraphs) {
    const count = countWords(paragraph);
    if (count > maxWords) {
      push();
      // One paragraph longer than a whole chunk: split it at sentence ends.
      for (const piece of splitLongText(paragraph, maxWords * 6)) chunks.push([piece]);
      continue;
    }
    if (words + count > maxWords) push();
    current.push(paragraph);
    words += count;
  }
  push();
  return chunks;
}

export interface RewriteProblem {
  attempt: string;
  problem: string;
}

export function rewritePrompt(paragraphs: string[], previous?: RewriteProblem): string {
  const lines = [
    "Bạn viết lại văn bản truyện tiếng Việt để đọc bằng máy (TTS). Chỉ đổi CÁCH VIẾT, giữ nguyên 100% nội dung, tình tiết, lời thoại, thứ tự câu và đoạn.",
    "",
    "Được phép sửa:",
    "- Bỏ định dạng không đọc được: markdown, emoji, HTML, ký hiệu trang trí; bỏ ghi chú tác giả/quảng cáo/watermark/\"hết chương\" nếu không thuộc truyện.",
    "- Số và đơn vị viết thành chữ theo cách đọc tiếng Việt: 3 giờ 15 → ba giờ mười lăm; 20/10 → hai mươi tháng mười; 1.500.000đ → một triệu năm trăm nghìn đồng; 5km → năm ki-lô-mét; 30% → ba mươi phần trăm; 2024 → hai nghìn không trăm hai mươi bốn.",
    "- Viết tắt, ký hiệu → đọc đầy đủ: TP.HCM → Thành phố Hồ Chí Minh; Mr. → ông; vs → với; & → và; … hoặc ... → dấu chấm/phẩy hợp ngữ cảnh; !!! → một dấu; k/ko/dc → dạng đầy đủ.",
    "- Tách câu quá dài (khoảng hơn 40 từ) thành câu ngắn tại chỗ ngắt tự nhiên, không đổi từ ngữ.",
    "- Lời thoại: đặt trong dấu ngoặc kép \"...\", mỗi lượt thoại một đoạn riêng. Lời dẫn lẫn trong thoại (\"- Anh đi đâu? - cô hỏi.\") tách thành \"Anh đi đâu?\" cô hỏi. Không thêm \"X nói\" khi bản gốc không có.",
    "- Chuyển cảnh (***, ---, nhiều dòng trống) → một dòng trống; bỏ ký tự điều khiển và khoảng trắng thừa.",
    "- Sửa lỗi chính tả rõ ràng và dấu câu làm máy đọc sai.",
    "",
    "KHÔNG được: tóm tắt, cắt bớt, gộp đoạn, thêm tình tiết/bình luận, đổi giọng văn/xưng hô/tên riêng, kiểm duyệt nội dung.",
    "KHÔNG gộp hai đoạn thành một; được phép tách một đoạn thành nhiều đoạn.",
    "Đầu ra không còn chữ số Ả Rập và không còn các ký tự * # > [ ] ( ) _ | { }.",
    "Tên nước ngoài hoặc từ không chắc cách đọc thì giữ nguyên.",
    "",
    "Trả về DUY NHẤT một JSON đúng định dạng, không giải thích thêm:",
    '{"paragraphs": ["đoạn một", "đoạn hai"]}',
    "",
    "Các đoạn của chương, mỗi dòng một đoạn:",
    paragraphs.join("\n"),
  ];
  if (previous) {
    lines.push(
      "",
      "Lần thử trước đã viết:",
      previous.attempt.slice(0, 1500),
      `và chưa đạt: ${previous.problem}`,
      "Hãy viết lại toàn bộ, sửa đúng lỗi đó, giữ nguyên định dạng JSON."
    );
  }
  return lines.join("\n");
}

// Agents sometimes wrap the JSON in a sentence or a code fence; take the outermost object.
export function parseRewriteReply(reply: string): string[] {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("the agent did not return JSON");
  let value: unknown;
  try {
    value = JSON.parse(reply.slice(start, end + 1));
  } catch {
    throw new Error("the agent returned unreadable JSON");
  }
  const paragraphs = (value as { paragraphs?: unknown }).paragraphs;
  if (!Array.isArray(paragraphs)) throw new Error('the JSON has no "paragraphs" array');
  return paragraphs
    .filter((paragraph): paragraph is string => typeof paragraph === "string")
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const FORBIDDEN_SYMBOLS = /[*#>|_\[\]{}()]/;
const ARABIC_DIGITS = /[0-9]/;

// Capitalized words (names) from the source; sentence-start words survive a rewrite too,
// so a missing one is a real sign of dropped or invented content.
export function properNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.match(/[A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+)*/g) ?? []) {
    if (match.length >= 3) names.add(match);
  }
  return [...names];
}

export function missingNames(source: string, rewritten: string): string[] {
  const names = properNames(source);
  if (names.length < 5) return [];
  return names.filter((name) => !rewritten.includes(name));
}

// What still makes a reply unusable, in the words fed back to the agent on the next try.
// Returns null when the rewrite may be saved.
export function validateRewrite(source: string[], rewritten: string[]): string | null {
  if (rewritten.length === 0) return "the rewrite is empty";
  if (rewritten.length < source.length) {
    return `it has ${rewritten.length} paragraphs for ${source.length}: paragraphs must not be merged`;
  }
  const sourceText = source.join(" ");
  const rewrittenText = rewritten.join(" ");
  const sourceWords = countWords(sourceText);
  const rewrittenWords = countWords(rewrittenText);
  if (sourceWords >= 20) {
    const ratio = rewrittenWords / sourceWords;
    if (ratio < 0.7) return `too short (${rewrittenWords} words for ${sourceWords}): some content was dropped`;
    if (ratio > 1.7) return `too long (${rewrittenWords} words for ${sourceWords}): content was added`;
  }
  const symbol = rewrittenText.match(FORBIDDEN_SYMBOLS);
  if (symbol) return `it still has the symbol "${symbol[0]}"`;
  if (ARABIC_DIGITS.test(rewrittenText)) return "it still has digits; numbers must be written as words";
  const missing = missingNames(sourceText, rewrittenText);
  if (missing.length >= 2 && missing.length > properNames(sourceText).length * 0.15) {
    return `names are missing: ${missing.slice(0, 5).join(", ")}`;
  }
  return null;
}
