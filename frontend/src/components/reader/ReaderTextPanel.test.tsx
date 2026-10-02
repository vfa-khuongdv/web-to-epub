// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, FONT_SIZE_RANGE } from "../../lib/reader/readerPreview";
import ReaderTextPanel from "./ReaderTextPanel";

import { renderEn } from "../../test/renderEn";

afterEach(cleanup);

describe("ReaderTextPanel", () => {
  it("steps the font size by the configured step", async () => {
    const onChange = vi.fn();
    renderEn(<ReaderTextPanel prefs={{ ...DEFAULT_PREFS, fontSize: 18 }} onChange={onChange} />);
    expect(screen.getByText("18px")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Larger text" }));
    expect(onChange).toHaveBeenLastCalledWith({ fontSize: 18 + FONT_SIZE_RANGE.step });
    await userEvent.click(screen.getByRole("button", { name: "Smaller text" }));
    expect(onChange).toHaveBeenLastCalledWith({ fontSize: 18 - FONT_SIZE_RANGE.step });
  });

  it("disables the size buttons at the limits", () => {
    const { rerender } = renderEn(
      <ReaderTextPanel prefs={{ ...DEFAULT_PREFS, fontSize: FONT_SIZE_RANGE.min }} onChange={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Smaller text" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Larger text" })).toBeEnabled();
    rerender(<ReaderTextPanel prefs={{ ...DEFAULT_PREFS, fontSize: FONT_SIZE_RANGE.max }} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Larger text" })).toBeDisabled();
  });

  it("changes line spacing, font and theme, marking the current choice", async () => {
    const onChange = vi.fn();
    renderEn(<ReaderTextPanel prefs={{ ...DEFAULT_PREFS, theme: "sepia", lineHeight: 1.5 }} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Sepia" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Book" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Loose" }));
    expect(onChange).toHaveBeenLastCalledWith({ lineHeight: 1.8 });
    await userEvent.click(screen.getByRole("button", { name: "Georgia" }));
    expect(onChange).toHaveBeenLastCalledWith({ font: "georgia" });
    await userEvent.click(screen.getByRole("button", { name: "Night" }));
    expect(onChange).toHaveBeenLastCalledWith({ theme: "dark" });
  });
});
