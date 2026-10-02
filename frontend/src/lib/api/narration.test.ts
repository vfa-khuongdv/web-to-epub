// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./narration";
import { setVaultToken } from "../../vault/token";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
  return { url, init: init ?? {} };
};
const reply = (res: Response) => fetchMock.mockResolvedValueOnce(res);
const fail = () => reply(new Response("", { status: 500 }));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("lang", "en");
  setVaultToken(null);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("narration calls", () => {
  it("fetchNarration", async () => {
    reply(json({ chapters: [] }));
    expect(await api.fetchNarration("s")).toEqual({ chapters: [] });
    expect(lastCall().url).toBe("/api/stories/s/narration");
    fail();
    await expect(api.fetchNarration("s")).rejects.toThrow("Could not load narration");
  });

  it("startNarration omits orders and regenerate by default", async () => {
    reply(json({ total: 1 }));
    await api.startNarration("s");
    expect(lastCall().url).toBe("/api/stories/s/narrate");
    expect(lastCall().init.body).toBe("{}");
  });

  it("startNarration sends orders and regenerate", async () => {
    reply(json({ total: 2 }));
    await api.startNarration("s", [1, 2], { regenerate: true });
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ orders: [1, 2], regenerate: true });
    fail();
    await expect(api.startNarration("s")).rejects.toThrow("Could not start narration");
  });

  it("stopNarration", async () => {
    reply(json({}));
    await api.stopNarration("s");
    expect(lastCall().url).toBe("/api/stories/s/narrate/stop");
    fail();
    await expect(api.stopNarration("s")).rejects.toThrow("Could not stop narration");
  });

  it("fetchNarrationTimeline returns the parts", async () => {
    reply(json({ parts: [{ block: -1, start: 0, end: 1 }] }));
    expect(await api.fetchNarrationTimeline("s", 3)).toEqual([{ block: -1, start: 0, end: 1 }]);
    expect(lastCall().url).toBe("/api/stories/s/chapters/3/narration");
  });

  it("deleteStoryAudio uses DELETE", async () => {
    reply(json({}));
    await api.deleteStoryAudio("s");
    expect(lastCall().init.method).toBe("DELETE");
    fail();
    await expect(api.deleteStoryAudio("s")).rejects.toThrow("Could not delete the audio");
  });
});

describe("chapterAudioUrl", () => {
  it("is plain without options or token", () => {
    expect(api.chapterAudioUrl("s", 2)).toBe("/api/stories/s/chapters/2/audio");
  });

  it("carries the vault token and download flag", () => {
    setVaultToken("t k");
    expect(api.chapterAudioUrl("s", 2, { download: true })).toBe(
      "/api/stories/s/chapters/2/audio?vault=t+k&download=1"
    );
  });

  it("adds music only for downloads, defaulting the volume", () => {
    expect(api.chapterAudioUrl("s", 2, { music: { musicId: "m" } })).not.toContain("music");
    expect(api.chapterAudioUrl("s", 2, { download: true, music: { musicId: "m" } })).toBe(
      "/api/stories/s/chapters/2/audio?download=1&music=m&musicVolume=0.3"
    );
    expect(api.chapterAudioUrl("s", 2, { download: true, music: { musicId: "m", musicVolume: 0.5 } })).toContain(
      "musicVolume=0.5"
    );
  });
});

describe("audio export", () => {
  it("exportStoryAudio adds the download url", async () => {
    reply(json({ exportId: "e/1", fileName: "f.zip", count: 2, missing: [] }));
    const out = await api.exportStoryAudio("s");
    expect(out.url).toBe("/api/exports/audio/e%2F1");
    expect(lastCall().url).toBe("/api/stories/s/export-audio");
    fail();
    await expect(api.exportStoryAudio("s")).rejects.toThrow("Could not export audio");
  });

  it("startAudioMix posts the music options", async () => {
    reply(json({ jobId: "j", total: 4 }));
    expect(await api.startAudioMix("s", { musicId: "m", format: "zip" })).toEqual({ jobId: "j", total: 4 });
    expect(lastCall().url).toBe("/api/stories/s/export-audio-mix");
    expect(lastCall().init.body).toBe('{"musicId":"m","format":"zip"}');
  });

  it("fetchAudioMix adds a url only once an export exists", async () => {
    reply(json({ state: "running", done: 1, total: 4 }));
    expect(await api.fetchAudioMix("j")).not.toHaveProperty("url");
    expect(lastCall().url).toBe("/api/exports/audio-mix/j");
    reply(json({ state: "done", done: 4, total: 4, exportId: "x" }));
    expect((await api.fetchAudioMix("j")).url).toBe("/api/exports/audio/x");
    fail();
    await expect(api.fetchAudioMix("j")).rejects.toThrow("Could not export audio");
  });
});
