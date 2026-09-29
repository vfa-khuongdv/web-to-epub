import { describe, expect, it, vi } from "vitest";
import type { SiteSession } from "./siteSession";
import { detailsHtml, jsiaBody, JPEG } from "./__fixtures__/archiveBorrowFixtures";
import { readerConfig } from "./archiveBorrow";

const SESSION: SiteSession = {
  cookies: [
    { name: "logged-in-user", value: "me%40x.com", domain: ".archive.org", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
  ],
  origins: [],
};

function baseMock(options: { html?: string; jsia?: unknown } = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    const url = String(input);
    if (url.startsWith("https://archive.org/details/testitem")) {
      return new Response(options.html ?? detailsHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (url.includes("BookReaderJSIA.php")) {
      const body = options.jsia ?? jsiaBody({});
      return new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("", { status: 404 });
  });
}

describe("readerConfig", () => {
  it("reads the config url off the details page and fetches it as json on the storage host", async () => {
    const fetchImpl = baseMock();
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem");

    expect(config.bookId).toBe("testitem");
    expect(config.subPrefix).toBe("testitem");
    expect(config.bookTitle).toBe("Namiya zakkaten no kiseki");
    expect(config.leaves.map((leaf) => leaf.leafNum)).toEqual([1, 2, 3]);
    expect(config.leaves[0].uri).toContain("BookReaderPreview.php");
    expect(config.lendingStatus.is_lendable).toBe(true);
    expect(config.metadata.creator).toBe("Keigo Higashino");

    const called = fetchImpl.mock.calls.map(([input]) => String(input));
    // format=jsonp must be rewritten to format=json, on the storage host — archive.org 404s it.
    const configCall = called.find((url) => url.includes("BookReaderJSIA.php"));
    expect(configCall).toContain("format=json");
    expect(configCall).not.toContain("format=jsonp");
    expect(configCall).toContain("ia601804.us.archive.org");
    expect(configCall).toContain("https://");
    // session headers ride both requests
    const headers = (fetchImpl.mock.calls[1]?.[1] as RequestInit)?.headers as Record<string, string>;
    expect(headers.Cookie).toContain("logged-in-user=me%40x.com");
  });

  it("fails clearly when the details page has no reader config", async () => {
    const fetchImpl = baseMock({ html: "<html><body>nothing here</body></html>" });
    await expect(readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem")).rejects.toThrow(
      /reader config/
    );
  });

  it("fails clearly when the config response has an unexpected shape", async () => {
    const fetchImpl = baseMock({ jsia: JSON.stringify({ data: { brOptions: { data: "no" } } }) });
    await expect(readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem")).rejects.toThrow(
      /unexpected shape/
    );
    const notJson = baseMock({ jsia: "<html>login</html>" });
    await expect(readerConfig(notJson as unknown as typeof fetch, SESSION, "testitem")).rejects.toThrow();
  });
});
