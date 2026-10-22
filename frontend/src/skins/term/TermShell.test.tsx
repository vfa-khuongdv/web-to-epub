// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrawlLogLine } from "../../hooks/useCrawlJob";
import { LangProvider } from "../../i18n";
import { startStoryCrawl } from "../../lib/api";
import { ContentBlock, StoredStory, StorySummary } from "../../types";
import { SkinAppContext } from "../types";
import TermShell from "./TermShell";

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
  fetchChapterContent: vi.fn(async (_id: string, order: number) => ({ ...story.chapters[order - 1], blocks: blocks(order) })),
  startStoryCrawl: vi.fn(async () => ({ total: 1 })),
  stopStoryCrawl: vi.fn(async () => {}),
}));

vi.mock("../../hooks/narrationPlayer", () => ({
  useNarrationPlayer: () => ({ order: null, playing: false, toggle: () => {}, pause: () => {} }),
}));

class NoResize {
  observe() {}
  disconnect() {}
}

// jsdom lays nothing out: give the terminal a window's size, so the pager shows a screen.
const sizes = { clientWidth: 1000, clientHeight: 800 };
const original = Object.fromEntries(
  Object.keys(sizes).map((key) => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)])
);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("lang", "en");
  vi.stubGlobal("ResizeObserver", NoResize);
  for (const [key, value] of Object.entries(sizes)) {
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const [key, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
  }
});

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
  return calls[calls.length - 1]?.[0].title;
}

function renderShell(app: SkinAppContext) {
  const result = render(
    <LangProvider>
      <TermShell app={app} />
    </LangProvider>
  );
  return {
    ...result,
    rerenderWith: (next: SkinAppContext) =>
      result.rerender(
        <LangProvider>
          <TermShell app={next} />
        </LangProvider>
      ),
  };
}

async function type(command: string) {
  const input = await screen.findByRole("textbox", { name: "Terminal input" });
  fireEvent.change(input, { target: { value: command } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
}

const terminal = () => screen.getByRole("region", { name: "Terminal" });

describe("TermShell", () => {
  it("walks the library as folders and reads a file in the pager", async () => {
    const app = makeApp();
    renderShell(app);
    await screen.findByText('Type "help" to see the commands.');
    expect(lastTitle(app)).toBe("dev@workstation: ~/projects");

    await type("ls");
    await within(terminal()).findByText("tro-ve");
    await type("cd tro-ve");
    await waitFor(() => expect(lastTitle(app)).toBe("dev@workstation: ~/projects/tro-ve"));
    await type("ls");
    await within(terminal()).findByText("ch-0001-gap-lai.md");

    await type("less ch-0001-gap-lai.md");
    const pager = await screen.findByRole("document", { name: "ch-0001-gap-lai.md" });
    await within(pager).findByText("Đoạn văn của phần 1.");
    expect(within(pager).getByText("[image: minh họa]")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(lastTitle(app)).toBe("less ch-0001-gap-lai.md");

    fireEvent.keyDown(pager, { key: "]" });
    const next = await screen.findByRole("document", { name: "ch-0002-chia-tay.md" });
    await within(next).findByText("Đoạn văn của phần 2.");
    // The reading position is the file and its line.
    expect(JSON.parse(localStorage.getItem(`skin-position:public:${STORY_ID}`) ?? "null")).toEqual({ order: 2, line: 0 });

    fireEvent.keyDown(next, { key: "q" });
    await screen.findByRole("textbox", { name: "Terminal input" });
    await type("cat ch-0003-sau-cung.md");
    await within(terminal()).findByText("cat: ch-0003-sau-cung.md: Not downloaded yet.");
    await type("frobnicate");
    await within(terminal()).findByText("zsh: command not found: frobnicate");
  });

  it("shows no title with neutral names on", async () => {
    const app = makeApp({ neutralNames: true });
    renderShell(app);
    await type("ls");
    await within(terminal()).findByText("module-01");
    await type("cd module-01");
    await type("ls");
    await within(terminal()).findByText("part-0001.md");
    expect(screen.queryByText(/tro-ve|gap-lai|Trở về/)).toBeNull();
  });

  it("streams a sync's log without addresses and prints the finished bar", async () => {
    const app = makeApp();
    const view = renderShell(app);
    await type("cd tro-ve");
    await type("ls");
    await within(terminal()).findByText("ch-0003-sau-cung.md");
    await type("sync");
    await waitFor(() => expect(startStoryCrawl).toHaveBeenCalledWith(STORY_ID));
    await within(terminal()).findByText("Downloading 1 files…");

    const log: CrawlLogLine[] = [
      { at: "10:00:00", text: `[1/1] ${story.chapters[2].url} — saved (see https://novel.example/x)`, isError: false },
    ];
    const running = makeApp({
      ...app,
      live: { [STORY_ID]: { cursor: 0, total: 1, errors: 0 } },
      job: { ...app.job, running: true, total: 1, log },
    });
    act(() => view.rerenderWith(running));
    await within(terminal()).findByText("[1/1] ch-0003-sau-cung.md — saved (see …)");
    expect(terminal().textContent).not.toContain("novel.example");

    act(() => view.rerenderWith({ ...running, live: {} }));
    await within(terminal()).findByText(/1\/1 100%$/);
    await waitFor(() => expect(lastTitle(app)).toBe("dev@workstation: ~/projects/tro-ve"));
  });
});
