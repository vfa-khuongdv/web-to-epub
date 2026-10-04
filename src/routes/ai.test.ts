import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** GET/PUT /ai/config over a real Express server; the config lives in a throwaway settings table. */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "ai-route-test-"));
process.env.DATA_DIR = DATA_DIR;

describe("ai config routes", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { aiRouter } = await import("./ai");
    const app = express();
    app.use(express.json());
    app.use("/api", aiRouter);
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

  const put = (body: unknown) =>
    fetch(`${base}/ai/config`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const get = async () => (await fetch(`${base}/ai/config`)).json();
  const provider = (config: { providers: { id: string }[] }, id: string) => config.providers.find((p) => p.id === id) as Record<string, unknown>;

  it("starts disabled with every provider listed and no key", async () => {
    const config = await get();
    expect(config).toMatchObject({ enabled: false, active: "deepseek" });
    expect(config.providers.length).toBeGreaterThan(3);
    expect(provider(config, "deepseek")).toMatchObject({ hasKey: false, model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1" });
  });

  it("saves settings, and never sends the key back", async () => {
    const res = await put({
      enabled: true,
      active: "openai",
      providers: { openai: { apiKey: "  sk-secret  ", model: "gpt-x", baseUrl: "https://proxy.example/v1" } },
    });
    expect(res.status).toBe(200);
    const raw = JSON.stringify(await get());
    expect(raw).not.toContain("sk-secret");
    const config = JSON.parse(raw);
    expect(config).toMatchObject({ enabled: true, active: "openai" });
    expect(provider(config, "openai")).toMatchObject({ hasKey: true, model: "gpt-x", baseUrl: "https://proxy.example/v1" });
  });

  it("keeps the saved key when the apiKey is empty and clears model/baseUrl when blank", async () => {
    await put({ providers: { openai: { apiKey: "", model: "", baseUrl: "" } } });
    const config = await get();
    expect(provider(config, "openai")).toMatchObject({ hasKey: true, model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" });
    expect(config.enabled).toBe(true);
  });

  it.each([
    [{ enabled: "yes" }, /true or false/],
    [{ active: "nope" }, /Unknown AI provider/],
    [{ active: 3 }, /Unknown AI provider/],
    [{ providers: { nope: { apiKey: "k" } } }, /Unknown AI provider/],
    [{ providers: { openai: { baseUrl: "ftp://x" } } }, /http/],
  ])("rejects %j with 400", async (body, message) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(message);
  });
});
