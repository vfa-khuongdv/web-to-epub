// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./tts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
  return { url, init: init ?? {}, headers: (init?.headers ?? {}) as Record<string, string> };
};
const reply = (res: Response) => fetchMock.mockResolvedValueOnce(res);
const fail = () => reply(new Response("", { status: 500 }));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("lang", "en");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("tts api", () => {
  it("fetchTtsStatus builds the query from its options", async () => {
    reply(json({ a: 1 }));
    await api.fetchTtsStatus();
    expect(lastCall().url).toBe("/api/tts/status");
    reply(json({}));
    await api.fetchTtsStatus(true, "omnivoice" as never);
    expect(lastCall().url).toBe("/api/tts/status?disk=1&engine=omnivoice");
    fail();
    await expect(api.fetchTtsStatus()).rejects.toThrow("Could not check narration");
  });

  it("installTts posts the variant", async () => {
    reply(json({ installed: true }));
    expect(await api.installTts("turbo" as never)).toEqual({ installed: true });
    expect(lastCall().url).toBe("/api/tts/install");
    expect(lastCall().init.body).toBe('{"variant":"turbo"}');
    fail();
    await expect(api.installTts("turbo" as never)).rejects.toThrow("Could not install narration");
  });

  it("uninstallTts deletes by engine", async () => {
    reply(json({}));
    await api.uninstallTts("vieneu" as never);
    expect(lastCall().url).toBe("/api/tts?engine=vieneu");
    expect(lastCall().init.method).toBe("DELETE");
    fail();
    await expect(api.uninstallTts("vieneu" as never)).rejects.toThrow("Could not uninstall narration");
  });

  it("fetchTtsVoices unwraps voices", async () => {
    reply(json({ voices: [{ id: "v" }] }));
    expect(await api.fetchTtsVoices("nano" as never)).toEqual([{ id: "v" }]);
    expect(lastCall().url).toBe("/api/tts/voices?variant=nano");
    fail();
    await expect(api.fetchTtsVoices("nano" as never)).rejects.toThrow("Could not load voices");
  });

  it("uploadTtsVoice sends the file raw, with a trimmed transcript only when given", async () => {
    const file = new File(["x"], "a.wav");
    reply(json({ id: "custom:1" }));
    await api.uploadTtsVoice("My voice", file);
    expect(lastCall().url).toBe("/api/tts/voices?name=My+voice");
    expect(lastCall().init.body).toBe(file);
    expect(lastCall().headers["Content-Type"]).toBe("application/octet-stream");
    reply(json({}));
    await api.uploadTtsVoice("v", file, "  hello  ");
    expect(lastCall().url).toBe("/api/tts/voices?name=v&transcript=hello");
    reply(json({}));
    await api.uploadTtsVoice("v", file, "   ");
    expect(lastCall().url).toBe("/api/tts/voices?name=v");
    fail();
    await expect(api.uploadTtsVoice("v", file)).rejects.toThrow("Could not upload the voice");
  });

  it("deleteTtsVoice encodes the id", async () => {
    reply(json({}));
    await api.deleteTtsVoice("custom:1");
    expect(lastCall().url).toBe("/api/tts/voices/custom%3A1");
    expect(lastCall().init.method).toBe("DELETE");
    fail();
    await expect(api.deleteTtsVoice("x")).rejects.toThrow("Could not remove the voice");
  });

  it("previewTts returns the audio blob", async () => {
    reply(new Response("audio", { status: 200 }));
    const blob = await api.previewTts("turbo" as never, "v1");
    expect(await blob.text()).toBe("audio");
    expect(lastCall().init.body).toBe('{"variant":"turbo","voice":"v1"}');
    fail();
    await expect(api.previewTts("turbo" as never, "v1")).rejects.toThrow("Could not preview the voice");
  });
});
