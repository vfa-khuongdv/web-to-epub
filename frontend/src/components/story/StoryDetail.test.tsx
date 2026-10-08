// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "../../i18n";
import type { StoredChapter, StoredStory } from "../../types";
import type { CrawlJobState } from "../../hooks/useCrawlJob";
import StoryDetail from "./StoryDetail";

const api = vi.hoisted(() => ({
  chapterAudioUrl: vi.fn((id: string, order: number) => `/audio/${id}/${order}.mp3`),
  deleteChapter: vi.fn(),
  fetchChapterContent: vi.fn(),
  fetchStory: vi.fn(),
  fetchStorySize: vi.fn(),
  refreshStoryToc: vi.fn(),
  saveChapterEdit: vi.fn(),
  saveChapterSpellChecked: vi.fn(),
  saveChapterTitle: vi.fn(),
  saveChapterUrl: vi.fn(),
  saveStoryMeta: vi.fn(),
  setStoryWatch: vi.fn(),
  startStoryCrawl: vi.fn(),
  stopStoryCrawl: vi.fn(),
}));
vi.mock("../../lib/api", () => api);

const exporter = vi.hoisted(() => ({ isExporting: false, progress: null as unknown, exportStoryBook: vi.fn() }));
vi.mock("../../hooks/useEpubExport", () => ({
  useEpubExport: () => exporter,
  exportProgressLabel: () => "progress-label",
}));

const narr = vi.hoisted(() => ({
  value: null as unknown as Record<string, unknown>,
}));
vi.mock("../../hooks/useStoryNarration", () => ({ useStoryNarration: () => narr.value }));
vi.mock("../narration/NarrationPanel", () => ({
  default: () => <div data-testid="narration-panel" />,
  playerMusic: () => ({}),
}));
vi.mock("../reader/ReaderOverlay", () => ({
  default: (p: { chapters: unknown[]; onClose: () => void; startOrder?: number }) => (
    <div data-testid="reader">
      reader {p.chapters.length} start={String(p.startOrder)}
      <button onClick={p.onClose}>close-reader</button>
    </div>
  ),
}));
vi.mock("../../vault", () => ({ useVault: () => ({ active: false }) }));
const rewrite = vi.hoisted(() => ({
  value: { state: null, outcome: null, error: null, start: vi.fn(), stop: vi.fn(), refresh: vi.fn(), dismissOutcome: vi.fn() },
}));
vi.mock("../../hooks/useRewrite", () => ({ useRewrite: () => rewrite.value }));
vi.mock("./AgentCrawlerPanel", () => ({ default: () => <div data-testid="agent-crawler-panel" /> }));
vi.mock("./YouTubePanel", () => ({
  default: (p: { onClose: () => void }) => (
    <div data-testid="youtube-panel">
      <button onClick={p.onClose}>close-youtube</button>
    </div>
  ),
}));

function ch(order: number, over: Partial<StoredChapter> = {}): StoredChapter {
  return {
    order,
    url: `https://x.test/${order}`,
    title: `Chapter title ${order}`,
    status: "done",
    blocks: [{ type: "paragraph", text: `body ${order}` }],
    ...over,
  };
}

function makeStory(over: Partial<StoredStory> = {}): StoredStory {
  return {
    id: "s1",
    storyUrl: "https://truyen.test/story",
    site: "truyen.test",
    title: "The Story",
    author: "Ann",
    language: "en",
    watching: false,
    newChapterCount: 0,
    chapters: [ch(1), ch(2, { status: "pending", blocks: undefined }), ch(3, { status: "error", error: "boom" })],
    createdAt: "2026-01-01",
    updatedAt: "2026-01-02",
    ...over,
  };
}

const idleJob: CrawlJobState = { label: "", running: false, pct: 0, cursor: 0, total: 0, errors: 0, log: [], chapters: {} };

