import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredStory } from "../types";

/**
 * The Facebook routes over a real Express server and a throwaway library; the account,
 * the Graph client and the upload job are faked, so what is pinned here is the route logic:
 * the token check on save, the refusals, and which chapters a job is started with.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "facebook-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const fake = vi.hoisted(() => ({
  account: undefined as Record<string, unknown> | undefined,
  saved: undefined as Record<string, unknown> | undefined,
  page: vi.fn(async () => ({ id: "123456", name: "Truyện FM", link: "https://fb.test/page" })),
  upload: vi.fn(async () => ({ done: 1, failed: 0 })),
}));

vi.mock("../services/facebook/account", () => ({
  loadAccount: async () => fake.account,
  saveAccount: async (account: Record<string, unknown>) => {
    fake.saved = account;
  },
  removeAccount: async () => {},
}));
vi.mock("../services/facebook/api", () => ({ fetchPage: (...args: unknown[]) => fake.page(...(args as [])) }));
vi.mock("../services/facebook/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/facebook/jobs")>()),
  uploadFacebookVideos: (...args: unknown[]) => fake.upload(...(args as [])),
}));

function makeStory(id: string): StoredStory {
  return {
    id,
    storyUrl: "https://x.test/truyen/facebook",
    site: "x.test",
    title: "Truyện",
    language: "vi",
    watching: false,
    newChapterCount: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    chapters: [
      { order: 1, url: "u1", title: "Chương 1", status: "done", blocks: [{ type: "paragraph", text: "Một." }] },
      { order: 2, url: "u2", title: "Chương 2", status: "done", blocks: [{ type: "paragraph", text: "Hai." }] },
    ],
  };
}

describe("Facebook routes", () => {
  let server: Server;
  let base: string;
  let stories: typeof import("../services/storyStore").storyStore;
  const id = "c".repeat(16);
  const stamp = "2026-10-01T00:00:00.000Z";
  const post = (url: string, body: unknown = {}) =>
    fetch(`${base}${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { facebookRouter } = await import("./facebook");
    stories = (await import("../services/storyStore")).storyStore;
    await stories.save(makeStory(id));
    const app = express();
    app.use(express.json());
    app.use("/api", facebookRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(async () => {
    fake.account = { pageId: "123456", pageName: "Truyện FM", token: "tok", savedAt: stamp };
    fake.saved = undefined;
    fake.upload.mockClear();
    for (const order of [1, 2]) {
      await stories.removeYouTubeVideo(id, order);
      await stories.removeFacebookVideo(id, order);
    }
  });

  it("checks the token against the Page before saving it", async () => {
    const res = await fetch(`${base}/facebook/account`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId: "123456", token: " tok " }),
    });
    expect(res.status).toBe(200);
    expect(fake.saved).toMatchObject({ pageId: "123456", pageName: "Truyện FM", token: "tok" });
  });

  it("refuses a Page id that is not digits, or a missing token", async () => {
    for (const body of [{ pageId: "abc", token: "t" }, { pageId: "123456", token: "" }]) {
      const res = await fetch(`${base}/facebook/account`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
    expect(fake.saved).toBeUndefined();
  });

  it("refuses to upload without a connected Page", async () => {
    fake.account = undefined;
    const res = await post(`/stories/${id}/facebook/upload`);
    expect(res.status).toBe(409);
    expect(fake.upload).not.toHaveBeenCalled();
  });

  it("refuses when no chapter has a rendered video", async () => {
    const res = await post(`/stories/${id}/facebook/upload`);
    expect(res.status).toBe(400);
  });

  it("does not offer a chapter that has no video file on this computer", async () => {
    // e.g. one the YouTube sync marked as uploaded after the upload script made it
    await stories.saveYouTubeVideo({ storyId: id, order: 1, status: "uploaded", createdAt: stamp, updatedAt: stamp });
    const res = await post(`/stories/${id}/facebook/upload`);
    expect(res.status).toBe(400);
    expect(fake.upload).not.toHaveBeenCalled();
  });

  it("posts only rendered chapters that are not already on Facebook", async () => {
    for (const order of [1, 2]) {
      await stories.saveYouTubeVideo({
        storyId: id,
        order,
        status: "rendered",
        videoPath: `youtube/${id}/${order}.mp4`,
        createdAt: stamp,
        updatedAt: stamp,
      });
    }
    await stories.saveFacebookVideo({ storyId: id, order: 1, status: "uploaded", videoId: "9", createdAt: stamp, updatedAt: stamp });
    const res = await post(`/stories/${id}/facebook/upload`);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ total: 1 });
    expect(fake.upload).toHaveBeenCalledWith(expect.objectContaining({ orders: [2] }));
  });
});
