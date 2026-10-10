import { describe, expect, it } from "vitest";
import { ContentBlock } from "../../types";
import { AgentModel } from "../agent/agentConfig";
import { RewriteCancelledError, rewriteChapterBlocks } from "./rewriteChapter";

function agentOf(replies: string[]) {
  const prompts: string[] = [];
  const model: AgentModel = {
    name: "test-agent",
    complete: async (prompt) => {
      prompts.push(prompt);
      return replies.shift() ?? "";
    },
  };
  return { model, prompts };
}

describe("rewriteChapterBlocks", () => {
  it("rewrites paragraphs and keeps the other blocks where they are", async () => {
    const blocks: ContentBlock[] = [
      { type: "paragraph", text: "Anh đi đâu về muộn thế?" },
      { type: "image", src: "https://x.test/a.png" },
      { type: "paragraph", text: "Hắn cười nhạt." },
    ];
    const { model, prompts } = agentOf([
      '{"paragraphs":["\\"Anh đi đâu về muộn thế?\\""]}',
      '{"paragraphs":["Hắn cười nhạt."]}',
    ]);
    const out = await rewriteChapterBlocks(model, blocks, { host: "Truyện", order: 1 });
    expect(out).toEqual([
      { type: "paragraph", text: '"Anh đi đâu về muộn thế?"' },
      { type: "image", src: "https://x.test/a.png" },
      { type: "paragraph", text: "Hắn cười nhạt." },
    ]);
    // One run per side of the image: a chunk never mixes two stretches of the chapter.
    expect(prompts).toHaveLength(2);
  });

  it("feeds a failed check back to the agent on the next attempt", async () => {
    const { model, prompts } = agentOf(['{"paragraphs":["có 3 người"]}', '{"paragraphs":["có ba người"]}']);
    const out = await rewriteChapterBlocks(model, [{ type: "paragraph", text: "có ba người" }], { host: "T", order: 2 });
    expect(out[0].text).toBe("có ba người");
    expect(prompts[1]).toContain("digits");
  });

  it("gives up after three attempts", async () => {
    const { model, prompts } = agentOf(["không phải JSON", "không phải JSON", "không phải JSON"]);
    await expect(rewriteChapterBlocks(model, [{ type: "paragraph", text: "Một câu." }], { host: "T", order: 3 })).rejects.toThrow(
      /could not rewrite/i
    );
    expect(prompts).toHaveLength(3);
  });

  it("stops before asking when the run was cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { model, prompts } = agentOf([]);
    await expect(
      rewriteChapterBlocks(model, [{ type: "paragraph", text: "Một." }], {
        host: "T",
        order: 4,
        signal: controller.signal,
      })
    ).rejects.toBeInstanceOf(RewriteCancelledError);
    expect(prompts).toHaveLength(0);
  });
});
