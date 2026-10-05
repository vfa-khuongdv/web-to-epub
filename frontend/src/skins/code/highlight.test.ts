import { describe, expect, it } from "vitest";
import { highlight, highlightLine } from "./highlight";

const kinds = (line: string) =>
  highlightLine(line)
    .tokens.filter((token) => token.kind !== "plain")
    .map((token) => `${token.kind}:${token.text}`);

describe("highlightLine", () => {
  it("colours an import", () => {
    expect(kinds(`import { Injectable } from "@nestjs/common";`)).toEqual([
      "control:import",
      "type:Injectable",
      "control:from",
      'string:"@nestjs/common"',
    ]);
  });

  it("tells functions, types, numbers and variables apart", () => {
    expect(kinds("const total = sumBy(items, 0.5) as Money;")).toEqual([
      "keyword:const",
      "variable:total",
      "function:sumBy",
      "variable:items",
      "number:0.5",
      "keyword:as",
      "type:Money",
    ]);
  });

  it("ends at a line comment", () => {
    expect(kinds("return x; // done")).toEqual(["control:return", "variable:x", "comment:// done"]);
  });

  it("keeps every character", () => {
    const line = `  async load(id: string): Promise<Budget> { // x`;
    expect(highlightLine(line).tokens.map((token) => token.text).join("")).toBe(line);
  });
});

describe("highlight", () => {
  it("carries a block comment across lines", () => {
    const lines = highlight("/**\n * Budget\n */\nconst a = 1;");
    expect(lines[0]).toEqual([{ kind: "comment", text: "/**" }]);
    expect(lines[1]).toEqual([{ kind: "comment", text: " * Budget" }]);
    expect(lines[2]).toEqual([{ kind: "comment", text: " */" }]);
    expect(lines[3][0]).toEqual({ kind: "keyword", text: "const" });
  });

  it("closes a one-line block comment", () => {
    const lines = highlight("/* note */ let b = 2;\nlet c = 3;");
    expect(lines[0][0]).toEqual({ kind: "comment", text: "/* note */" });
    expect(lines[1][0]).toEqual({ kind: "keyword", text: "let" });
  });
});