function makeNarration(over: Record<string, unknown> = {}) {
  return {
    narratable: false,
    narration: { state: null, start: vi.fn(), stop: vi.fn(), refresh: vi.fn(), dismissOutcome: vi.fn() },
    narratedCount: 0,
    narratedOrders: [] as number[],
    player: { openRequest: null, clearOpenRequest: vi.fn(), isPlaying: () => false, play: vi.fn() },
    queue: { titles: {} },
    playChapter: vi.fn(),
    resumeListen: undefined,
    ...over,
  };
}

function setup(over: { story?: Partial<StoredStory>; job?: Partial<CrawlJobState> } = {}) {
  const props = {
    story: makeStory(over.story),
    job: { ...idleJob, ...over.job },
    attach: vi.fn(() => vi.fn()),
    clearChapters: vi.fn(),
    onStoryChanged: vi.fn(),
    onClear: vi.fn(),
    pushNotice: vi.fn(),
    onOpenSettings: vi.fn(),
  };
  const utils = render(
    <LangProvider>
      <StoryDetail {...props} />
    </LangProvider>,
  );
  return { props, ...utils };
}

beforeEach(() => {
  localStorage.setItem("lang", "en");
  Object.values(api).forEach((f) => f.mockReset());
  api.chapterAudioUrl.mockImplementation((id: string, order: number) => `/audio/${id}/${order}.mp3`);
  api.fetchStorySize.mockResolvedValue({ total: 2048, text: 1024, images: 512, audio: 256, cover: 256 });
  exporter.isExporting = false;
  exporter.progress = null;
  exporter.exportStoryBook.mockReset();
  narr.value = makeNarration();
  rewrite.value = {
    state: null,
    outcome: null,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    refresh: vi.fn(),
    dismissOutcome: vi.fn(),
  };
});
afterEach(cleanup);

