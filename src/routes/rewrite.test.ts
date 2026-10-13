import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredStory } from "../types";

/**
 * The rewrite routes over a real Express server and a throwaway library; the agent job is
 * the only thing faked, so the store, the plan and the SSE bookkeeping are the real ones.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "rewrite-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const fake = vi.hoisted(() => ({
  agent: undefined as { name?: string; complete: (prompt: string) => Promise<string> } | undefined,
  job: vi.fn(),
}));

vi.mock("../services/agent/agentConfig", () => ({ activeAgent: () => fake.agent }));
vi.mock("../services/rewrite/rewriteJob", () => ({ rewriteChapters: (job: unknown) => fake.job(job) }));

function makeStory(id: string): StoredStory {
  return {
    id,
    storyUrl: "https://x.test/truyen/rewrite",
    site: "x.test",
    title: "Truyện",
    language: "vi",
    watching: false,
    newChapterCount: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    chapters: [
      { order: 1, url: "u1", title: "Chương 1", status: "done", blocks: [{ type: "paragraph", text: "Một." }] },
      { order: 2, url: "u2", title: "Chương 2", status: "done", blocks: [{ type: "paragraph", text: "Hai." }] },
      { order: 3, url: "u3", title: "Chương 3", status: "pending" },
    ],
  };
}

describe("rewrite routes", () => {
  let server: Server;
  let base: string;
  let stories: typeof import("../services/storyStore").storyStore;
  const id = "a".repeat(16);

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { rewriteRouter } = await import("./rewrite");
    stories = (await import("../services/storyStore")).storyStore;
    await stories.save(makeStory(id));
    const app = express();
    app.use(express.json());
    app.use("/api", rewriteRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(async () => {
    fake.job.mockReset();
    fake.agent = { name: "fake", complete: async () => "" };
    await stories.removeRewrite(id, 1);
    await stories.removeRewrite(id, 2);
    await stories.save(makeStory(id));
  });

  afterEach(async () => {
    // Let a just-finished mocked job release the story before the next test.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it("reports which chapters are rewritten and what remains", async () => {
    await stories.saveRewrite(id, 1, [{ type: "paragraph", text: "gốc" }], "fake");
    const res = await fetch(`${base}/stories/${id}/rewrite`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      narratable: boolean;
      ready: boolean;
      remaining: number;
      chapters: Record<number, { rewritten: boolean }>;
    };
    expect(body).toMatchObject({ narratable: true, ready: true, remaining: 1 });
    expect(body.chapters[1].rewritten).toBe(true);
    expect(body.chapters[2].rewritten).toBe(false);
  });

  it("starts a run for every done chapter that was not rewritten yet", async () => {
    fake.job.mockImplementation(async (job: { onEvent: (event: unknown) => void }) => {
      job.onEvent({ type: "rewrite-chapter-done", order: 1, skipped: false, done: 1, total: 2 });
      return { done: 2, failed: 0 };
    });
    const res = await fetch(`${base}/stories/${id}/rewrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: true, total: 2 });
    await vi.waitFor(() => expect(fake.job).toHaveBeenCalledTimes(1));
    const job = fake.job.mock.calls[0][0] as { orders: number[]; storyTitle: string };
    expect(job.orders).toEqual([1, 2]);
    expect(job.storyTitle).toBe("Truyện");
  });

  it("refuses when the agent is off", async () => {
    fake.agent = undefined;
    const res = await fetch(`${base}/stories/${id}/rewrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(409);
  });

  it("restores the original text and drops the backup", async () => {
    await stories.saveRewrite(id, 1, [{ type: "paragraph", text: "bản gốc" }], "fake");
    const chapter = await stories.getChapter(id, 1);
    await stories.saveChapter(id, { ...chapter!, blocks: [{ type: "paragraph", text: "bản viết lại" }] });
    const res = await fetch(`${base}/stories/${id}/rewrite`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ restored: 1 });
    expect((await stories.getChapter(id, 1))?.blocks?.[0].text).toBe("bản gốc");
    expect(await stories.getRewrite(id, 1)).toBeUndefined();
  });
});
