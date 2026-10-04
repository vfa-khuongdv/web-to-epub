// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportStoryEpub } from "./epubExport";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ndjson = (events: unknown[]) =>
  new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("lang", "en");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const meta = { title: "T" } as never;

describe("exportStoryEpub", () => {
  it("streams progress, then downloads each exported file", async () => {
    fetchMock
      .mockResolvedValueOnce(
        ndjson([
          { type: "progress", phase: "images", done: 1, total: 4 },
          { type: "progress", phase: "packaging" },
          { type: "done", exports: [{ exportId: "a/1", fileName: "A (1/2).epub" }, { exportId: "b", fileName: "A (2/2).epub" }] },
        ])
      )
      .mockResolvedValueOnce(new Response("one"))
      .mockResolvedValueOnce(new Response("two"));
    const progress: unknown[] = [];
    const files = await exportStoryEpub("s 1", meta, [{ order: 1, title: "c" }], (p) => progress.push(p), true);

    expect(progress).toEqual([
      { phase: "images", done: 1, total: 4 },
      { phase: "packaging", done: 0, total: 0 },
    ]);
    expect(files.map((f) => f.fileName)).toEqual(["A (1/2).epub", "A (2/2).epub"]);
    expect(await files[0].blob.text()).toBe("one");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/stories/s%201/export");
    expect(JSON.parse(init.body as string)).toEqual({
      metadata: meta,
      chapters: [{ order: 1, title: "c" }],
      includeNarration: true,
    });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/exports/a%2F1");
  });

  it("defaults includeNarration to false", async () => {
    fetchMock.mockResolvedValueOnce(ndjson([{ type: "done", exports: [{ exportId: "a", fileName: "f" }] }]));
    fetchMock.mockResolvedValueOnce(new Response("x"));
    await exportStoryEpub("s", meta, []);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).includeNarration).toBe(false);
  });

  it("throws the stream's error event", async () => {
    fetchMock.mockResolvedValueOnce(ndjson([{ type: "error", message: "disk full" }]));
    await expect(exportStoryEpub("s", meta, [])).rejects.toThrow("disk full");
  });

  it("throws when the stream ends without files", async () => {
    fetchMock.mockResolvedValueOnce(ndjson([{ type: "progress", phase: "images", done: 0, total: 0 }]));
    await expect(exportStoryEpub("s", meta, [])).rejects.toThrow("stream ended without file");
    fetchMock.mockResolvedValueOnce(ndjson([{ type: "done", exports: [] }]));
    await expect(exportStoryEpub("s", meta, [])).rejects.toThrow("stream ended without file");
  });

  it("throws when a download fails", async () => {
    fetchMock.mockResolvedValueOnce(ndjson([{ type: "done", exports: [{ exportId: "a", fileName: "f" }] }]));
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await expect(exportStoryEpub("s", meta, [])).rejects.toThrow("Could not download the exported EPUB file");
  });

  it("throws when the export request itself fails", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "no story" }, 404));
    await expect(exportStoryEpub("s", meta, [])).rejects.toThrow("no story");
  });
});
