import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * libraryFor picks the public or private library per request and must answer 401 (never
 * fall back to the public shelf) for a stale or forged token.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "library-route-test-"));
process.env.DATA_DIR = DATA_DIR;

describe("libraryFor", () => {
  let server: Server;
  let base: string;
  let vault: typeof import("../services/vault").vault;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { libraryFor } = await import("./library");
    vault = (await import("../services/vault")).vault;
    const app = express();
    app.get("/which", (req, res) => {
      const library = libraryFor(req, res);
      if (library) res.json({ dataDir: library.dataDir });
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(DATA_DIR, { recursive: true, force: true });
  });

  it("serves the public library when there is no token", async () => {
    expect(await (await fetch(`${base}/which`)).json()).toEqual({ dataDir: DATA_DIR });
  });

  it("answers 401 for a token the vault does not know, in the header or the query", async () => {
    const header = await fetch(`${base}/which`, { headers: { "X-Vault-Token": "forged" } });
    expect(header.status).toBe(401);
    expect((await header.json()).message).toMatch(/locked/);
    expect((await fetch(`${base}/which?vault=forged`)).status).toBe(401);
  });

  it("serves the private library for a valid token, and 401 again once locked", async () => {
    const setup = vault.setup("123456");
    if (!setup.ok) throw new Error("vault setup failed");
    const privateDir = path.join(DATA_DIR, "private");

    expect(await (await fetch(`${base}/which`, { headers: { "X-Vault-Token": setup.token } })).json()).toEqual({ dataDir: privateDir });
    expect(await (await fetch(`${base}/which?vault=${setup.token}`)).json()).toEqual({ dataDir: privateDir });

    vault.lock(setup.token);
    expect((await fetch(`${base}/which`, { headers: { "X-Vault-Token": setup.token } })).status).toBe(401);
  });
});
