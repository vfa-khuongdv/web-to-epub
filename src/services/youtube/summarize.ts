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
    "không bịa, không thêm bình luận, không suy đoán, không mở đầu bằng \"Chương này\".",
    "Trả về DUY NHẤT một JSON đúng định dạng, không giải thích thêm:",
    '{"summary": "..."}',
    "",
    `Chương ${order} của truyện "${storyTitle}":`,
    text,
  ].join("\n");
}

export function parseSummary(reply: string): string | undefined {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const value = JSON.parse(reply.slice(start, end + 1)) as { summary?: unknown };
      if (typeof value.summary === "string" && value.summary.trim()) return value.summary.trim().slice(0, 600);
    } catch {
      /* not JSON: fall through to the plain-reply case */
    }
  }
  // A model that answered with the summary itself (no JSON, no code) is still usable.
  const text = reply.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  if (text && text.length <= 700 && !/[{}]/.test(text)) return text;
  return undefined;
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
