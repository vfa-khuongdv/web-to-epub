import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { storyUsage } from "./storyUsage";

describe("storyUsage", () => {
  let dir: string;
  const id = "abc123";

  const library = (contentBytes: number, coverPath?: string) =>
    ({
      dataDir: dir,
      stories: { contentBytes: async () => contentBytes },
      covers: { find: () => (coverPath ? { filePath: coverPath, contentType: "image/png" } : undefined) },
    }) as unknown as Parameters<typeof storyUsage>[0];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "usage-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is only the text when the story keeps no pictures, audio or cover", async () => {
    expect(await storyUsage(library(1200), id)).toEqual({ text: 1200, images: 0, audio: 0, cover: 0, total: 1200 });
  });

  it("adds up pictures, audio and cover next to the text", async () => {
    await mkdir(path.join(dir, "epub-media", id), { recursive: true });
    await writeFile(path.join(dir, "epub-media", id, "a.png"), Buffer.alloc(100));
    await writeFile(path.join(dir, "epub-media", id, "b.png"), Buffer.alloc(50));
    await mkdir(path.join(dir, "audio", id), { recursive: true });
    await writeFile(path.join(dir, "audio", id, "1.mp3"), Buffer.alloc(1000));
    const cover = path.join(dir, "cover.png");
    await writeFile(cover, Buffer.alloc(7));

    expect(await storyUsage(library(10, cover), id)).toEqual({
      text: 10,
      images: 150,
      audio: 1000,
      cover: 7,
      total: 1167,
    });
  });

  it("counts a cover that vanished from disk as zero", async () => {
    const usage = await storyUsage(library(5, path.join(dir, "missing.png")), id);
    expect(usage.cover).toBe(0);
    expect(usage.total).toBe(5);
  });
});
