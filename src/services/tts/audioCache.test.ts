import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chapterAudioPath,
  ensureStoryAudioDir,
  narrationKey,
  readFreshAudio,
  removeStoryAudio,
  storyAudioBytes,
  writeAudioMeta,
} from "./audioCache";

const voice = { variant: "turbo", voice: "Ngọc Linh" };

describe("narrationKey", () => {
  it("changes with the text, the variant, the voice and the engine version", () => {
    const base = narrationKey(["a", "b"], voice, "3.8.3");
    expect(narrationKey(["a", "b"], voice, "3.8.3")).toBe(base);
    expect(narrationKey(["a", "c"], voice, "3.8.3")).not.toBe(base);
    expect(narrationKey(["ab"], voice, "3.8.3")).not.toBe(base);
    expect(narrationKey(["a", "b"], { ...voice, variant: "nano" }, "3.8.3")).not.toBe(base);
    expect(narrationKey(["a", "b"], { ...voice, voice: "Adam" }, "3.8.3")).not.toBe(base);
    expect(narrationKey(["a", "b"], voice, "3.9.0")).not.toBe(base);
  });
});

describe("audio cache", () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "audio-cache-"));
  });
  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("returns audio only when the file exists and the key matches", async () => {
    await ensureStoryAudioDir(dataDir, "s1");
    expect(await readFreshAudio(dataDir, "s1", 3, "k1")).toBeUndefined();

    await fs.writeFile(chapterAudioPath(dataDir, "s1", 3), "mp3");
    // MP3 without meta = interrupted synthesis
    expect(await readFreshAudio(dataDir, "s1", 3, "k1")).toBeUndefined();

    await writeAudioMeta(dataDir, "s1", 3, "k1", 12.5);
    expect(await readFreshAudio(dataDir, "s1", 3, "k1")).toEqual({
      filePath: chapterAudioPath(dataDir, "s1", 3),
      seconds: 12.5,
    });
    expect(await readFreshAudio(dataDir, "s1", 3, "k2")).toBeUndefined();
  });

  it("reports size and removes a story's audio", async () => {
    await ensureStoryAudioDir(dataDir, "s1");
    await fs.writeFile(chapterAudioPath(dataDir, "s1", 1), "12345");
    expect(await storyAudioBytes(dataDir, "s1")).toBe(5);
    await removeStoryAudio(dataDir, "s1");
    expect(await storyAudioBytes(dataDir, "s1")).toBe(0);
    await removeStoryAudio(dataDir, "missing");
  });
});
