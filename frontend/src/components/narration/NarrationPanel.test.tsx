// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NarrationState } from "../../types";
import { fakePlayer } from "../../test/fakePlayer";
import { renderEn } from "../../test/renderEn";

let player = fakePlayer();
vi.mock("../../hooks/narrationPlayer", async (importActual) => ({
  ...(await importActual<typeof import("../../hooks/narrationPlayer")>()),
  useNarrationPlayer: () => player,
}));
vi.mock("../../lib/api", () => ({
  deleteStoryAudio: vi.fn(),
  exportStoryAudio: vi.fn(),
  fetchAudioMix: vi.fn(),
  fetchTtsStatus: vi.fn(),
  startAudioMix: vi.fn(),
  // PlayerBar's music picker is not rendered here, but its module imports these.
  fetchMusicTracks: vi.fn(),
  uploadMusicTrack: vi.fn(),
  deleteMusicTrack: vi.fn(),
}));
import { deleteStoryAudio, exportStoryAudio, fetchAudioMix, fetchTtsStatus, startAudioMix } from "../../lib/api";
import NarrationPanel, { playerMusic } from "./NarrationPanel";

const status = vi.mocked(fetchTtsStatus);
const deleteAudio = vi.mocked(deleteStoryAudio);
const exportZip = vi.mocked(exportStoryAudio);
const mixStart = vi.mocked(startAudioMix);
const mixPoll = vi.mocked(fetchAudioMix);

const state = (over: Partial<NarrationState> = {}): NarrationState => ({
  narratable: true,
  chapters: { 1: "ready", 2: "ready", 3: "missing" },
  bytes: 2048,
  running: null,
  ...over,
});

function setup(props: Partial<React.ComponentProps<typeof NarrationPanel>> = {}) {
  const all = {
    storyId: "s1",
    state: state(),
    outcome: null,
    error: null,
    onStart: vi.fn(),
    onStop: vi.fn(),
    onDismissOutcome: vi.fn(),
    onOpenSettings: vi.fn(),
    onAudioDeleted: vi.fn(),
    ...props,
  };
  renderEn(<NarrationPanel {...all} />);
  return all;
}

