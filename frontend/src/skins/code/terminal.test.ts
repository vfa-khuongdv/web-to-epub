import { describe, expect, it } from "vitest";
import { CrawlLogLine } from "../../hooks/useCrawlJob";
import { TerminalEntry, historyStep, interleave, parseCommand } from "./terminal";

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