describe("StoryDetail header and counts", () => {
  it("shows title, source link, counts and size", async () => {
    setup();
    expect(screen.getByRole("heading", { name: "The Story" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://truyen.test/story" })).toBeInTheDocument();
    expect(screen.getByText("chapters crawled").previousSibling).toHaveTextContent("/3");
    expect(screen.getByText("1 pending crawl")).toBeInTheDocument();
    expect(screen.getByText("1 errors")).toBeInTheDocument();
    expect(await screen.findByText(/Size on disk:/)).toBeInTheDocument();
  });

  it("hides the size line when the size request fails", async () => {
    api.fetchStorySize.mockRejectedValue(new Error("x"));
    setup();
    await waitFor(() => expect(api.fetchStorySize).toHaveBeenCalled());
    expect(screen.queryByText(/Size on disk/)).toBeNull();
  });

  it("says all chapters crawled when none remain", () => {
    setup({ story: { chapters: [ch(1)] } });
    expect(screen.getByText("All chapters crawled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue crawl/ })).toBeDisabled();
  });

  it("overlays live crawl results onto pending chapters", () => {
    setup({
      story: { chapters: [ch(1, { status: "pending" }), ch(2, { status: "pending" })] },
      job: { running: true, chapters: { "https://x.test/1": "done", "https://x.test/2": "error" } },
    });
    expect(screen.getByText("chapters crawled").previousSibling).toHaveTextContent("/2");
    expect(screen.getByText("1 errors")).toBeInTheDocument();
  });

  it("shows an ETA line and Stop button while running", () => {
    setup({ job: { running: true, etaMs: 120_000, total: 10, cursor: 4 } });
    expect(screen.getByText(/remaining · 3 ch\/min/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop crawl" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crawling…" })).toBeDisabled();
  });

  it("shows watch status, and the back button calls onClear", async () => {
    const { props } = setup({ story: { watching: true } });
    expect(screen.getByText("Never checked")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Story list" }));
    expect(props.onClear).toHaveBeenCalled();
  });

  it("attaches to the live channel for this story", () => {
    const { props } = setup();
    expect(props.attach).toHaveBeenCalledWith("Story: The Story", "s1");
  });

  it("hides crawl/watch controls and source link for imported books", () => {
    setup({ story: { site: "epub", storyUrl: "pdf:abc" } });
    expect(screen.queryByRole("button", { name: /Continue crawl/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Watch/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "pdf:abc" })).toBeNull();
    expect(screen.getByText("PDF file")).toBeInTheDocument();
  });
});

describe("StoryDetail crawl actions", () => {
  it("starts a crawl for the remaining chapters", async () => {
    api.startStoryCrawl.mockResolvedValue(undefined);
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Continue crawl (2 chapters)" }));
    expect(api.startStoryCrawl).toHaveBeenCalledWith("s1", undefined);
  });

  it("shows the error when the crawl cannot start", async () => {
    api.startStoryCrawl.mockRejectedValue(new Error("already running"));
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Continue crawl/ }));
    expect(await screen.findByText("already running")).toBeInTheDocument();
  });

  it("retries a single failed chapter by order", async () => {
    api.startStoryCrawl.mockResolvedValue(undefined);
    setup();
    const row = screen.getByText("Chapter title 3").closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "Retry" }));
    expect(api.startStoryCrawl).toHaveBeenCalledWith("s1", [3]);
  });

  it("stops the crawl, and surfaces stop errors", async () => {
    api.stopStoryCrawl.mockRejectedValueOnce(new Error("nope")).mockResolvedValue(undefined);
    setup({ job: { running: true } });
    await userEvent.click(screen.getByRole("button", { name: "Stop crawl" }));
    expect(await screen.findByText("nope")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop crawl" }));
    expect(api.stopStoryCrawl).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("button", { name: "Stopping…" })).toBeDisabled();
  });

  it("refetches the story when a running crawl ends", async () => {
    api.fetchStory.mockResolvedValue(makeStory({ chapters: [ch(1), ch(2), ch(3)] }));
    const { props, rerender } = setup({ job: { running: true } });
    rerender(
      <LangProvider>
        <StoryDetail {...props} job={{ ...idleJob, running: false }} />
      </LangProvider>,
    );
    await waitFor(() => expect(api.fetchStory).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(props.clearChapters).toHaveBeenCalled());
    expect(props.onStoryChanged).toHaveBeenCalled();
  });

  it("loads new chapters: refreshes the TOC, waits for the parent, then crawls", async () => {
    const order: string[] = [];
    api.refreshStoryToc.mockImplementation(async () => void order.push("toc"));
    api.startStoryCrawl.mockImplementation(async () => void order.push("crawl"));
    const { props } = setup({ story: { newChapterCount: 4 } });
    props.onStoryChanged.mockImplementation(async () => void order.push("changed"));
    expect(screen.getByText("4 new chapters since the last crawl.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load 4 new chapters" }));
    await waitFor(() => expect(order).toEqual(["toc", "changed", "crawl"]));
  });

  it("reports a failed TOC refresh and does not crawl", async () => {
    api.refreshStoryToc.mockRejectedValue(new Error("toc failed"));
    setup({ story: { newChapterCount: 1 } });
    await userEvent.click(screen.getByRole("button", { name: "Load 1 new chapters" }));
    expect(await screen.findByText("toc failed")).toBeInTheDocument();
    expect(api.startStoryCrawl).not.toHaveBeenCalled();
  });

  it("toggles watching and tells the parent", async () => {
    api.setStoryWatch.mockResolvedValue(undefined);
    const { props } = setup({ story: { watching: true } });
    await userEvent.click(screen.getByRole("button", { name: "Watching" }));
    expect(api.setStoryWatch).toHaveBeenCalledWith("s1", false);
    await waitFor(() => expect(props.onStoryChanged).toHaveBeenCalled());
  });
});

