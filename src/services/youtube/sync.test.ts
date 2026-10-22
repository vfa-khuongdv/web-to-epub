import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StoredStory } from "../../types";
import { createStoryStore, storyId } from "../storyStore";
import { YouTubeConfig } from "./config";

const api = vi.hoisted(() => ({
  findPlaylist: vi.fn(),
  listPlaylistItems: vi.fn(),
  listVideoDetails: vi.fn(),
}));
vi.mock("./api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api")>()), ...api }));
vi.mock("./account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./account")>()),
  accessToken: async () => "token",
}));

import { syncYouTubeUploads } from "./jobs";

const config: YouTubeConfig = {
  channel: "Truyện FM",
  clientSecretPath: "",
  ffmpegPath: "",
  genreTags: "truyện ngôn tình",
  scheduleTime: "18:00",
  musicVolume: 0.15,
  syntheticMedia: true,
};

const URL = "https://x.test/truyen/sync";

function makeStory(id: string): StoredStory {
  return {
    id,
    storyUrl: URL,
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
      { order: 3, url: "u3", title: "Chương 3", status: "done", blocks: [{ type: "paragraph", text: "Ba." }] },
    ],
  };
}

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-sync-"));
  const store = createStoryStore(dir);
  const id = storyId(URL);
  await store.save(makeStory(id));
  const story = (await store.getOutline(id))!;
  return { store, id, story };
}

beforeEach(() => {
  api.findPlaylist.mockReset();
  api.listPlaylistItems.mockReset();
  api.listVideoDetails.mockReset().mockResolvedValue(new Map());
});

describe("syncYouTubeUploads", () => {
  it("marks chapters found in the playlist as uploaded, keeping known records alone", async () => {
    const { store, id, story } = await setup();
    // A draft the user prepared here: no video yet, so the playlist wins.
    await store.saveYouTubeVideo({
      storyId: id,
      order: 2,
      status: "draft",
      title: "Truyện – Chương 2 | Truyện FM",
      description: "mô tả đã sửa",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    // A video this app already uploaded: never overwritten by a playlist match.
    await store.saveYouTubeVideo({
      storyId: id,
      order: 3,
      status: "uploaded",
      videoId: "mine",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    api.findPlaylist.mockResolvedValue({ id: "PL1", title: "Truyện – Truyện Audio Full | Truyện FM" });
    api.listPlaylistItems.mockResolvedValue([
      { videoId: "v1", title: "Truyện – Chương 1 | Truyện FM" },
      { videoId: "v2", title: "Truyện – Chương 2 | Truyện FM" },
      { videoId: "v9", title: "Truyện – Chương 9 | Truyện FM" },
      { videoId: "v1", title: "Truyện – Chương 1 | Truyện FM" },
    ]);
    api.listVideoDetails.mockResolvedValue(
      new Map([
        [
          "v1",
          {
            title: "Truyện – Chương 1 | Truyện FM",
            description: "Mô tả từ YouTube.",
            tags: ["Truyện", "truyện audio"],
            privacyStatus: "private",
            publishAt: "2026-10-09T18:00:00+07:00",
          },
        ],
        ["v2", { title: "Truyện – Chương 2 | Truyện FM", privacyStatus: "private" }],
      ])
    );

    const result = await syncYouTubeUploads({
      library: { stories: store } as never,
      story,
      config,
      account: {} as never,
    });

    expect(result).toEqual({
      imported: 2,
      updated: 0,
      playlistTitle: "Truyện – Truyện Audio Full | Truyện FM",
      playlistExists: true,
    });
    expect(await store.getYouTubeVideo(id, 1)).toMatchObject({
      status: "uploaded",
      videoId: "v1",
      videoUrl: "https://youtu.be/v1",
      description: "Mô tả từ YouTube.",
      tags: "Truyện, truyện audio",
      privacy: "private",
      publishAt: "2026-10-09T18:00:00+07:00",
    });
    // The edited draft keeps its description and gains the video.
    expect(await store.getYouTubeVideo(id, 2)).toMatchObject({
      status: "uploaded",
      videoId: "v2",
      description: "mô tả đã sửa",
    });
    // A record that already points at a video is untouched.
    expect((await store.getYouTubeVideo(id, 3))?.videoId).toBe("mine");
    // A chapter number the story does not have is ignored.
    expect(await store.getYouTubeVideo(id, 9)).toBeUndefined();
    // The playlist is remembered on the story.
    expect((await store.getYouTubeStory(id))?.playlistId).toBe("PL1");
  });

  it("reports a missing playlist without touching records", async () => {
    const { store, story } = await setup();
    api.findPlaylist.mockResolvedValue(undefined);
    expect(await syncYouTubeUploads({ library: { stories: store } as never, story, config, account: {} as never })).toEqual({
      imported: 0,
      updated: 0,
      playlistTitle: "Truyện – Truyện Audio Full | Truyện FM",
      playlistExists: false,
    });
  });

  it("backfills description and tags for records a previous sync only marked uploaded", async () => {
    const { store, id, story } = await setup();
    await store.saveYouTubeVideo({
      storyId: id,
      order: 1,
      status: "uploaded",
      videoId: "v1",
      title: "Truyện – Chương 1 | Truyện FM",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    // A record the person edited here keeps their description.
    await store.saveYouTubeVideo({
      storyId: id,
      order: 2,
      status: "uploaded",
      videoId: "v2",
      description: "mô tả tự sửa",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    api.findPlaylist.mockResolvedValue({ id: "PL1", title: "T" });
    api.listPlaylistItems.mockResolvedValue([
      { videoId: "v1", title: "Truyện – Chương 1 | Truyện FM" },
      { videoId: "v2", title: "Truyện – Chương 2 | Truyện FM" },
    ]);
    api.listVideoDetails.mockResolvedValue(
      new Map([
        ["v1", { description: "Mô tả cũ.", tags: ["x"] }],
        ["v2", { description: "Mô tả YouTube.", tags: ["y"] }],
      ])
    );
    const result = await syncYouTubeUploads({ library: { stories: store } as never, story, config, account: {} as never });
    // Chapter 1 gets both fields; chapter 2 only the tags it lacked — the edited
    // description is never replaced by the channel's copy.
    expect(result).toMatchObject({ imported: 0, updated: 2 });
    expect(await store.getYouTubeVideo(id, 1)).toMatchObject({ description: "Mô tả cũ.", tags: "x" });
    expect(await store.getYouTubeVideo(id, 2)).toMatchObject({ description: "mô tả tự sửa", tags: "y" });
  });

  it("imports nothing when every chapter is already marked", async () => {
    const { store, id, story } = await setup();
    await store.saveYouTubeVideo({
      storyId: id,
      order: 1,
      status: "uploaded",
      videoId: "v1",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    api.findPlaylist.mockResolvedValue({ id: "PL1", title: "T" });
    api.listPlaylistItems.mockResolvedValue([{ videoId: "v1", title: "Truyện – Chương 1 | Truyện FM" }]);
    expect((await syncYouTubeUploads({ library: { stories: store } as never, story, config, account: {} as never })).imported).toBe(0);
  });
});
