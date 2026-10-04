// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAiConfig, saveAiConfig } from "./ai";

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

describe("ai config api", () => {
  it("fetchAiConfig", async () => {
    fetchMock.mockResolvedValueOnce(json({ enabled: true, active: "x", providers: [] }));
    expect((await fetchAiConfig()).enabled).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ai/config");
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(fetchAiConfig()).rejects.toThrow("Could not load the AI settings");
  });

  it("saveAiConfig PUTs the patch", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await saveAiConfig({ enabled: false, providers: { openai: { apiKey: "k" } } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/ai/config");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ enabled: false, providers: { openai: { apiKey: "k" } } });
    fetchMock.mockResolvedValueOnce(json({ message: "bad key" }, 400));
    await expect(saveAiConfig({})).rejects.toThrow("bad key");
  });
});