describe("StoryDetail metadata", () => {
  it("saves edited metadata as FormData and flashes Saved", async () => {
    api.saveStoryMeta.mockResolvedValue({ title: "New T", author: "Bob", language: "en", coverUrl: undefined });
    const { props } = setup();
    const title = screen.getByLabelText("Book title");
    await userEvent.clear(title);
    await userEvent.type(title, "New T");
    await userEvent.click(screen.getByRole("button", { name: "Save metadata" }));
    const [id, form] = api.saveStoryMeta.mock.calls[0] as [string, FormData];
    expect(id).toBe("s1");
    expect(form.get("title")).toBe("New T");
    expect(form.get("author")).toBe("Ann");
    expect(form.get("language")).toBe("en");
    expect(form.has("cover")).toBe(false);
    expect(await screen.findByRole("button", { name: "Saved" })).toBeInTheDocument();
    expect(props.onStoryChanged).toHaveBeenCalled();
  });

  it("sends a chosen cover file", async () => {
    api.saveStoryMeta.mockResolvedValue({ title: "The Story", language: "en" });
    setup();
    const file = new File(["x"], "c.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Cover image"), file);
    await userEvent.click(screen.getByRole("button", { name: "Save metadata" }));
    expect((api.saveStoryMeta.mock.calls[0][1] as FormData).get("cover")).toBeInstanceOf(File);
  });

  it("shows a save error", async () => {
    api.saveStoryMeta.mockRejectedValue(new Error("quota"));
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Save metadata" }));
    expect(await screen.findByText("quota")).toBeInTheDocument();
  });
});

describe("StoryDetail export and reader", () => {
  it("exports non-error chapters with the metadata and announces the result", async () => {
    exporter.exportStoryBook.mockResolvedValue(2);
    const { props } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Export EPUB" }));
    expect(exporter.exportStoryBook).toHaveBeenCalledWith(
      "s1",
      { title: "The Story", author: "Ann", language: "en", coverUrl: undefined },
      [{ order: 1, title: "Chapter title 1", contentHtml: undefined }],
      null,
      false,
    );
    expect(props.pushNotice).toHaveBeenCalledWith({ kind: "export-done", fileCount: 2 });
  });

  it("stays quiet when the folder picker was cancelled, and shows export errors", async () => {
    exporter.exportStoryBook.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("export broke"));
    const { props } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Export EPUB" }));
    expect(props.pushNotice).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Export EPUB" }));
    expect(await screen.findByText("export broke")).toBeInTheDocument();
  });

  it("disables export with nothing crawled and while exporting", () => {
    setup({ story: { chapters: [ch(1, { status: "pending" })] } });
    expect(screen.getByRole("button", { name: "Export EPUB" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Read / preview" })).toBeDisabled();
    cleanup();
    exporter.isExporting = true;
    exporter.progress = { phase: "packaging" };
    setup();
    expect(screen.getByRole("button", { name: "Exporting…" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("progress-label");
  });

  it("opens and closes the reader with the readable chapters", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Read / preview" }));
    expect(screen.getByTestId("reader")).toHaveTextContent("reader 1 start=undefined");
    await userEvent.click(screen.getByRole("button", { name: "close-reader" }));
    expect(screen.queryByTestId("reader")).toBeNull();
  });

  it("opens the reader when the player requests this story", async () => {
    const clearOpenRequest = vi.fn();
    narr.value = makeNarration({
      player: { openRequest: { storyId: "s1", order: 1 }, clearOpenRequest, isPlaying: () => false, play: vi.fn() },
    });
    setup();
    expect(await screen.findByTestId("reader")).toHaveTextContent("start=1");
    expect(clearOpenRequest).toHaveBeenCalled();
  });
});

describe("StoryDetail rewrite", () => {
  it("shows a Rewrite button on a done chapter and starts the rewrite for it", async () => {
    const start = vi.fn();
    rewrite.value = {
      state: { narratable: true, ready: true, chapters: { 1: { rewritten: false } }, remaining: 1, running: null },
      outcome: null,
      error: null,
      start,
      stop: vi.fn(),
      refresh: vi.fn(),
      dismissOutcome: vi.fn(),
    };
    vi.stubGlobal("confirm", vi.fn(() => true));
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Rewrite chapter 1 for narration" }));
    expect(start).toHaveBeenCalledWith([1]);
    vi.unstubAllGlobals();
  });

  it("shows the restore button on a rewritten chapter", () => {
    rewrite.value = {
      state: { narratable: true, ready: true, chapters: { 1: { rewritten: true } }, remaining: 0, running: null },
      outcome: null,
      error: null,
      start: vi.fn(),
      stop: vi.fn(),
      refresh: vi.fn(),
      dismissOutcome: vi.fn(),
    };
    setup();
    expect(screen.getByRole("button", { name: "Restore original text of chapter 1" })).toBeInTheDocument();
    expect(screen.getByText("Rewritten")).toBeInTheDocument();
  });
});

describe("StoryDetail YouTube", () => {
  it("opens the YouTube panel from the action row and closes it again", async () => {
    narr.value = makeNarration({
      narratable: true,
      narratedCount: 3,
      narration: { state: { narratable: true, chapters: {}, bytes: 0, running: null }, start: vi.fn(), stop: vi.fn(), refresh: vi.fn(), dismissOutcome: vi.fn() },
    });
    setup();
    expect(screen.queryByTestId("youtube-panel")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "YouTube" }));
    expect(screen.getByTestId("youtube-panel")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "close-youtube" }));
    expect(screen.queryByTestId("youtube-panel")).not.toBeInTheDocument();
  });

  it("hides the YouTube button for a story with no narration", () => {
    setup();
    expect(screen.queryByRole("button", { name: "YouTube" })).not.toBeInTheDocument();
  });
});

