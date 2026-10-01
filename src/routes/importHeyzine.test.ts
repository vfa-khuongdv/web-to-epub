import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /stories/import-heyzine over a throwaway library, like importDtvEbook.test.ts. The
 * server's own heyzine.com fetches are intercepted by a stubbed global fetch; the test
 * client calls the local server with the real fetch captured before stubbing.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "import-heyzine-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const PDF = readFileSync(path.join(__dirname, "..", "services", "__fixtures__", "pdf-outline.pdf"));
const PDF_URL = "https://cdnm.heyzine.com/files/uploaded/v2/19b8fa685a6c345fb0b1c195cad7e96240d363f7.pdf";

describe("POST /stories/import-heyzine", () => {
  let server: Server;
  let base: string;
  let stories: typeof import("../services/storyStore").storyStore;
  let storyId: typeof import("../services/storyStore").storyId;
  let id: string;
  let realFetch: typeof fetch;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { storiesRouter } = await import("./stories");
    const { setLang } = await import("../services/lang");
    const store = await import("../services/storyStore");
    stories = store.storyStore;
    storyId = store.storyId;
    id = storyId("heyzine:19b8fa685a");

    const app = express();
    app.use(express.json());
    // The real app sets the request language in routes/index.ts; this harness mounts the
    // router alone, so X-Lang needs the same middleware to pick the wording.
    app.use((req, _res, next) => {
      setLang(req.header("X-Lang") ?? undefined);
      next();
    });
    app.use("/api", storiesRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}`;
    realFetch = globalThis.fetch;
  });

  beforeEach(async () => {
    await stories.remove(id);
    await rm(path.join(DATA_DIR, "epub-media"), { recursive: true, force: true });
    await rm(path.join(DATA_DIR, "covers"), { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  // The shell page names the PDF the viewer renders; `config: false` is what a
  // password-protected flipbook serves instead (no heyzine.load at all).
  function stubSite(options: { pdfUrl?: string | null; status?: number } = {}) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://heyzine.com/flip-book/")) {
        if (options.status) return new Response("", { status: options.status });
        const pdfUrl = options.pdfUrl === undefined ? PDF_URL : options.pdfUrl;
        const html = pdfUrl ? `<script>heyzine.load('${pdfUrl}', flipbookcfg);</script>` : "<form>Enter password</form>";
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.startsWith("https://cdnm.heyzine.com/")) {
        return new Response(new Uint8Array(PDF), { status: 200, headers: { "content-type": "application/pdf" } });
      }
      return realFetch(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function importHeyzine(query = "", url = "https://heyzine.com/flip-book/19b8fa685a.html#page/6") {
    return realFetch(`${base}/api/stories/import-heyzine${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  }

  it("imports the PDF the flipbook renders as a book with chapters", async () => {
    stubSite();
    const res = await importHeyzine();
    expect(res.status).toBe(201);

    const { story } = await res.json();
    expect(story).toMatchObject({
      id,
      site: "epub",
      storyUrl: "heyzine:19b8fa685a",
      title: "Sách PDF",
      watching: false,
    });
    expect(story.chapters.map((chapter: { title: string }) => chapter.title)).toEqual([
      "Chương 1: Khởi đầu",
      "Chương 2: Tiếp",
      "Chương 3: Kết",
    ]);
    expect(story.chapters[0]).toMatchObject({ order: 1, status: "done" });
  });

  it("answers 409 for a book already in the library, then overwrites", async () => {
    stubSite();
    await importHeyzine();

    const conflict = await importHeyzine();
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe("exists");

    const overwrite = await importHeyzine("?overwrite=1");
    expect(overwrite.status).toBe(200);
  });

  it("says a flipbook that is not publicly readable", async () => {
    stubSite({ pdfUrl: null });
    const res = await importHeyzine();
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("not publicly readable");
  });

  it("says a flipbook the site does not serve", async () => {
    stubSite({ status: 404 });
    const res = await importHeyzine();
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("could not serve");
  });

  it("refuses a URL that is not a Heyzine flipbook", async () => {
    const res = await importHeyzine("", "https://example.com/flip-book/19b8fa685a.html");
    expect(res.status).toBe(400);
  });

  it("refuses to load a Heyzine flipbook through POST /stories", async () => {
    const res = await realFetch(`${base}/api/stories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://heyzine.com/flip-book/19b8fa685a.html" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("Heyzine flipbooks are imported, not crawled");
  });
});
