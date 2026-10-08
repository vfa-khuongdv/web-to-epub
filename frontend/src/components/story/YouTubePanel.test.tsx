// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderEn } from "../../test/renderEn";
import { YouTubeState } from "../../types";

const api = vi.hoisted(() => ({
  fetchMusicTracks: vi.fn(async () => ({
    tracks: [
      { id: "m1", name: "Endless Love" },
      { id: "m2", name: "Mưa tháng sáu" },
    ],
    defaultId: null,
  })),
  prepareYouTube: vi.fn(async () => ({ total: 1 })),
  renderYouTube: vi.fn(async () => ({ total: 1 })),
  uploadYouTube: vi.fn(async () => ({ total: 1 })),
  stopYouTube: vi.fn(async () => {}),
  saveYouTubeChapter: vi.fn(async () => ({})),
  saveYouTubeCompilation: vi.fn(async () => {}),
  saveYouTubeCredits: vi.fn(async () => {}),
  syncYouTube: vi.fn(async () => ({ imported: 0, updated: 0, playlistTitle: "", playlistExists: true })),
  planYouTubeCompilation: vi.fn(async () => ({ totalHours: 2, missing: [], parts: [{ part: 1, from: 1, to: 1, hours: 2 }] })),
  renderYouTubeCompilation: vi.fn(async () => ({ total: 1 })),
  uploadYouTubeCompilation: vi.fn(async () => ({ total: 1 })),
  deleteYouTubeCompilation: vi.fn(async () => {}),
  youTubeCompilationVideoUrl: (storyId: string, id: string) => `/api/stories/${storyId}/youtube/compilation/${id}/video`,
  writeYouTubeIntro: vi.fn(async () => ({ intro: "Giới thiệu do AI viết." })),
  deleteYouTubeChapter: vi.fn(async () => {}),
  youTubeVideoUrl: (storyId: string, order: number) => `/api/stories/${storyId}/youtube/${order}/video`,
}));
vi.mock("../../lib/api", () => api);

const hook = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../../hooks/useYouTube", () => ({
  useYouTube: () => hook.value,
}));

import YouTubePanel from "./YouTubePanel";