describe("StoryDetail narration", () => {
  const withNarration = () => {
    const start = vi.fn();
    narr.value = makeNarration({
      narratable: true,
      narratedCount: 1,
      narration: {
        state: { chapters: { 1: "ready", 2: "missing" }, running: null },
        start,
        stop: vi.fn(),
        refresh: vi.fn(),
        dismissOutcome: vi.fn(),
      },
    });
    return start;
  };

  it("shows the panel, audio link on narrated chapters, and Create audio on missing ones", async () => {
    const start = withNarration();
    setup({ story: { language: "vi", chapters: [ch(1), ch(2)] } });
    expect(screen.getByTestId("narration-panel")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download narration of chapter 1" })).toHaveAttribute("href", "/audio/s1/1.mp3");
    await userEvent.click(screen.getByRole("button", { name: "Create audio for chapter 2" }));
    expect(start).toHaveBeenCalledWith([2]);
  });

  it("includes narration in the export only when ticked", async () => {
    withNarration();
    exporter.exportStoryBook.mockResolvedValue(1);
    setup({ story: { language: "vi", chapters: [ch(1), ch(2)] } });
    await userEvent.click(screen.getByRole("checkbox", { name: /Include narration/ }));
    await userEvent.click(screen.getByRole("button", { name: "Export EPUB" }));
    expect(exporter.exportStoryBook.mock.calls[0][4]).toBe(true);
  });

  it("has no narration UI for non-narratable stories", () => {
    setup();
    expect(screen.queryByTestId("narration-panel")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /Include narration/ })).toBeNull();
  });
});

