import { existsSync, mkdtempSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEpubMediaStore,
  exportMediaHtml,
  mapBlockMedia,
  resolveMediaHtml,
  restoreMediaHtml,
} from "./epubMedia";

const STORY_ID = "0123456789abcdef";
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

describe("createEpubMediaStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "epub-media-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stores an image once and returns its marker", async () => {
    const store = createEpubMediaStore(dir);

    const first = store.save(STORY_ID, TINY_PNG, "png");
    const again = store.save(STORY_ID, TINY_PNG, "png");

    expect(first).toBe(again);
    expect(first).toMatch(new RegExp(`^epub-media/${STORY_ID}/[0-9a-f]{12}\\.png$`));
    const files = await readdir(path.join(dir, "epub-media", STORY_ID));
    expect(files).toHaveLength(1);
    expect(store.find(STORY_ID, path.basename(first))?.contentType).toBe("image/png");
  });

  it("rejects traversal names and unknown story ids", () => {
    const store = createEpubMediaStore(dir);
    expect(store.find(STORY_ID, "../../secret.png")).toBeUndefined();
    expect(store.find("../evil", "abcdef123456.png")).toBeUndefined();
    expect(store.find(STORY_ID, "abcdef123456.svg")).toBeUndefined();
  });

  it("removes the story's media directory", async () => {
    const store = createEpubMediaStore(dir);
    store.save(STORY_ID, TINY_PNG, "png");

    await store.remove(STORY_ID);

    expect(existsSync(path.join(dir, "epub-media", STORY_ID))).toBe(false);
  });
});

describe("media src rewriting", () => {
  const marker = `epub-media/${STORY_ID}/abcdef123456.png`;

  it("resolves markers for the reader and restores them on save", () => {
    const resolved = resolveMediaHtml(`<img src="${marker}">`, STORY_ID, "tok+1");
    expect(resolved).toBe(`<img src="/api/stories/${STORY_ID}/media/abcdef123456.png?vault=tok%2B1">`);

    const restored = restoreMediaHtml(`<img src="/api/stories/${STORY_ID}/media/abcdef123456.png?vault=tok%2B1">`, STORY_ID);
    expect(restored).toBe(`<img src="${marker}">`);
  });

  it("leaves external urls alone", () => {
    const html = `<img src="https://example.com/a.png">`;
    expect(resolveMediaHtml(html, STORY_ID, "tok")).toBe(html);
    expect(restoreMediaHtml(html, STORY_ID)).toBe(html);
  });

  it("exports markers and resolved urls as local files", () => {
    const dataDir = "/tmp/library";
    const html = `<img src="${marker}"><img src="/api/stories/${STORY_ID}/media/abcdef123456.png?vault=tok">`;
    const out = exportMediaHtml(html, STORY_ID, dataDir);
    expect(out.match(new RegExp(`file:///tmp/library/epub-media/${STORY_ID}/abcdef123456\\.png`, "g"))).toHaveLength(2);
  });

  it("maps src and text fields of blocks", () => {
    const blocks = mapBlockMedia(
      [
        { type: "paragraph", text: `<img src="${marker}">` },
        { type: "image", src: marker, alt: "x" },
      ],
      (html) => html.replace("epub-media/", "media/")
    );
    expect(blocks[0].text).toContain("media/");
    expect(blocks[1].src).toBe(`media/${STORY_ID}/abcdef123456.png`);
  });
});
