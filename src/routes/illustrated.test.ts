import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredStory } from "../types";

/**
 * The illustrated-video routes over a real Express server and a throwaway library; the agent
 * is faked, so what is pinned here is the route logic: what the agent is shown, that a bad
 * answer is refused instead of saved, and that the bible survives and can be removed.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "illustrated-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const fake = vi.hoisted(() => ({ reply: "", prompts: [] as string[], agent: true }));
vi.mock("../services/agent/agentConfig", () => ({
  activeAgent: () =>
    fake.agent
      ? {
          complete: async (prompt: string) => {
            fake.prompts.push(prompt);
            return fake.reply;
          },
        }
      : undefined,
}));

const face = '<g><circle cx="-22" cy="-6" r="7" fill="#222"/></g>';
const goodReply = JSON.stringify({
  style: "flat",
  characters: [
    {
      id: "heroine",
      name: "Heroine",
      description: "tóc đen",
      headY: -380,
      body: '<g><rect x="-40" y="-300" width="80" height="300" fill="#2f8f5a"/></g>',
      faces: { neutral: face, smile: face, sad: face, surprised: face, laugh: face },
    },
  ],
});

function makeStory(id: string): StoredStory {
  return {
    id,
    storyUrl: "https://x.test/truyen/illustrated",
    site: "x.test",
    title: "Truyện minh hoạ",
    language: "vi",
    watching: false,
    newChapterCount: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    chapters: [
      { order: 1, url: "u1", title: "Chương 1", status: "done", blocks: [{ type: "paragraph", text: "Cô gái tóc đen bước vào làng." }] },
      { order: 2, url: "u2", title: "Chương 2", status: "pending" },
    ],
  };
}

describe("illustrated routes", () => {
  let server: Server;
  let base: string;
  const id = "d".repeat(16);

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { illustratedRouter } = await import("./illustrated");
    await (await import("../services/storyStore")).storyStore.save(makeStory(id));
    const app = express();
    app.use(express.json());
    app.use("/api", illustratedRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(async () => {
    fake.reply = goodReply;
    fake.prompts = [];
    fake.agent = true;
    await fetch(`${base}/stories/${id}/illustrated`, { method: "DELETE" });
  });

  it("starts empty and reports whether an agent is available", async () => {
    const body = (await (await fetch(`${base}/stories/${id}/illustrated`)).json()) as { bible: unknown; agentAvailable: boolean };
    expect(body).toEqual({ bible: null, agentAvailable: true });
    fake.agent = false;
    expect(((await (await fetch(`${base}/stories/${id}/illustrated`)).json()) as { agentAvailable: boolean }).agentAvailable).toBe(false);
  });

  it("draws the characters from the downloaded chapters and keeps them", async () => {
    const res = await fetch(`${base}/stories/${id}/illustrated/bible`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(fake.prompts[0]).toContain("Cô gái tóc đen bước vào làng.");
    const saved = (await (await fetch(`${base}/stories/${id}/illustrated`)).json()) as { bible: { characters: { id: string }[] } };
    expect(saved.bible.characters[0].id).toBe("heroine");
  });

  it("refuses without an agent, and saves nothing when the agent keeps answering badly", async () => {
    fake.agent = false;
    expect((await fetch(`${base}/stories/${id}/illustrated/bible`, { method: "POST" })).status).toBe(409);
    fake.agent = true;
    fake.reply = "không phải JSON";
    expect((await fetch(`${base}/stories/${id}/illustrated/bible`, { method: "POST" })).status).toBe(502);
    expect(fake.prompts).toHaveLength(3);
    expect(((await (await fetch(`${base}/stories/${id}/illustrated`)).json()) as { bible: unknown }).bible).toBeNull();
  });

  it("removes the characters", async () => {
    await fetch(`${base}/stories/${id}/illustrated/bible`, { method: "POST" });
    expect((await fetch(`${base}/stories/${id}/illustrated`, { method: "DELETE" })).status).toBe(204);
    expect(((await (await fetch(`${base}/stories/${id}/illustrated`)).json()) as { bible: unknown }).bible).toBeNull();
  });

  it("answers 404 for a story that does not exist", async () => {
    expect((await fetch(`${base}/stories/${"e".repeat(16)}/illustrated/bible`, { method: "POST" })).status).toBe(404);
  });
});