let clicked: string[];
beforeEach(() => {
  player = fakePlayer();
  status.mockReset().mockResolvedValue({ state: "installed" } as never);
  deleteAudio.mockReset().mockResolvedValue();
  exportZip.mockReset();
  mixStart.mockReset();
  mixPoll.mockReset();
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(`${this.getAttribute("href")}|${this.download}`);
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("playerMusic", () => {
  it("is empty while music is off or no track is picked", () => {
    expect(playerMusic(fakePlayer({ musicEnabled: false, musicTrack: "a" }))).toEqual({});
    expect(playerMusic(fakePlayer({ musicEnabled: true, musicTrack: null }))).toEqual({});
  });
  it("sends the track with its volume relative to the voice", () => {
    expect(playerMusic(fakePlayer({ musicEnabled: true, musicTrack: "a", musicVolume: 0.2, volume: 0.8 }))).toEqual({
      musicId: "a",
      musicVolume: 0.25,
    });
  });
});

describe("NarrationPanel install states", () => {
  it("renders nothing while the engine status is unknown", async () => {
    status.mockReturnValue(new Promise(() => {}));
    const { container } = renderEn(
      <NarrationPanel
        storyId="s1"
        state={state()}
        outcome={null}
        error={null}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onDismissOutcome={vi.fn()}
        onOpenSettings={vi.fn()}
        onAudioDeleted={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("points to Settings when not installed and nothing is narrated", async () => {
    status.mockResolvedValue({ state: "not-installed" } as never);
    const props = setup({ state: state({ chapters: { 1: "missing" }, bytes: 0 }) });
    await userEvent.click(await screen.findByRole("button", { name: "Set up narration" }));
    expect(props.onOpenSettings).toHaveBeenCalled();
  });

  it("keeps the full block with a note when not installed but audio exists", async () => {
    status.mockResolvedValue({ state: "not-installed" } as never);
    setup();
    expect(await screen.findByText(/Narration is not installed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Narrate (1 chapters)" })).toBeDisabled();
  });
});

describe("NarrationPanel", () => {
  it("counts narrated chapters and starts narrating the missing ones", async () => {
    const props = setup();
    expect(await screen.findByText(/2\/3 chapters narrated · 2\.0 KB/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Narrate (1 chapters)" }));
    expect(props.onStart).toHaveBeenCalled();
  });

  it("disables Narrate when everything has audio", async () => {
    setup({ state: state({ chapters: { 1: "ready" } }) });
    expect(await screen.findByRole("button", { name: "Narrate (0 chapters)" })).toBeDisabled();
  });

  it("offers the single-file export only when every chapter is narrated", async () => {
    setup();
    const mix = await screen.findByRole("button", { name: "Export audio + music (.mp3)" });
    expect(mix).toBeDisabled();
    cleanup();
    setup({ state: state({ chapters: { 1: "ready", 2: "ready" } }) });
    expect(await screen.findByRole("button", { name: "Export audio + music (.mp3)" })).toBeEnabled();
  });

  it("shows run progress and stop, which flips to Stopping…", async () => {
    const props = setup({
      state: state({ running: { done: 1, total: 3, order: 3, part: 2, parts: 5, etaMs: 120000 } }),
    });
    expect(await screen.findByRole("progressbar", { name: "Narration progress" })).toHaveAttribute("aria-valuenow", "33");
    expect(screen.getByText(/Reading chapter 3 — part 2\/5 · 1\/3 chapters · /)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop narration" }));
    expect(props.onStop).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
  });

  it("says the model is loading before the first part", async () => {
    setup({ state: state({ running: { done: 0, total: 3 } }) });
    expect(await screen.findByText(/Loading the voice model…/)).toBeInTheDocument();
  });

  it("reports a finished run, a stopped run with failures, and dismisses", async () => {
    const props = setup({ outcome: { done: 3, failed: 0, total: 3, cancelled: false } });
    expect(await screen.findByText("Narration finished: 3/3 chapters have audio.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onDismissOutcome).toHaveBeenCalled();
    cleanup();
    setup({ outcome: { done: 1, failed: 2, total: 3, cancelled: true, lastError: "boom" } });
    expect(await screen.findByText(/Narration stopped: 1\/3 chapters have audio\./)).toHaveTextContent("2 failed: boom");
  });

  it("shows the resume button and calls onResume", async () => {
    const onResume = vi.fn();
    setup({ resume: { order: 2, time: 65, title: "Noon" }, onResume });
    await userEvent.click(await screen.findByRole("button", { name: /Continue listening · chapter 2 · 1:05/ }));
    expect(onResume).toHaveBeenCalled();
  });

  it("shows an error from the page", async () => {
    setup({ error: "load failed" });
    expect(await screen.findByRole("alert")).toHaveTextContent("load failed");
  });

  it("renders extra actions", async () => {
    setup({ actions: <button type="button">Extra</button> });
    expect(await screen.findByRole("button", { name: "Extra" })).toBeInTheDocument();
  });
});

describe("NarrationPanel delete audio", () => {
  it("does nothing when the confirm is declined", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    const props = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Delete audio" }));
    expect(deleteAudio).not.toHaveBeenCalled();
    expect(props.onAudioDeleted).not.toHaveBeenCalled();
  });

  it("deletes and notifies the page when confirmed", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const props = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Delete audio" }));
    expect(deleteAudio).toHaveBeenCalledWith("s1");
    await waitFor(() => expect(props.onAudioDeleted).toHaveBeenCalled());
  });

  it("shows the error when deletion fails", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    deleteAudio.mockRejectedValue(new Error("locked"));
    const props = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Delete audio" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("locked");
    expect(props.onAudioDeleted).not.toHaveBeenCalled();
  });

  it("is hidden while narrating or when there is no audio on disk", async () => {
    setup({ state: state({ bytes: 0 }) });
    await screen.findByText(/chapters narrated/);
    expect(screen.queryByRole("button", { name: "Delete audio" })).toBeNull();
  });
});

describe("NarrationPanel export", () => {
  it("downloads the zip without music and reports counts", async () => {
    exportZip.mockResolvedValue({ exportId: "e1", url: "/api/exports/audio/e1", fileName: "story.zip", count: 2, missing: [3] } as never);
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Export audio (.zip)" }));
    expect(await screen.findByText("Exported 2 chapters. 1 chapters have no audio yet and were left out.")).toBeInTheDocument();
    expect(clicked).toEqual(["/api/exports/audio/e1|story.zip"]);
    expect(mixStart).not.toHaveBeenCalled();
  });

  it("shows an export failure", async () => {
    exportZip.mockRejectedValue(new Error("disk full"));
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Export audio (.zip)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });

  it("mixes the zip with the player's music, polling the job", async () => {
    player = fakePlayer({ musicEnabled: true, musicTrack: "m1", musicVolume: 0.2, volume: 0.8 });
    mixStart.mockResolvedValue({ jobId: "j1", total: 2 });
    mixPoll
      .mockResolvedValueOnce({ state: "running", done: 1, total: 2 })
      .mockResolvedValueOnce({
        state: "done",
        done: 2,
        total: 2,
        url: "/api/exports/audio/x",
        fileName: "mix.zip",
        count: 2,
        missing: [],
      } as never);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Export audio (.zip)" }));
    await waitFor(() => expect(mixStart).toHaveBeenCalledWith("s1", { musicId: "m1", musicVolume: 0.25, format: "zip" }));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(screen.getByRole("button", { name: "Mixing audio… 1/2" })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(await screen.findByText("Exported 2 chapters.")).toBeInTheDocument();
    expect(clicked).toEqual(["/api/exports/audio/x|mix.zip"]);
  });

  it("joins the whole story into one MP3, naming the music used", async () => {
    mixStart.mockResolvedValue({ jobId: "j2", total: 2 });
    mixPoll.mockResolvedValue({
      state: "done",
      done: 2,
      total: 2,
      url: "/api/exports/audio/y",
      fileName: "all.mp3",
      musicName: "Rain",
    } as never);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup({ state: state({ chapters: { 1: "ready", 2: "ready" } }) });
    fireEvent.click(await screen.findByRole("button", { name: "Export audio + music (.mp3)" }));
    await waitFor(() => expect(mixStart).toHaveBeenCalledWith("s1", {}));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(await screen.findByText(/with the background music “Rain”/)).toBeInTheDocument();
    expect(clicked).toEqual(["/api/exports/audio/y|all.mp3"]);
  });

  it("surfaces a failed mix job", async () => {
    mixStart.mockResolvedValue({ jobId: "j3", total: 2 });
    mixPoll.mockResolvedValue({ state: "error", done: 0, total: 2, message: "ffmpeg died" });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup({ state: state({ chapters: { 1: "ready", 2: "ready" } }) });
    fireEvent.click(await screen.findByRole("button", { name: "Export audio + music (.mp3)" }));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(await screen.findByRole("alert")).toHaveTextContent("ffmpeg died");
  });
});
