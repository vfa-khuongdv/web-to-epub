// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "../../i18n";
import type { StoredStory, StorySummary, SupportedSite } from "../../types";
import type { CrawlJobState, LiveCrawl } from "../../hooks/useCrawlJob";
import LibraryView from "./LibraryView";

const api = vi.hoisted(() => {
  class ApiError extends Error {
    status?: number;
    code?: string;
  }
  return {
    ApiError,
    checkStoryUpdates: vi.fn(),
    createStory: vi.fn(),
    fetchAiConfig: vi.fn(),
    deleteStory: vi.fn(),
    fetchSiteSession: vi.fn(),
    fetchStories: vi.fn(),
    fetchStory: vi.fn(),
    importEpub: vi.fn(),
    setStoryWatch: vi.fn(),
    importArchive: vi.fn(),
    importDtvEbook: vi.fn(),
    importHeyzine: vi.fn(),
  };
});
vi.mock("../../lib/api", () => api);

const playerState = vi.hoisted(() => ({ openRequest: null as null | { storyId: string; order: number } }));
vi.mock("../../hooks/narrationPlayer", () => ({ useNarrationPlayer: () => playerState }));
vi.mock("../settings/AiSettings", () => ({ AI_CONFIG_CHANGED: "ai-config-changed" }));
vi.mock("../story/StoryDetail", () => ({
  default: (p: { story: StoredStory; onClear: () => void; onStoryChanged: () => void }) => (
    <div data-testid="detail">
      detail:{p.story.id}
      <button onClick={p.onClear}>clear-detail</button>
      <button onClick={() => void p.onStoryChanged()}>changed-detail</button>
    </div>
  ),
}));
vi.mock("../settings/SiteSessionDialog", () => ({
  default: (p: { site: { slug: string }; onSaved: (r: { username?: string }) => void; onSkip: () => void }) => (
    <div data-testid="session-dialog">
      session:{p.site.slug}
      <button onClick={() => p.onSaved({ username: "bob" })}>save-session</button>
      <button onClick={p.onSkip}>skip-session</button>
    </div>
  ),
}));

const sites: SupportedSite[] = [
  { domain: "truyen.test", name: "Truyen", mode: "crawl" },
  { domain: "archive.org", name: "Archive", mode: "import" },
];

function summary(id: string, over: Partial<StorySummary> = {}): StorySummary {
  return {
    id,
    storyUrl: `https://truyen.test/${id}`,
    site: "truyen.test",
    title: `Story ${id}`,
    chapterCount: 10,
    doneCount: 4,
    errorCount: 0,
    watching: false,
    newChapterCount: 0,
    updatedAt: new Date(2026, 0, 1).toISOString(),
    ...over,
  };
}

function full(id: string): StoredStory {
  return {
    id,
    storyUrl: `https://truyen.test/${id}`,
    site: "truyen.test",
    title: `Story ${id}`,
    watching: false,
    newChapterCount: 0,
    chapters: [],
    createdAt: "",
    updatedAt: "",
  };
}

const idleJob: CrawlJobState = { label: "", running: false, pct: 0, cursor: 0, total: 0, errors: 0, log: [], chapters: {} };

function setup(
  over: { live?: Record<string, LiveCrawl | undefined>; autoScan?: boolean | undefined; job?: Partial<CrawlJobState>; sites?: SupportedSite[] } = {},
) {
  const props = {
    job: { ...idleJob, ...over.job },
    live: over.live ?? {},
    attach: vi.fn(() => vi.fn()),
    clearChapters: vi.fn(),
    supportedSites: over.sites ?? sites,
    pushNotice: vi.fn(),
    autoScan: "autoScan" in over ? over.autoScan : false,
    onOpenSettings: vi.fn(),
  };
  const utils = render(
    <LangProvider>
      <LibraryView {...props} />
    </LangProvider>,
  );
  return { props, ...utils };
}

const urlInput = () => screen.getByLabelText("Story page URL");
const rowOf = (title: string) => screen.getByText(title).closest("tr") as HTMLElement;
const tableTitles = () =>
  within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row").map((r) => within(r).getAllByRole("button")[0].textContent);

