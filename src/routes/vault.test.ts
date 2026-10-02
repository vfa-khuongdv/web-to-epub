import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** The private-mode lock routes, over the real vault in a throwaway DATA_DIR. */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "vault-route-test-"));
process.env.DATA_DIR = DATA_DIR;

describe("vault routes", () => {
  let server: Server;
  let base: string;
  let vault: typeof import("../services/vault").vault;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { vaultRouter } = await import("./vault");
    vault = (await import("../services/vault")).vault;
    const app = express();
    app.use(express.json());
    app.use("/api", vaultRouter);
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

  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${url}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  // Tests run in order and share the one vault, like the user's session does.
  it("reports unconfigured and refuses to unlock before a code exists", async () => {
    expect(await (await fetch(`${base}/vault/status`)).json()).toEqual({ configured: false });
    expect((await post("/vault/unlock", { code: "123456" })).status).toBe(404);
  });

  it("rejects a setup code that is not exactly 6 digits", async () => {
    for (const code of ["12345", "1234567", "abcdef", 123456, undefined]) {
      const res = await post("/vault/setup", { code });
      expect(res.status).toBe(400);
    }
  });

  it("sets the code once and hands back a valid token", async () => {
    const res = await post("/vault/setup", { code: "123456" });
    expect(res.status).toBe(200);
    const { token } = await res.json();
    expect(vault.isValidToken(token)).toBe(true);
    expect(await (await fetch(`${base}/vault/status`)).json()).toEqual({ configured: true });

    expect((await post("/vault/setup", { code: "654321" })).status).toBe(409);
  });

  it("unlocks with the right code, 401 on the wrong one, 400 on a malformed one", async () => {
    const ok = await post("/vault/unlock", { code: "123456" });
    expect(ok.status).toBe(200);
    expect(typeof (await ok.json()).token).toBe("string");

    expect((await post("/vault/unlock", { code: "000000" })).status).toBe(401);
    expect((await post("/vault/unlock", { code: "abc" })).status).toBe(400);
    expect((await post("/vault/unlock", {})).status).toBe(400);
  });

  it("locks a session by its token", async () => {
    const { token } = await (await post("/vault/unlock", { code: "123456" })).json();
    expect(vault.isValidToken(token)).toBe(true);
    expect((await post("/vault/lock", {}, { "X-Vault-Token": token })).status).toBe(200);
    expect(vault.isValidToken(token)).toBe(false);
    // Locking without a token is harmless.
    expect((await post("/vault/lock", {})).status).toBe(200);
  });

  it("changes the code only with the current one", async () => {
    expect((await post("/vault/change-code", { code: "123456", newCode: "12" })).status).toBe(400);
    expect((await post("/vault/change-code", { code: "999999", newCode: "222222" })).status).toBe(401);
    expect(await (await post("/vault/change-code", { code: "123456", newCode: "222222" })).json()).toEqual({ ok: true });
    expect((await post("/vault/unlock", { code: "123456" })).status).toBe(401);
    expect((await post("/vault/unlock", { code: "222222" })).status).toBe(200);
  });

  it("locks out after repeated wrong codes with 429 and retryAfterMs", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 5; i++) last = await post("/vault/unlock", { code: "000001" });
    expect(last!.status).toBe(429);
    const body = await last!.json();
    expect(body.retryAfterMs).toBeGreaterThan(0);
    // Even the right code is refused during the lockout.
    expect((await post("/vault/unlock", { code: "222222" })).status).toBe(429);
  });
});
