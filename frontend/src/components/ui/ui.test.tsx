// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "../../i18n";
import type { Notice } from "../../hooks/useCrawlJob";
import { Icon } from "./Icon";
import { NoticeStack } from "./NoticeStack";
import { ProgressBar } from "./ProgressBar";
import { SkeletonBar } from "./Skeleton";
import { ChipState, StatusChip } from "./StatusChip";

beforeEach(() => localStorage.setItem("lang", "en"));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wrap = (ui: React.ReactElement) => render(<LangProvider>{ui}</LangProvider>);

describe("Icon", () => {
  it("renders a decorative svg at the given size", () => {
    const { container } = render(<Icon name="check" size={20} className="x" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "20");
    expect(svg).toHaveClass("x");
    expect(svg).toHaveAttribute("fill", "none");
  });

  it("defaults to 16px", () => {
    const { container } = render(<Icon name="x" />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "16");
  });

  it("fills dot and play by default, and honours an explicit filled", () => {
    expect(render(<Icon name="dot" />).container.querySelector("svg")).toHaveAttribute("fill", "currentColor");
    expect(render(<Icon name="play" filled={false} />).container.querySelector("svg")).toHaveAttribute("fill", "none");
    expect(render(<Icon name="check" filled />).container.querySelector("svg")).toHaveAttribute("fill", "currentColor");
  });
});

describe("ProgressBar", () => {
  it("exposes progressbar semantics", () => {
    render(<ProgressBar pct={42.4} label="Crawl" />);
    const bar = screen.getByRole("progressbar", { name: "Crawl" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).not.toHaveClass("bar-running");
    expect(bar.querySelector("i")).toHaveStyle({ transform: "scaleX(0.424)" });
  });

  it("clamps out-of-range values and marks running", () => {
    const { rerender } = render(<ProgressBar pct={150} running label="a" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("progressbar")).toHaveClass("bar-running");
    rerender(<ProgressBar pct={-5} label="a" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});

describe("SkeletonBar", () => {
  it("appends the caller's class", () => {
    const { container } = render(<SkeletonBar className="h-3 w-10" />);
    expect(container.firstElementChild).toHaveClass("animate-pulse", "h-3", "w-10");
  });

  it("works without a class", () => {
    const { container } = render(<SkeletonBar />);
    expect(container.firstElementChild).toHaveClass("animate-pulse");
  });
});

describe("StatusChip", () => {
  const cases: [ChipState, string][] = [
    ["pending", "Pending crawl"],
    ["running", "Crawling"],
    ["done", "Done"],
    ["error", "Error"],
    ["locked", "Locked"],
    ["subscribers", "Subscribers only"],
    ["mature", "Rated M (18+)"],
    ["new", "New chapters"],
  ];
  it.each(cases)("%s shows %s", (state, label) => {
    wrap(<StatusChip state={state} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("uses a custom label and the error/running modifiers", () => {
    const { container } = wrap(<StatusChip state="error" label="Custom" />);
    expect(screen.getByText("Custom")).toHaveClass("chip-error");
    expect(container.querySelector("svg")).not.toHaveClass("animate-pulse");
    cleanup();
    const running = wrap(<StatusChip state="running" />);
    expect(running.container.querySelector("svg")).toHaveClass("animate-pulse");
  });

  it("translates the label", () => {
    localStorage.setItem("lang", "vi");
    wrap(<StatusChip state="running" />);
    expect(screen.getByText("Đang crawl")).toBeInTheDocument();
  });
});

describe("NoticeStack", () => {
  it("renders nothing without notices", () => {
    const { container } = wrap(<NoticeStack notices={[]} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("words each notice kind", () => {
    const notices: Notice[] = [
      { id: 1, kind: "session-saved", username: "bob" },
      { id: 2, kind: "session-saved" },
      { id: 3, kind: "export-done", fileCount: 3 },
      { id: 4, kind: "export-done", fileCount: 1 },
      { id: 5, kind: "epub-imported", title: "My Book" },
    ];
    wrap(<NoticeStack notices={notices} onDismiss={() => {}} />);
    expect(screen.getAllByRole("status")).toHaveLength(5);
    for (const text of [
      "Saved login for bob",
      "Saved site session",
      "Exported 3 EPUB files",
      "Exported EPUB",
      "Imported My Book",
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it("dismisses on the close button", async () => {
    const onDismiss = vi.fn();
    wrap(<NoticeStack notices={[{ id: 7, kind: "session-saved" }]} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onDismiss).toHaveBeenCalledWith(7);
  });

  it("auto-dismisses after 6 seconds", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    wrap(<NoticeStack notices={[{ id: 9, kind: "session-saved" }]} onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(5900));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(onDismiss).toHaveBeenCalledWith(9);
  });
});
