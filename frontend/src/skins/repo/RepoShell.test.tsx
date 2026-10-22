// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "../../i18n";
import { ContentBlock, StoredStory, StorySummary } from "../../types";
import { SkinAppContext } from "../types";
import RepoShell from "./RepoShell";

const STORY_ID = "s1";

const summary: StorySummary = {
  id: STORY_ID,
  storyUrl: "https://novel.example/truyen/tro-ve",
  site: "example",
  title: "Trở về",
  chapterCount: 3,
  doneCount: 2,
  errorCount: 0,
  watching: false,
  newChapterCount: 0,
  updatedAt: "2026-10-01T08:00:00.000Z",
};

const story: StoredStory = {
  id: STORY_ID,
  storyUrl: summary.storyUrl,
  site: "example",
  title: "Trở về",
  watching: false,
  newChapterCount: 0,
  createdAt: summary.updatedAt,
  updatedAt: summary.updatedAt,
  chapters: [
    { order: 1, url: "https://novel.example/truyen/tro-ve/chuong-1", title: "Gặp lại", status: "done" },
    { order: 2, url: "https://novel.example/truyen/tro-ve/chuong-2", title: "Chia tay", status: "done" },
    { order: 3, url: "https://novel.example/truyen/tro-ve/chuong-3", title: "Sau cùng", status: "pending" },
  ],
};

function blocks(order: number): ContentBlock[] {
  return [
    { type: "heading", level: 1, text: `Chương ${order}` },
    { type: "paragraph", text: `Đoạn văn của phần ${order}.` },
    { type: "image", src: "https://cdn.example/pic.png", alt: "minh họa" },
  ];
}

vi.mock("../../lib/api", () => ({
  fetchStories: vi.fn(async () => [summary]),
  fetchStory: vi.fn(async () => story),
  fetchChapterContent: vi.fn(async (_id: string, order: number) => ({
    ...story.chapters[order - 1],
    blocks: blocks(order),
  })),
  startStoryCrawl: vi.fn(async () => {}),
  stopStoryCrawl: vi.fn(async () => {}),
}));

vi.mock("../../hooks/narrationPlayer", () => ({
  useNarrationPlayer: () => ({ order: null, playing: false, toggle: () => {}, pause: () => {} }),
}));

function makeApp(overrides: Partial<SkinAppContext> = {}): SkinAppContext {
  return {
    job: { label: "", running: false, pct: 0, cursor: 0, total: 0, errors: 0, log: [], chapters: {} },
    live: {},
    attach: vi.fn(() => () => {}),
    clearChapters: vi.fn(),
    openSettings: vi.fn(),
    openInDefault: vi.fn(),
    neutralNames: false,
    isPrivate: false,
    setHead: vi.fn(),
    ...overrides,
  };
}

function lastTitle(app: SkinAppContext): string | undefined {
  const calls = (app.setHead as ReturnType<typeof vi.fn>).mock.calls.filter((call) => call[0]);
  return calls.at(-1)?.[0].title;
}

