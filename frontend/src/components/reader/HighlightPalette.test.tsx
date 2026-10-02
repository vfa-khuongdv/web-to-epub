// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import HighlightPalette, { Palette } from "./HighlightPalette";

import { renderEn } from "../../test/renderEn";

afterEach(cleanup);

const selection: Palette = {
  left: 10,
  top: 20,
  below: false,
  target: { kind: "selection", start: 0, end: 3, text: "abc" },
};

describe("HighlightPalette", () => {
  it("offers the four colours and reports the clicked one", async () => {
    const onColor = vi.fn();
    renderEn(<HighlightPalette palette={selection} onColor={onColor} onRemove={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(4);
    await userEvent.click(screen.getByRole("button", { name: "Green" }));
    expect(onColor).toHaveBeenCalledWith("green");
  });

  it("has no remove button for a fresh selection", () => {
    renderEn(<HighlightPalette palette={selection} onColor={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Remove highlight" })).toBeNull();
  });

  it("removes a clicked highlight by id and positions itself", async () => {
    const onRemove = vi.fn();
    renderEn(
      <HighlightPalette
        palette={{ left: 5, top: 7, below: true, target: { kind: "highlight", id: "h1" } }}
        onColor={vi.fn()}
        onRemove={onRemove}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove highlight" }));
    expect(onRemove).toHaveBeenCalledWith("h1");
    const group = screen.getByRole("group", { name: "Highlight colour" });
    expect(group).toHaveStyle({ left: "5px", top: "7px" });
    expect(group).toHaveClass("reader-palette-below");
  });
});
