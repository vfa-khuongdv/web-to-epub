import { describe, expect, it } from "vitest";
import { DOCS_PULL, docsPull } from "./docsPull";
import { fakeRepository } from "./fakeData";

describe("docsPull", () => {
  const pull = docsPull({ file: "part-0012.md", lines: ["## Phần 12", "", "Đoạn một.", "", "[image: minh họa]"], sha: "abc1234", at: 1000 });

  it("proposes the file as added lines under its own name", () => {
    expect(pull.title).toBe("docs: add part-0012.md");
    expect(pull.head).toBe("docs/part-0012");
    expect(pull.files).toHaveLength(1);
    expect(pull.files[0]).toMatchObject({ path: "part-0012.md", status: "added" });
    expect(pull.files[0].hunks[0].lines.map((line) => line.text)).toEqual(["## Phần 12", "", "Đoạn một.", "", "[image: minh họa]"]);
    expect(pull.files[0].hunks[0].lines.every((line) => line.kind === "add")).toBe(true);
  });

  it("is newer than every made-up pull request and issue", () => {
    const repo = fakeRepository(1000);
    for (const item of [...repo.pulls, ...repo.issues]) expect(item.number).toBeLessThan(DOCS_PULL);
  });

  it("carries a check and a commit, so every tab has something", () => {
    expect(pull.checks[0].steps.length).toBeGreaterThan(0);
    expect(pull.commits[0].sha).toBe("abc1234");
  });
});
