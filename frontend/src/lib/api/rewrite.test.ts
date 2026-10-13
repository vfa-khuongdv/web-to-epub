import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRewriteState, restoreRewrittenChapters, startRewrite, stopRewrite } from "./rewrite";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("rewrite API", () => {
  it("loads the state", async () => {
    fetchMock.mockResolvedValue(json({ narratable: true }));
    expect(await fetchRewriteState("s1")).toEqual({ narratable: true });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/stories/s1/rewrite");
  });

  it("starts a run with the chosen orders", async () => {
    fetchMock.mockResolvedValue(json({ started: true, total: 2 }));
    await startRewrite("s1", [1, 2]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ orders: [1, 2] });
  });

  it("restores with DELETE and surfaces the server's message", async () => {
    fetchMock.mockResolvedValue(json({ restored: 3 }));
    expect(await restoreRewrittenChapters("s1")).toEqual({ restored: 3 });
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE");

    fetchMock.mockResolvedValue(json({ message: "busy" }, 409));
    await expect(stopRewrite("s1")).rejects.toThrow("busy");
  });
});