beforeEach(() => {
  localStorage.setItem("lang", "en");
  Object.entries(api).forEach(([k, f]) => k !== "ApiError" && (f as ReturnType<typeof vi.fn>).mockReset());
  api.fetchStories.mockResolvedValue([]);
  api.fetchAiConfig.mockResolvedValue({ enabled: false, active: "", providers: [] });
  api.fetchSiteSession.mockResolvedValue({ configured: true });
  playerState.openRequest = null;
});
afterEach(cleanup);

describe("LibraryView list states", () => {
  it("shows the loading skeleton, then the empty state", async () => {
    let resolve!: (v: StorySummary[]) => void;
    api.fetchStories.mockReturnValue(new Promise((r) => (resolve = r)));
    setup();
    expect(screen.getByText("Loading story list")).toBeInTheDocument();
    await act(async () => resolve([]));
    expect(await screen.findByText("Library is empty")).toBeInTheDocument();
    expect(screen.getByText("No story selected")).toBeInTheDocument();
  });

  it("shows the load error", async () => {
    api.fetchStories.mockRejectedValue(new Error("db down"));
    setup();
    expect(await screen.findByText("db down")).toBeInTheDocument();
  });

  it("lists stories with counts and a status chip", async () => {
    api.fetchStories.mockResolvedValue([
      summary("a", { chapterCount: 10, doneCount: 10 }),
      summary("b", { errorCount: 2 }),
    ]);
    setup();
    expect(await screen.findByText("Story a")).toBeInTheDocument();
    expect(screen.getByText("2 stories")).toBeInTheDocument();
    expect(within(rowOf("Story a")).getByText("Crawl complete")).toBeInTheDocument();
    expect(within(rowOf("Story b")).getByText("4 chapters pending")).toBeInTheDocument();
  });

  it("shows crawl chip from the live channel, and blocks delete/pick for it", async () => {
    api.fetchStories.mockResolvedValue([summary("a")]);
    setup({ live: { a: { cursor: 2, total: 6, errors: 0 } } });
    const row = await screen.findByText("Story a").then((e) => e.closest("tr") as HTMLElement);
    expect(within(row).getByText("Crawling 2/6")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Delete Story a" })).toBeDisabled();
    expect(within(row).getByRole("checkbox")).toBeDisabled();
  });

  it("shows a check-error marker and the source label for imported books (no watch button)", async () => {
    api.fetchStories.mockResolvedValue([
      summary("a", { checkError: "site down" }),
      summary("b", { site: "epub", storyUrl: "pdf:x" }),
    ]);
    setup();
    await screen.findByText("Story a");
    expect(within(rowOf("Story a")).getByText("Check error")).toBeInTheDocument();
    expect(within(rowOf("Story b")).getByText("PDF file")).toBeInTheDocument();
    expect(within(rowOf("Story b")).queryByRole("button", { name: /Watch/ })).toBeNull();
  });
});

describe("LibraryView search, sort, paging", () => {
  const many = () =>
    Array.from({ length: 12 }, (_, i) => summary(String(i + 1), { title: `Item ${String(i + 1).padStart(2, "0")}`, updatedAt: new Date(2026, 0, i + 1).toISOString() }));

  it("filters diacritic-insensitively on title and site, with a no-match state", async () => {
    api.fetchStories.mockResolvedValue([summary("a", { title: "Văn học" }), summary("b", { title: "Other" })]);
    setup();
    await screen.findByText("Văn học");
    await userEvent.type(screen.getByLabelText("Search stories"), "van");
    expect(screen.getByText("1/2 stories")).toBeInTheDocument();
    expect(screen.queryByText("Other")).toBeNull();
    await userEvent.clear(screen.getByLabelText("Search stories"));
    await userEvent.type(screen.getByLabelText("Search stories"), "zzz");
    expect(screen.getByText("No stories match")).toBeInTheDocument();
    expect(screen.getByText(/containing “zzz”/)).toBeInTheDocument();
  });

  it("sorts by updated desc by default and toggles by header click", async () => {
    api.fetchStories.mockResolvedValue([
      summary("a", { title: "Alpha", updatedAt: new Date(2026, 0, 1).toISOString() }),
      summary("b", { title: "Beta", updatedAt: new Date(2026, 0, 5).toISOString() }),
    ]);
    setup();
    await screen.findByText("Alpha");
    expect(tableTitles()).toEqual(["Beta", "Alpha"]);
    await userEvent.click(screen.getByRole("button", { name: "Story" }));
    expect(tableTitles()).toEqual(["Alpha", "Beta"]);
    await userEvent.click(screen.getByRole("button", { name: "Story" }));
    expect(tableTitles()).toEqual(["Beta", "Alpha"]);
  });

  it("paginates at 10 per page", async () => {
    api.fetchStories.mockResolvedValue(many());
    setup();
    await screen.findByText("Item 12");
    expect(screen.getByText("Page 1/2")).toBeInTheDocument();
    expect(screen.queryByText("Item 02")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 2/2")).toBeInTheDocument();
    expect(screen.getByText("Item 02")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});

describe("LibraryView opening a story", () => {
  it("shows the skeleton while loading then the detail pane; clear returns to empty pane", async () => {
    api.fetchStories.mockResolvedValue([summary("a")]);
    let resolve!: (s: StoredStory) => void;
    api.fetchStory.mockReturnValue(new Promise((r) => (resolve = r)));
    setup();
    await userEvent.click(await screen.findByText("Story a"));
    expect(screen.getByText("Loading story details")).toBeInTheDocument();
    await act(async () => resolve(full("a")));
    expect(screen.getByTestId("detail")).toHaveTextContent("detail:a");
    await userEvent.click(screen.getByRole("button", { name: "clear-detail" }));
    expect(screen.getByText("No story selected")).toBeInTheDocument();
  });

  it("only the newest open request wins", async () => {
    api.fetchStories.mockResolvedValue([summary("a"), summary("b")]);
    const resolvers: Record<string, (s: StoredStory) => void> = {};
    api.fetchStory.mockImplementation((id: string) => new Promise((r) => (resolvers[id] = r)));
    setup();
    await userEvent.click(await screen.findByText("Story a"));
    await userEvent.click(screen.getByText("Story b"));
    await act(async () => resolvers.b(full("b")));
    await act(async () => resolvers.a(full("a")));
    expect(screen.getByTestId("detail")).toHaveTextContent("detail:b");
  });

  it("shows an error when the story cannot be opened", async () => {
    api.fetchStories.mockResolvedValue([summary("a")]);
    api.fetchStory.mockRejectedValue(new Error("gone"));
    setup();
    await userEvent.click(await screen.findByText("Story a"));
    expect(await screen.findByText("gone")).toBeInTheDocument();
    expect(screen.queryByTestId("detail")).toBeNull();
  });

  it("opens the story the player asks for", async () => {
    api.fetchStories.mockResolvedValue([summary("a")]);
    api.fetchStory.mockResolvedValue(full("a"));
    playerState.openRequest = { storyId: "a", order: 1 };
    setup();
    expect(await screen.findByTestId("detail")).toHaveTextContent("detail:a");
  });

  it("refetches list and story when the detail reports a change", async () => {
    api.fetchStories.mockResolvedValue([summary("a")]);
    api.fetchStory.mockResolvedValue(full("a"));
    setup();
    await userEvent.click(await screen.findByText("Story a"));
    await screen.findByTestId("detail");
    api.fetchStories.mockClear();
    api.fetchStory.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "changed-detail" }));
    await waitFor(() => expect(api.fetchStories).toHaveBeenCalled());
    await waitFor(() => expect(api.fetchStory).toHaveBeenCalledWith("a"));
  });

  it("reloads the list when a story leaves the live channel", async () => {
    api.fetchStories.mockResolvedValue([summary("a")]);
    const live = { a: { cursor: 1, total: 2, errors: 0 } };
    const { props, rerender } = setup({ live });
    await screen.findByText("Story a");
    api.fetchStories.mockClear();
    rerender(
      <LangProvider>
        <LibraryView {...props} live={{}} />
      </LangProvider>,
    );
    await waitFor(() => expect(api.fetchStories).toHaveBeenCalled());
  });
});

describe("LibraryView adding stories", () => {
  it("asks for a URL when empty", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Load chapters" }));
    expect(screen.getByText("Paste a story URL first.")).toBeInTheDocument();
    expect(api.createStory).not.toHaveBeenCalled();
  });

  it("creates a story from a supported URL, selects it and clears the box", async () => {
    api.createStory.mockResolvedValue(full("new"));
    setup();
    await userEvent.type(urlInput(), "https://truyen.test/foo{enter}");
    expect(api.createStory).toHaveBeenCalledWith("https://truyen.test/foo", { ai: false });
    expect(await screen.findByTestId("detail")).toHaveTextContent("detail:new");
    expect(urlInput()).toHaveValue("");
    expect(api.fetchStories).toHaveBeenCalledTimes(2);
  });

  it("rejects an unsupported site, naming the supported ones", async () => {
    setup();
    await userEvent.type(urlInput(), "https://nope.test/x{enter}");
    expect(await screen.findByText(/not from a supported site\. Supported: truyen\.test, archive\.org/)).toBeInTheDocument();
    expect(api.createStory).not.toHaveBeenCalled();
  });

  it("shows create errors", async () => {
    api.createStory.mockRejectedValue(new Error("toc failed"));
    setup();
    await userEvent.type(urlInput(), "https://truyen.test/foo{enter}");
    expect(await screen.findByText("toc failed")).toBeInTheDocument();
  });

  it("with the AI crawler ready, an unsupported http URL is crawled with ai; non-http is refused", async () => {
    api.fetchAiConfig.mockResolvedValue({
      enabled: true,
      active: "p",
      providers: [{ id: "p", hasKey: true, keyRequired: true }],
    });
    api.createStory.mockResolvedValue(full("ai"));
    setup();
    await screen.findByRole("button", { name: "Load with AI" });
    await userEvent.type(urlInput(), "https://other.test/x{enter}");
    expect(api.createStory).toHaveBeenCalledWith("https://other.test/x", { ai: true });
    await screen.findByTestId("detail");
    await userEvent.type(urlInput(), "not a url");
    await userEvent.click(screen.getByRole("button", { name: "Load with AI" }));
    expect(await screen.findByText("Paste a story URL first.")).toBeInTheDocument();
  });

  it("hides the AI button when the provider has no key", async () => {
    api.fetchAiConfig.mockResolvedValue({ enabled: true, active: "p", providers: [{ id: "p", hasKey: false, keyRequired: true }] });
    setup();
    await screen.findByRole("button", { name: "Load chapters" });
    expect(screen.queryByRole("button", { name: "Load with AI" })).toBeNull();
  });

  it("imports a book URL through its source and announces it", async () => {
    api.importArchive.mockResolvedValue({ ...full("arc"), title: "Archive Book" });
    const { props } = setup();
    await userEvent.type(urlInput(), "https://archive.org/details/foo{enter}");
    await waitFor(() => expect(api.importArchive).toHaveBeenCalledWith("https://archive.org/details/foo", { overwrite: false }));
    await waitFor(() => expect(props.pushNotice).toHaveBeenCalledWith({ kind: "epub-imported", title: "Archive Book" }));
    expect(api.createStory).not.toHaveBeenCalled();
  });

  it("asks to overwrite when a URL import already exists, then retries with overwrite", async () => {
    const exists = Object.assign(new Error("exists"), { code: "exists" });
    api.fetchSiteSession.mockResolvedValue({ configured: true });
    api.importArchive.mockRejectedValueOnce(exists).mockResolvedValue(full("arc"));
    setup();
    await userEvent.type(urlInput(), "https://archive.org/details/foo{enter}");
    expect(await screen.findByText(/already in the library/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Overwrite" }));
    await waitFor(() => expect(api.importArchive).toHaveBeenLastCalledWith("https://archive.org/details/foo", { overwrite: true }));
    await waitFor(() => expect(screen.queryByText(/already in the library/)).toBeNull());
  });

  it("imports an epub file, and rejects other file types", async () => {
    api.importEpub.mockResolvedValue({ ...full("e"), title: "Epub Book" });
    const { props, container } = setup();
    await screen.findByRole("button", { name: "Load chapters" });
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.txt")] } });
    expect(await screen.findByText("Please choose an .epub or .pdf file.")).toBeInTheDocument();
    expect(api.importEpub).not.toHaveBeenCalled();
    const epub = new File(["x"], "book.EPUB");
    fireEvent.change(input, { target: { files: [epub] } });
    await waitFor(() => expect(api.importEpub).toHaveBeenCalledWith(epub, { overwrite: false }));
    await waitFor(() => expect(props.pushNotice).toHaveBeenCalledWith({ kind: "epub-imported", title: "Epub Book" }));
    expect(await screen.findByTestId("detail")).toHaveTextContent("detail:e");
  });

  it("file import conflict: overwrite or cancel", async () => {
    const exists = Object.assign(new Error("exists"), { code: "exists" });
    api.importEpub.mockRejectedValueOnce(exists).mockResolvedValue(full("e"));
    const { container } = setup();
    await screen.findByRole("button", { name: "Load chapters" });
    const file = new File(["x"], "book.pdf");
    fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [file] } });
    expect(await screen.findByText(/Overwrite it with “book.pdf”/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/already in the library/)).toBeNull();
    fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [file] } });
    // Second attempt succeeds directly.
    await waitFor(() => expect(api.importEpub).toHaveBeenCalledTimes(2));
  });
});

