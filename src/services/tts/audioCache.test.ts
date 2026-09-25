import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chapterAudioPath,
  ensureStoryAudioDir,
  legacyNarrationKey,
  readFreshAudio,
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

  it("returns audio only when the file exists and its text matches — whatever the voice", async () => {
    expect(await readFreshAudio(dataDir, "s1", 3, ["a"])).toBeUndefined();

    await fs.writeFile(chapterAudioPath(dataDir, "s1", 3), "mp3");
    // MP3 without meta = interrupted synthesis
    expect(await readFreshAudio(dataDir, "s1", 3, ["a"])).toBeUndefined();

    await writeAudioMeta(dataDir, "s1", 3, ["a"], { ...info, timings: [[0, 1.5]] });
    expect(await readFreshAudio(dataDir, "s1", 3, ["a"])).toEqual({
      filePath: chapterAudioPath(dataDir, "s1", 3),
      seconds: 12.5,
      timings: [[0, 1.5]],
    });
    // Another voice in Settings now: still the same audio.
    expect(
      await readFreshAudio(dataDir, "s1", 3, ["a"], { voice: { variant: "nano", voice: "Adam" }, engineVersion: "9" })
    ).toBeDefined();
    // Edited text: stale.
    expect(await readFreshAudio(dataDir, "s1", 3, ["a, edited"])).toBeUndefined();
  });

  it("recognises audio saved with the old voice-bound key once, and upgrades it", async () => {
    await fs.writeFile(chapterAudioPath(dataDir, "s1", 1), "mp3");
    const metaFile = path.join(dataDir, "audio", "s1", "1.json");
    await fs.writeFile(metaFile, JSON.stringify({ key: legacyNarrationKey(["a"], voice, "3.8.3"), seconds: 4 }));

    // Without knowing the voice it was made with, it cannot be matched.
    expect(await readFreshAudio(dataDir, "s1", 1, ["a"])).toBeUndefined();
    // With the voice that made it (still the one in Settings), it is — and gets upgraded.
    expect(await readFreshAudio(dataDir, "s1", 1, ["a"], { voice, engineVersion: "3.8.3" })).toMatchObject({ seconds: 4 });
    expect(JSON.parse(await fs.readFile(metaFile, "utf8"))).toMatchObject({ text: textKey(["a"]), variant: "turbo", voice: "Ngọc Linh" });
    // From then on the voice no longer matters.
    expect(await readFreshAudio(dataDir, "s1", 1, ["a"])).toMatchObject({ seconds: 4 });
  });

  it("reports size and removes a story's audio", async () => {
    await fs.writeFile(chapterAudioPath(dataDir, "s1", 1), "12345");
    expect(await storyAudioBytes(dataDir, "s1")).toBe(5);
    await removeStoryAudio(dataDir, "s1");
    expect(await storyAudioBytes(dataDir, "s1")).toBe(0);
    await removeStoryAudio(dataDir, "missing");
  });
});
