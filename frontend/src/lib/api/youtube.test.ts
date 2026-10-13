import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError } from "./http";
import { connectYouTube, fetchYouTubeStory, saveYouTubeCredits, uploadYouTube, youTubeVideoUrl } from "./youtube";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("YouTube API", () => {
  it("loads the story panel state", async () => {
    fetchMock.mockResolvedValue(json({ connected: true }));
    expect(await fetchYouTubeStory("s1")).toEqual({ connected: true });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/stories/s1/youtube");
  });

  it("sends the playlist confirmation with the upload", async () => {
    fetchMock.mockResolvedValue(json({ started: true, total: 1 }));
    await uploadYouTube("s1", [1], true);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ orders: [1], createPlaylist: true });
  });

  it("carries the playlist-missing code through as an ApiError", async () => {
    fetchMock.mockResolvedValue(json({ code: "playlist-missing", message: "missing" }, 409));
    const err = (await uploadYouTube("s1", [1]).catch((error: unknown) => error)) as ApiError;
    expect(err.message).toBe("missing");
    expect(err.status).toBe(409);
    expect(err.code).toBe("playlist-missing");
  });

  it("saves the general info with PATCH", async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    await saveYouTubeCredits("s1", { genreTags: "truyện xuyên sách" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ genreTags: "truyện xuyên sách" });
  });

  it("returns the connect URL", async () => {
    fetchMock.mockResolvedValue(json({ url: "https://accounts.test/auth" }));
    expect(await connectYouTube("~/secret.json")).toEqual({ url: "https://accounts.test/auth" });
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      clientSecretPath: "~/secret.json",
    });
  });

  it("builds the preview URL", () => {
    expect(youTubeVideoUrl("s1", 3)).toBe("/api/stories/s1/youtube/3/video");
  });
});
