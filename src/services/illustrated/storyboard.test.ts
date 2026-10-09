import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  parseStoryboard,
  partWindows,
  readStoryboard,
  saveStoryboard,
  splitLongScenes,
  storyboardKey,
  targetScenes,
  timeScenes,
  writeStoryboard,
} from "./storyboard";
import { Bible, Scene } from "./types";

const bible = { style: "flat", createdAt: "t", characters: [{ id: "a", name: "A", description: "", body: "", headY: -380, faces: {} }] } as unknown as Bible;
const scene = (from: number, to: number, extra: Partial<Scene> = {}) => ({ from, to, place: "field", time: "day", cast: [], ...extra });
const sc = (fromPart: number, toPart: number): Scene => ({ fromPart, toPart, place: "field", time: "day", cast: [] });
const reply = (scenes: unknown[]) => JSON.stringify({ scenes });

describe("partWindows", () => {
  it("uses the narration timings when they match the parts", () => {
    expect(partWindows(["a", "b"], 10, [[0, 4], [4.5, 9]])).toEqual([[0, 4], [4.5, 9]]);
  });
  it("shares the length by text size without timings", () => {
    const windows = partWindows(["aaa", "a"], 8);
    expect(windows[0]).toEqual([0, 6]);
    expect(windows[1][0]).toBe(6);
    expect(windows[1][1]).toBeCloseTo(8);
  });
});

describe("targetScenes", () => {
  it("is about one scene per seven seconds, never more than the parts", () => {
    expect(targetScenes(68, 14)).toBe(10);
    expect(targetScenes(68, 4)).toBe(4);
    expect(targetScenes(1, 3)).toBe(1);
  });
});

describe("parseStoryboard", () => {
  it("accepts scenes that cover every part in order", () => {
    const scenes = parseStoryboard(reply([scene(0, 1, { cast: [{ id: "a", spot: "left", expression: "smile" }] }), scene(2, 3)]), bible, 4);
    expect(scenes.map((s) => [s.fromPart, s.toPart])).toEqual([[0, 1], [2, 3]]);
    expect(scenes[0].cast[0]).toEqual({ id: "a", spot: "left", expression: "smile" });
  });

  it.each([
    ["a gap", reply([scene(0, 0), scene(2, 3)])],
    ["not reaching the last part", reply([scene(0, 1)])],
    ["starting after 0", reply([scene(1, 3)])],
    ["an unknown character", reply([scene(0, 3, { cast: [{ id: "zzz", spot: "left", expression: "sad" }] })])],
    ["a repeated spot", reply([scene(0, 3, { cast: [{ id: "a", spot: "left", expression: "sad" }, { id: "a", spot: "left", expression: "sad" }] })])],
    ["a bad place", reply([scene(0, 3, { place: "moon" })])],
    ["no JSON", "không biết"],
  ])("refuses %s", (_name, text) => {
    expect(() => parseStoryboard(text, bible, 4)).toThrow();
  });
});

describe("splitLongScenes + timeScenes", () => {
  const windows: [number, number][] = [[0, 20], [20, 40], [40, 60], [60, 80]];
  it("cuts a scene longer than 30 s at part boundaries", () => {
    const split = splitLongScenes([sc(0, 3)], windows, 80);
    expect(split.map((s) => [s.fromPart, s.toPart])).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
  });
  it("times scenes from the part windows and keeps captions inside them", () => {
    const timed = timeScenes([sc(0, 1), sc(2, 3)], ["p0", "p1", "p2", "p3"], windows, 80);
    expect([timed[0].from, timed[0].to, timed[1].from, timed[1].to]).toEqual([0, 40, 40, 80]);
    expect(timed[0].captions.map((c) => [c.text, c.from, c.to])).toEqual([["p0", 0, 20], ["p1", 20, 40]]);
  });
});

describe("writeStoryboard + cache", () => {
  it("retries with the reason and caches by key", async () => {
    const prompts: string[] = [];
    const answers = [reply([scene(0, 0)]), reply([scene(0, 1)])];
    const agent = { complete: async (p: string) => (prompts.push(p), answers.shift() ?? "") };
    const scenes = await writeStoryboard(agent, { storyTitle: "T", bible, parts: ["a", "b"], windows: [[0, 1], [1, 2]], seconds: 2 });
    expect(scenes).toHaveLength(1);
    expect(prompts[1]).toContain("Lần trước bị từ chối vì");

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sb-"));
    const key = storyboardKey(bible, ["a", "b"]);
    await saveStoryboard(dir, "s", 1, key, scenes);
    expect(await readStoryboard(dir, "s", 1, key)).toEqual(scenes);
    expect(await readStoryboard(dir, "s", 1, storyboardKey(bible, ["a", "changed"]))).toBeUndefined();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