describe("LibraryView site session prompt", () => {
  const withAff = [...sites, { domain: "asianfanfics.com", name: "AFF", mode: "crawl" } as SupportedSite];
  const affUrl = "https://www.asianfanfics.com/story/view/1/x";

  it("prompts when no session is saved; saving continues the add and announces it", async () => {
    api.fetchSiteSession.mockResolvedValue({ configured: false });
    api.createStory.mockResolvedValue(full("af"));
    const { props } = setup({ sites: withAff });
    await userEvent.type(urlInput(), `${affUrl}{enter}`);
    expect(await screen.findByTestId("session-dialog")).toHaveTextContent("session:asianfanfics");
    expect(api.createStory).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "save-session" }));
    expect(props.pushNotice).toHaveBeenCalledWith({ kind: "session-saved", username: "bob" });
    await waitFor(() => expect(api.createStory).toHaveBeenCalledWith(affUrl, { ai: false }));
    expect(screen.queryByTestId("session-dialog")).toBeNull();
  });

  it("skipping continues without a session", async () => {
    api.fetchSiteSession.mockResolvedValue({ configured: false });
    api.createStory.mockResolvedValue(full("af"));
    setup({ sites: withAff });
    await userEvent.type(urlInput(), `${affUrl}{enter}`);
    await userEvent.click(await screen.findByRole("button", { name: "skip-session" }));
    await waitFor(() => expect(api.createStory).toHaveBeenCalled());
  });

  it("prompts when the saved session has expired", async () => {
    api.fetchSiteSession.mockResolvedValue({ configured: true, expiresAt: new Date(Date.now() - 1000).toISOString() });
    setup({ sites: withAff });
    await userEvent.type(urlInput(), `${affUrl}{enter}`);
    expect(await screen.findByTestId("session-dialog")).toBeInTheDocument();
  });

  it("does not prompt with a valid session, or when the status check fails", async () => {
    api.createStory.mockResolvedValue(full("af"));
    api.fetchSiteSession.mockResolvedValueOnce({ configured: true, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    setup({ sites: withAff });
    await userEvent.type(urlInput(), `${affUrl}{enter}`);
    await waitFor(() => expect(api.createStory).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("session-dialog")).toBeNull();
    api.fetchSiteSession.mockRejectedValueOnce(new Error("x"));
    await userEvent.type(urlInput(), `${affUrl}{enter}`);
    await waitFor(() => expect(api.createStory).toHaveBeenCalledTimes(2));
  });
});

