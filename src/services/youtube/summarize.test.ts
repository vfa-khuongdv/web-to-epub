import { describe, expect, it, vi } from "vitest";
import { parseSummary, summarizeChapter, writeStoryIntro } from "./summarize";

const agent = (replies: string[]) => ({
  name: "fake",
  complete: vi.fn(async () => replies.shift() ?? ""),
});

describe("parseSummary", () => {
  it("reads the key the prompt asked for", () => {
    expect(parseSummary('{"summary": "Tóm tắt chương."}')).toBe("Tóm tắt chương.");
    expect(parseSummary('{"intro": "Giới thiệu truyện."}', "intro")).toBe("Giới thiệu truyện.");
  });

  it("keeps reading the summary key while answering an intro prompt with it", () => {
    // A model that copies the chapter-summary shape instead of the asked one: the intro
    // parser must not mistake it for an unreadable answer.
    expect(parseSummary('{"intro": "Giới thiệu."}', "summary")).toBeUndefined();
  });

  it("reads JSON inside a fenced block", () => {
    expect(parseSummary('```json\n{"intro": "Giới thiệu."}\n```', "intro")).toBe("Giới thiệu.");
  });

  it("falls back to a plain reply, never to raw JSON", () => {
    expect(parseSummary("Tóm tắt bằng lời.")).toBe("Tóm tắt bằng lời.");
    expect(parseSummary('{"intro": "Giới thiệu."}')).toBeUndefined();
  });

  it("collapses a multi-paragraph answer into the one line the description carries", () => {
    expect(parseSummary('{"summary": "Câu một.\\n\\nCâu hai."}')).toBe("Câu một. Câu hai.");
    expect(parseSummary('{"intro": "- Ý một.\\n- Ý hai."}', "intro")).toBe("- Ý một. - Ý hai.");
  });
});

describe("writeStoryIntro", () => {
  it("asks for the chapter-description style, not a blurb", async () => {
    const fake = agent(['{"intro": "Châu Mạt gặp tai nạn trước cổng bệnh viện và qua đời."}']);
    await writeStoryIntro(fake, { storyTitle: "A", text: "Chương 1: ..." });
    const prompt = (fake.complete.mock.calls[0] as unknown as string[])[0];
    // The intro sits on the same 📖 line as a chapter summary, so it follows the same
    // rules: real events, no spoilers, one plain paragraph.
    expect(prompt).toContain("cùng định dạng với phần tóm tắt trong mô tả từng chương");
    expect(prompt).toContain("chỉ nêu những sự việc thực sự xảy ra");
    expect(prompt).toContain("không tiết lộ kết thúc");
    expect(prompt).toContain("một đoạn văn");
  });

  it("returns the intro from the agent's JSON reply", async () => {
    const fake = agent(['{"intro": "Cô gái bước vào thành phố và gặp người lạ."}']);
    await expect(writeStoryIntro(fake, { storyTitle: "A", text: "Chương 1: ..." })).resolves.toBe(
      "Cô gái bước vào thành phố và gặp người lạ."
    );
    expect(fake.complete).toHaveBeenCalledTimes(1);
  });

  it("retries once, then fails when the reply stays unreadable", async () => {
    const fake = agent(["{}", "{}"]);
    await expect(writeStoryIntro(fake, { storyTitle: "A", text: "..." })).rejects.toThrow(
      "The agent could not write the intro"
    );
    expect(fake.complete).toHaveBeenCalledTimes(2);
  });
});

describe("summarizeChapter", () => {
  it("still reads the summary key", async () => {
    const fake = agent(['{"summary": "Tóm tắt chương 2."}']);
    await expect(summarizeChapter(fake, { storyTitle: "A", order: 2, text: "..." })).resolves.toBe(
      "Tóm tắt chương 2."
    );
  });
});
