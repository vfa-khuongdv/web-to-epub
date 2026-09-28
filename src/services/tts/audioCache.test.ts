import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chapterAudioPath,
  ensureStoryAudioDir,
  readChapterAudio,
  removeChapterAudio,
  removeStoryAudio,
  storyAudioBytes,
  textKey,
  writeAudioMeta,
} from "./audioCache";

const voice = { variant: "turbo", voice: "Ngọc Linh" };
const info = { seconds: 12.5, voice, engineVersion: "3.8.3" };

describe("textKey", () => {
  it("depends on the text only, part boundaries included", () => {
    expect(textKey(["a", "b"])).toBe(textKey(["a", "b"]));
    expect(textKey(["a", "c"])).not.toBe(textKey(["a", "b"]));
    expect(textKey(["ab"])).not.toBe(textKey(["a", "b"]));
  });
});

describe("audio cache", () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "audio-cache-"));
    await ensureStoryAudioDir(dataDir, "s1");
  });
  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("returns audio once the MP3 and its meta both exist — whatever text the chapter now has", async () => {
    expect(await readChapterAudio(dataDir, "s1", 3)).toBeUndefined();

    await fs.writeFile(chapterAudioPath(dataDir, "s1", 3), "mp3");
    // MP3 without meta = interrupted synthesis
    expect(await readChapterAudio(dataDir, "s1", 3)).toBeUndefined();

    await writeAudioMeta(dataDir, "s1", 3, ["a"], { ...info, timings: [[0, 1.5]] });
    expect(await readChapterAudio(dataDir, "s1", 3)).toEqual({
      filePath: chapterAudioPath(dataDir, "s1", 3),
      seconds: 12.5,
      timings: [[0, 1.5]],
    });
  });

  it("still reads audio saved with the old voice-bound key", async () => {
    await fs.writeFile(chapterAudioPath(dataDir, "s1", 1), "mp3");
    await fs.writeFile(path.join(dataDir, "audio", "s1", "1.json"), JSON.stringify({ key: "old", seconds: 4 }));
    expect(await readChapterAudio(dataDir, "s1", 1)).toMatchObject({ seconds: 4 });
  });

  it("reports size and removes a story's audio", async () => {
    await fs.writeFile(chapterAudioPath(dataDir, "s1", 1), "12345");
    expect(await storyAudioBytes(dataDir, "s1")).toBe(5);
    await removeStoryAudio(dataDir, "s1");
    expect(await storyAudioBytes(dataDir, "s1")).toBe(0);
    await removeStoryAudio(dataDir, "missing");
  });

  it("removes one chapter's audio and meta, leaving the others", async () => {
    await fs.writeFile(chapterAudioPath(dataDir, "s1", 1), "mp3");
    await writeAudioMeta(dataDir, "s1", 1, ["a"], info);
    await fs.writeFile(chapterAudioPath(dataDir, "s1", 2), "mp3");
    await writeAudioMeta(dataDir, "s1", 2, ["b"], info);

    await removeChapterAudio(dataDir, "s1", 1);
    expect(await readChapterAudio(dataDir, "s1", 1)).toBeUndefined();
    expect(await fs.readdir(path.join(dataDir, "audio", "s1"))).toEqual(expect.arrayContaining(["2.mp3", "2.json"]));
    expect(await fs.readdir(path.join(dataDir, "audio", "s1"))).not.toContain("1.json");
    // Nothing narrated yet is not an error.
    await removeChapterAudio(dataDir, "missing", 1);
  });
});
