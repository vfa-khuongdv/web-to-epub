// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderEn } from "../../test/renderEn";
import { YouTubeStatus } from "../../types";

const api = vi.hoisted(() => ({
  fetchYouTubeStatus: vi.fn(),
  saveYouTubeSettings: vi.fn(),
  connectYouTube: vi.fn(),
  disconnectYouTube: vi.fn(),
  fetchMusicTracks: vi.fn(),
}));
vi.mock("../../lib/api", () => api);

import YouTubeSettings, { YOUTUBE_CONNECTED } from "./YouTubeSettings";

function status(connected: boolean): YouTubeStatus {
  return {
    connected,
    channel: connected ? "Truyện FM" : undefined,
    clientSecretPath: "~/secret.json",
    hasClientSecret: true,
    ffmpeg: "/usr/bin/ffmpeg",
    config: {
      channel: "Truyện FM",
      clientSecretPath: "~/secret.json",
      ffmpegPath: "",
      genreTags: "truyện ngôn tình",
      scheduleTime: "18:00",
      musicVolume: 0.15,
      syntheticMedia: true,
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("open", vi.fn());
  api.fetchYouTubeStatus.mockReset().mockResolvedValue(status(false));
  api.connectYouTube.mockReset().mockResolvedValue({ url: "https://accounts.test/auth" });
  api.saveYouTubeSettings.mockReset().mockResolvedValue({});
  api.disconnectYouTube.mockReset();
  api.fetchMusicTracks.mockReset().mockResolvedValue({
    tracks: [{ id: "m1", name: "Endless Love" }],
    defaultId: "m1",
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("YouTubeSettings", () => {
  it("polls after Connect and shows the channel once the browser sign-in lands", async () => {
    vi.useFakeTimers();
    const onSaved = vi.fn();
    const connected = vi.fn();
    window.addEventListener(YOUTUBE_CONNECTED, connected);
    renderEn(<YouTubeSettings onSaved={onSaved} onError={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Not connected to YouTube yet.")).toBeInTheDocument();

    api.fetchYouTubeStatus.mockResolvedValue(status(true));
    fireEvent.click(screen.getByRole("button", { name: "Connect YouTube" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.connectYouTube).toHaveBeenCalledWith("~/secret.json");
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the Google sign-in");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(screen.getByText("Connected: Truyện FM")).toBeInTheDocument();
    expect(connected).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
    window.removeEventListener(YOUTUBE_CONNECTED, connected);
  });

  it("saves the default background music", async () => {
    renderEn(<YouTubeSettings onSaved={vi.fn()} onError={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Default background music" }), "m1");
    await waitFor(() => expect(api.saveYouTubeSettings).toHaveBeenCalledWith({ musicId: "m1" }));
  });

  it("signs out and reloads the status", async () => {
    const onSaved = vi.fn();
    api.fetchYouTubeStatus.mockResolvedValue(status(true));
    renderEn(<YouTubeSettings onSaved={onSaved} onError={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    api.disconnectYouTube.mockResolvedValue(undefined);
    api.fetchYouTubeStatus.mockResolvedValue(status(false));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(api.disconnectYouTube).toHaveBeenCalled();
    expect(await screen.findByText("Not connected to YouTube yet.")).toBeInTheDocument();
  });
});