const story = {
  id: "s1",
  storyUrl: "https://x.test/truyen",
  site: "x.test",
  title: "Truyện",
  watching: false,
  newChapterCount: 0,
  chapters: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const state: YouTubeState = {
  connected: true,
  channel: "Truyện FM",
  agentReady: true,
  cover: true,
  ffmpeg: true,
  config: { channel: "Truyện FM", scheduleTime: "18:00", genreTags: "truyện ngôn tình", musicVolume: 0.15 },
  story: { title: "Truyện" },
  playlist: { title: "Truyện – Truyện Audio Full | Truyện FM", exists: false },
  credits: { genreTags: "truyện ngôn tình" },
  chapters: [
    {
      order: 1,
      title: "Chương 1",
      hasAudio: true,
      audioChanged: false,
      record: { order: 1, status: "rendered", title: "Truyện – Chương 1 | Truyện FM", createdAt: "", updatedAt: "" },
    },
  ],
  compilationPlaylist: "Truyện – Trọn bộ | Truyện FM",
  compilations: [],
  running: null,
};

function hookValue(over: Partial<Record<string, unknown>> = {}) {
  return {
    state,
    outcome: null,
    error: null,
    setError: vi.fn(),
    refresh: vi.fn(),
    dismissOutcome: vi.fn(),
    ...over,
  };
}

afterEach(cleanup);

beforeEach(() => {
  hook.value = hookValue();
  api.uploadYouTube.mockClear();
  api.fetchMusicTracks.mockClear();
  api.saveYouTubeCompilation.mockClear();
  api.syncYouTube.mockReset().mockResolvedValue({ imported: 0, updated: 0, playlistTitle: "", playlistExists: true });
});

describe("YouTubePanel", () => {
  it("says the playlist does not exist yet and that it is created only after confirmation", () => {
    renderEn(<YouTubePanel story={story} onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.getByText(/does not exist yet — it will be created only after you confirm it at upload/)).toBeInTheDocument();
  });

  it("asks for the playlist confirmation before uploading", async () => {
    renderEn(<YouTubePanel story={story} onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Choose chapter 1" }));
    const upload = screen.getByRole("button", { name: "Upload (1)" });
    await waitFor(() => expect(upload).toBeEnabled());
    await userEvent.click(upload);
    const confirm = screen.getByRole("button", { name: "Upload now" });
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /Create the playlist/ }));
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(api.uploadYouTube).toHaveBeenCalledWith("s1", [1], true));
  });

  it("marks chapters already on YouTube when the panel opens", async () => {
    api.syncYouTube.mockResolvedValue({ imported: 3, updated: 0, playlistTitle: "T", playlistExists: true });
    renderEn(<YouTubePanel story={story} onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(await screen.findByText("Synced 3 chapters already on YouTube.")).toBeInTheDocument();
  });

  it("reports the description and tags filled in from YouTube", async () => {
    api.syncYouTube.mockResolvedValue({ imported: 0, updated: 4, playlistTitle: "T", playlistExists: true });
    renderEn(<YouTubePanel story={story} onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(await screen.findByText("Filled in the description and tags from YouTube for 4 chapters.")).toBeInTheDocument();
  });

  it("offers removing the local record of an uploaded chapter", async () => {
    hook.value = hookValue({
      state: {
        ...state,
        chapters: [
          {
            order: 1,
            title: "Chương 1",
            hasAudio: true,
            audioChanged: false,
            record: {
              order: 1,
              status: "uploaded",
              videoId: "v1",
              videoUrl: "https://youtu.be/v1",
              createdAt: "",
              updatedAt: "",
            },
          },
        ],
      },
    });
    renderEn(<YouTubePanel story={story} onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Open on YouTube" })).toBeInTheDocument();
    vi.stubGlobal("confirm", vi.fn(() => true));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(api.deleteYouTubeChapter).toHaveBeenCalledWith("s1", 1);
    vi.unstubAllGlobals();
  });

  it("saves the general info when genre tags change", async () => {
    renderEn(<YouTubePanel story={story} onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    const save = screen.getByRole("button", { name: "Save general info" });
    expect(save).toBeDisabled();
    const tags = screen.getByLabelText("Genre tags");
    await userEvent.clear(tags);
    await userEvent.type(tags, "xuyên sách");
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() =>
      expect(api.saveYouTubeCredits).toHaveBeenCalledWith("s1", { author: "", translator: "", genreTags: "xuyên sách" })
    );
    expect(await screen.findByText("General info saved.")).toBeInTheDocument();
  });

  it("uses the Settings → YouTube default track for new renders", async () => {
    hook.value = hookValue({ state: { ...state, config: { ...state.config, musicId: "m2", musicVolume: 0.2 } } });
    renderEn(<YouTubePanel story={story} onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Background music" })).toHaveValue("m2"));
    vi.stubGlobal("confirm", vi.fn(() => true));
    await userEvent.click(screen.getByRole("checkbox", { name: "Choose chapter 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Make videos (1)" }));
    await waitFor(() => expect(api.renderYouTube).toHaveBeenCalledWith("s1", [1], { musicId: "m2", musicVolume: 0.2 }));
    vi.unstubAllGlobals();
  });

  it("falls back to the player's background music when no default is set", async () => {
    renderEn(
      <YouTubePanel
        story={story}
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        playerMusic={{ track: "m1", enabled: true }}
      />
    );
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Background music" })).toHaveValue("m1"));
  });

  it("leaves no stale making-videos line once the job was started", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    renderEn(<YouTubePanel story={story} onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Choose chapter 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Make videos (1)" }));
    await waitFor(() => expect(api.renderYouTube).toHaveBeenCalledWith("s1", [1], { musicId: "", musicVolume: 0.15 }));
    // The progress bar and the outcome line carry this; a "Making…" line used to stay
    // on screen after the render finished.
    expect(screen.queryByText(/Making 1 videos/)).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("plans the full-story compilation for the selected chapters", async () => {
    renderEn(<YouTubePanel story={story} onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Choose chapter 1" }));
    await userEvent.click(screen.getByRole("button", { name: "View plan" }));
    await waitFor(() => expect(api.planYouTubeCompilation).toHaveBeenCalledWith("s1", [1]));
    expect(await screen.findByText("Plan: 1 chapters · 2.0 hours · 1 parts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make compilation (1 parts)" })).toBeEnabled();
  });

  it("fills the progress bar with the running part's own progress", () => {
    hook.value = hookValue({
      state: { ...state, running: { phase: "compilation", done: 1, total: 2, order: 2, percent: 40 } },
    });
    renderEn(<YouTubePanel story={story} onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    // One finished part plus 40% of the second: the bar moves while the part renders.
    expect(screen.getByRole("progressbar", { name: "YouTube job progress" })).toHaveAttribute("aria-valuenow", "70");
    expect(screen.getByText(/Part 2\/2 · 40%/)).toBeInTheDocument();
  });

  it("writes the compilation intro with the agent when it is on", async () => {
    renderEn(<YouTubePanel story={story} onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Choose chapter 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Write intro with AI" }));
    await waitFor(() => expect(api.writeYouTubeIntro).toHaveBeenCalledWith("s1", [1]));
    expect(await screen.findByDisplayValue("Giới thiệu do AI viết.")).toBeInTheDocument();
  });

  it("hides the AI intro button when the agent is off", () => {
    hook.value = hookValue({ state: { ...state, agentReady: false } });
    renderEn(<YouTubePanel story={story} onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Write intro with AI" })).toBeNull();
  });

  it("applies the schedule to rendered compilation parts too", async () => {
    hook.value = hookValue({
      state: {
        ...state,
        compilations: [
          {
            id: "c1",
            part: 1,
            parts: 1,
            label: "Truyện – Trọn bộ (Chương 1-1)",
            fromOrder: 1,
            toOrder: 1,
            status: "rendered",
            videoPath: "youtube/s1/compilation-1-1.mp4",
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
          },
        ],
      },
    });
    renderEn(<YouTubePanel story={story} onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    // No chapter selected: the rendered parts are what the button reschedules.
    await userEvent.click(screen.getByRole("button", { name: "Apply schedule" }));
    await waitFor(() =>
      expect(api.saveYouTubeCompilation).toHaveBeenCalledWith("s1", "c1", { publishAt: expect.any(String) })
    );
    expect(await screen.findByText("Schedule applied to 1 parts.")).toBeInTheDocument();
  });

  it("shows and saves a rendered part's description and tags", async () => {
    hook.value = hookValue({
      state: {
        ...state,
        compilations: [
          {
            id: "c1",
            part: 1,
            parts: 1,
            label: "Truyện – Trọn bộ (Chương 1-1)",
            fromOrder: 1,
            toOrder: 1,
            status: "rendered",
            videoPath: "youtube/s1/compilation-1-1.mp4",
            description: "🎧 Nghe truyện audio \"Truyện\".\n\n📖 Mở đầu.\n\n#TruyệnFM #TruyệnAudio",
            tags: "truyện audio, nghe truyện",
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
          },
        ],
      },
    });
    renderEn(<YouTubePanel story={story} onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Part info" }));
    const dialog = screen.getByRole("dialog", { name: "Part info" });
    // The description the video gets is already assembled: intro, credits and hashtags.
    expect((dialog.querySelector("textarea") as HTMLTextAreaElement).value).toContain("#TruyệnFM #TruyệnAudio");
    await userEvent.click(screen.getByRole("button", { name: "Save this part's info" }));
    await waitFor(() =>
      expect(api.saveYouTubeCompilation).toHaveBeenCalledWith(
        "s1",
        "c1",
        expect.objectContaining({ tags: "truyện audio, nghe truyện" })
      )
    );
  });

  it("plays a rendered part in the app instead of opening a link", async () => {
    hook.value = hookValue({
      state: {
        ...state,
        compilations: [
          {
            id: "c1",
            part: 1,
            parts: 1,
            label: "Truyện – Trọn bộ (Chương 1-1)",
            fromOrder: 1,
            toOrder: 1,
            status: "rendered",
            videoPath: "youtube/s1/compilation-1-1.mp4",
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
          },
        ],
      },
    });
    renderEn(<YouTubePanel story={story} onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Watch the rendered part" }));
    const dialog = screen.getByRole("dialog", { name: "Watch the rendered part" });
    expect(dialog.querySelector("video")).toHaveAttribute(
      "src",
      "/api/stories/s1/youtube/compilation/c1/video"
    );
  });

  it("points at Settings when not connected", () => {
    hook.value = hookValue({ state: { ...state, connected: false } });
    renderEn(<YouTubePanel story={story} onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.getByText("Not connected to YouTube yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect YouTube" })).toBeInTheDocument();
  });

  it("keeps the upload button disabled when a chapter has no audio", async () => {
    hook.value = hookValue({
      state: {
        ...state,
        chapters: [{ order: 1, title: "Chương 1", hasAudio: false, audioChanged: false, record: state.chapters[0].record }],
      },
    });
    renderEn(<YouTubePanel story={story} onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Choose chapter 1" })).toBeDisabled();
  });
});
