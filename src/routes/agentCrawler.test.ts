import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** GET/PUT /agent-crawler/config over a real Express server; the config lives in a throwaway settings table. */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "agent-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const installed = new Set(["opencode", "claude"]);
vi.mock("../services/agent/agentCli", () => ({
  findAgentBinary: (id: string) => (installed.has(id) ? `/bin/${id}` : undefined),
  runAgent: vi.fn(),
}));

const crawler = vi.hoisted(() => ({ hasAgentCrawler: vi.fn(), rewriteCrawler: vi.fn() }));
vi.mock("../services/agent/agentCrawler", () => crawler);

describe("agent crawler config routes", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { agentCrawlerRouter } = await import("./agentCrawler");
    const app = express();
    app.use(express.json());
    app.use("/api", agentCrawlerRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}/api`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(DATA_DIR, { recursive: true, force: true });
  });

  const put = (body: unknown) =>
    fetch(`${base}/agent-crawler/config`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const get = async () => (await fetch(`${base}/agent-crawler/config`)).json();

  it("starts off, listing every agent with whether it is installed", async () => {
    const config = await get();
    expect(config).toMatchObject({ enabled: false, agent: null, ready: false });
    expect(config.agents).toEqual([
      { id: "opencode", name: "opencode", installed: true },
      { id: "claude", name: "Claude Code", installed: true },
      { id: "codex", name: "Codex", installed: false },
    ]);
  });

  it("turning it on picks the first installed agent", async () => {
    expect((await put({ enabled: true })).status).toBe(200);
    expect(await get()).toMatchObject({ enabled: true, agent: "opencode", ready: true });
  });

  it("lets the person choose another installed agent, and a model", async () => {
    expect((await put({ agent: "claude", model: " sonnet " })).status).toBe(200);
    expect(await get()).toMatchObject({ agent: "claude", model: "sonnet", ready: true });
  });

  it("refuses an unknown agent, one that is not installed, and bad types", async () => {
    expect((await put({ agent: "nope" })).status).toBe(400);
    expect((await put({ agent: "codex" })).status).toBe(400);
    expect((await put({ enabled: "yes" })).status).toBe(400);
    expect((await put({ model: 3 })).status).toBe(400);
  });

  it("is not ready when the chosen agent was uninstalled", async () => {
    installed.delete("claude");
    expect(await get()).toMatchObject({ enabled: true, agent: "claude", ready: false });
  });

  describe("agent crawler live channel", () => {
  it("sends the recent history, then each step as it happens", async () => {
    const { reportAgent } = await import("../services/agent/agentActivity");
    reportAgent({ kind: "ask", host: "a.test", fn: "toc", attempt: 1, of: 3 });
    const res = await fetch(`${base}/agent-crawler/live`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const until = async (needle: string) => {
      while (!text.includes(needle)) text += decoder.decode((await reader.read()).value);
    };
    await until('"type":"snapshot"');
    expect(text).toContain('"kind":"ask"');
    reportAgent({ kind: "saved", host: "a.test", fn: "toc", count: 5 });
    await until('"type":"event"');
    expect(text).toContain('"count":5');
    // "Clear log" empties the history and tells the open pages.
    expect((await fetch(`${base}/agent-crawler/activity`, { method: "DELETE" })).status).toBe(200);
    await until('"type":"clear"');
    const { recentAgentActivity } = await import("../services/agent/agentActivity");
    expect(recentAgentActivity()).toEqual([]);
    await reader.cancel();
  });
});


  describe("a story's crawler", () => {
    const STORY_URL = "https://novels.test/story";
    let id: string;

    beforeAll(async () => {
      const store = await import("../services/storyStore");
      id = store.storyId(STORY_URL);
      await store.storyStore.save({
        id,
        storyUrl: STORY_URL,
        site: "novels.test",
        title: "S",
        watching: false,
        newChapterCount: 0,
        chapters: [{ order: 1, url: "https://novels.test/story/c1", title: "One", status: "pending" }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    const post = (storyId: string) => fetch(`${base}/stories/${storyId}/agent-crawler/rewrite`, { method: "POST" });

    it("says whether the site is crawled by agent code, and whether the agent is ready", async () => {
      crawler.hasAgentCrawler.mockResolvedValueOnce(true);
      expect(await (await fetch(`${base}/stories/${id}/agent-crawler`)).json()).toEqual({ available: true, ready: expect.any(Boolean) });
      crawler.hasAgentCrawler.mockRejectedValueOnce(new TypeError("Invalid URL"));
      expect((await (await fetch(`${base}/stories/${id}/agent-crawler`)).json()).available).toBe(false);
      expect((await fetch(`${base}/stories/0123456789abcdef/agent-crawler`)).status).toBe(404);
    });

    it("rewrites from the story page and its first chapter, and answers the agent's failure", async () => {
      await put({ enabled: true, agent: "opencode" });
      crawler.rewriteCrawler.mockResolvedValueOnce(undefined);
      expect((await post(id)).status).toBe(200);
      expect(crawler.rewriteCrawler).toHaveBeenCalledWith(expect.anything(), { storyUrl: STORY_URL, chapterUrl: "https://novels.test/story/c1" });
      crawler.rewriteCrawler.mockRejectedValueOnce(new Error("agent gave up"));
      const failed = await post(id);
      expect(failed.status).toBe(502);
      expect((await failed.json()).message).toBe("agent gave up");
      expect((await post("0123456789abcdef")).status).toBe(404);
    });

    it("refuses while the agent crawler is off", async () => {
      await put({ enabled: false });
      expect((await post(id)).status).toBe(409);
    });
  });
});
