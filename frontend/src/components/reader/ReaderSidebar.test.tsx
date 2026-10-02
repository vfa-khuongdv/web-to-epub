// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Highlight } from "../../lib/api";
import ReaderSidebar from "./ReaderSidebar";

import { renderEn } from "../../test/renderEn";

afterEach(cleanup);

const chapters = [
  { order: 1, title: "Dawn" },
  { order: 2, title: "Noon" },
  { order: 3, title: "Dusk" },
];

function setup(over: Partial<ComponentProps<typeof ReaderSidebar>> = {}) {
  const props: ComponentProps<typeof ReaderSidebar> = {
    storyTitle: "My Story",
    author: "",
    chapters,
    currentOrder: 2,
    tab: "chapters",
    onTab: vi.fn(),
    highlights: [],
    onGoToHighlight: vi.fn(),
    query: "",
    onQuery: vi.fn(),
    needle: "",
    shown: chapters,
    hiddenMatches: 0,
    activeRow: createRef<HTMLButtonElement>(),
    onGoToChapter: vi.fn(),
    page: 0,
    pageCount: 1,
    from: 0,
    onTocPage: vi.fn(),
    ...over,
  };
  renderEn(<ReaderSidebar {...props} />);
  return props;
}

const hlRow = (over: Partial<Highlight> = {}): Highlight => ({
  id: "h1",
  chapterOrder: 2,
  start: 0,
  end: 4,
  color: "yellow",
  text: "quoted bit",
  createdAt: "",
  ...over,
});

describe("ReaderSidebar", () => {
  it("shows the book header with an Unknown author fallback and chapter count", () => {
    setup();
    expect(screen.getByText("My Story")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText("3 chapters in the book")).toBeInTheDocument();
  });

  it("marks the current chapter and navigates by index in the full list", async () => {
    const props = setup({ shown: [chapters[2]] });
    await userEvent.click(screen.getByRole("button", { name: /Dusk/ }));
    expect(props.onGoToChapter).toHaveBeenCalledWith(2);
  });

  it("flags the current chapter row", () => {
    setup();
    expect(screen.getByRole("button", { name: /Noon/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /Dawn/ })).not.toHaveAttribute("aria-current");
  });

  it("forwards search input and shows an empty-match note", async () => {
    const props = setup({ shown: [], query: " zzz ", needle: "zzz" });
    expect(screen.getByText("No chapter matches “zzz”.")).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("Find a chapter…"), "a");
    expect(props.onQuery).toHaveBeenCalledWith(" zzz a");
  });

  it("reports hidden matches and hides pagination while searching", () => {
    setup({ hiddenMatches: 5, needle: "x", pageCount: 3 });
    expect(screen.getByText("5 more matches — type a longer search.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Later chapters" })).toBeNull();
  });

  it("pages the table of contents and disables the ends", async () => {
    const props = setup({ pageCount: 3, page: 0, from: 0 });
    expect(screen.getByText("1–3 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Earlier chapters" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Later chapters" }));
    expect(props.onTocPage).toHaveBeenCalledWith(1);
  });

  it("switches tabs", async () => {
    const props = setup({ highlights: [hlRow()] });
    await userEvent.click(screen.getByRole("button", { name: "Highlights (1)" }));
    expect(props.onTab).toHaveBeenCalledWith("highlights");
  });

  it("lists highlights and jumps to one; shows an empty note otherwise", async () => {
    const h = hlRow();
    const props = setup({ tab: "highlights", highlights: [h] });
    await userEvent.click(screen.getByRole("button", { name: /quoted bit/ }));
    expect(props.onGoToHighlight).toHaveBeenCalledWith(h);
    expect(screen.getByText("Chapter 2")).toBeInTheDocument();
    cleanup();
    setup({ tab: "highlights" });
    expect(screen.getByText(/Nothing highlighted yet/)).toBeInTheDocument();
  });
});
