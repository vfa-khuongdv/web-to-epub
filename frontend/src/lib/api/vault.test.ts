// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./vault";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
  return { url, init: init ?? {} };
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("lang", "en");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("vault api", () => {
  it("fetchVaultStatus", async () => {
    fetchMock.mockResolvedValueOnce(json({ configured: true }));
    expect(await api.fetchVaultStatus()).toEqual({ configured: true });
    expect(lastCall().url).toBe("/api/vault/status");
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(api.fetchVaultStatus()).rejects.toThrow("Could not check private mode");
  });

  it.each(["setup", "unlock"] as const)("openVault %s posts the code and returns the token", async (mode) => {
    fetchMock.mockResolvedValueOnce(json({ token: "tok" }));
    expect(await api.openVault("123456", mode)).toBe("tok");
    expect(lastCall().url).toBe(`/api/vault/${mode}`);
    expect(lastCall().init.body).toBe('{"code":"123456"}');
  });

  it("openVault errors carry the status and message", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "bad code" }, 401));
    await expect(api.openVault("1", "unlock")).rejects.toMatchObject({ message: "bad code", status: 401 });
    fetchMock.mockResolvedValueOnce(new Response("", { status: 429 }));
    await expect(api.openVault("1", "unlock")).rejects.toMatchObject({ message: "Wrong code", status: 429 });
  });

  it("changeVaultCode posts both codes", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await api.changeVaultCode("111111", "222222");
    expect(lastCall().url).toBe("/api/vault/change-code");
    expect(lastCall().init.body).toBe('{"code":"111111","newCode":"222222"}');
    fetchMock.mockResolvedValueOnce(json({ message: "no" }, 401));
    await expect(api.changeVaultCode("a", "b")).rejects.toMatchObject({ message: "no", status: 401 });
  });

  it("closeVault never throws, even when the request fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(api.closeVault()).resolves.toBeUndefined();
    expect(lastCall().url).toBe("/api/vault/lock");
    expect(lastCall().init.method).toBe("POST");
  });
});
