// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./stories";
import { setVaultToken } from "../../vault/token";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
  return { url, init: init ?? {}, headers: (init?.headers ?? {}) as Record<string, string> };
};
const reply = (res: Response) => fetchMock.mockResolvedValueOnce(res);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("lang", "en");
  setVaultToken(null);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("crawl", () => {
  it("startStoryCrawl posts orders", async () => {
    reply(json({ total: 3 }));
    expect(await api.startStoryCrawl("a/b", [1, 2])).toEqual({ total: 3 });
    const { url, init, headers } = lastCall();
    expect(url).toBe("/api/stories/a%2Fb/crawl");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ orders: [1, 2] }));
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Lang"]).toBeDefined();
  });

  it("maps errors to the server message or a fallback", async () => {
    reply(json({ message: "busy" }, 409));
    await expect(api.startStoryCrawl("a")).rejects.toThrow("busy");
    reply(new Response("", { status: 500 }));
    await expect(api.startStoryCrawl("a")).rejects.toThrow("Could not start crawl");
  });

  it("stopStoryCrawl posts to stop", async () => {
    reply(json({}));
    await api.stopStoryCrawl("a");
    expect(lastCall().url).toBe("/api/stories/a/crawl/stop");
    reply(new Response("", { status: 500 }));
    await expect(api.stopStoryCrawl("a")).rejects.toThrow("Could not stop crawl");
  });
});

describe("list and create", () => {
  it("fetchStories returns the list, or [] when absent", async () => {
    reply(json({ stories: [{ id: "1" }] }));
    expect(await api.fetchStories()).toEqual([{ id: "1" }]);
    reply(json({}));
    expect(await api.fetchStories()).toEqual([]);
    reply(new Response("", { status: 500 }));
    await expect(api.fetchStories()).rejects.toThrow("Could not load story list");
  });

  it("createStory sends ai only when requested", async () => {
    reply(json({ story: { id: "1" } }));
    await api.createStory("http://x");
    expect(lastCall().init.body).toBe('{"url":"http://x"}');
    reply(json({ story: { id: "1" } }));
    expect(await api.createStory("http://x", { ai: true })).toEqual({ id: "1" });
    expect(lastCall().init.body).toBe('{"url":"http://x","ai":true}');
    reply(new Response("", { status: 500 }));
    await expect(api.createStory("u")).rejects.toThrow("Could not load chapters");
  });

  it("sends the vault token header when held", async () => {
    setVaultToken("tok");
    reply(json({ stories: [] }));
    await api.fetchStories();
    expect(lastCall().headers["X-Vault-Token"]).toBe("tok");
  });
});

describe("imports", () => {
  it("importEpub sends the file with name and overwrite", async () => {
    const file = new File(["x"], "my book.epub", { type: "application/epub+zip" });
    reply(json({ story: { id: "1" } }));
    await api.importEpub(file, { overwrite: true });
    const { url, init, headers } = lastCall();
    expect(url).toBe("/api/stories/import-epub?name=my+book.epub&overwrite=1");
    expect(init.body).toBe(file);
    expect(headers["Content-Type"]).toBe("application/epub+zip");
  });

  it("importEpub falls back to octet-stream and omits overwrite", async () => {
    reply(json({ story: {} }));
    await api.importEpub(new File(["x"], "a.pdf"));
    expect(lastCall().url).toBe("/api/stories/import-epub?name=a.pdf");
    expect(lastCall().headers["Content-Type"]).toBe("application/octet-stream");
  });

  it("importEpub maps 409 to an error carrying code, status and story", async () => {
    reply(json({ message: "dup", code: "exists", story: { id: "s" } }, 409));
    await expect(api.importEpub(new File(["x"], "a.epub"))).rejects.toMatchObject({
      message: "dup",
      status: 409,
      code: "exists",
      story: { id: "s" },
    });
  });

  it("importEpub uses a fallback message on a non-json failure", async () => {
    reply(new Response("oops", { status: 500 }));
    await expect(api.importEpub(new File(["x"], "a.epub"))).rejects.toMatchObject({
      message: "Could not import the file",
      status: 500,
    });
  });

  it.each([
    ["importArchive", api.importArchive, "import-archive", "Could not import from Internet Archive"],
    ["importDtvEbook", api.importDtvEbook, "import-dtvebook", "Could not import from DTV Ebook"],
    ["importHeyzine", api.importHeyzine, "import-heyzine", "Could not import from Heyzine"],
  ])("%s posts the url", async (_n, fn, path, fallback) => {
    reply(json({ story: { id: "1" } }));
    expect(await fn("http://u")).toEqual({ id: "1" });
    expect(lastCall().url).toBe(`/api/stories/${path}`);
    expect(lastCall().init.body).toBe('{"url":"http://u"}');

    reply(json({ story: { id: "1" } }));
    await fn("http://u", { overwrite: true });
    expect(lastCall().url).toBe(`/api/stories/${path}?overwrite=1`);

    reply(json({ code: "exists", story: { id: "z" } }, 409));
    await expect(fn("http://u")).rejects.toMatchObject({ message: fallback, status: 409, code: "exists" });
  });
});

