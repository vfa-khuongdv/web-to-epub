import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** GET/PATCH /settings over a real Express server and a throwaway library. */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "settings-route-test-"));
process.env.DATA_DIR = DATA_DIR;

describe("settings routes", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { settingsRouter } = await import("./settings");
    const app = express();
    app.use(express.json());
    app.use("/api", settingsRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}/api`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(DATA_DIR, { recursive: true, force: true });
  });

  const patch = (body: unknown) =>
    fetch(`${base}/settings`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("returns the settings and facts about the open library", async () => {
    const res = await fetch(`${base}/settings`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.settings).toMatchObject({ autoScanOnOpen: true, defaultBookLanguage: "vi", defaultAuthor: "", ttsVariant: "turbo" });
    expect(data.app).toMatchObject({ dataDir: DATA_DIR, storyCount: 0, chapterCount: 0, privateConfigured: false });
    expect(typeof data.app.version).toBe("string");
  });

  it("answers 401 for a forged vault token instead of falling back to the public library", async () => {
    const res = await fetch(`${base}/settings`, { headers: { "X-Vault-Token": "forged" } });
    expect(res.status).toBe(401);
  });

  it("updates only the fields present and trims the author", async () => {
    const res = await patch({ autoScanOnOpen: false, defaultAuthor: "  Nam Cao  ", defaultBookLanguage: "en" });
    expect(res.status).toBe(200);
    expect((await res.json()).settings).toMatchObject({ autoScanOnOpen: false, defaultAuthor: "Nam Cao", defaultBookLanguage: "en", ttsVariant: "turbo" });

    const next = await patch({ ttsVariant: "nano", ttsVoice: "Binh" });
    expect((await next.json()).settings).toMatchObject({ autoScanOnOpen: false, ttsVariant: "nano", ttsVoice: "Binh" });
    expect((await (await fetch(`${base}/settings`)).json()).settings.defaultAuthor).toBe("Nam Cao");
  });

  it.each([
    [{ autoScanOnOpen: "yes" }, /true or false/],
    [{ defaultBookLanguage: "fr" }, /book language/],
    [{ defaultAuthor: "x".repeat(201) }, /too long/],
    [{ defaultAuthor: 5 }, /too long/],
    [{ ttsVariant: "huge" }, /narration variant/],
    [{ ttsVoice: "v".repeat(101) }, /too long/],
  ])("rejects %j with 400", async (body, message) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(message);
  });

  it("accepts an empty patch and changes nothing", async () => {
    const res = await patch({});
    expect(res.status).toBe(200);
    expect((await res.json()).settings.defaultAuthor).toBe("Nam Cao");
  });
});