describe("StoryDetail chapter table", () => {
  it("renders pending rows for uncrawled chapters and cards for the rest", () => {
    setup();
    expect(screen.getByText("Pending crawl")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("saves a pending chapter's title and shows it right away", async () => {
    api.saveChapterTitle.mockResolvedValue(undefined);
    const { props } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Edit title for chapter 2" }));
    const input = screen.getByLabelText("Title for chapter 2");
    await userEvent.clear(input);
    await userEvent.type(input, "Fixed");
    await userEvent.click(screen.getByRole("button", { name: "Save title" }));
    expect(api.saveChapterTitle).toHaveBeenCalledWith("s1", 2, "Fixed");
    expect(await screen.findByText("Fixed")).toBeInTheDocument();
    expect(props.onStoryChanged).toHaveBeenCalled();
  });

  it("deletes a chapter and tells the parent; failure shows a banner", async () => {
    api.deleteChapter.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("locked db"));
    const { props } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete chapter 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.deleteChapter).toHaveBeenCalledWith("s1", 1);
    await waitFor(() => expect(props.onStoryChanged).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Delete chapter 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("locked db")).toBeInTheDocument();
  });

  it("disables delete while a crawl runs", () => {
    setup({ job: { running: true } });
    expect(screen.getByRole("button", { name: "Delete chapter 1" })).toBeDisabled();
  });

  it("lazy-loads a chapter body on expand", async () => {
    api.fetchChapterContent.mockResolvedValue({ blocks: [{ type: "paragraph", text: "fetched text" }] });
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Chapter title 1/ }));
    expect(api.fetchChapterContent).toHaveBeenCalledWith("s1", 1);
    expect(await screen.findByText("fetched text")).toBeInTheDocument();
  });

  it("saves an edited chapter through the API and refreshes the parent", async () => {
    api.fetchChapterContent.mockResolvedValue({ blocks: [{ type: "paragraph", text: "orig" }] });
    api.saveChapterEdit.mockResolvedValue({ url: "https://x.test/1", title: "Renamed", blocks: [{ type: "paragraph", text: "orig" }] });
    const { props } = setup();
    await userEvent.click(screen.getByRole("button", { name: /Chapter title 1/ }));
    await screen.findByText("orig");
    const title = screen.getByLabelText("Title for chapter 1");
    await userEvent.clear(title);
    await userEvent.type(title, "Renamed");
    await userEvent.click(screen.getByRole("button", { name: "Save chapter" }));
    expect(api.saveChapterEdit).toHaveBeenCalledWith("s1", 1, { title: "Renamed", contentHtml: expect.stringContaining("orig") });
    await waitFor(() => expect(props.onStoryChanged).toHaveBeenCalled());
  });

  it("saves a chapter URL", async () => {
    api.saveChapterUrl.mockResolvedValue({ url: "https://y.test/1" });
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Chapter title 1/ }));
    await userEvent.click(screen.getByRole("button", { name: "Edit URL" }));
    const input = screen.getByLabelText("Source URL for chapter 1");
    await userEvent.clear(input);
    await userEvent.type(input, "https://y.test/1");
    await userEvent.click(screen.getByRole("button", { name: "Save URL" }));
    expect(api.saveChapterUrl).toHaveBeenCalledWith("s1", 1, "https://y.test/1");
  });

  it("toggles the spelling mark via the API", async () => {
    api.saveChapterSpellChecked.mockResolvedValue({ spellChecked: true });
    setup();
    await userEvent.click(screen.getAllByRole("button", { name: "Spelling fixed in chapter 1" })[0]);
    expect(api.saveChapterSpellChecked).toHaveBeenCalledWith("s1", 1, true);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Spelling fixed in chapter 1" })).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("paginates long stories at 100 chapters per page", async () => {
    const many = Array.from({ length: 150 }, (_, i) => ch(i + 1, { status: "pending", blocks: undefined }));
    setup({ story: { chapters: many } });
    expect(screen.getByText("Chapters 1–100 / 150")).toBeInTheDocument();
    expect(screen.queryByText("Chapter title 101")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Chapters 101–150 / 150")).toBeInTheDocument();
    expect(screen.getByText("Chapter title 101")).toBeInTheDocument();
  });

  it("shows no pager for a short story", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });
});

describe("StoryDetail cover", () => {
  it("builds a proxied cover URL for a stored cover and keeps http covers as-is", () => {
    setup({ story: { coverUrl: "cover.jpg" } });
    expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining("/api/stories/s1/cover?v=cover.jpg"));
    cleanup();
    setup({ story: { coverUrl: "https://cdn.test/c.jpg" } });
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://cdn.test/c.jpg");
  });

  it("falls back to the empty frame when the image fails", () => {
    setup({ story: { coverUrl: "https://cdn.test/c.jpg" } });
    act(() => screen.getByRole("img").dispatchEvent(new Event("error")));
    expect(screen.queryByRole("img")).toBeNull();
  });
});