describe("story and chapter calls", () => {
  it("fetchStory / fetchStorySize unwrap their payloads", async () => {
    reply(json({ story: { id: "1" } }));
    expect(await api.fetchStory("1")).toEqual({ id: "1" });
    reply(json({ size: { total: 5 } }));
    expect(await api.fetchStorySize("1")).toEqual({ total: 5 });
    expect(lastCall().url).toBe("/api/stories/1/size");
    reply(new Response("", { status: 404 }));
    await expect(api.fetchStory("1")).rejects.toThrow("Could not load story");
  });

  it("saveStoryMeta posts form data without a content-type header", async () => {
    const form = new FormData();
    reply(json({ story: { id: "1" } }));
    await api.saveStoryMeta("1", form);
    const { url, init, headers } = lastCall();
    expect(url).toBe("/api/stories/1/meta");
    expect(init.body).toBe(form);
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it.each([
    ["saveChapterEdit", () => api.saveChapterEdit("s", 2, { title: "t", contentHtml: "<p/>" }), "/api/stories/s/chapters/2", { title: "t", contentHtml: "<p/>" }],
    ["saveChapterUrl", () => api.saveChapterUrl("s", 2, "http://u"), "/api/stories/s/chapters/2/url", { url: "http://u" }],
    ["saveChapterTitle", () => api.saveChapterTitle("s", 2, "T"), "/api/stories/s/chapters/2/title", { title: "T" }],
    ["saveChapterSpellChecked", () => api.saveChapterSpellChecked("s", 2, true), "/api/stories/s/chapters/2/spell-checked", { spellChecked: true }],
  ])("%s PATCHes and returns the chapter", async (_n, call, url, body) => {
    reply(json({ chapter: { order: 2 } }));
    expect(await call()).toEqual({ order: 2 });
    expect(lastCall().url).toBe(url);
    expect(lastCall().init.method).toBe("PATCH");
    expect(JSON.parse(lastCall().init.body as string)).toEqual(body);
    reply(new Response("", { status: 500 }));
    await expect(call()).rejects.toThrow();
  });

  it("deleteStory and deleteChapter use DELETE", async () => {
    reply(json({}));
    await api.deleteStory("a b");
    expect(lastCall().url).toBe("/api/stories/a%20b");
    expect(lastCall().init.method).toBe("DELETE");
    reply(json({}));
    await api.deleteChapter("s", 4);
    expect(lastCall().url).toBe("/api/stories/s/chapters/4");
    reply(new Response("", { status: 500 }));
    await expect(api.deleteChapter("s", 4)).rejects.toThrow("Could not delete chapter");
  });

  it("setStoryWatch posts the flag", async () => {
    reply(json({ story: { watching: true } }));
    expect(await api.setStoryWatch("s", true)).toEqual({ watching: true });
    expect(lastCall().url).toBe("/api/stories/s/watch");
    expect(lastCall().init.body).toBe('{"watching":true}');
  });

  it("checkStoryUpdates carries the status on failure", async () => {
    reply(json({ newChapterCount: 2 }));
    expect(await api.checkStoryUpdates("s")).toEqual({ newChapterCount: 2 });
    reply(json({ message: "site down" }, 502));
    await expect(api.checkStoryUpdates("s")).rejects.toMatchObject({ message: "site down", status: 502 });
  });

  it("refreshStoryToc posts to refresh", async () => {
    reply(json({ story: { id: "s" } }));
    expect(await api.refreshStoryToc("s")).toEqual({ id: "s" });
    expect(lastCall().url).toBe("/api/stories/s/refresh");
    reply(new Response("", { status: 500 }));
    await expect(api.refreshStoryToc("s")).rejects.toThrow("Could not load new chapter list");
  });

  it("uploadCover posts a form with the file and returns the path", async () => {
    reply(json({ path: "/covers/x.jpg" }));
    const file = new File(["x"], "c.png");
    expect(await api.uploadCover(file)).toBe("/covers/x.jpg");
    const body = lastCall().init.body as FormData;
    expect(body.get("cover")).toBeInstanceOf(File);
    reply(new Response("", { status: 500 }));
    await expect(api.uploadCover(file)).rejects.toThrow("Cover upload failed");
  });

  it("fetchChapterContent returns the chapter", async () => {
    reply(json({ chapter: { order: 1 } }));
    expect(await api.fetchChapterContent("s", 1)).toEqual({ order: 1 });
    expect(lastCall().url).toBe("/api/stories/s/chapters/1");
  });
});
