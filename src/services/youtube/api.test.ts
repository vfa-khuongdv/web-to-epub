import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  chapterNumber,
  createPlaylist,
  findPlaylist,
  isQuotaError,
  listVideoDetails,
  playlistPosition,
  uploadVideo,
  YouTubeApiError,
} from "./api";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

describe("playlist helpers", () => {
  it("reads chapter numbers and places a video after earlier chapters", () => {
    expect(chapterNumber("Truyện – Chương 12 | Truyện FM")).toBe(12);
    const items = [{ title: "Chương 3" }, { title: "Chương 1" }, { title: "Không số" }];
    expect(playlistPosition(items, 2)).toBe(1);
    expect(playlistPosition(items, 9)).toBe(2);
    expect(playlistPosition(items, 1)).toBe(0);
  });

  it("finds a playlist by exact title, paging through the list", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      const parsed = new URL(String(url));
      if (parsed.searchParams.get("pageToken") === "p2") {
        return json({ items: [{ id: "pl2", snippet: { title: "Truyện – Truyện Audio Full | Truyện FM" } }] });
      }
      return json({ items: [{ id: "pl1", snippet: { title: "Khác" } }], nextPageToken: "p2" });
    }) as typeof fetch;
    expect(await findPlaylist("tok", "Truyện – Truyện Audio Full | Truyện FM", fetchImpl)).toEqual({
      id: "pl2",
      title: "Truyện – Truyện Audio Full | Truyện FM",
    });
    expect(calls).toHaveLength(2);
  });

  it("reads the snippet and status of imported videos", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return json({
        items: [
          {
            id: "v1",
            snippet: { title: "Truyện – Chương 1 | Truyện FM", description: "Mô tả cũ.", tags: ["a", "b"] },
            status: { privacyStatus: "private", publishAt: "2026-10-09T18:00:00+07:00" },
          },
        ],
      });
    }) as typeof fetch;
    const details = await listVideoDetails("tok", ["v1", "v2"], fetchImpl);
    expect(details.get("v1")).toEqual({
      title: "Truyện – Chương 1 | Truyện FM",
      description: "Mô tả cũ.",
      tags: ["a", "b"],
      privacyStatus: "private",
      publishAt: "2026-10-09T18:00:00+07:00",
      uploadStatus: undefined,
    });
    expect(calls[0]).toContain("part=snippet,status");
    expect(calls[0]).toContain("id=v1,v2");
  });

  it("creates a playlist public and reports the server's error", async () => {
    let body: { status?: { privacyStatus?: string } } = {};
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as typeof body;
      return json({ id: "new", snippet: { title: "X" } });
    }) as typeof fetch;
    expect(await createPlaylist("tok", { title: "X" }, fetchImpl)).toEqual({ id: "new", title: "X" });
    expect(body.status?.privacyStatus).toBe("public");

    const failing = (async () => json({ error: { message: "nope", errors: [{ reason: "forbidden" }] } }, 403)) as typeof fetch;
    const err = await createPlaylist("tok", { title: "X" }, failing).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(YouTubeApiError);
    expect(isQuotaError(err)).toBe(false);
  });
});

describe("uploadVideo", () => {
  it("uploads in chunks and resumes from the Range YouTube reports", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "yt-upload-"));
    const file = path.join(dir, "video.mp4");
    const handle = await fsp.open(file, "w");
    await handle.truncate(9 * 1024 * 1024);
    await handle.close();
    const size = 9 * 1024 * 1024;
    const ranges: string[] = [];
    let puts = 0;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("uploadType=resumable")) {
        return new Response(null, { status: 200, headers: { location: "https://upload.test/session" } });
      }
      puts++;
      ranges.push(String((init?.headers as Record<string, string>)["Content-Range"]));
      if (puts === 1) return new Response(null, { status: 308, headers: { range: "bytes=0-4194303" } });
      return json({ id: "vid1", status: { privacyStatus: "private" } });
    }) as typeof fetch;
    const progress: number[] = [];
    const result = await uploadVideo(
      "tok",
      { filePath: file, title: "t", description: "d", tags: ["a"] },
      (sent) => progress.push(sent),
      undefined,
      fetchImpl
    );
    expect(result).toEqual({ id: "vid1", privacyStatus: "private" });
    expect(ranges[0]).toBe(`bytes 0-${8 * 1024 * 1024 - 1}/${size}`);
    expect(ranges[1]).toBe(`bytes ${4 * 1024 * 1024}-${size - 1}/${size}`);
    expect(progress.at(-1)).toBe(size);
  });

  it("maps a quota error so the run can stop and resume later", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "yt-upload-"));
    const file = path.join(dir, "video.mp4");
    await fsp.writeFile(file, "x");
    const fetchImpl = (async () =>
      json({ error: { message: "quota", errors: [{ reason: "uploadLimitExceeded" }] } }, 403)) as typeof fetch;
    const err = await uploadVideo("tok", { filePath: file, title: "t", description: "", tags: [] }, () => {}, undefined, fetchImpl).catch(
      (error: unknown) => error
    );
    expect(err).toBeInstanceOf(YouTubeApiError);
    expect(isQuotaError(err)).toBe(true);
  });
});
