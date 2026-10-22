import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, plainText, taskCount } from "./markdown";

describe("parseInline", () => {
  it("reads code, bold, italic, links, references and mentions", () => {
    expect(parseInline("Gọi `roundCurrency` **trước**, xem _ghi chú_ ở [docs](https://x.test/a) cho #471, cc @lan-pt")).toEqual([
      { kind: "text", text: "Gọi " },
      { kind: "code", text: "roundCurrency" },
      { kind: "text", text: " " },
      { kind: "bold", text: "trước" },
      { kind: "text", text: ", xem " },
      { kind: "italic", text: "ghi chú" },
      { kind: "text", text: " ở " },
      // A link keeps its words only: nothing on the page goes anywhere.
      { kind: "link", text: "docs" },
      { kind: "text", text: " cho " },
      { kind: "ref", text: "#471", number: 471 },
      { kind: "text", text: ", cc " },
      { kind: "mention", text: "@lan-pt" },
    ]);
  });

  it("leaves snake_case and lone symbols alone", () => {
    expect(parseInline("budget_line_code * 2")).toEqual([{ kind: "text", text: "budget_line_code * 2" }]);
  });
});

describe("parseMarkdown", () => {
  it("reads the blocks of a pull request description", () => {
    const blocks = parseMarkdown(
      [
        "## Mô tả",
        "Dòng một",
        "dòng hai",
        "",
        "- `GET /budgets/:id/variance`",
        "- Cảnh báo 85%",
        "",
        "1. Một",
        "2. Hai",
        "",
        "- [x] Unit test",
        "- [ ] Staging",
        "",
        "> Trích",
        "",
        "```sql",
        "SELECT 1;",
        "```",
        "---",
      ].join("\n")
    );
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "list", "list", "list", "quote", "code", "rule"]);
    expect(blocks[1]).toEqual({ kind: "paragraph", lines: [[{ kind: "text", text: "Dòng một" }], [{ kind: "text", text: "dòng hai" }]] });
    expect(blocks[3]).toMatchObject({ kind: "list", ordered: true });
    expect(blocks[4]).toMatchObject({ kind: "list", items: [{ task: true }, { task: false }] });
    expect(blocks[6]).toEqual({ kind: "code", lang: "sql", lines: ["SELECT 1;"] });
  });

  it("treats typed text as text", () => {
    const blocks = parseMarkdown("<img src=x onerror=alert(1)>");
    expect(plainText(blocks)).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("taskCount", () => {
  it("counts ticked boxes", () => {
    expect(taskCount("- [x] a\n- [ ] b\n* [X] c\nnot - [x] d")).toEqual({ done: 2, total: 3 });
    expect(taskCount("no tasks")).toEqual({ done: 0, total: 0 });
  });
});
