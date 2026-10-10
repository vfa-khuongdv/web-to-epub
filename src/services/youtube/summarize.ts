import { AgentModel } from "../agent/agentConfig";
import { t } from "../lang";

/**
 * The 2–3 sentence chapter summary the description opens with, written by the agent from
 * the chapter's full text. A summary that does not come back readable is retried once;
 * the caller treats a failure as a per-chapter error, never as invented text.
 */
export function summaryPrompt(storyTitle: string, order: number, text: string): string {
  return [
    "Bạn tóm tắt một chương truyện để làm mô tả video YouTube.",
    "Viết 2–3 câu tiếng Việt, chỉ nêu những sự việc thực sự xảy ra trong chương, đúng tên nhân vật;",
    "không bịa, không suy đoán, không mở đầu bằng \"Chương này\"; giọng văn cuốn hút, khơi gợi tò mò để người đọc muốn nghe ngay,",
    "mỗi chương mở đầu và diễn đạt khác nhau, nhưng không tiết lộ cái kết của chương.",
    "viết liền một đoạn văn, không xuống dòng, không dùng markdown.",
    "Trả về DUY NHẤT một JSON đúng định dạng, không giải thích thêm:",
    '{"summary": "..."}',
    "",
    `Chương ${order} của truyện "${storyTitle}":`,
    text,
  ].join("\n");
}

// `key` is the JSON field the prompt asked for: "summary" for a chapter's summary,
// "intro" for the compilation's story intro (asking for one key and reading another
// silently throws away a correct answer).
export function parseSummary(reply: string, key: "summary" | "intro" = "summary"): string | undefined {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const value = JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>;
      const text = value[key];
      // One paragraph, like the 📖 line in a chapter's description (and the fallback below).
      if (typeof text === "string" && text.trim()) return text.trim().replace(/\s+/g, " ").slice(0, 600);
    } catch {
      /* not JSON: fall through to the plain-reply case */
    }
  }
  // A model that answered with the text itself (no JSON, no code) is still usable.
  const text = reply.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  if (text && text.length <= 700 && !/[{}]/.test(text)) return text;
  return undefined;
}

export function introPrompt(storyTitle: string, text: string): string {
  return [
    "Bạn viết đoạn giới thiệu truyện để mở đầu phần mô tả của video YouTube, cùng định dạng với phần tóm tắt trong mô tả từng chương.",
    "Viết 2–3 câu tiếng Việt, chỉ nêu những sự việc thực sự xảy ra ở phần đầu truyện, đúng tên nhân vật;",
    "không bịa, không thêm bình luận, không suy đoán, không tiết lộ kết thúc hay tình tiết về sau, không mở đầu bằng \"Truyện kể về\";",
    "viết liền một đoạn văn, không xuống dòng, không dùng markdown.",
    "Trả về DUY NHẤT một JSON đúng định dạng, không giải thích thêm:",
    '{"intro": "..."}',
    "",
    `Truyện "${storyTitle}", phần đầu:`,
    text,
  ].join("\n");
}

// The story intro the compilation description opens with, written from the first chapters
// (the same one-shot shape as summarizeChapter).
export async function writeStoryIntro(
  agent: AgentModel,
  input: { storyTitle: string; text: string; signal?: AbortSignal }
): Promise<string> {
  const prompt = introPrompt(input.storyTitle, input.text);
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (input.signal?.aborted) throw new Error(t("Stopped"));
    const reply = await agent.complete(attempt === 1 ? prompt : `${prompt}\n\nChỉ trả về JSON, không giải thích.`);
    const intro = parseSummary(reply, "intro");
    if (intro) return intro;
  }
  throw new Error(t("The agent could not write the intro"));
}

export async function summarizeChapter(
  agent: AgentModel,
  input: { storyTitle: string; order: number; text: string; signal?: AbortSignal }
): Promise<string> {
  const prompt = summaryPrompt(input.storyTitle, input.order, input.text);
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (input.signal?.aborted) throw new Error(t("Stopped"));
    const reply = await agent.complete(attempt === 1 ? prompt : `${prompt}\n\nChỉ trả về JSON, không giải thích.`);
    const summary = parseSummary(reply);
    if (summary) return summary;
  }
  throw new Error(t("The agent could not write a summary for chapter {order}", { order: input.order }));
}
