import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** The combined /api router: supported-sites listing, X-Lang, and that sub-routers are mounted. */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "index-route-test-"));
process.env.DATA_DIR = DATA_DIR;

describe("api router", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const router = (await import("./index")).default;
    const app = express();
    app.use(express.json());
    app.use("/api", router);
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

  it("lists crawl sites and import sources, tagged by mode", async () => {
    const { sites } = (await (await fetch(`${base}/supported-sites`)).json()) as { sites: { mode: string; domain?: string }[] };
    const { SUPPORTED_SITES, IMPORT_SOURCES } = await import("../config/supportedSites");
    expect(sites).toHaveLength(SUPPORTED_SITES.length + IMPORT_SOURCES.length);
    expect(sites.filter((s) => s.mode === "crawl")).toHaveLength(SUPPORTED_SITES.length);
    expect(sites.filter((s) => s.mode === "import")).toHaveLength(IMPORT_SOURCES.length);
  });

  it("mounts the sub-routers", async () => {
    expect((await fetch(`${base}/vault/status`)).status).toBe(200);
    expect((await fetch(`${base}/settings`)).status).toBe(200);
    expect((await fetch(`${base}/ai/config`)).status).toBe(200);
    expect((await fetch(`${base}/music`)).status).toBe(200);
    expect((await fetch(`${base}/stories`)).status).toBe(200);
  });

  it("phrases errors in the language of X-Lang", async () => {
    const send = (lang?: string) =>
      fetch(`${base}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(lang ? { "X-Lang": lang } : {}) },
        body: JSON.stringify({ autoScanOnOpen: "x" }),
      }).then((r) => r.json());
    const vi = (await send("vi")).message as string;
    const en = (await send()).message as string;
    expect(en).toBe("autoScanOnOpen must be true or false");
    expect(vi).not.toBe(en);
  });

  it("does not shadow GET /stories/live with /stories/:id", async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/stories/live`, { signal: controller.signal });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    controller.abort();
  });
});
