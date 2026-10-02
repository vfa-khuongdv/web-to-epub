// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NarrationPlayer } from "../../hooks/narrationPlayer";
import MiniPlayer from "./MiniPlayer";

import { renderEn } from "../../test/renderEn";

afterEach(cleanup);

function fakePlayer(over: Partial<NarrationPlayer> = {}): NarrationPlayer {
  return {
    order: 3,
    playing: false,
    time: 65,
    duration: 130,
    toggle: vi.fn(),
    seek: vi.fn(),
    close: vi.fn(),
    ...over,
  } as unknown as NarrationPlayer;
}

describe("MiniPlayer", () => {
  it("renders nothing when no chapter is loaded", () => {
    const { container } = renderEn(<MiniPlayer player={fakePlayer({ order: null })} showChapter={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the clock and toggles, seeks and closes", async () => {
    const player = fakePlayer();
    renderEn(<MiniPlayer player={player} showChapter={false} />);
    expect(screen.getByText("1:05 / 2:10")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(player.toggle).toHaveBeenCalled();
    fireEvent.change(screen.getByRole("slider", { name: "Position" }), { target: { value: "90" } });
    expect(player.seek).toHaveBeenCalledWith(90);
    await userEvent.click(screen.getByRole("button", { name: "Close player" }));
    expect(player.close).toHaveBeenCalled();
  });

  it("labels the pause button while playing and shows the chapter only when asked", () => {
    const { rerender } = renderEn(<MiniPlayer player={fakePlayer({ playing: true })} showChapter={true} />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByText("Ch. 3")).toBeInTheDocument();
    rerender(<MiniPlayer player={fakePlayer()} showChapter={false} />);
    expect(screen.queryByText("Ch. 3")).toBeNull();
  });

  it("disables the slider until the duration is known", () => {
    renderEn(<MiniPlayer player={fakePlayer({ duration: 0, time: 0 })} showChapter={false} />);
    expect(screen.getByRole("slider", { name: "Position" })).toBeDisabled();
  });
});
