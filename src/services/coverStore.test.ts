import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoverStore, coverPathForExport, MAX_COVER_BYTES, type CoverStore } from "./coverStore";

const STORY_ID = "0123456789abcdef";
const COVER_URL = "https://cdn.example.com/bia.jpg";

// undici wraps a dropped connection as "fetch failed" with the real code on the
// cause — that is what a network blocking a host looks like from Node.
function connectionReset(): Error {
  return Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
  });
}

function imageResponse(body: BodyInit, contentType = "image/jpeg", headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType, ...headers } });
}

function bytesBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer as ArrayBuffer;
}

describe("createCoverStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "cover-store-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("downloads cover image and returns path saved in DB", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse(bytesBody(bytes)));
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const stored = await store.save(STORY_ID, COVER_URL);

    expect(stored).toBe(`covers/${STORY_ID}.jpg`);
    expect(new Uint8Array(await readFile(path.join(dir, "covers", `${STORY_ID}.jpg`)))).toEqual(bytes);
  });

  it("chooses file extension by content-type", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("png-bytes", "image/png"));
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await store.save(STORY_ID, COVER_URL)).toBe(`covers/${STORY_ID}.png`);
  });

  it("does not save when response is not an image", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("<html>404</html>", "text/html"));
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await store.save(STORY_ID, COVER_URL)).toBeUndefined();
    expect(store.find(STORY_ID)).toBeUndefined();
  });

  it("recognizes image when server returns generic content-type (octet-stream)", async () => {
    // img.xtruyen.vn returns .webp cover with application/octet-stream content-type (real case).
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x2a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse(bytesBody(webp), "application/octet-stream"));
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await store.save(STORY_ID, COVER_URL)).toBe(`covers/${STORY_ID}.webp`);
  });

  it("returns undefined when HTTP load fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await store.save(STORY_ID, COVER_URL)).toBeUndefined();
    expect(store.find(STORY_ID)).toBeUndefined();
  });

  it("does not save image exceeding size limit (by content-length)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      imageResponse("x", "image/jpeg", { "content-length": String(MAX_COVER_BYTES + 1) })
    );
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await store.save(STORY_ID, COVER_URL)).toBeUndefined();
    expect(store.find(STORY_ID)).toBeUndefined();
  });

  it("does not save image exceeding size limit (by actual data)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse(bytesBody(new Uint8Array(MAX_COVER_BYTES + 1))));
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await store.save(STORY_ID, COVER_URL)).toBeUndefined();
    expect(store.find(STORY_ID)).toBeUndefined();
  });

  it("skips when cover already saved, does not reload", async () => {
    const first = vi.fn().mockResolvedValue(imageResponse("first"));
    const store = createCoverStore(dir, { fetchImpl: first as unknown as typeof fetch });
    await store.save(STORY_ID, COVER_URL);

    const second = vi.fn().mockResolvedValue(imageResponse("second"));
    const reloaded = createCoverStore(dir, { fetchImpl: second as unknown as typeof fetch });
    expect(await reloaded.save(STORY_ID, COVER_URL)).toBe(`covers/${STORY_ID}.jpg`);
    expect(second).not.toHaveBeenCalled();
  });

  it("sends Referer and User-Agent when loading image", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("bytes"));
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });

    await store.save(STORY_ID, COVER_URL, "https://truyen.example.com/truyen-a/");

    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ Referer: "https://truyen.example.com/truyen-a/" });
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain("Mozilla");
  });

  it("connection error returns undefined instead of throwing (does not break crawl)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(connectionReset());
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await store.save(STORY_ID, COVER_URL)).toBeUndefined();
  });

  it("rejects invalid story id (does not write outside directory)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("bytes"));
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await store.save("../../etc/passwd", COVER_URL)).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("find returns saved file with content-type", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("bytes", "image/webp"));
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await store.save(STORY_ID, COVER_URL);

    const found = store.find(STORY_ID);
    expect(found?.filePath).toBe(path.join(dir, "covers", `${STORY_ID}.webp`));
    expect(found?.contentType).toBe("image/webp");
  });

  it("remove deletes saved cover", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("bytes"));
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await store.save(STORY_ID, COVER_URL);

    await store.remove(STORY_ID);

    expect(store.find(STORY_ID)).toBeUndefined();
  });

  it("saveUpload saves user-selected file as story cover", async () => {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
    const tmp = path.join(dir, "upload-tmp");
    await writeFile(tmp, jpg);
    const store = createCoverStore(dir);

    expect(await store.saveUpload(STORY_ID, tmp)).toBe(`covers/${STORY_ID}.jpg`);
    expect(await readFile(path.join(dir, "covers", `${STORY_ID}.jpg`))).toEqual(jpg);
    expect(existsSync(tmp)).toBe(false);
  });

  it("saveUpload replaces old cover when format changes", async () => {
    const store = createCoverStore(dir);
    const jpgTmp = path.join(dir, "upload-1");
    await writeFile(jpgTmp, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    await store.saveUpload(STORY_ID, jpgTmp);

    const pngTmp = path.join(dir, "upload-2");
    await writeFile(pngTmp, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]));
    expect(await store.saveUpload(STORY_ID, pngTmp)).toBe(`covers/${STORY_ID}.png`);

    expect(store.find(STORY_ID)?.contentType).toBe("image/png");
    expect(existsSync(path.join(dir, "covers", `${STORY_ID}.jpg`))).toBe(false);
  });

  it("saveUpload rejects non-image file and cleans temp file", async () => {
    const tmp = path.join(dir, "upload-html");
    await writeFile(tmp, "<html>không phải ảnh</html>");
    const store = createCoverStore(dir);

    expect(await store.saveUpload(STORY_ID, tmp)).toBeUndefined();
    expect(store.find(STORY_ID)).toBeUndefined();
    expect(existsSync(tmp)).toBe(false);
  });

  it("saveUpload rejects invalid story id", async () => {
    const tmp = path.join(dir, "upload-x");
    await writeFile(tmp, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    const store = createCoverStore(dir);

    expect(await store.saveUpload("../../evil", tmp)).toBeUndefined();
  });
});

describe("coverPathForExport", () => {
  it("keeps external URL for epub-gen to load itself", () => {
    expect(coverPathForExport(COVER_URL)).toBe(COVER_URL);
  });

  it("resolves internal saved path by data directory", () => {
    expect(coverPathForExport(`covers/${STORY_ID}.jpg`, "/app/data")).toBe(
      path.join("/app/data", "covers", `${STORY_ID}.jpg`)
    );
  });

  it("keeps absolute path unchanged", () => {
    expect(coverPathForExport("/tmp/upload-123.jpg")).toBe("/tmp/upload-123.jpg");
  });
});
