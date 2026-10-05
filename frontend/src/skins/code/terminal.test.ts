import { describe, expect, it } from "vitest";
import { CrawlLogLine } from "../../hooks/useCrawlJob";
import { TerminalEntry, historyStep, interleave, logText, parseCommand, stripUrls } from "./terminal";

describe("parseCommand", () => {
  const cases: [string, string][] = [
    ["help", "help"],
    ["  CRAWL ", "crawl"],
    ["stop now", "stop"],
    ["open", "open"],
    ["cls", "clear"],
    ["clear", "clear"],
    ["hide", "hide"],
    ["", "empty"],
    ["   ", "empty"],
    ["rm -rf /", "unknown"],
  ];
  for (const [input, command] of cases) {
    it(`"${input}" → ${command}`, () => expect(parseCommand(input).command).toBe(command));
  }
  it("keeps the typed name for the error", () => expect(parseCommand("Foo bar").name).toBe("Foo"));
});

describe("log rewriting", () => {
  const files: Record<string, string> = { "https://truyen.example/tro-ve/chuong-12": "ch-0012-gap-lai.md" };
  const fileFor = (url: string) => files[url] ?? null;

  it("replaces the chapter address with its file name", () => {
    expect(logText("[12/150] https://truyen.example/tro-ve/chuong-12 — Loading & extracting…", fileFor)).toBe(
      "[12/150] ch-0012-gap-lai.md — Loading & extracting…"
    );
  });

  it("drops an unknown address", () => {
    expect(logText("[3/9] https://other.example/x — HTTP 500", fileFor)).toBe("[3/9] HTTP 500");
  });

  it("drops a missing address", () => {
    expect(logText("[3/9] undefined — Crawl stopped by user", fileFor)).toBe("[3/9] Crawl stopped by user");
  });

  it("strips addresses inside messages and other lines", () => {
    expect(logText("[1/2] https://truyen.example/tro-ve/chuong-12 — 404 at https://cdn.example/a.jpg", fileFor)).toBe(
      "[1/2] ch-0012-gap-lai.md — 404 at …"
    );
    expect(stripUrls("see http://a.b/c?d=e, then go")).toBe("see …, then go");
  });
});

describe("interleave", () => {
  const line = (text: string): CrawlLogLine => ({ at: "10:00:00", text, isError: false });
  const a = line("a");
  const b = line("b");
  const c = line("c");
  const entry = (id: number, after: CrawlLogLine | null): TerminalEntry => ({ id, kind: "input", text: `e${id}`, after });
  const flat = (items: ReturnType<typeof interleave>) =>
    items.map((item) => (item.type === "log" ? item.line.text : item.entry.text));

  it("puts each entry after the log line that was last when it was written", () => {
    expect(flat(interleave([a, b, c], [entry(1, null), entry(2, b), entry(3, b), entry(4, c)], undefined))).toEqual([
      "e1",
      "a",
      "b",
      "e2",
      "e3",
      "c",
      "e4",
    ]);
  });

  it("hides the log up to the clear mark", () => {
    expect(flat(interleave([a, b, c], [entry(1, b)], b))).toEqual(["e1", "c"]);
    expect(flat(interleave([a, b], [], null))).toEqual(["a", "b"]);
  });

  it("shows everything when the log was reset", () => {
    const fresh = [line("x")];
    expect(flat(interleave(fresh, [entry(1, b)], b))).toEqual(["e1", "x"]);
  });
});

describe("historyStep", () => {
  it("stays within the history", () => {
    expect(historyStep(["a", "b"], 2, -1)).toBe(1);
    expect(historyStep(["a", "b"], 0, -1)).toBe(0);
    expect(historyStep(["a", "b"], 2, 1)).toBe(2);
  });
});
