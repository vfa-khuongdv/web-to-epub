// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAgentConfig, fetchStoryAgentCrawler, rewriteStoryAgentCrawler, saveAgentConfig } from "./agent";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("lang", "en");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("agent crawler api", () => {
  it("fetchAgentConfig", async () => {
    fetchMock.mockResolvedValueOnce(json({ enabled: true, agent: "opencode", model: "", ready: true, agents: [] }));
    expect((await fetchAgentConfig()).ready).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/agent-crawler/config");
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(fetchAgentConfig()).rejects.toThrow("Could not load the agent crawler settings");
  });

  it("saveAgentConfig PUTs the patch and surfaces the server's message", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await saveAgentConfig({ agent: "claude" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/agent-crawler/config");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ agent: "claude" });
    fetchMock.mockResolvedValueOnce(json({ message: "nope" }, 400));
    await expect(saveAgentConfig({ agent: "x" })).rejects.toThrow("nope");
  });

  it("fetchStoryAgentCrawler asks about one story", async () => {
    fetchMock.mockResolvedValueOnce(json({ available: true, ready: false }));
    expect(await fetchStoryAgentCrawler("abc")).toEqual({ available: true, ready: false });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/stories/abc/agent-crawler");
  });

  it("rewriteStoryAgentCrawler POSTs and surfaces the server's message", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await rewriteStoryAgentCrawler("abc");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/stories/abc/agent-crawler/rewrite");
    expect(init.method).toBe("POST");
    fetchMock.mockResolvedValueOnce(json({ message: "agent gave up" }, 502));
    await expect(rewriteStoryAgentCrawler("abc")).rejects.toThrow("agent gave up");
  });
});
