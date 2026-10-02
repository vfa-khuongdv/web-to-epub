import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** The crawl SSE channels, read with fetch streams over a real Express server. */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "live-route-test-"));
process.env.DATA_DIR = DATA_DIR;

describe("live routes", () => {
  let server: Server;
  let base: string;
  let library: import("./library").Library;
  let publish: typeof import("./live").publish;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const live = await import("./live");
    publish = live.publish;
    // The public library is the one a request without a token reaches.
    const { libraryFor } = await import("./library");
    library = libraryFor({ header: () => undefined, query: {} } as never, {} as never)!;
    const app = express();
    app.use("/api", live.liveRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}/api`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(DATA_DIR, { recursive: true, force: true });
  });

  // Reads data: lines until `stop` says enough, then drops the connection.
  async function listen(url: string, stop: (events: any[]) => boolean, trigger?: () => void) {
    const controller = new AbortController();
    const res = await fetch(`${base}${url}`, { signal: controller.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const events: any[] = [];
    let buffer = "";
    let triggered = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (chunk.startsWith("data: ")) events.push(JSON.parse(chunk.slice(6)));
      }
      if (!triggered && events.length > 0) {
        triggered = true;
        trigger?.();
      }
      if (stop(events)) break;
    }
    const headers = res.headers;
    controller.abort();
    return { events, headers };
  }

  it("sends an idle snapshot on the per-story channel, then pushes published events", async () => {
    const { events, headers } = await listen(
      "/stories/abc/live",
      (e) => e.length >= 2,
      () => publish(library, "abc", { type: "running", cursor: 1, total: 3 } as never)
    );
    expect(headers.get("content-type")).toBe("text/event-stream");
    expect(events[0]).toEqual({ type: "idle" });
    expect(events[1]).toEqual({ type: "running", cursor: 1, total: 3 });
    await vi.waitFor(() => expect(library.liveSubscribers.has("abc")).toBe(false));
  });

  it("snapshots a running crawl for a late session", async () => {
    library.runningCrawls.set("busy", { cursor: 2, total: 9, startedAt: 1, abort: new AbortController() });
    const { events } = await listen("/stories/busy/live", (e) => e.length >= 1);
    library.runningCrawls.delete("busy");
    expect(events[0]).toEqual({ type: "running", cursor: 2, total: 9 });
  });

  it("the shared channel snapshots all crawls and tags events with storyId", async () => {
    library.runningCrawls.set("busy", { cursor: 2, total: 9, startedAt: 1, abort: new AbortController() });
    const { events } = await listen(
      "/stories/live",
      (e) => e.length >= 2,
      () => publish(library, "other", { type: "idle" } as never)
    );
    library.runningCrawls.delete("busy");
    expect(events[0].type).toBe("snapshot");
    expect(events[0].crawls).toEqual([expect.objectContaining({ storyId: "busy", cursor: 2, total: 9 })]);
    expect(events[1]).toEqual({ type: "idle", storyId: "other" });
    await vi.waitFor(() => expect(library.liveAllSubscribers.size).toBe(0));
  });

  it("answers 401 for a forged vault token", async () => {
    expect((await fetch(`${base}/stories/x/live?vault=forged`)).status).toBe(401);
    expect((await fetch(`${base}/stories/live?vault=forged`)).status).toBe(401);
  });

  it("publish drops subscribers whose connection has ended", () => {
    const dead = { destroyed: true, writableEnded: false, write: () => true } as never;
    library.liveSubscribers.set("gone", new Set([dead]));
    library.liveAllSubscribers.add(dead);
    publish(library, "gone", { type: "idle" } as never);
    expect(library.liveSubscribers.get("gone")!.size).toBe(0);
    expect(library.liveAllSubscribers.has(dead)).toBe(false);
  });
});
