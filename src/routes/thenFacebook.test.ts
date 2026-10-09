import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "then-facebook-test-"));

import type { Library } from "./library";
import { thenFacebook } from "./youtube";

/**
 * One publish run for two destinations: Facebook starts only after the YouTube job is over
 * and was not stopped, the run's phase moves on, and the summary keeps both sides' failures.
 */
function makeRun() {
  return {
    phase: "upload" as const,
    done: 3,
    total: 5,
    order: 2 as number | undefined,
    percent: 40 as number | undefined,
    abort: new AbortController(),
  };
}
const library = { youtubeSubscribers: new Set() } as unknown as Library;

describe("thenFacebook", () => {
  it("runs the Facebook job after the first and sums up both", async () => {
    const run = makeRun();
    const start = vi.fn(async () => {
      expect(run).toMatchObject({ phase: "facebook", done: 0, total: 2 });
      return { done: 2, failed: 0 };
    });
    const result = await thenFacebook(library, "s1", run, Promise.resolve({ done: 5, failed: 1, message: "quota" }), {
      total: 2,
      start,
    });
    expect(start).toHaveBeenCalledOnce();
    expect(result).toEqual({ done: 2, failed: 1, message: "quota" });
  });

  it("does not start Facebook when the run was stopped", async () => {
    const run = makeRun();
    run.abort.abort();
    const start = vi.fn(async () => ({ done: 1, failed: 0 }));
    const result = await thenFacebook(library, "s1", run, Promise.resolve({ done: 1, failed: 0 }), { total: 1, start });
    expect(start).not.toHaveBeenCalled();
    expect(result).toEqual({ done: 1, failed: 0 });
  });

  it("does not start Facebook when the first job threw", async () => {
    const start = vi.fn(async () => ({ done: 1, failed: 0 }));
    await expect(
      thenFacebook(library, "s1", makeRun(), Promise.reject(new Error("boom")), { total: 1, start })
    ).rejects.toThrow("boom");
    expect(start).not.toHaveBeenCalled();
  });
});
