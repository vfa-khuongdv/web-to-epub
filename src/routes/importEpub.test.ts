import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildEpubFixture, TINY_PNG } from "../services/__fixtures__/epubFixtures";

/**
 * POST /stories/import-epub and GET /stories/:id/media/:name — a real Express server
 * over a throwaway library, like stories.test.ts: what matters is that the file lands
 * in the right library and that a re-import asks before replacing it.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "import-epub-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const fixture = buildEpubFixture({
  title: "Sách nhập",
  chapters: [
    {
      id: "ch1",
      file: "OEBPS/ch1.xhtml",
      title: "Một",
      html: `<h1>Một</h1><p>Nội dung.</p><img src="images/pic.png" alt="p"/>`,
    },
  ],
  extraEntries: { "OEBPS/images/pic.png": new Uint8Array(TINY_PNG) },
});
const STORY_URL = `epub:${createHash("sha1").update(fixture).digest("hex")}`;

describe("POST /stories/import-epub", () => {
  let server: Server;
  let base: string;
  let stories: typeof import("../services/storyStore").storyStore;
  let storyId: typeof import("../services/storyStore").storyId;
  let id: string;
  let privateStore: ReturnType<typeof import("../services/storyStore").createStoryStore>;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { storiesRouter } = await import("./stories");
    const store = await import("../services/storyStore");
    stories = store.storyStore;
    storyId = store.storyId;
    id = storyId(STORY_URL);
    privateStore = store.createStoryStore(path.join(DATA_DIR, "private"));

    const app = express();
    app.use(express.json());
    app.use("/api", storiesRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await stories.remove(id);
    await privateStore.remove(id);
    await rm(path.join(DATA_DIR, "epub-media"), { recursive: true, force: true });
    await rm(path.join(DATA_DIR, "covers"), { recursive: true, force: true });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  function importEpub(bytes: Buffer, query = "", headers: Record<string, string> = {}) {
    return fetch(`${base}/api/stories/import-epub${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/epub+zip", ...headers },
      body: new Uint8Array(bytes),
    });
  }

  it("imports a book with done chapters, blocks and a cover route", async () => {
    const res = await importEpub(fixture, "?name=Sach-nhap.epub");
    expect(res.status).toBe(201);

    const { story } = await res.json();
    expect(story.site).toBe("epub");
    expect(story.watching).toBe(false);
    expect(story.title).toBe("Sách nhập");
    expect(story.chapters).toHaveLength(1);
    expect(story.chapters[0]).toMatchObject({ order: 1, title: "Một", status: "done" });

    const stored = await stories.get(id);
    const image = stored?.chapters[0].blocks?.find((block) => block.type === "image");
    expect(image?.src).toMatch(new RegExp(`^epub-media/${id}/[0-9a-f]{12}\\.png$`));

    const name = image!.src!.split("/").pop()!;
    const media = await fetch(`${base}/api/stories/${id}/media/${name}`);
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await media.arrayBuffer()).equals(TINY_PNG)).toBe(true);
  });

  it("answers 409 for a book already in the library, then overwrites on request", async () => {
    await importEpub(fixture);
    await stories.addHighlight(id, { chapterOrder: 1, start: 0, end: 1, color: "yellow", text: "M" });

    const conflict = await importEpub(fixture);
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe("exists");

    const overwrite = await importEpub(fixture, "?overwrite=1");
    expect(overwrite.status).toBe(200);
    // The file is identical, so highlight offsets still line up and are kept.
    expect(await stories.listHighlights(id)).toHaveLength(1);
  });

  it("imports into the private library when a vault token is sent", async () => {
    const vault = (await import("../services/vault")).vault;
    const setup = vault.setup("123456");
    if (!setup.ok) throw new Error(setup.reason);

    const res = await importEpub(fixture, "", { "X-Vault-Token": setup.token });
    expect(res.status).toBe(201);

    expect(await privateStore.getOutline(id)).toBeTruthy();
    expect(await stories.getOutline(id)).toBeUndefined();
  });

  it("rejects a file that is not an EPUB and one locked with DRM", async () => {
    const junk = await importEpub(Buffer.from("hello"));
    expect(junk.status).toBe(400);

    const drmBytes = buildEpubFixture({
      encryptionXml:
        `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>`,
    });
    const drm = await importEpub(drmBytes);
    expect(drm.status).toBe(400);
    expect((await drm.json()).message).toContain("DRM");
  });

  it("answers the translated message for a malformed book, never a parser message", async () => {
    const malformed = buildEpubFixture({
      extraEntries: { "META-INF/container.xml": new Uint8Array(Buffer.from("<container><rootfiles>")) },
    });

    const res = await importEpub(malformed);

    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("This file is not an EPUB book");
  });

  it("refuses the watch toggle on an imported book", async () => {
    await importEpub(fixture);
    const res = await fetch(`${base}/api/stories/${id}/watch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watching: true }),
    });
    expect(res.status).toBe(400);
  });

  it("removes a story's media directory with the story", async () => {
    await importEpub(fixture);
    const stored = await stories.get(id);
    const name = stored!.chapters[0].blocks!.find((block) => block.type === "image")!.src!.split("/").pop()!;

    const res = await fetch(`${base}/api/stories/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await fetch(`${base}/api/stories/${id}/media/${name}`)).toHaveProperty("status", 404);
  });
});
