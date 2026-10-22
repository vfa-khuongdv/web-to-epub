import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StoredStory } from "../../types";
import { AgentModel } from "../agent/agentConfig";
import { createStoryStore, storyId } from "../storyStore";
import { rewriteChapters, RewriteEvent } from "./rewriteJob";

const URL = "https://x.test/truyen/rewrite";

function makeStory(id: string): StoredStory {
  return {
    id,
    storyUrl: URL,
    site: "x.test",
    title: "Truyện",
    language: "vi",
    watching: false,
    newChapterCount: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    chapters: [
      { order: 1, url: "u1", title: "Chương 1", status: "done", blocks: [{ type: "paragraph", text: "Châu Mạt đứng dưới mưa." }] },
      { order: 2, url: "u2", title: "Chương 2", status: "done", blocks: [{ type: "paragraph", text: "Hắn cười nhạt." }] },
      { order: 3, url: "u3", title: "Chương 3", status: "pending" },
    ],
  };
}

function agentOf(replies: string[]): AgentModel {
  return { name: "fake", complete: async () => replies.shift() ?? "" };
}

describe("rewriteChapters", () => {
  it("rewrites done chapters, backs up the original, and reports each one", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rewrite-job-"));
    const store = createStoryStore(dir);
    const id = storyId(URL);
    await store.save(makeStory(id));
    const events: RewriteEvent[] = [];
    const { done, failed } = await rewriteChapters({
      stories: store,
      storyId: id,
      storyTitle: "Truyện",
      orders: [1, 2, 3],
      agent: agentOf(['{"paragraphs":["Châu Mạt chạy dưới mưa."]}', '{"paragraphs":["Hắn cười nhạt."]}']),
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    });
    expect({ done, failed }).toEqual({ done: 3, failed: 0 });
    expect((await store.getChapter(id, 1))?.blocks?.[0].text).toBe("Châu Mạt chạy dưới mưa.");
    // The chapter holds the rewrite; the backup holds the text the agent first saw.
    expect((await store.getRewrite(id, 1))?.originalBlocks[0].text).toBe("Châu Mạt đứng dưới mưa.");
    expect((await store.getChapter(id, 3))?.blocks).toBeUndefined();
    expect(events.filter((event) => event.type === "rewrite-chapter-done")).toHaveLength(3);
  });

  it("keeps the old text when the agent cannot write an acceptable rewrite", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rewrite-job-"));
    const store = createStoryStore(dir);
    const id = storyId(URL);
    await store.save(makeStory(id));
    const { done, failed } = await rewriteChapters({
      stories: store,
      storyId: id,
      storyTitle: "Truyện",
      orders: [1],
      agent: agentOf(["không phải JSON", "không phải JSON", "không phải JSON"]),
      signal: new AbortController().signal,
      onEvent: () => {},
    });
    expect({ done, failed }).toEqual({ done: 0, failed: 1 });
    expect((await store.getChapter(id, 1))?.blocks?.[0].text).toBe("Châu Mạt đứng dưới mưa.");
    expect(await store.getRewrite(id, 1)).toBeUndefined();
  });
});
