// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawlJobState } from "../../hooks/useCrawlJob";
import { LangProvider } from "../../i18n";
import type { SupportedSite } from "../../types";
import AddStoryBox from "./AddStoryBox";
import { CrawlLogButton, CrawlLogDialog } from "./CrawlLog";
import SortTh from "./SortTh";

beforeEach(() => {
  localStorage.setItem("lang", "en");
  // jsdom does not implement scrolling geometry; the dialog only assigns scrollTop.
});
afterEach(cleanup);

const wrap = (ui: React.ReactElement) => render(<LangProvider>{ui}</LangProvider>);

const job = (over: Partial<CrawlJobState> = {}): CrawlJobState => ({
  label: "My Story",
  running: false,
  pct: 0,
  cursor: 0,
  total: 0,
  errors: 0,
  log: [],
  chapters: {},
  ...over,
});

describe("CrawlLogButton", () => {
  it("renders nothing before any crawl", () => {
    const { container } = wrap(<CrawlLogButton job={job()} onOpen={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows progress while running, and plain Crawling with no total", () => {
    const { rerender } = wrap(<CrawlLogButton job={job({ running: true, cursor: 2, total: 5 })} onOpen={() => {}} />);
    expect(screen.getByRole("button")).toHaveTextContent("Crawling 2/5");
    rerender(
      <LangProvider>
        <CrawlLogButton job={job({ running: true })} onOpen={() => {}} />
      </LangProvider>
    );
    expect(screen.getByRole("button")).toHaveTextContent(/^Crawling$/);
  });

  it("shows Crawl log and an error count after a finished run, and opens", async () => {
    const onOpen = vi.fn();
    wrap(<CrawlLogButton job={job({ total: 4, cursor: 4, errors: 2 })} onOpen={onOpen} />);
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("Crawl log");
    expect(button).toHaveTextContent("2 errors");
    await userEvent.click(button);
    expect(onOpen).toHaveBeenCalled();
  });

  it("is visible when only log lines exist", () => {
    wrap(<CrawlLogButton job={job({ log: [{ at: "1", text: "x", isError: false }] })} onOpen={() => {}} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});

describe("CrawlLogDialog", () => {
  it("shows an empty log and a Preparing state while running with no total", () => {
    wrap(<CrawlLogDialog job={job({ running: true })} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Crawl log" })).toBeInTheDocument();
    expect(screen.getByText("Nothing logged yet.")).toBeInTheDocument();
    expect(screen.getByText("Preparing…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Crawl progress" })).toBeInTheDocument();
  });

  it("shows counts, eta, errors and log lines", () => {
    wrap(
      <CrawlLogDialog
        job={job({
          running: true,
          cursor: 3,
          total: 10,
          pct: 30,
          etaMs: 30_000,
          errors: 1,
          log: [
            { at: "10:00:00", text: "line ok", isError: false },
            { at: "10:00:01", text: "line bad", isError: true },
          ],
        })}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("My Story")).toBeInTheDocument();
    expect(screen.getByText("3/10 chapters")).toBeInTheDocument();
    expect(screen.getByText("· under 1 min remaining")).toBeInTheDocument();
    expect(screen.getByText("1 errors")).toBeInTheDocument();
    expect(screen.getByText("line bad")).toHaveClass("text-error");
    expect(screen.getByText("line ok")).not.toHaveClass("text-error");
  });

  it("shows a finished run with a Done title and completed bar", () => {
    wrap(<CrawlLogDialog job={job({ total: 2, cursor: 2, pct: 100 })} onClose={() => {}} />);
    expect(screen.getByRole("heading")).toHaveTextContent("Done · My Story");
    expect(screen.getByRole("progressbar", { name: "Crawl completed" })).toBeInTheDocument();
  });

  it("has no progress bar when idle with no run", () => {
    wrap(<CrawlLogDialog job={job()} onClose={() => {}} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("closes via button, Escape and backdrop, but not on a click inside", async () => {
    const onClose = vi.fn();
    wrap(<CrawlLogDialog job={job()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe("SortTh", () => {
  const renderTh = (sorts: { key: "title" | "site"; dir: "asc" | "desc" }[], onSort = vi.fn()) => {
    wrap(
      <table>
        <thead>
          <tr>
            <SortTh label="Title" sortKey="title" sorts={sorts} onSort={onSort} className="c" />
          </tr>
        </thead>
      </table>
    );
    return onSort;
  };

  it("has no aria-sort when inactive", () => {
    renderTh([]);
    expect(screen.getByRole("columnheader")).not.toHaveAttribute("aria-sort");
  });

  it("reports ascending and descending", () => {
    renderTh([{ key: "title", dir: "asc" }]);
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "ascending");
    cleanup();
    renderTh([{ key: "title", dir: "desc" }]);
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "descending");
  });

  it("shows the rank only with several criteria", () => {
    renderTh([{ key: "site", dir: "asc" }, { key: "title", dir: "asc" }]);
    expect(screen.getByRole("button")).toHaveTextContent("2");
    cleanup();
    renderTh([{ key: "title", dir: "asc" }]);
    expect(screen.getByRole("button")).not.toHaveTextContent("1");
  });

  it("passes the additive flag from Shift", async () => {
    const onSort = renderTh([]);
    await userEvent.click(screen.getByRole("button"));
    expect(onSort).toHaveBeenLastCalledWith("title", false);
    fireEvent.click(screen.getByRole("button"), { shiftKey: true });
    expect(onSort).toHaveBeenLastCalledWith("title", true);
  });

  it("has a descriptive title", () => {
    renderTh([]);
    expect(screen.getByRole("button")).toHaveAttribute("title", "Sort by Title — hold Shift to add secondary criteria");
  });
});

describe("AddStoryBox", () => {
  const sites: SupportedSite[] = [
    { domain: "a.com", name: "Alpha", mode: "crawl" },
    { domain: "a.net", name: "Alpha", mode: "crawl" },
    { domain: "b.com", name: "Beta", mode: "crawl" },
  ];
  const imports: SupportedSite[] = [{ domain: "arch.org", name: "Archive", mode: "import" }];

  function setup(over: Partial<React.ComponentProps<typeof AddStoryBox>> = {}) {
    const props: React.ComponentProps<typeof AddStoryBox> = {
      storyUrl: "",
      onStoryUrl: vi.fn(),
      busy: false,
      importBusy: false,
      onCreate: vi.fn(),
      aiReady: false,
      onCreateAi: vi.fn(),
      onImportFiles: vi.fn(),
      pendingImport: null,
      onOverwrite: vi.fn(),
      onCancelOverwrite: vi.fn(),
      crawlSites: sites,
      importSites: imports,
      ...over,
    };
    const utils = wrap(<AddStoryBox {...props} />);
    return { props, ...utils };
  }

  it("lists unique crawl sites and import sites", () => {
    setup();
    expect(screen.getByText(/Auto-loading sites:/)).toHaveTextContent("Alpha, Beta");
    expect(screen.getByText(/Book sites/)).toHaveTextContent("Archive");
    expect(screen.getByText("Or drop an .epub or .pdf file here to import it.")).toBeInTheDocument();
  });

  it("shows loading… with no sites and hides the import group", () => {
    setup({ crawlSites: [], importSites: [] });
    expect(screen.getByText(/loading…/)).toBeInTheDocument();
    expect(screen.queryByText(/Book sites/)).toBeNull();
  });

  it("reports typing, Load click and Enter", async () => {
    const { props } = setup();
    const input = screen.getByLabelText("Story page URL");
    await userEvent.type(input, "h");
    expect(props.onStoryUrl).toHaveBeenCalledWith("h");
    await userEvent.type(input, "{Enter}");
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Load chapters" }));
    expect(props.onCreate).toHaveBeenCalledTimes(2);
  });

  it("disables load while busy and import while importing", () => {
    setup({ busy: true, importBusy: true });
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Importing…" })).toBeDisabled();
  });

  it("offers Load with AI only when ready", async () => {
    const first = setup();
    expect(screen.queryByRole("button", { name: /Load with AI/ })).toBeNull();
    first.unmount();
    const { props } = setup({ aiReady: true });
    await userEvent.click(screen.getByRole("button", { name: /Load with AI/ }));
    expect(props.onCreateAi).toHaveBeenCalled();
  });

  it("passes chosen files and resets the input", () => {
    const { props, container } = setup();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "b.epub");
    fireEvent.change(input, { target: { files: [file] } });
    expect(props.onImportFiles).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("");
  });

  it("imports dropped files and toggles the drag highlight", () => {
    const { props, container } = setup();
    const box = container.firstElementChild!;
    fireEvent.dragOver(box);
    expect(box).toHaveClass("bg-sunken");
    fireEvent.dragLeave(box);
    expect(box).not.toHaveClass("bg-sunken");
    fireEvent.dragOver(box);
    const files = [new File(["x"], "d.pdf")];
    fireEvent.drop(box, { dataTransfer: { files } });
    expect(box).not.toHaveClass("bg-sunken");
    expect(props.onImportFiles).toHaveBeenCalledWith(files);
  });

  it("asks about overwriting a file and wires both answers", async () => {
    const { props } = setup({ pendingImport: { kind: "file", file: new File(["x"], "book.epub") } });
    expect(screen.getByText(/Overwrite it with “book.epub”\?/)).toBeInTheDocument();
    expect(screen.queryByText(/Auto-loading sites/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Overwrite" }));
    expect(props.onOverwrite).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancelOverwrite).toHaveBeenCalled();
  });

  it("names the URL for a pending url import and disables answers while busy", () => {
    setup({ pendingImport: { kind: "url", url: "https://archive.org/details/x" }, importBusy: true });
    expect(screen.getByText(/https:\/\/archive.org\/details\/x/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overwrite" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
