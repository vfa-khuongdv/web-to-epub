import { describe, expect, it } from "vitest";
import { Token, highlightLine, languageOf } from "./highlight";

const kinds = (tokens: Token[]) => tokens.filter((token) => token.kind !== "plain").map((token) => `${token.kind}:${token.text}`);

describe("languageOf", () => {
  it("picks the language from the extension", () => {
    expect(languageOf("src/budget/budget.service.ts")).toBe("ts");
    expect(languageOf("migrations/001_init.SQL")).toBe("sql");
    expect(languageOf("package.json")).toBe("json");
    expect(languageOf(".ci/test.yml")).toBe("yaml");
    expect(languageOf("docs/part-0001.md")).toBe("md");
    expect(languageOf("Makefile")).toBe("plain");
  });
});

describe("highlightLine", () => {
  it("tints TypeScript keywords, names, strings, numbers and comments", () => {
    expect(kinds(highlightLine("export class BudgetService {", "ts"))).toEqual(["keyword:export", "keyword:class", "entity:BudgetService"]);
    expect(kinds(highlightLine("  const ratio = total > 0 ? spent / total : 0; // tránh chia 0", "ts"))).toEqual([
      "keyword:const",
      "constant:0",
      "constant:0",
      "comment:// tránh chia 0",
    ]);
    expect(kinds(highlightLine("  @Get(':id/variance')", "ts"))).toEqual(["entity:@Get", "string:':id/variance'"]);
    expect(kinds(highlightLine("    return roundCurrency(WARNING_THRESHOLD, null);", "ts"))).toEqual([
      "keyword:return",
      "entity:roundCurrency",
      "constant:WARNING_THRESHOLD",
      "constant:null",
    ]);
    expect(kinds(highlightLine("   * @param amount số tiền", "ts"))).toEqual(["comment:   * @param amount số tiền"]);
  });

  it("keeps the text whole", () => {
    const line = "  const rows = budget.lines.map((line) => ({ code: `${line.code}` }));";
    expect(highlightLine(line, "ts").map((token) => token.text).join("")).toBe(line);
  });

  it("tints SQL in any case", () => {
    expect(kinds(highlightLine("ALTER TABLE budget_line ADD COLUMN code varchar(20) DEFAULT ''; -- mã dòng", "sql"))).toEqual([
      "keyword:ALTER",
      "keyword:TABLE",
      "keyword:ADD",
      "keyword:COLUMN",
      "keyword:varchar",
      "constant:20",
      "keyword:DEFAULT",
      "string:''",
      "comment:-- mã dòng",
    ]);
  });

  it("tints JSON keys, YAML keys and Markdown headings", () => {
    expect(kinds(highlightLine('    "pg": "^8.13.0",', "json"))).toEqual(['constant:"pg":', 'string:"^8.13.0"']);
    expect(kinds(highlightLine("  node-version: 20 # LTS", "yaml"))).toEqual(["entity:  node-version", "constant:20", "comment:# LTS"]);
    expect(highlightLine("## Cách chạy", "md")).toEqual([{ kind: "heading", text: "## Cách chạy" }]);
    expect(highlightLine("", "ts")).toEqual([]);
  });
});
