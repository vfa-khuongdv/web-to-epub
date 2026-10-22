// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TermDecoy from "./TermDecoy";

class NoResize {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoResize);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 6, 15, 4, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TermDecoy", () => {
  it("shows work in progress and nothing the shell answers to", () => {
    render(<TermDecoy />);
    expect(screen.getAllByText(/Test Suites:/).length).toBeGreaterThan(0);
    expect(screen.getByText("vim src/report/variance.con", { exact: false })).toBeInTheDocument();
    // The shell stays mounted underneath: no control here may share its names.
    expect(screen.queryByRole("button", { name: "Terminal menu" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show and run commands" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("measures its window and dates its login from today, as the shell does", () => {
    render(<TermDecoy />);
    // jsdom lays nothing out, so the window is the smallest a terminal reports; never a
    // fixed size that would jump when the boss key swaps the screen.
    expect(screen.getByText("20×4")).toBeInTheDocument();
    expect(screen.queryByText("120×36")).toBeNull();
    expect(screen.getByText(/^Last login: Tue Oct\s+6 08:47:12 on ttys001$/)).toBeInTheDocument();
  });
});
