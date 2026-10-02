// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, apiFetch, langHeaders, readJsonError, streamNdjson } from "./http";
import { onVaultExpired, setVaultToken } from "../../vault/token";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("lang", "en");
  setVaultToken(null);
  onVaultExpired(null);
});
afterEach(() => vi.unstubAllGlobals());

describe("langHeaders", () => {
  it("sends the language and merges extra headers", () => {
    localStorage.setItem("lang", "vi");
    expect(langHeaders({ A: "b" })).toEqual({ A: "b", "X-Lang": "vi" });
  });

  it("adds the vault token only when one is held", () => {
    expect(langHeaders()).not.toHaveProperty("X-Vault-Token");
    setVaultToken("tok");
    expect(langHeaders()["X-Vault-Token"]).toBe("tok");
  });
});

describe("apiFetch", () => {
  it("drops the vault session on 401 when a token was sent", async () => {
    const expired = vi.fn();
    onVaultExpired(expired);
    setVaultToken("tok");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    const res = await apiFetch("/x");
    expect(res.status).toBe(401);
    expect(expired).toHaveBeenCalledOnce();
  });

  it("ignores 401 without a token", async () => {
    const expired = vi.fn();
    onVaultExpired(expired);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await apiFetch("/x");
    expect(expired).not.toHaveBeenCalled();
  });
});

describe("apiError / readJsonError", () => {
  it("carries status, code and story", () => {
    const e = apiError("m", 409, "exists");
    expect(e).toBeInstanceOf(Error);
    expect([e.message, e.status, e.code]).toEqual(["m", 409, "exists"]);
  });

  it("uses the server message, else the fallback", async () => {
    expect(await readJsonError(json({ message: "boom" }, 500), "fb")).toBe("boom");
    expect(await readJsonError(json({}, 500), "fb")).toBe("fb");
    expect(await readJsonError(new Response("not json", { status: 500 }), "fb")).toBe("fb");
  });
});

describe("streamNdjson", () => {
  it("parses events split across chunks and skips blank lines", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode('{"a":1}\n{"a"'));
        c.enqueue(enc.encode(':2}\n\n{"a":3}\n'));
        c.close();
      },
    });
    const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const events: unknown[] = [];
    await streamNdjson("/p", { q: 1 }, (e) => events.push(e));
    expect(events).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/p");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"q":1}');
  });

  it("throws the server message on a failed response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "nope" }, 500)));
    await expect(streamNdjson("/p", {}, () => {})).rejects.toThrow("nope");
  });

  it("falls back to the crawl-failed text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 500 })));
    await expect(streamNdjson("/p", {}, () => {})).rejects.toThrow("Crawl failed");
  });
});