describe("LibraryView delete", () => {
  it("confirms before deleting one story, and clears the selection if it was open", async () => {
    api.fetchStories.mockResolvedValue([summary("a")]);
    api.fetchStory.mockResolvedValue(full("a"));
    api.deleteStory.mockResolvedValue(undefined);
    setup();
    await userEvent.click(await screen.findByText("Story a"));
    await screen.findByTestId("detail");
    await userEvent.click(screen.getByRole("button", { name: "Delete Story a" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.deleteStory).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete Story a" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.deleteStory).toHaveBeenCalledWith("a");
    await waitFor(() => expect(screen.queryByTestId("detail")).toBeNull());
  });

  it("shows the error when deleting fails", async () => {
    api.fetchStories.mockResolvedValue([summary("a")]);
    api.deleteStory.mockRejectedValue(new Error("narrating"));
    setup();
    await screen.findByText("Story a");
    await userEvent.click(screen.getByRole("button", { name: "Delete Story a" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("narrating")).toBeInTheDocument();
  });

  it("bulk delete: select, confirm, delete all; failed ones stay picked with the first error", async () => {
    api.fetchStories.mockResolvedValue([summary("a"), summary("b"), summary("c")]);
    api.deleteStory.mockImplementation(async (id: string) => {
      if (id === "b") throw new Error("b is narrating");
    });
    setup();
    await screen.findByText("Story a");
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all stories on this page" }));
    expect(screen.getByText("Selected 3 stories")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete 3 stories" }));
    await waitFor(() => expect(api.deleteStory).toHaveBeenCalledTimes(3));
    expect(await screen.findByText("b is narrating")).toBeInTheDocument();
    expect(screen.getByText("Selected 1 stories")).toBeInTheDocument();
  });

  it("deselect clears the selection", async () => {
    api.fetchStories.mockResolvedValue([summary("a")]);
    setup();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Story a" }));
    expect(screen.getByText("Selected 1 stories")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Deselect" }));
    expect(screen.queryByText(/Selected \d+ stories/)).toBeNull();
  });
});

describe("LibraryView watching and update checks", () => {
  it("toggles watch for a row and reloads", async () => {
    api.fetchStories.mockResolvedValue([summary("a")]);
    api.setStoryWatch.mockResolvedValue(undefined);
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Watch Story a" }));
    expect(api.setStoryWatch).toHaveBeenCalledWith("a", true);
    await waitFor(() => expect(api.fetchStories).toHaveBeenCalledTimes(2));
  });

  it("checks watched stories on launch when autoScan is on, skipping ones being crawled", async () => {
    api.fetchStories.mockResolvedValue([summary("a", { watching: true }), summary("b", { watching: true })]);
    api.checkStoryUpdates.mockResolvedValue({ newChapterCount: 3 });
    setup({ autoScan: true, live: { b: { cursor: 0, total: 1, errors: 0 } } });
    await waitFor(() => expect(api.checkStoryUpdates).toHaveBeenCalledTimes(1));
    expect(api.checkStoryUpdates).toHaveBeenCalledWith("a");
  });

  it("does not check on launch when autoScan is off or still unknown", async () => {
    api.fetchStories.mockResolvedValue([summary("a", { watching: true })]);
    setup({ autoScan: false });
    await screen.findByText("Story a");
    cleanup();
    setup({ autoScan: undefined });
    await screen.findByText("Story a");
    expect(api.checkStoryUpdates).not.toHaveBeenCalled();
  });

  it("manual check shows a per-row error but ignores a 409 (being crawled)", async () => {
    api.fetchStories.mockResolvedValue([summary("a", { watching: true }), summary("b", { watching: true })]);
    api.checkStoryUpdates.mockImplementation(async (id: string) => {
      if (id === "a") throw Object.assign(new api.ApiError("busy"), { status: 409 });
      throw new Error("site timeout");
    });
    // The post-check reload returns rows without the transient checkError.
    setup();
    await screen.findByText("Story a");
    api.fetchStories.mockResolvedValue([summary("a", { watching: true }), summary("b", { watching: true, checkError: "site timeout" })]);
    await userEvent.click(screen.getByRole("button", { name: "Check for new chapters" }));
    await waitFor(() => expect(api.checkStoryUpdates).toHaveBeenCalledTimes(2));
    expect(await screen.findAllByText("Check error")).toHaveLength(1);
  });

  it("has no check button without watched stories", async () => {
    api.fetchStories.mockResolvedValue([summary("a")]);
    setup();
    await screen.findByText("Story a");
    expect(screen.queryByRole("button", { name: "Check for new chapters" })).toBeNull();
  });
});
