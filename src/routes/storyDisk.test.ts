import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * What a story takes on disk, and what deleting it gives back. A real Express server over a
 * throwaway library; DATA_DIR is set first because the stores open their files at import time.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "story-disk-test-"));
process.env.DATA_DIR = DATA_DIR;

const URL_ = "https://example.test/truyen/a/";
// "Tiếng Việt" is 14 bytes in UTF-8 but 10 characters: the size counts bytes.
const TEXT = "Tiếng Việt";

describe("a story's size on disk, and deleting it", () => {
  let server: Server;
  let base: string;
  let id: string;
  const folder = (...parts: string[]) => path.join(DATA_DIR, ...parts);

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { storiesRouter } = await import("./stories");
    const store = await import("../services/storyStore");
    id = store.storyId(URL_);
    await store.storyStore.save({
      id,
      storyUrl: URL_,
      site: "example.test",
      title: "Truyện",
      watching: false,
      newChapterCount: 0,
      chapters: [
        { order: 1, url: `${URL_}1`, title: "1", status: "done", blocks: [{ type: "paragraph", text: TEXT }] },
        { order: 2, url: `${URL_}2`, title: "2", status: "pending" },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Pictures, narration audio and a cover, the way crawling and narrating leave them.
    mkdirSync(folder("epub-media", id), { recursive: true });
    writeFileSync(folder("epub-media", id, "aaaaaaaaaaaa.jpg"), Buffer.alloc(1000));
    writeFileSync(folder("epub-media", id, "bbbbbbbbbbbb.jpg"), Buffer.alloc(2000));
    mkdirSync(folder("audio", id), { recursive: true });
    writeFileSync(folder("audio", id, "1.mp3"), Buffer.alloc(5000));
    mkdirSync(folder("covers"), { recursive: true });
    writeFileSync(folder("covers", `${id}.jpg`), Buffer.alloc(300));

    // Rendered YouTube videos (one chapter, one compilation part) and their records.
    mkdirSync(folder("youtube", id), { recursive: true });
    writeFileSync(folder("youtube", id, "1.mp4"), Buffer.alloc(7000));
    writeFileSync(folder("youtube", id, "compilation-1-2.mp4"), Buffer.alloc(9000));
    await store.storyStore.saveYouTubeVideo({
      storyId: id,
      order: 1,
      status: "rendered",
      title: "Truyện – Chương 1",
      videoPath: `youtube/${id}/1.mp4`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await store.storyStore.saveCompilation({
      id: "comp-1",
      storyId: id,
      part: 1,
      parts: 1,
      label: "Truyện – Trọn bộ (Chương 1-2)",
      fromOrder: 1,
      toOrder: 2,
      status: "rendered",
      videoPath: `youtube/${id}/compilation-1-2.mp4`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const app = express();
    app.use(express.json());
    app.use("/api", storiesRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    server.close();
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("splits the size into text, pictures, audio and cover, and adds them up", async () => {
    const res = await fetch(`${base}/api/stories/${id}/size`);
    expect(res.status).toBe(200);
    const { size } = (await res.json()) as { size: Record<string, number> };
    expect(size.images).toBe(3000);
    expect(size.audio).toBe(5000);
    expect(size.cover).toBe(300);
    // the blocks are stored as JSON: at least the text itself, counted in bytes (14), not characters (10)
    expect(size.text).toBeGreaterThanOrEqual(Buffer.byteLength(TEXT));
    expect(size.total).toBe(size.text + 3000 + 5000 + 300);
  });

  it("answers 404 for a story that is not in the library", async () => {
    const res = await fetch(`${base}/api/stories/0123456789abcdef/size`);
    expect(res.status).toBe(404);
  });

  it("deleting the story removes its pictures, audio, cover and rendered videos", async () => {
    expect(existsSync(folder("epub-media", id))).toBe(true);
    expect(existsSync(folder("audio", id))).toBe(true);
    expect(existsSync(folder("covers", `${id}.jpg`))).toBe(true);
    expect(existsSync(folder("youtube", id, "1.mp4"))).toBe(true);
    expect(existsSync(folder("youtube", id, "compilation-1-2.mp4"))).toBe(true);

    const res = await fetch(`${base}/api/stories/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    expect(existsSync(folder("epub-media", id))).toBe(false);
    expect(existsSync(folder("audio", id))).toBe(false);
    expect(existsSync(folder("covers", `${id}.jpg`))).toBe(false);
    // Chapter videos and compilation parts alike: the whole youtube/<story> folder goes.
    expect(existsSync(folder("youtube", id))).toBe(false);
    expect((await fetch(`${base}/api/stories/${id}`)).status).toBe(404);

    // And the records cascade with the story.
    const store = (await import("../services/storyStore")).storyStore;
    expect(await store.getYouTubeVideo(id, 1)).toBeUndefined();
    expect(await store.listCompilations(id)).toEqual([]);
  });
});
