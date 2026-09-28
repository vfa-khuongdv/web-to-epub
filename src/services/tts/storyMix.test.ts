import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mixStoryAudio } from "./storyMix";

const FAKE = path.join(__dirname, "__fixtures__", "fakeMixer.js");
const cmd = { command: process.execPath, args: [FAKE] };

describe("mixStoryAudio", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "story-mix-"));
    await fs.writeFile(path.join(dir, "1.mp3"), "a");
    await fs.writeFile(path.join(dir, "2.mp3"), "b");
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("sends the job on stdin, reports progress and resolves with the length", async () => {
    const out = path.join(dir, "story.mp3");
    const progress: number[] = [];
    const seconds = await mixStoryAudio(
      cmd,
      { chapters: [path.join(dir, "1.mp3"), path.join(dir, "2.mp3")], music: "/m.mp3", musicVolume: 0.2, out },
      (done) => progress.push(done)
    );
    expect(seconds).toBe(6);
    expect(progress).toEqual([1, 2]);
    expect(await fs.readFile(out, "utf8")).toBe("a+b~music@0.2");
  });

  it("rejects with the script's own error message", async () => {
    await expect(
      mixStoryAudio(cmd, { chapters: [path.join(dir, "gone.mp3")], musicVolume: 0.3, out: path.join(dir, "x.mp3") }, () => {})
    ).rejects.toThrow("missing chapter file");
  });
});
