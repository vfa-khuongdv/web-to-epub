// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Highlight } from "../../lib/api";
import { fakePlayer } from "../../test/fakePlayer";
import { renderEn } from "../../test/renderEn";

vi.mock("../../lib/api", () => ({
  HIGHLIGHT_COLORS: ["yellow", "green", "blue", "pink"],
  fetchHighlights: vi.fn(),
  createHighlight: vi.fn(),
  recolorHighlight: vi.fn(),
  deleteHighlight: vi.fn(),
  fetchNarrationTimeline: vi.fn(),
}));
import { deleteHighlight, fetchHighlights, fetchNarrationTimeline, recolorHighlight } from "../../lib/api";
import ReaderOverlay, { ReaderChapter } from "./ReaderOverlay";

const m = {
  highlights: vi.mocked(fetchHighlights),
  recolor: vi.mocked(recolorHighlight),
  remove: vi.mocked(deleteHighlight),
  timeline: vi.mocked(fetchNarrationTimeline),
};

const chapters: ReaderChapter[] = [
  { order: 1, title: "Dawn" },
  { order: 2, title: "Noon" },
  { order: 3, title: "Dusk" },
];

const loadChapterHtml = vi.fn();

function props(over: Partial<React.ComponentProps<typeof ReaderOverlay>> = {}) {
  return {
    storyId: "s1",
    storyTitle: "My Story",
    author: "Ann",
    language: "en",
    chapters,
    loadChapterHtml,
    onClose: vi.fn(),
    isPrivate: false,
    ...over,
  };
}

const mount = (over: Partial<React.ComponentProps<typeof ReaderOverlay>> = {}) => {
  const p = props(over);
  const view = renderEn(<ReaderOverlay {...p} />);
  return { p, ...view };
};

const frame = () => screen.getByTitle(/EPUB preview/) as HTMLIFrameElement;
const savedPosition = (id = "s1") => JSON.parse(localStorage.getItem(`reader-position:${id}`) || "null");
const foot = () => screen.getByRole("button", { name: "Next" }).parentElement!;

beforeEach(() => {
  localStorage.clear();
  loadChapterHtml.mockReset().mockImplementation(async (order: number) => `<p>Hello text ${order}</p>`);
  m.highlights.mockReset().mockResolvedValue([]);
  m.recolor.mockReset().mockResolvedValue(undefined as never);
  m.remove.mockReset().mockResolvedValue(undefined as never);
  m.timeline.mockReset().mockResolvedValue([]);
  // jsdom lacks these.
  (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s };
  Element.prototype.scrollIntoView = vi.fn();
  // Each iframe window has its own scrollTo, which jsdom only logs as "not implemented".
  const logError = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("Not implemented")) logError(...args);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReaderOverlay loading", () => {
  it("shows a loading note, then the first chapter in the sandboxed frame", async () => {
    mount();
    expect(screen.getByText("Loading chapter…")).toBeInTheDocument();
    const el = await waitFor(() => frame());
    expect(el).toHaveAttribute("sandbox", "allow-same-origin");
    expect(el.getAttribute("srcdoc")).toContain("Hello text 1");
    expect(el.getAttribute("srcdoc")).toContain("<h1>Dawn</h1>");
    expect(screen.getByRole("dialog", { name: "Reading My Story" })).toBeInTheDocument();
    expect(screen.getByText("Chapter 1 / 3")).toBeInTheDocument();
    expect(loadChapterHtml).toHaveBeenCalledWith(1);
  });

  it("shows the loader's error instead of the chapter", async () => {
    loadChapterHtml.mockRejectedValue(new Error("chapter missing"));
    mount();
    expect(await screen.findByText("chapter missing")).toBeInTheDocument();
    expect(screen.queryByTitle(/EPUB preview/)).toBeNull();
  });

  it("prefetches the next chapter once, after the current one shows", async () => {
    mount();
    await waitFor(() => expect(loadChapterHtml).toHaveBeenCalledWith(2));
    expect(loadChapterHtml).toHaveBeenCalledTimes(2);
  });

  it("opens on the saved reading position", async () => {
    localStorage.setItem("reader-position:s1", JSON.stringify({ order: 3, scroll: 40 }));
    mount();
    await waitFor(() => expect(frame().getAttribute("srcdoc")).toContain("Hello text 3"));
    expect(screen.getByText("Chapter 3 / 3")).toBeInTheDocument();
  });

  it("startOrder wins over the saved position; an unknown saved order falls back to the first", async () => {
    localStorage.setItem("reader-position:s1", JSON.stringify({ order: 3, scroll: 0 }));
    mount({ startOrder: 2 });
    await waitFor(() => expect(frame().getAttribute("srcdoc")).toContain("Hello text 2"));
    cleanup();
    localStorage.setItem("reader-position:s1", JSON.stringify({ order: 99, scroll: 0 }));
    mount();
    await waitFor(() => expect(frame().getAttribute("srcdoc")).toContain("Hello text 1"));
  });

  it("keeps private and public positions apart", async () => {
    localStorage.setItem("reader-position:s1", JSON.stringify({ order: 3, scroll: 0 }));
    mount({ isPrivate: true });
    await waitFor(() => expect(frame().getAttribute("srcdoc")).toContain("Hello text 1"));
  });
});

