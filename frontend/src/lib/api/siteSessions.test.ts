// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./siteSessions";

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

describe("site sessions api", () => {
  it("fetchSiteSession", async () => {
    fetchMock.mockResolvedValueOnce(json({ configured: true, username: "u" }));
    expect(await api.fetchSiteSession("asianfanfics")).toEqual({ configured: true, username: "u" });
    expect(lastCall().url).toBe("/api/site-sessions/asianfanfics");
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(api.fetchSiteSession("x")).rejects.toThrow("Could not check the saved session");
  });

  it("importSiteSession posts the curl text", async () => {
    fetchMock.mockResolvedValueOnce(json({ cookieCount: 3 }));
    expect(await api.importSiteSession("archive", "curl 'x'")).toEqual({ cookieCount: 3 });
    expect(lastCall().init.method).toBe("POST");
    expect(lastCall().init.body).toBe(JSON.stringify({ curl: "curl 'x'" }));
    fetchMock.mockResolvedValueOnce(json({ message: "no cookies" }, 400));
    await expect(api.importSiteSession("archive", "x")).rejects.toThrow("no cookies");
  });

  it("removeSiteSession deletes", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await api.removeSiteSession("truyenfull");
    expect(lastCall().init.method).toBe("DELETE");
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(api.removeSiteSession("x")).rejects.toThrow("Could not remove the session");
  });
});