function renderShell(app: SkinAppContext) {
  return render(
    <LangProvider>
      <RepoShell app={app} />
    </LangProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("lang", "en");
  // jsdom has no layout: scrolling a row into view is a no-op here.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe("RepoShell", () => {
  it("goes from the repositories to a file and back, naming the tab like the site", async () => {
    const app = makeApp();
    renderShell(app);

    const list = await screen.findByRole("list", { name: "Repositories" });
    expect(lastTitle(app)).toBe("Repositories");
    fireEvent.click(within(list).getByRole("button", { name: "tro-ve" }));

    const table = await screen.findByRole("table", { name: "Files" });
    await waitFor(() => expect(lastTitle(app)).toBe("team/tro-ve"));
    expect(app.attach).toHaveBeenCalledWith("repository", STORY_ID);
    expect(within(table).getByRole("button", { name: "ch-0003-sau-cung.md" })).toBeInTheDocument();
    // No title anywhere but in the slugs, and no address.
    expect(document.body.textContent).not.toContain("Trở về");
    expect(document.body.textContent).not.toContain("novel.example");

    fireEvent.click(within(table).getByRole("button", { name: "ch-0001-gap-lai.md" }));
    const article = await screen.findByRole("article", { name: "Preview" });
    await within(article).findByText("Đoạn văn của phần 1.");
    expect(within(article).getByText("[image: minh họa]")).toBeInTheDocument();
    expect(document.querySelector("img, audio, video")).toBeNull();
    expect(lastTitle(app)).toBe("tro-ve/ch-0001-gap-lai.md at main · team/tro-ve");

    // ] steps to the next file; the pending third one is not "later".
    fireEvent.keyDown(document.body, { key: "]" });
    expect(await screen.findByText("Đoạn văn của phần 2.")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("skin-position:public:s1")!)).toEqual({ order: 2, line: 0 });
    fireEvent.keyDown(document.body, { key: "j" });
    expect(await screen.findByText("Nothing later.")).toBeInTheDocument();

    // Escape goes back up, and the files remember what was read.
    fireEvent.keyDown(document.body, { key: "Escape" });
    await screen.findByRole("table", { name: "Files" });
    expect(screen.getByText("You were reading ch-0002-chia-tay.md")).toBeInTheDocument();
  });

  it("uses neutral names everywhere when asked", async () => {
    const app = makeApp({ neutralNames: true });
    renderShell(app);
    const list = await screen.findByRole("list", { name: "Repositories" });
    fireEvent.click(within(list).getByRole("button", { name: "module-01" }));
    const table = await screen.findByRole("table", { name: "Files" });
    expect(within(table).getByRole("button", { name: "part-0001.md" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/tro-ve|gap-lai|Trở về/);
    fireEvent.click(within(table).getByRole("button", { name: "part-0002.md" }));
    await screen.findByRole("article", { name: "Preview" });
    expect(lastTitle(app)).toBe("module-01/part-0002.md at main · team/module-01");
  });

  it("opens the palette from / and runs the download from the Actions tab", async () => {
    const api = await import("../../lib/api");
    const app = makeApp();
    renderShell(app);
    const list = await screen.findByRole("list", { name: "Repositories" });
    fireEvent.click(within(list).getByRole("button", { name: "tro-ve" }));
    await screen.findByRole("table", { name: "Files" });

    fireEvent.keyDown(document.body, { key: "/" });
    expect(screen.getByRole("dialog", { name: "Type a command" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Type a command" }), { key: "Escape" });

    // "g a" jumps to Actions, where the run starts.
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "a" });
    await waitFor(() => expect(lastTitle(app)).toBe("Workflow runs · team/tro-ve"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run workflow/ }));
    });
    expect(api.startStoryCrawl).toHaveBeenCalledWith(STORY_ID);
  });

  it("prints the run's log without a single address", async () => {
    const app = makeApp({
      live: { [STORY_ID]: { cursor: 1, total: 3, errors: 1 } },
      job: {
        label: "repository",
        running: true,
        pct: 33,
        cursor: 1,
        total: 3,
        errors: 1,
        log: [
          { at: "10:00:01", text: "[1/3] https://novel.example/truyen/tro-ve/chuong-1 — ok", isError: false },
          { at: "10:00:02", text: "[2/3] https://novel.example/truyen/tro-ve/chuong-2 — failed https://novel.example/x", isError: true },
        ],
        chapters: {},
      },
    });
    renderShell(app);
    const list = await screen.findByRole("list", { name: "Repositories" });
    fireEvent.click(within(list).getByRole("button", { name: "tro-ve" }));
    await screen.findByRole("table", { name: "Files" });
    fireEvent.click(within(screen.getByRole("navigation", { name: "Repository" })).getByRole("button", { name: "Actions" }));

    const log = await screen.findByRole("log", { name: "Log" });
    await within(log).findByText("[1/3] ch-0001-gap-lai.md — ok");
    expect(log.textContent).not.toContain("novel.example");
    expect(screen.getByRole("button", { name: "Cancel run" })).toBeInTheDocument();
  });

  it("lists pull requests and reviews one: viewed file, line comment, submitted review", async () => {
    const app = makeApp();
    renderShell(app);
    const list = await screen.findByRole("list", { name: "Repositories" });
    fireEvent.click(within(list).getByRole("button", { name: "tro-ve" }));
    await screen.findByRole("table", { name: "Files" });
    fireEvent.click(within(screen.getByRole("navigation", { name: "Repository" })).getByRole("button", { name: /Pull requests/ }));

    const pulls = await screen.findByRole("list", { name: "Pull requests" });
    // The newest downloaded file is up for review, under its file name.
    expect(within(pulls).getByRole("button", { name: "docs: add ch-0002-chia-tay.md" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Closed/ }));
    expect(within(screen.getByRole("list", { name: "Pull requests" })).getByRole("button", { name: /bump money-format/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open/ }));

    fireEvent.click(within(screen.getByRole("list", { name: "Pull requests" })).getByRole("button", { name: /báo cáo chênh lệch ngân sách theo quý/ }));
    await waitFor(() => expect(lastTitle(app)).toBe("feat(budget): báo cáo chênh lệch ngân sách theo quý by hoang-nm · Pull Request #482 · team/tro-ve"));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Pull request" })).getByRole("button", { name: /Files changed/ }));
    const file = screen.getByRole("region", { name: "src/budget/budget.routes.ts" });
    fireEvent.click(within(file).getByRole("checkbox", { name: "Viewed" }));
    expect(screen.getByText("1 / 6 files viewed")).toBeInTheDocument();

    const service = screen.getByRole("region", { name: "src/budget/budget.service.ts" });
    fireEvent.click(within(service).getByRole("button", { name: "Add a comment on line R3" }));
    fireEvent.change(within(service).getByRole("textbox", { name: "Comment on line R3" }), { target: { value: "Import này chưa dùng" } });
    fireEvent.click(within(service).getByRole("button", { name: "Add single comment" }));
    expect(within(service).getByText("Import này chưa dùng")).toBeInTheDocument();

    // Shortcuts are not taken from a comment being typed.
    fireEvent.click(within(service).getByRole("button", { name: "Add a comment on line R4" }));
    const field = within(service).getByRole("textbox", { name: "Comment on line R4" });
    fireEvent.keyDown(field, { key: "g" });
    fireEvent.keyDown(field, { key: "i" });
    expect(screen.getByRole("region", { name: "src/budget/budget.service.ts" })).toBeInTheDocument();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(within(service).queryByRole("textbox", { name: "Comment on line R4" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    const dialog = screen.getByRole("dialog", { name: "Finish your review" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Review summary" }), { target: { value: "Ổn, merge được" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit review" }));
    expect(screen.getByText("Ổn, merge được")).toBeInTheDocument();
    expect(screen.getAllByText("Import này chưa dùng").length).toBeGreaterThan(0);

    // Back to the list and in again: what was done is still there.
    fireEvent.click(within(screen.getByRole("navigation", { name: "Repository" })).getByRole("button", { name: /Pull requests/ }));
    fireEvent.click(within(await screen.findByRole("list", { name: "Pull requests" })).getByRole("button", { name: /báo cáo chênh lệch ngân sách theo quý/ }));
    expect(screen.getByText("Ổn, merge được")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("novel.example");
  });

  it("reads the newest file as a pull request's added lines", async () => {
    const app = makeApp({ neutralNames: true });
    renderShell(app);
    const list = await screen.findByRole("list", { name: "Repositories" });
    fireEvent.click(within(list).getByRole("button", { name: "module-01" }));
    await screen.findByRole("table", { name: "Files" });
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "p" });
    fireEvent.click(within(await screen.findByRole("list", { name: "Pull requests" })).getByRole("button", { name: "docs: add part-0002.md" }));
    fireEvent.click(within(await screen.findByRole("navigation", { name: "Pull request" })).getByRole("button", { name: /Files changed/ }));
    const file = screen.getByRole("region", { name: "part-0002.md" });
    expect(await within(file).findByText("Đoạn văn của phần 2.")).toBeInTheDocument();
    expect(within(file).getByText("[image: minh họa]")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/tro-ve|chia-tay|Trở về|cdn\.example/);
  });

  it("opens an issue from the list and comments on it, then closes it", async () => {
    const app = makeApp();
    renderShell(app);
    const list = await screen.findByRole("list", { name: "Repositories" });
    fireEvent.click(within(list).getByRole("button", { name: "tro-ve" }));
    await screen.findByRole("table", { name: "Files" });
    fireEvent.click(within(screen.getByRole("navigation", { name: "Repository" })).getByRole("button", { name: /Issues/ }));

    const search = screen.getByRole("searchbox", { name: "Search all issues" });
    fireEvent.change(search, { target: { value: "is:issue is:open label:bug" } });
    fireEvent.keyDown(search, { key: "Enter" });
    const issues = screen.getByRole("list", { name: "Issues" });
    expect(within(issues).getAllByRole("button")).toHaveLength(2);
    fireEvent.click(within(issues).getByRole("button", { name: /phòng ban chưa có ngân sách/ }));
    await waitFor(() => expect(lastTitle(app)).toMatch(/· Issue #483 · team\/tro-ve$/));

    fireEvent.change(screen.getByRole("textbox", { name: "Add a comment" }), { target: { value: "Em xem giúp anh nhé" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(screen.getByText("Em xem giúp anh nhé")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close issue" }));
    expect(screen.getByText("closed this as completed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen issue" })).toBeInTheDocument();
  });

  it("shows the file tree beside an open file, and folds it away", async () => {
    const app = makeApp();
    renderShell(app);
    const list = await screen.findByRole("list", { name: "Repositories" });
    fireEvent.click(within(list).getByRole("button", { name: "tro-ve" }));
    fireEvent.click(within(await screen.findByRole("table", { name: "Files" })).getByRole("button", { name: "ch-0001-gap-lai.md" }));
    const tree = await screen.findByRole("tree", { name: "Files" });
    fireEvent.click(within(tree).getByRole("button", { name: "ch-0002-chia-tay.md" }));
    expect(await screen.findByText("Đoạn văn của phần 2.")).toBeInTheDocument();
    expect(within(tree).getByRole("treeitem", { selected: true })).toHaveTextContent("ch-0002-chia-tay.md");
    fireEvent.click(screen.getByRole("button", { name: "Collapse file tree" }));
    expect(screen.queryByRole("tree", { name: "Files" })).toBeNull();
    expect(localStorage.getItem("repo-tree-open")).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Expand file tree" }));
    expect(screen.getByRole("tree", { name: "Files" })).toBeInTheDocument();
  });
});
