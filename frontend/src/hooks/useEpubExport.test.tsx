// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookMetadata } from "../types";

const api = vi.hoisted(() => ({ exportStoryEpub: vi.fn(), uploadCover: vi.fn() }));
vi.mock("../lib/api", () => api);

import { exportProgressLabel, useEpubExport } from "./useEpubExport";

const meta = { title: "T", coverUrl: "old.jpg" } as unknown as BookMetadata;
const file = (name: string) => ({ blob: new Blob(["x"]), fileName: name });
const tr = (key: string, params?: Record<string, string | number>) =>
  key.replace(/\{(\w+)\}/g, (_, n: string) => String(params?.[n]));

let clicked: string[];

beforeEach(() => {
  clicked = [];
  api.exportStoryEpub.mockReset();
  api.uploadCover.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.download);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (window as { electronExport?: unknown }).electronExport;
});

describe("exportProgressLabel", () => {
  it("labels each phase", () => {
    expect(exportProgressLabel({ phase: "packaging", done: 0, total: 0 }, tr)).toBe("Packaging EPUB…");
    expect(exportProgressLabel({ phase: "images", done: 2, total: 5 }, tr)).toBe("Downloading images 2/5…");
    expect(exportProgressLabel({ phase: "media", done: 1, total: 3 }, tr)).toBe("Downloading audio/video 1/3…");
  });
});

describe("useEpubExport", () => {
  it("downloads each file in a plain browser and returns the count", async () => {
    vi.useFakeTimers();
    api.exportStoryEpub.mockResolvedValue([file("a.epub"), file("b.epub")]);
    const { result } = renderHook(() => useEpubExport());
    let count: number | null = null;
    const p = act(async () => {
      const run = result.current.exportStoryBook("s1", meta, [], null, true);
      await vi.advanceTimersByTimeAsync(1000);
      count = await run;
    });
    await p;
    expect(count).toBe(2);
    expect(clicked).toEqual(["a.epub", "b.epub"]);
    expect(api.exportStoryEpub).toHaveBeenCalledWith("s1", { ...meta, coverUrl: "old.jpg" }, [], expect.any(Function), true);
    expect(result.current.isExporting).toBe(false);
    expect(result.current.progress).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("uploads a new cover first and uses its URL", async () => {
    api.uploadCover.mockResolvedValue("new.jpg");
    api.exportStoryEpub.mockResolvedValue([file("a.epub")]);
    const { result } = renderHook(() => useEpubExport());
    const cover = new File(["c"], "c.png");
    await act(() => result.current.exportStoryBook("s1", meta, [], cover));
    expect(api.uploadCover).toHaveBeenCalledWith(cover);
    expect(api.exportStoryEpub.mock.calls[0][1].coverUrl).toBe("new.jpg");
  });

  it("reports progress while exporting", async () => {
    let release!: () => void;
    api.exportStoryEpub.mockImplementation(async (_i, _m, _c, onProgress) => {
      onProgress({ phase: "images", done: 1, total: 2 });
      await new Promise<void>((r) => (release = r));
      return [file("a.epub")];
    });
    const { result } = renderHook(() => useEpubExport());
    let run!: Promise<number | null>;
    act(() => {
      run = result.current.exportStoryBook("s1", meta, [], null);
    });
    await vi.waitFor(() => expect(result.current.progress).toEqual({ phase: "images", done: 1, total: 2 }));
    expect(result.current.isExporting).toBe(true);
    await act(async () => {
      release();
      await run;
    });
    expect(result.current.isExporting).toBe(false);
  });

  it("ignores a second call while one is running", async () => {
    let release!: () => void;
    api.exportStoryEpub.mockImplementation(
      () => new Promise((r) => (release = () => r([file("a.epub")])))
    );
    const { result } = renderHook(() => useEpubExport());
    let first!: Promise<number | null>;
    let second: number | null = 0;
    await act(async () => {
      first = result.current.exportStoryBook("s1", meta, [], null);
      second = await result.current.exportStoryBook("s1", meta, [], null);
    });
    expect(second).toBeNull();
    expect(api.exportStoryEpub).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await first;
    });
  });

  it("writes into the folder picked in the Electron app", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const pickFolder = vi.fn().mockResolvedValue("/out");
    (window as unknown as { electronExport: unknown }).electronExport = { pickFolder, writeFile, saveUrl: vi.fn() };
    // jsdom's Blob has no arrayBuffer().
    const blob = { arrayBuffer: async () => new ArrayBuffer(1) } as unknown as Blob;
    api.exportStoryEpub.mockResolvedValue([{ blob, fileName: "a.epub" }]);
    const { result } = renderHook(() => useEpubExport());
    let count: number | null = null;
    await act(async () => {
      count = await result.current.exportStoryBook("s1", meta, [], null);
    });
    expect(count).toBe(1);
    expect(writeFile).toHaveBeenCalledWith("/out", "a.epub", expect.any(ArrayBuffer));
    expect(clicked).toEqual([]);
  });

  it("returns null without exporting when the folder dialog is cancelled", async () => {
    (window as unknown as { electronExport: unknown }).electronExport = {
      pickFolder: vi.fn().mockResolvedValue(null),
      writeFile: vi.fn(),
      saveUrl: vi.fn(),
    };
    const { result } = renderHook(() => useEpubExport());
    let count: number | null = 5;
    await act(async () => {
      count = await result.current.exportStoryBook("s1", meta, [], null);
    });
    expect(count).toBeNull();
    expect(api.exportStoryEpub).not.toHaveBeenCalled();
    expect(result.current.isExporting).toBe(false);
  });

  it("resets state and rethrows when the export fails, allowing a retry", async () => {
    api.exportStoryEpub.mockRejectedValueOnce(new Error("fail")).mockResolvedValueOnce([file("a.epub")]);
    const { result } = renderHook(() => useEpubExport());
    await act(async () => {
      await expect(result.current.exportStoryBook("s1", meta, [], null)).rejects.toThrow("fail");
    });
    expect(result.current.isExporting).toBe(false);
    let count: number | null = null;
    await act(async () => {
      count = await result.current.exportStoryBook("s1", meta, [], null);
    });
    expect(count).toBe(1);
  });
});
