import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The session endpoint takes a cURL copy of a request from the user's own logged-in
 * browser and keeps its cookies. The body and the file are secrets, so these tests also
 * pin that nothing echoes a cookie value back.
 *
 * DATA_DIR is set before anything is imported: config/paths reads it at import time.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "site-sessions-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const JWT_FUTURE = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.sig";
const VALID_CURL =
  `curl 'https://www.asianfanfics.com/story/view/1191193' -H 'cookie: atokun=${JWT_FUTURE}; cf_clearance=clear-value' -H 'user-agent: UA-TEST'`;

describe("site session routes", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { siteSessionsRouter } = await import("./siteSessions");
    const app = express();
    app.use(express.json());
    app.use("/api", siteSessionsRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("báo chưa cấu hình khi chưa nhập phiên", async () => {
    const res = await fetch(`${base}/api/site-sessions/asianfanfics`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: false });
  });

  it("từ chối body rỗng", async () => {
    const res = await fetch(`${base}/api/site-sessions/asianfanfics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ curl: "   " }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/Paste the cURL/);
  });

  it("từ chối cURL của site khác", async () => {
    const res = await fetch(`${base}/api/site-sessions/asianfanfics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ curl: "curl 'https://example.com/' -H 'cookie: a=1'" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/not for asianfanfics\.com/);
  });

  it("từ chối cURL không có cookie", async () => {
    const res = await fetch(`${base}/api/site-sessions/asianfanfics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ curl: "curl 'https://www.asianfanfics.com/' -H 'accept: text/html'" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/No cookies found/);
  });

  it("lưu phiên và chỉ trả về số cookie, không trả giá trị", async () => {
    const res = await fetch(`${base}/api/site-sessions/asianfanfics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ curl: VALID_CURL }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cookieCount: number };
    expect(body.cookieCount).toBe(2);
    expect(JSON.stringify(body)).not.toContain(JWT_FUTURE);
    expect(JSON.stringify(body)).not.toContain("clear-value");
    expect(existsSync(path.join(DATA_DIR, "sessions", "asianfanfics.com.json"))).toBe(true);
  });

  it("báo đã cấu hình sau khi nhập", async () => {
    const res = await fetch(`${base}/api/site-sessions/asianfanfics`);
    const status = (await res.json()) as { configured: boolean; savedAt?: string };
    expect(status.configured).toBe(true);
    expect(typeof status.savedAt).toBe("string");
    expect(status.expiresAt).toBe(new Date(4_102_444_800 * 1000).toISOString());
  });

  it("xoá phiên đã lưu", async () => {
    const res = await fetch(`${base}/api/site-sessions/asianfanfics`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true });
    expect(existsSync(path.join(DATA_DIR, "sessions", "asianfanfics.com.json"))).toBe(false);
    const status = await fetch(`${base}/api/site-sessions/asianfanfics`);
    expect(await status.json()).toEqual({ configured: false });
  });
});
