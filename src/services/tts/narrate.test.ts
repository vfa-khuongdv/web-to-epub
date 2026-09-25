import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StoredStory } from "../../types";
import { StoryStore, createStoryStore, storyId } from "../storyStore";
import { chapterAudioPath } from "./audioCache";
import { NarrateEvent, NarrationSettings, chaptersToNarrate, isNarratable, narrateChapters, narrationStates } from "./narrate";
import { NarrationCancelled, SynthRequest, TtsWorker } from "./workerClient";

const STORY_ID = storyId("https://example.com/truyen/");

function story(): StoredStory {
  return {
    id: STORY_ID,
    storyUrl: "https://example.com/truyen/",
    site: "example.com",
    title: "Truyện",
    language: "vi",
    watching: false,
    newChapterCount: 0,
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    chapters: [
      { order: 1, url: "u1", title: "Chương 1", status: "done", blocks: [{ type: "paragraph", text: "Một." }] },
      { order: 2, url: "u2", title: "Chương 2", status: "pending" },
      { order: 3, url: "u3", title: "Chương 3", status: "done", blocks: [{ type: "paragraph", text: "FAIL" }] },
      { order: 4, url: "u4", title: "", status: "done", blocks: [{ type: "image", src: "x.png" }] },
      { order: 5, url: "u5", title: "Chương 5", status: "done", blocks: [{ type: "paragraph", text: "Năm." }] },
    ],
  };
}

// Stands in for TtsRuntime: records every synth, writes the file like the real worker,
// fails on the text "FAIL", and honours the abort signal like the worker's cancel.
function fakeRuntime() {
  const calls: { variant: string; request: SynthRequest }[] = [];
  const runtime = {
    calls,
    beforeSynth: undefined as undefined | ((request: SynthRequest) => void),
    async withModel<T>(variant: string, fn: (worker: TtsWorker) => Promise<T>): Promise<T> {
      const worker = {
        closed: false,
        load: async () => ({ variant, voices: [], sampleRate: 24000 }),
        close: () => {},
        synth: async (request: SynthRequest) => {
          calls.push({ variant, request });
          runtime.beforeSynth?.(request);
          if (request.signal?.aborted) throw new NarrationCancelled();
          if (request.parts.includes("FAIL")) throw new Error("model blew up");
          request.onProgress?.(1, request.parts.length);
          await fs.writeFile(request.out, request.parts.join("|"));
          return { seconds: request.parts.length * 2 };
        },
      } as unknown as TtsWorker;
      return fn(worker);
    },
  };
  return runtime;
}

describe("isNarratable", () => {
  it("accepts Vietnamese and stories without a language, nothing else", () => {
    expect(isNarratable({ language: "vi" })).toBe(true);
    expect(isNarratable({ language: undefined as unknown as string })).toBe(true);
    expect(isNarratable({ language: "en" })).toBe(false);
  });
});

describe("narration job", () => {
  let dir: string;
  let stories: StoryStore;
  let settings: NarrationSettings;
  let events: NarrateEvent[];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "narrate-"));
    stories = createStoryStore(dir);
    await stories.save(story());
    settings = { variant: "turbo", voice: "A" };
    events = [];
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const job = (runtime: ReturnType<typeof fakeRuntime>, signal = new AbortController().signal) => ({
    stories,
    dataDir: dir,
    storyId: STORY_ID,
    settings: () => settings,
    runtime,
    signal,
    onEvent: (event: NarrateEvent) => events.push(event),
  });

  it("plans readable chapters only, optionally the requested ones", async () => {
    expect(await chaptersToNarrate(stories, STORY_ID)).toEqual([1, 3, 4, 5]);
    expect(await chaptersToNarrate(stories, STORY_ID, [5, 2, 1])).toEqual([1, 5]);
    expect(await chaptersToNarrate(stories, "missing")).toEqual([]);
  });

  it("narrates each chapter, reports progress, skips empty chapters and carries on past a failure", async () => {
    const runtime = fakeRuntime();
    const result = await narrateChapters(job(runtime), [1, 3, 4, 5]);

    expect(result).toEqual({ done: 2, failed: 1 });
    expect(runtime.calls.map((c) => c.request.parts)).toEqual([["Chương 1", "Một."], ["Chương 3", "FAIL"], ["Chương 5", "Năm."]]);
    expect(runtime.calls.every((c) => c.variant === "turbo" && c.request.voice === "A")).toBe(true);
    expect(await fs.readFile(chapterAudioPath(dir, STORY_ID, 1), "utf8")).toBe("Chương 1|Một.");

    expect(events.map((e) => [e.type, "order" in e ? e.order : undefined])).toEqual([
      ["narrate-progress", 1],
      ["narrate-chapter-done", 1],
      ["narrate-error", 3],
      ["narrate-chapter-done", 4],
      ["narrate-progress", 5],
      ["narrate-chapter-done", 5],
    ]);
    expect(events.find((e) => e.type === "narrate-error")).toMatchObject({ message: "model blew up" });
    expect(events.at(-1)).toMatchObject({ seconds: 4, skipped: false, done: 2, total: 4 });
  });

  it("skips chapters whose audio is fresh, and redoes them when text or voice change", async () => {
    await narrateChapters(job(fakeRuntime()), [1, 5]);
    expect(await narrationStates(stories, dir, STORY_ID, settings)).toEqual({ 1: "ready", 3: "missing", 4: "missing", 5: "ready" });

    const again = fakeRuntime();
    await narrateChapters(job(again), [1, 5]);
    expect(again.calls).toHaveLength(0);

    const edited = (await stories.getChapter(STORY_ID, 1))!;
    edited.blocks = [{ type: "paragraph", text: "Một, đã sửa." }];
    await stories.saveChapter(STORY_ID, edited);
    settings = { variant: "turbo", voice: "B" };
    expect(await narrationStates(stories, dir, STORY_ID, settings)).toMatchObject({ 1: "missing", 5: "missing" });

    const redo = fakeRuntime();
    await narrateChapters(job(redo), [1, 5]);
    expect(redo.calls.map((c) => c.request.voice)).toEqual(["B", "B"]);
  });

  it("reads the voice per chapter, so a change applies from the next chapter", async () => {
    const runtime = fakeRuntime();
    runtime.beforeSynth = () => {
      settings = { variant: "nano", voice: "" };
    };
    await narrateChapters(job(runtime), [1, 5]);
    expect(runtime.calls.map((c) => c.variant)).toEqual(["turbo", "nano"]);
  });

  it("stops on cancel without reporting an error", async () => {
    const abort = new AbortController();
    const runtime = fakeRuntime();
    runtime.beforeSynth = () => abort.abort();
    const result = await narrateChapters(job(runtime, abort.signal), [1, 5]);
    expect(result).toEqual({ done: 0, failed: 0 });
    expect(runtime.calls).toHaveLength(1);
    expect(events.some((e) => e.type === "narrate-error")).toBe(false);
  });
});
