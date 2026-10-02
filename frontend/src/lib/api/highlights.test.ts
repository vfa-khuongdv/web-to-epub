// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./highlights";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
  return { url, init: init ?? {} };
};
const reply = (res: Response) => fetchMock.mockResolvedValueOnce(res);
const fail = () => reply(json({ message: "server said no" }, 400));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("lang", "en");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const draft = { chapterOrder: 1, start: 2, end: 5, color: "yellow", text: "abc" } as const;

describe("highlights api", () => {
  it("fetchHighlights unwraps the list", async () => {
    reply(json({ highlights: [{ id: "h" }] }));
    expect(await api.fetchHighlights("s/1")).toEqual([{ id: "h" }]);
    expect(lastCall().url).toBe("/api/stories/s%2F1/highlights");
    reply(new Response("", { status: 500 }));
    await expect(api.fetchHighlights("s")).rejects.toThrow("Could not load highlights");
  });

  it("createHighlight posts the draft and returns the saved one", async () => {
    reply(json({ highlight: { id: "h", ...draft } }));
    expect((await api.createHighlight("s", draft)).id).toBe("h");
    expect(lastCall().init.method).toBe("POST");
    expect(JSON.parse(lastCall().init.body as string)).toEqual(draft);
    fail();
    await expect(api.createHighlight("s", draft)).rejects.toThrow("server said no");
  });

  it("recolorHighlight patches the colour", async () => {
    reply(json({}));
    await api.recolorHighlight("s", "h 1", "pink");
    expect(lastCall().url).toBe("/api/stories/s/highlights/h%201");
    expect(lastCall().init.method).toBe("PATCH");
    expect(lastCall().init.body).toBe('{"color":"pink"}');
    reply(new Response("", { status: 500 }));
    await expect(api.recolorHighlight("s", "h", "pink")).rejects.toThrow("Could not change the highlight colour");
  });

  it("deleteHighlight deletes", async () => {
    reply(json({}));
    await api.deleteHighlight("s", "h");
    expect(lastCall().init.method).toBe("DELETE");
    reply(new Response("", { status: 500 }));
    await expect(api.deleteHighlight("s", "h")).rejects.toThrow("Could not delete the highlight");
  });

  it("exposes the colour palette", () => {
    expect(api.HIGHLIGHT_COLORS).toEqual(["yellow", "green", "blue", "pink"]);
  });
});
