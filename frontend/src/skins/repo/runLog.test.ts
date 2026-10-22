import { describe, expect, it } from "vitest";
import { currentRun, logRows, runNumber } from "./runLog";

const idleJob = { cursor: 0, total: 0, errors: 0, log: [] };

describe("currentRun", () => {
  it("is the live crawl while one runs", () => {
    expect(currentRun({ cursor: 3, total: 10, errors: 1 }, idleJob)).toEqual({
      status: "running",
      done: 3,
      total: 10,
      errors: 1,
    });
  });

  it("is the finished run this session saw, by its errors", () => {
    const log = [{ at: "10:00:00", text: "x", isError: false }];
    expect(currentRun(undefined, { cursor: 10, total: 10, errors: 0, log })?.status).toBe("success");
    expect(currentRun(undefined, { cursor: 10, total: 10, errors: 2, log })?.status).toBe("failure");
  });

  it("is nothing when this session saw no run", () => {
    expect(currentRun(undefined, idleJob)).toBeNull();
  });
});

describe("logRows", () => {
  it("prints the file name instead of the story address, and no address anywhere", () => {
    const rows = logRows(
      [
        { at: "10:00:01", text: "[1/2] https://site.example/truyen/abc/chuong-1 — done", isError: false },
        { at: "10:00:02", text: "[2/2] https://site.example/truyen/abc/chuong-2 — failed at https://cdn.example/x", isError: true },
        { at: "10:00:03", text: "Started https://site.example/truyen/abc", isError: false },
      ],
      (url) => (url.endsWith("chuong-1") ? "part-0001.md" : null)
    );
    expect(rows.map((row) => row.text)).toEqual(["[1/2] part-0001.md — done", "[2/2] failed at …", "Started …"]);
    expect(rows[1].error).toBe(true);
    expect(rows.map((row) => row.number)).toEqual([1, 2, 3]);
    expect(rows.some((row) => /https?:/.test(row.text))).toBe(false);
  });
});

describe("runNumber", () => {
  it("is stable per repository", () => {
    expect(runNumber("abc")).toBe(runNumber("abc"));
    expect(runNumber("abc")).toBeGreaterThanOrEqual(12);
  });
});
