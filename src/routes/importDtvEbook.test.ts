import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEpubFixture, TINY_PNG } from "../services/__fixtures__/epubFixtures";

/**
 * POST /stories/import-dtvebook over a throwaway library, like importArchive.test.ts. The
 * server's own dtv-ebook.com.vn fetches are intercepted by a stubbed global fetch; the
 * test client calls the local server with the real fetch captured before stubbing.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "import-dtvebook-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const EPUB = buildEpubFixture({
  title: "Truyện DTV",
  chapters: [{ id: "ch1", file: "OEBPS/ch1.xhtml", title: "Chương 1", html: "<p>Nội dung một.</p>" }],
  cover: { file: "OEBPS/cover.png", bytes: TINY_PNG },
});

describe("POST /stories/import-dtvebook", () => {
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
    id = storyId("dtv:27570");

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

  // The reader page names the file; `epubPath: null` is the site answering with an empty
  // epub.js path, which is what a book with no online EPUB looks like.
  function stubSite(options: { epubPath?: string | null; status?: number } = {}) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/doconline.php")) {
        if (options.status) return new Response("", { status: options.status });
        const path = options.epubPath === undefined ? "images/files_2/2026/092026/ten-sach.epub" : options.epubPath;
        return new Response(`<script>window.reader = ePubReader("${path}",{ });</script>`, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      if (url.startsWith("https://dtv-ebook.com.vn/images/")) {
        return new Response(new Uint8Array(EPUB), { status: 200, headers: { "content-type": "application/epub+zip" } });
      }
      return realFetch(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function importDtv(query = "", url = "https://dtv-ebook.com.vn/an-minh-tai-so_27570.html") {
    return realFetch(`${base}/api/stories/import-dtvebook${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  }

  it("imports the EPUB the site hosts as a book with chapters", async () => {
    stubSite();
    const res = await importDtv();
    expect(res.status).toBe(201);

    const { story } = await res.json();
    expect(story).toMatchObject({ id, site: "epub", storyUrl: "dtv:27570", title: "Truyện DTV", watching: false });
    expect(story.chapters).toHaveLength(1);
    expect(story.chapters[0]).toMatchObject({ order: 1, title: "Chương 1", status: "done" });
    expect(story.coverUrl).toBe(`covers/${id}.png`);
  });

  it("answers 409 for a book already in the library, then overwrites", async () => {
    stubSite();
    await importDtv();

    const conflict = await importDtv();
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe("exists");

    const overwrite = await importDtv("?overwrite=1");
    expect(overwrite.status).toBe(200);
  });

  it("says a book the site has no EPUB for", async () => {
    stubSite({ epubPath: "" });
    const res = await importDtv("", "https://dtv-ebook.com.vn/vo-than-108_24274.html");
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("no EPUB to import");
  });

  it("refuses a URL that is not a DTV Ebook book page", async () => {
    const res = await importDtv("", "https://example.com/an-minh_27570.html");
    expect(res.status).toBe(400);
  });

  it("refuses to load a DTV Ebook book through POST /stories", async () => {
    const res = await realFetch(`${base}/api/stories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://dtv-ebook.com.vn/an-minh-tai-so_27570.html" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("DTV Ebook books are imported, not crawled");
  });
});