describe("ReaderOverlay navigation", () => {
  it("Next and Previous turn chapters and save the position", async () => {
    mount();
    await waitFor(() => frame());
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(frame().getAttribute("srcdoc")).toContain("Hello text 2"));
    expect(savedPosition()).toEqual({ order: 2, scroll: 0 });
    expect(screen.getByText("Chapter 2 / 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(frame().getAttribute("srcdoc")).toContain("Hello text 1"));
    expect(savedPosition()).toEqual({ order: 1, scroll: 0 });
  });

  it("disables Next on the last chapter", async () => {
    localStorage.setItem("reader-position:s1", JSON.stringify({ order: 3, scroll: 0 }));
    mount();
    await waitFor(() => frame());
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("arrow keys turn chapters and Escape closes", async () => {
    const { p } = mount();
    await waitFor(() => frame());
    fireEvent.keyDown(document, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByText("Chapter 2 / 3")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    await waitFor(() => expect(screen.getByText("Chapter 1 / 3")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByText("Chapter 1 / 3")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(p.onClose).toHaveBeenCalled();
  });

  it("ignores keys typed in an input", async () => {
    const { p } = mount();
    await waitFor(() => frame());
    fireEvent.keyDown(screen.getByPlaceholderText("Find a chapter…"), { key: "Escape" });
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it("the Close button closes", async () => {
    const { p } = mount();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(p.onClose).toHaveBeenCalled();
  });
});

describe("ReaderOverlay sidebar", () => {
  it("jumps to a chapter picked from the list and filters by search", async () => {
    mount();
    await waitFor(() => frame());
    await userEvent.type(screen.getByPlaceholderText("Find a chapter…"), "dus");
    expect(screen.queryByRole("button", { name: /Noon/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Dusk/ }));
    await waitFor(() => expect(frame().getAttribute("srcdoc")).toContain("Hello text 3"));
  });

  it("matches a chapter by its number", async () => {
    mount();
    await waitFor(() => frame());
    await userEvent.type(screen.getByPlaceholderText("Find a chapter…"), "2");
    expect(screen.getByRole("button", { name: /Noon/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dawn/ })).toBeNull();
  });

  it("hides and shows the list, remembering the choice", async () => {
    mount();
    await waitFor(() => frame());
    const toggle = screen.getAllByRole("button", { name: "Chapters" }).find((b) => b.getAttribute("aria-pressed") !== null)!;
    await userEvent.click(toggle);
    expect(screen.queryByRole("navigation", { name: "Chapters" })).toBeNull();
    expect(JSON.parse(localStorage.getItem("reader-prefs")!).toc).toBe(false);
    await userEvent.click(toggle);
    expect(screen.getByRole("navigation", { name: "Chapters" })).toBeInTheDocument();
  });

  it("lists highlights and jumps to the one in another chapter", async () => {
    const h: Highlight = { id: "h9", chapterOrder: 3, start: 0, end: 5, color: "blue", text: "Hello", createdAt: "" };
    m.highlights.mockResolvedValue([h]);
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Highlights (1)" }));
    await userEvent.click(screen.getByRole("button", { name: /Hello/ }));
    await waitFor(() => expect(frame().getAttribute("srcdoc")).toContain("Hello text 3"));
  });

  it("reports a highlights load failure", async () => {
    m.highlights.mockRejectedValue(new Error("no highlights"));
    loadChapterHtml.mockReturnValue(new Promise(() => {}));
    mount();
    expect(await screen.findByText("no highlights")).toBeInTheDocument();
  });
});

describe("ReaderOverlay text settings", () => {
  it("opens the panel and persists a theme change into the page", async () => {
    mount();
    await waitFor(() => frame());
    await userEvent.click(screen.getByRole("button", { name: "Text settings" }));
    const before = frame().getAttribute("srcdoc");
    await userEvent.click(screen.getByRole("button", { name: "Night" }));
    expect(JSON.parse(localStorage.getItem("reader-prefs")!).theme).toBe("dark");
    expect(frame().getAttribute("srcdoc")).not.toBe(before);
    await userEvent.click(screen.getByRole("button", { name: "Text settings" }));
    expect(screen.queryByRole("complementary", { name: "Text settings" })).toBeNull();
  });
});

describe("ReaderOverlay full screen", () => {
  it("requests full screen on the reader and on the F key", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    HTMLElement.prototype.requestFullscreen = request;
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Read full screen" }));
    expect(request).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "f" });
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("ReaderOverlay narration", () => {
  it("offers Listen for a narrated chapter and plays it", async () => {
    const onListen = vi.fn();
    mount({ narratedOrders: [1], onListen });
    await userEvent.click(await screen.findByRole("button", { name: "Listen" }));
    expect(onListen).toHaveBeenCalledWith(1);
  });

  it("hides Listen for a chapter without audio", async () => {
    mount({ narratedOrders: [2], onListen: vi.fn() });
    await waitFor(() => frame());
    expect(screen.queryByRole("button", { name: "Listen" })).toBeNull();
  });

  it("shows the mini player while the voice is on this story, labelled when on another chapter", async () => {
    const player = fakePlayer({ storyId: "s1", order: 2 });
    mount({ player, narratedOrders: [1, 2], onListen: vi.fn() });
    expect(await screen.findByRole("region", { name: "Narration player" })).toBeInTheDocument();
    expect(screen.getByText("Ch. 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Listen" })).toBeInTheDocument();
  });

  it("does not show the mini player for another story's audio", async () => {
    mount({ player: fakePlayer({ storyId: "other", order: 1 }) });
    await waitFor(() => frame());
    expect(screen.queryByRole("region", { name: "Narration player" })).toBeNull();
  });

  it("follows the player to the next chapter when it was showing the one being played", async () => {
    const { p, rerender } = mount({ player: fakePlayer({ storyId: "s1", order: 1 }) });
    await waitFor(() => frame());
    rerender(<ReaderOverlay {...p} player={fakePlayer({ storyId: "s1", order: 2 })} />);
    await waitFor(() => expect(screen.getByText("Chapter 2 / 3")).toBeInTheDocument());
  });

  it("does not yank a reader who browsed elsewhere", async () => {
    const { p, rerender } = mount({ player: fakePlayer({ storyId: "s1", order: 3 }) });
    await waitFor(() => frame());
    rerender(<ReaderOverlay {...p} player={fakePlayer({ storyId: "s1", order: 2 })} />);
    expect(screen.getByText("Chapter 1 / 3")).toBeInTheDocument();
  });

  it("fetches the narration timeline for the chapter being voiced", async () => {
    mount({ player: fakePlayer({ storyId: "s1", order: 1 }) });
    await waitFor(() => expect(m.timeline).toHaveBeenCalledWith("s1", 1));
  });
});

describe("ReaderOverlay highlights in the page", () => {
  const mark: Highlight = { id: "h1", chapterOrder: 1, start: 1, end: 6, color: "yellow", text: "Hello", createdAt: "" };

  // jsdom does not render an iframe's srcdoc, so the page the reader built is written into
  // the frame by hand and the load event the browser would fire is sent.
  async function markInFrame() {
    m.highlights.mockResolvedValue([mark]);
    mount();
    const el = await waitFor(() => frame());
    await waitFor(() => expect(m.highlights).toHaveBeenCalled());
    await act(async () => {});
    const doc = el.contentDocument!;
    doc.open();
    doc.write(el.getAttribute("srcdoc")!);
    doc.close();
    fireEvent.load(el);
    return waitFor(() => {
      const found = doc.querySelector('mark[data-highlight="h1"]');
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
  }

  it("paints stored highlights into the chapter", async () => {
    const found = await markInFrame();
    expect(found.textContent).toBe("Hello");
  });

  it("opens a link of the chapter in a new tab instead of navigating the frame", async () => {
    const found = await markInFrame();
    const doc = found.ownerDocument;
    doc.body.insertAdjacentHTML("beforeend", '<a id="out" href="https://example.test/page">out</a><a id="in" href="#top">in</a>');
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    expect(fireEvent.click(doc.getElementById("out")!)).toBe(false);
    expect(open).toHaveBeenCalledWith("https://example.test/page", "_blank", "noopener,noreferrer");
    // The test frame loads twice (by hand and by jsdom), so the handler may run more than once per click.
    const calls = open.mock.calls.length;
    expect(fireEvent.click(doc.getElementById("in")!)).toBe(true);
    expect(open).toHaveBeenCalledTimes(calls);
    open.mockRestore();
  });

  it("clicking a highlight opens the palette, which can recolour it", async () => {
    const found = await markInFrame();
    fireEvent.click(found);
    await userEvent.click(await screen.findByRole("button", { name: "Pink" }));
    expect(m.recolor).toHaveBeenCalledWith("s1", "h1", "pink");
    await waitFor(() => expect(screen.queryByRole("group", { name: "Highlight colour" })).toBeNull());
  });

  it("clicking a highlight then Remove deletes it and unpaints it", async () => {
    const found = await markInFrame();
    fireEvent.click(found);
    await userEvent.click(await screen.findByRole("button", { name: "Remove highlight" }));
    expect(m.remove).toHaveBeenCalledWith("s1", "h1");
    await waitFor(() => expect(frame().contentDocument?.querySelector("mark[data-highlight]")).toBeNull());
  });

  it("Escape dismisses the palette before it closes the reader", async () => {
    const found = await markInFrame();
    fireEvent.click(found);
    await screen.findByRole("group", { name: "Highlight colour" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Highlight colour" })).toBeNull();
  });

  it("leaves the highlight as it was when recolouring fails", async () => {
    m.recolor.mockRejectedValue(new Error("save failed"));
    const found = await markInFrame();
    fireEvent.click(found);
    await userEvent.click(await screen.findByRole("button", { name: "Green" }));
    await waitFor(() => expect(m.recolor).toHaveBeenCalled());
    expect(found.className).toBe("hl hl-yellow");
  });
});
