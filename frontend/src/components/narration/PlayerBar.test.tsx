// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SKIP_S } from "../../hooks/narrationPlayer";
import { fakePlayer } from "../../test/fakePlayer";
import { renderEn } from "../../test/renderEn";
import { setVaultToken } from "../../vault/token";

vi.mock("../../lib/api", () => ({
  fetchMusicTracks: vi.fn().mockResolvedValue({ tracks: [{ id: "a", name: "Rain" }], defaultId: null }),
  uploadMusicTrack: vi.fn(),
  deleteMusicTrack: vi.fn(),
}));
import PlayerBar, { formatClock } from "./PlayerBar";

afterEach(() => {
  cleanup();
  setVaultToken(null);
});

describe("formatClock", () => {
  it.each([
    [0, "0:00"],
    [65, "1:05"],
    [3599.9, "59:59"],
    [3600, "1:00:00"],
    [3725, "1:02:05"],
    [-5, "0:00"],
  ])("%s -> %s", (s, text) => expect(formatClock(s)).toBe(text));
});

describe("PlayerBar", () => {
  it("renders nothing when nothing is loaded", () => {
    const { container } = renderEn(<PlayerBar player={fakePlayer({ order: null })} />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    const second = renderEn(<PlayerBar player={fakePlayer({ storyId: null })} />);
    expect(second.container).toBeEmptyDOMElement();
  });

  it("shows chapter title, story and clock; falls back to Chapter N for an untitled one", () => {
    renderEn(<PlayerBar player={fakePlayer()} />);
    expect(screen.getByText("Noon")).toBeInTheDocument();
    expect(screen.getByText("My Story")).toBeInTheDocument();
    expect(screen.getByText("1:05")).toBeInTheDocument();
    expect(screen.getByText("2:10")).toBeInTheDocument();
    cleanup();
    renderEn(<PlayerBar player={fakePlayer({ titleOf: () => "" })} />);
    expect(screen.getByText("Chapter 2")).toBeInTheDocument();
  });

  it("drives the transport", async () => {
    const player = fakePlayer();
    renderEn(<PlayerBar player={player} />);
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    await userEvent.click(screen.getByRole("button", { name: "Next chapter" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous chapter" }));
    await userEvent.click(screen.getByRole("button", { name: `Back ${SKIP_S} seconds` }));
    await userEvent.click(screen.getByRole("button", { name: `Forward ${SKIP_S} seconds` }));
    await userEvent.click(screen.getByRole("button", { name: "Close player" }));
    expect(player.toggle).toHaveBeenCalled();
    expect(player.next).toHaveBeenCalled();
    expect(player.previous).toHaveBeenCalled();
    expect(player.skip).toHaveBeenNthCalledWith(1, -SKIP_S);
    expect(player.skip).toHaveBeenNthCalledWith(2, SKIP_S);
    expect(player.close).toHaveBeenCalled();
  });

  it("disables previous/next at the ends and the seek bar without a duration", () => {
    renderEn(<PlayerBar player={fakePlayer({ hasNext: false, hasPrevious: false, duration: 0, time: 0 })} />);
    expect(screen.getByRole("button", { name: "Next chapter" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous chapter" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Position" })).toBeDisabled();
  });

  it("seeks, changes speed and volume; shows pause while playing", async () => {
    const player = fakePlayer({ playing: true });
    renderEn(<PlayerBar player={player} />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "Position" }), { target: { value: "100" } });
    expect(player.seek).toHaveBeenCalledWith(100);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Playback speed" }), "1.5");
    expect(player.setRate).toHaveBeenCalledWith(1.5);
    fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: "0.5" } });
    expect(player.setVolume).toHaveBeenCalledWith(0.5);
  });

  it("opens the chapter in the reader only when a handler is given", async () => {
    const onShow = vi.fn();
    renderEn(<PlayerBar player={fakePlayer()} onShowChapter={onShow} />);
    await userEvent.click(screen.getByRole("button", { name: "Noon" }));
    expect(onShow).toHaveBeenCalledWith("s1", 2);
    cleanup();
    renderEn(<PlayerBar player={fakePlayer()} />);
    expect(screen.queryByRole("button", { name: "Noon" })).toBeNull();
  });

  it("builds the cover URL: http as-is, otherwise the cover route with the vault token", () => {
    const { container } = renderEn(<PlayerBar player={fakePlayer({ coverUrl: "https://x/c.jpg" })} />);
    expect(container.querySelector("img")).toHaveAttribute("src", "https://x/c.jpg");
    cleanup();
    setVaultToken("tok");
    const second = renderEn(<PlayerBar player={fakePlayer({ coverUrl: "c1.jpg" })} />);
    expect(second.container.querySelector("img")).toHaveAttribute(
      "src",
      "/api/stories/s1/cover?v=c1.jpg&vault=tok"
    );
  });

  it("falls back to the placeholder when the cover fails to load", () => {
    const { container } = renderEn(<PlayerBar player={fakePlayer({ coverUrl: "https://x/c.jpg" })} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows the playback error", () => {
    renderEn(<PlayerBar player={fakePlayer({ error: "x" })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not play this chapter's audio.");
  });

  it("queue popover lists up-next, jumps and closes (also on Escape)", async () => {
    const player = fakePlayer();
    renderEn(<PlayerBar player={player} />);
    expect(screen.queryByRole("heading", { name: "Next up" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Playback queue" }));
    const list = screen.getByRole("heading", { name: "Next up" }).parentElement!;
    expect(within(list).getByText("Chapter 3")).toBeInTheDocument();
    await userEvent.click(within(list).getByText("Chapter 3"));
    expect(player.jumpTo).toHaveBeenCalledWith(3);
    expect(screen.queryByRole("heading", { name: "Next up" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Playback queue" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("heading", { name: "Next up" })).toBeNull();
  });

  it("opens the background music menu with the picker and closes on the backdrop", async () => {
    renderEn(<PlayerBar player={fakePlayer()} />);
    await userEvent.click(screen.getByRole("button", { name: "Background music" }));
    expect(await screen.findByRole("radio", { name: "Rain" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("radio", { name: "Rain" })).toBeNull();
  });
});
