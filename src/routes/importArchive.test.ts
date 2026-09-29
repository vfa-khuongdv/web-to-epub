import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEpubFixture, TINY_PNG } from "../services/__fixtures__/epubFixtures";

/**
 * POST /stories/import-archive over a throwaway library, like importEpub.test.ts. The
 * server's own archive.org fetches are intercepted by a stubbed global fetch; the test
 * client calls the local server with the real fetch captured before stubbing.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "import-archive-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const EPUB = buildEpubFixture({
  title: "Sách Archive",
  chapters: [{ id: "ch1", file: "OEBPS/ch1.xhtml", title: "Một", html: "<p>Nội dung.</p>" }],
});
// Past MIN_TEXT_CHARS (200 non-space characters), so the text source is chosen.
const TEXT = [
  "Chapter 1",
  "It was a dark night, and the wind howled through the narrow streets.",
  "Nobody was outside, so the storekeeper locked the door early.",
  "She counted the till twice before turning off the lamps.",
  "Chapter 2",
  "Morning came slow, with the first light creeping over the rooftops.",
  "The cat was already waiting by the back door.",
].join("\n");

describe("POST /stories/import-archive", () => {
  let server: Server;
  let base: string;
  let stories: typeof import("../services/storyStore").storyStore;
  let storyId: typeof import("../services/storyStore").storyId;
  let privateStore: ReturnType<typeof import("../services/storyStore").createStoryStore>;
  let id: string;
  let realFetch: typeof fetch;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { storiesRouter } = await import("./stories");
    const { setLang } = await import("../services/lang");
    const store = await import("../services/storyStore");
    stories = store.storyStore;
    storyId = store.storyId;
    privateStore = store.createStoryStore(path.join(DATA_DIR, "private"));
    id = storyId("archive:testitem");

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
    await privateStore.remove(id);
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

  interface StubOptions {
    restricted?: boolean;
    files?: { name: string; format: string; private?: string }[];
    bodies?: Record<string, Buffer | string | number>;
    cover?: Buffer;
  }

  function stubArchive(options: StubOptions) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://archive.org/metadata/")) {
          const identifier = decodeURIComponent(url.split("/metadata/")[1]);
          return new Response(
            JSON.stringify({
              metadata: {
                identifier,
                title: "Sách Archive",
                creator: "Tác giả",
                language: "eng",
                mediatype: "texts",
                ...(options.restricted ? { "access-restricted-item": "true" } : {}),
              },
              files: options.files ?? [],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.startsWith("https://archive.org/download/")) {
          const name = decodeURIComponent(url.split("/download/")[1].split("/").slice(1).join("/"));
          const body = options.bodies?.[name];
          if (body === undefined) return new Response("", { status: 404 });
          if (typeof body === "number") return new Response("", { status: body });
          return new Response(new Uint8Array(typeof body === "string" ? Buffer.from(body) : body));
        }
        if (url.startsWith("https://archive.org/services/img/")) {
          return options.cover ? new Response(new Uint8Array(options.cover)) : new Response("", { status: 404 });
        }
        return realFetch(input, init);
      })
    );
  }

  function importArchive(
    query = "",
    body: unknown = { url: "https://archive.org/details/testitem" },
    headers: Record<string, string> = {}
  ) {
    return realFetch(`${base}/api/stories/import-archive${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  it("imports an open item as an EPUB-style book", async () => {
    stubArchive({ files: [{ name: "book.epub", format: "EPUB" }], bodies: { "book.epub": EPUB }, cover: TINY_PNG });
    const res = await importArchive();
    expect(res.status).toBe(201);

    const { story } = await res.json();
    expect(story).toMatchObject({
      id,
      site: "epub",
      storyUrl: "archive:testitem",
      title: "Sách Archive",
      watching: false,
    });
    expect(story.chapters).toHaveLength(1);
    expect(story.chapters[0]).toMatchObject({ order: 1, title: "Một", status: "done" });
    expect(story.coverUrl).toBe(`covers/${id}.png`);
  });

  it("uses the OCR text when the item has no EPUB", async () => {
    stubArchive({ files: [{ name: "book_djvu.txt", format: "DjVuTXT" }], bodies: { "book_djvu.txt": TEXT } });
    const res = await importArchive();
    expect(res.status).toBe(201);

    const { story } = await res.json();
    expect(story.chapters.map((chapter: { title: string }) => chapter.title)).toEqual(["Chapter 1", "Chapter 2"]);
  });

  it("imports into the private library when a vault token is sent", async () => {
    stubArchive({ files: [{ name: "book_djvu.txt", format: "DjVuTXT" }], bodies: { "book_djvu.txt": TEXT } });
    const vault = (await import("../services/vault")).vault;
    const setup = vault.setup("123456");
    if (!setup.ok) throw new Error(setup.reason);

    const res = await importArchive("", { url: "https://archive.org/details/testitem" }, { "X-Vault-Token": setup.token });
    expect(res.status).toBe(201);
    expect(await privateStore.getOutline(id)).toBeTruthy();
    expect(await stories.getOutline(id)).toBeUndefined();
  });

  it("answers 409 for an item already in the library, then overwrites", async () => {
    stubArchive({ files: [{ name: "book_djvu.txt", format: "DjVuTXT" }], bodies: { "book_djvu.txt": TEXT } });
    await importArchive();

    const conflict = await importArchive();
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe("exists");

    const overwrite = await importArchive("?overwrite=1");
    expect(overwrite.status).toBe(200);
  });

  it("refuses a lending item with the translated message", async () => {
    stubArchive({
      restricted: true,
      files: [{ name: "book_djvu.txt", format: "DjVuTXT" }],
      bodies: { "book_djvu.txt": TEXT },
    });
    const res = await importArchive("", { url: "https://archive.org/details/testitem" }, { "X-Lang": "vi" });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("giới hạn truy cập");
  });

  it("refuses a URL that is not an archive.org item page", async () => {
    const res = await importArchive("", { url: "https://example.com/details/x" });
    expect(res.status).toBe(400);
  });

  it("refuses to load an archive.org book through POST /stories", async () => {
    const res = await realFetch(`${base}/api/stories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://archive.org/details/testitem" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("Internet Archive books are imported, not crawled");
  });
});
