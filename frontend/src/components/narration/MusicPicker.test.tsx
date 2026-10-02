// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakePlayer } from "../../test/fakePlayer";
import { renderEn } from "../../test/renderEn";

vi.mock("../../lib/api", () => ({
  fetchMusicTracks: vi.fn(),
  uploadMusicTrack: vi.fn(),
  deleteMusicTrack: vi.fn(),
}));
import { deleteMusicTrack, fetchMusicTracks, uploadMusicTrack } from "../../lib/api";
import MusicPicker from "./MusicPicker";

const fetchMock = vi.mocked(fetchMusicTracks);
const uploadMock = vi.mocked(uploadMusicTrack);
const deleteMock = vi.mocked(deleteMusicTrack);

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({
    tracks: [
      { id: "a", name: "Rain" },
      { id: "b", name: "Piano" },
    ],
    defaultId: "a",
  });
  uploadMock.mockReset();
  deleteMock.mockReset().mockResolvedValue();
});
afterEach(cleanup);

describe("MusicPicker", () => {
  it("shows a loading note then the tracks, with the current one selected", async () => {
    renderEn(<MusicPicker player={fakePlayer({ musicTrack: "b" })} />);
    expect(screen.getByText("Loading music…")).toBeInTheDocument();
    expect(await screen.findByRole("radio", { name: "Piano" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Rain" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "None" })).not.toBeChecked();
  });

  it("picks a track and picks None", async () => {
    const player = fakePlayer({ musicTrack: "b" });
    renderEn(<MusicPicker player={player} />);
    await userEvent.click(await screen.findByRole("radio", { name: "Rain" }));
    expect(player.setMusicTrack).toHaveBeenCalledWith("a");
    await userEvent.click(screen.getByRole("radio", { name: "None" }));
    expect(player.setMusicTrack).toHaveBeenCalledWith(null);
  });

  it("turning music on with nothing picked takes the first track first", async () => {
    const player = fakePlayer();
    renderEn(<MusicPicker player={player} />);
    await screen.findByRole("radio", { name: "Rain" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Play background music while listening" }));
    expect(player.setMusicTrack).toHaveBeenCalledWith("a");
    expect(player.setMusicEnabled).toHaveBeenCalledWith(true);
  });

  it("keeps the picked track when turning music on", async () => {
    const player = fakePlayer({ musicTrack: "b" });
    renderEn(<MusicPicker player={player} />);
    await screen.findByRole("radio", { name: "Rain" });
    await userEvent.click(screen.getByRole("checkbox"));
    expect(player.setMusicTrack).not.toHaveBeenCalled();
    expect(player.setMusicEnabled).toHaveBeenCalledWith(true);
  });

  it("changes the music volume", async () => {
    const player = fakePlayer();
    renderEn(<MusicPicker player={player} />);
    fireEvent.change(screen.getByRole("slider", { name: "Music volume" }), { target: { value: "0.5" } });
    expect(player.setMusicVolume).toHaveBeenCalledWith(0.5);
  });

  it("removes a track and clears the selection when it was the playing one", async () => {
    const player = fakePlayer({ musicTrack: "a" });
    renderEn(<MusicPicker player={player} />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove Rain" }));
    expect(deleteMock).toHaveBeenCalledWith("a");
    await waitFor(() => expect(screen.queryByRole("radio", { name: "Rain" })).toBeNull());
    expect(player.setMusicTrack).toHaveBeenCalledWith(null);
  });

  it("shows an error when removal fails and keeps the track", async () => {
    deleteMock.mockRejectedValue(new Error("in use"));
    renderEn(<MusicPicker player={fakePlayer()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove Rain" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("in use");
    expect(screen.getByRole("radio", { name: "Rain" })).toBeInTheDocument();
  });

  it("uploads a file named without its extension and selects it", async () => {
    uploadMock.mockResolvedValue({ id: "c", name: "Wind" });
    const player = fakePlayer();
    const { container } = renderEn(<MusicPicker player={player} />);
    await screen.findByRole("radio", { name: "Rain" });
    const file = new File(["x"], "Wind.mp3", { type: "audio/mpeg" });
    await userEvent.upload(container.querySelector('input[type="file"]') as HTMLInputElement, file);
    expect(uploadMock).toHaveBeenCalledWith("Wind", file);
    expect(await screen.findByRole("radio", { name: "Wind" })).toBeInTheDocument();
    expect(player.setMusicTrack).toHaveBeenCalledWith("c");
  });

  it("rejects an oversized file before uploading", async () => {
    const { container } = renderEn(<MusicPicker player={fakePlayer()} />);
    await screen.findByRole("radio", { name: "Rain" });
    const big = new File(["x"], "big.mp3", { type: "audio/mpeg" });
    Object.defineProperty(big, "size", { value: 51 * 1024 * 1024 });
    await userEvent.upload(container.querySelector('input[type="file"]') as HTMLInputElement, big);
    expect(await screen.findByRole("alert")).toHaveTextContent("too large");
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("shows the upload error from the server", async () => {
    uploadMock.mockRejectedValue(new Error("bad audio"));
    const { container } = renderEn(<MusicPicker player={fakePlayer()} />);
    await screen.findByRole("radio", { name: "Rain" });
    await userEvent.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(["x"], "a.mp3", { type: "audio/mpeg" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("bad audio");
  });

  it("shows a load error", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    renderEn(<MusicPicker player={fakePlayer()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  });
});
