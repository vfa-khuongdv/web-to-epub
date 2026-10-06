// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderEn } from "../../test/renderEn";
import { SplitHandle } from "./SplitHandle";

afterEach(cleanup);

function setup(split = 0.5) {
  const box = document.createElement("div");
  box.getBoundingClientRect = () => ({ left: 100, width: 1000, top: 0, right: 1100, bottom: 0, height: 0, x: 100, y: 0, toJSON() {} });
  const container = createRef<HTMLElement>() as { current: HTMLElement | null };
  container.current = box;
  const onSplit = vi.fn();
  const onCommit = vi.fn();
  renderEn(<SplitHandle container={container} split={split} onSplit={onSplit} onCommit={onCommit} />);
  return { handle: screen.getByRole("separator", { name: "Resize panels" }), onSplit, onCommit };
}

describe("SplitHandle", () => {
  it("moves with the arrow keys, within the limits, and saves", () => {
    const { handle, onSplit, onCommit } = setup(0.5);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onSplit).toHaveBeenLastCalledWith(0.52);
    expect(onCommit).toHaveBeenLastCalledWith(0.52);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(onSplit).toHaveBeenLastCalledWith(0.25);
    fireEvent.keyDown(handle, { key: "End" });
    expect(onSplit).toHaveBeenLastCalledWith(0.75);
  });

  it("goes back to the default on a double click", () => {
    const { handle, onSplit, onCommit } = setup(0.3);
    fireEvent.doubleClick(handle);
    expect(onSplit).toHaveBeenLastCalledWith(29 / 50);
    expect(onCommit).toHaveBeenLastCalledWith(29 / 50);
  });

  it("reports its position for assistive tech", () => {
    const { handle } = setup(0.4);
    expect(handle).toHaveAttribute("aria-valuenow", "40");
  });
});
