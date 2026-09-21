import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoverStore, coverPathForExport, MAX_COVER_BYTES, sniffImageExtension } from "./coverStore";

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
    vi.useRealTimers();
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

  it("ignores content-type parameters", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("png-bytes", "image/png; charset=binary"));
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

  it("magic bytes win over a conflicting content-type header", async () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]);
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse(bytesBody(jpg), "image/png"));
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await store.save(STORY_ID, COVER_URL)).toBe(`covers/${STORY_ID}.jpg`);
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

  it("accepts images exactly at the size limit (by content-length and actual data)", async () => {
    const byHeader = createCoverStore(dir, {
      fetchImpl: vi
        .fn()
        .mockResolvedValue(imageResponse("x", "image/jpeg", { "content-length": String(MAX_COVER_BYTES) })) as unknown as typeof fetch,
    });
    expect(await byHeader.save(STORY_ID, COVER_URL)).toBe(`covers/${STORY_ID}.jpg`);

    const maxBody = new Uint8Array(MAX_COVER_BYTES);
    maxBody.set([0xff, 0xd8, 0xff]);
    const byBody = createCoverStore(dir, { fetchImpl: vi.fn().mockResolvedValue(imageResponse(bytesBody(maxBody))) as unknown as typeof fetch });
    expect(await byBody.save("fedcba9876543210", COVER_URL)).toBe("covers/fedcba9876543210.jpg");
  });

  it("accepts images one byte under the size limit (by content-length and actual data)", async () => {
    const byHeader = createCoverStore(dir, {
      fetchImpl: vi
        .fn()
        .mockResolvedValue(imageResponse("x", "image/jpeg", { "content-length": String(MAX_COVER_BYTES - 1) })) as unknown as typeof fetch,
    });
    expect(await byHeader.save(STORY_ID, COVER_URL)).toBe(`covers/${STORY_ID}.jpg`);

    const underBody = new Uint8Array(MAX_COVER_BYTES - 1);
    underBody.set([0xff, 0xd8, 0xff]);
    const byBody = createCoverStore(dir, {
      fetchImpl: vi.fn().mockResolvedValue(imageResponse(bytesBody(underBody))) as unknown as typeof fetch,
    });
    expect(await byBody.save("fedcba9876543210", COVER_URL)).toBe("covers/fedcba9876543210.jpg");
  });

  it("does not save a zero-byte body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse(bytesBody(new Uint8Array(0))));
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

  it("connection error retries once then returns undefined instead of throwing", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockRejectedValue(connectionReset());
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const saving = store.save(STORY_ID, COVER_URL);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await saving).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid story id (does not write outside directory)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("bytes"));
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await store.save("../../etc/passwd", COVER_URL)).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not fetch when coverUrl is missing or not http(s)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("bytes"));
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await store.save(STORY_ID, undefined)).toBeUndefined();
    expect(await store.save(STORY_ID, "")).toBeUndefined();
    expect(await store.save(STORY_ID, "ftp://cdn.example.com/bia.jpg")).toBeUndefined();
    expect(await store.save(STORY_ID, "/data/covers/bia.jpg")).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("propagates IO failures when the covers path is a file", async () => {
    await writeFile(path.join(dir, "covers"), "not a directory");
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse(bytesBody(new Uint8Array([0xff, 0xd8, 0xff]))));
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(store.save(STORY_ID, COVER_URL)).rejects.toThrow();
  });

  it("find and remove reject traversal ids and leave files outside covers intact", async () => {
    const dataDir = path.join(dir, "data");
    const outsideDir = path.join(dir, "etc");
    await mkdir(outsideDir, { recursive: true });
    const sentinels = ["jpg", "png", "webp", "gif"].map((extension) => path.join(outsideDir, `passwd.${extension}`));
    for (const sentinel of sentinels) await writeFile(sentinel, "keep");
    const store = createCoverStore(dataDir);

    expect(store.find("../../etc/passwd")).toBeUndefined();
    await store.remove("../../etc/passwd");

    for (const sentinel of sentinels) expect(existsSync(sentinel)).toBe(true);
  });

  it("find returns saved file with content-type", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("bytes", "image/webp"));
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await store.save(STORY_ID, COVER_URL);

    const found = store.find(STORY_ID);
    expect(found?.filePath).toBe(path.join(dir, "covers", `${STORY_ID}.webp`));
    expect(found?.contentType).toBe("image/webp");
  });

  it("find prefers jpg, then png, webp and gif when several formats exist", async () => {
    const store = createCoverStore(dir);
    const coversDir = path.join(dir, "covers");
    await mkdir(coversDir, { recursive: true });
    for (const extension of ["jpg", "png", "webp", "gif"]) {
      await writeFile(path.join(coversDir, `${STORY_ID}.${extension}`), "x");
    }

    expect(store.find(STORY_ID)?.filePath).toBe(path.join(coversDir, `${STORY_ID}.jpg`));
    await rm(path.join(coversDir, `${STORY_ID}.jpg`));
    expect(store.find(STORY_ID)?.filePath).toBe(path.join(coversDir, `${STORY_ID}.png`));
    await rm(path.join(coversDir, `${STORY_ID}.png`));
    expect(store.find(STORY_ID)?.filePath).toBe(path.join(coversDir, `${STORY_ID}.webp`));
    await rm(path.join(coversDir, `${STORY_ID}.webp`));
    expect(store.find(STORY_ID)?.filePath).toBe(path.join(coversDir, `${STORY_ID}.gif`));
    expect(store.find(STORY_ID)?.contentType).toBe("image/gif");
  });

  it("remove deletes saved cover", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("bytes"));
    const store = createCoverStore(dir, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await store.save(STORY_ID, COVER_URL);

    await store.remove(STORY_ID);

    expect(store.find(STORY_ID)).toBeUndefined();
  });

  it("remove is idempotent and tolerates missing files", async () => {
    const store = createCoverStore(dir);
    const tmp = path.join(dir, "upload-idem");
    await writeFile(tmp, Buffer.from([0xff, 0xd8, 0xff]));
    await store.saveUpload(STORY_ID, tmp);

    await store.remove(STORY_ID);
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

  it("saveUpload accepts a GIF cover", async () => {
    const gif = Buffer.from("GIF89a....", "latin1");
    const tmp = path.join(dir, "upload-gif");
    await writeFile(tmp, gif);
    const store = createCoverStore(dir);

    expect(await store.saveUpload(STORY_ID, tmp)).toBe(`covers/${STORY_ID}.gif`);
    expect(store.find(STORY_ID)?.contentType).toBe("image/gif");
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

  it("saveUpload overwrites an existing cover of the same format", async () => {
    const store = createCoverStore(dir);
    const firstTmp = path.join(dir, "upload-old");
    await writeFile(firstTmp, Buffer.from([0xff, 0xd8, 0xff, 1]));
    await store.saveUpload(STORY_ID, firstTmp);

    const secondTmp = path.join(dir, "upload-new");
    const updated = Buffer.from([0xff, 0xd8, 0xff, 2, 2]);
    await writeFile(secondTmp, updated);
    expect(await store.saveUpload(STORY_ID, secondTmp)).toBe(`covers/${STORY_ID}.jpg`);

    expect(await readFile(path.join(dir, "covers", `${STORY_ID}.jpg`))).toEqual(updated);
    expect(existsSync(secondTmp)).toBe(false);
  });

  it("saveUpload rejects non-image file and cleans temp file", async () => {
    const tmp = path.join(dir, "upload-html");
    await writeFile(tmp, "<html>không phải ảnh</html>");
    const store = createCoverStore(dir);

    expect(await store.saveUpload(STORY_ID, tmp)).toBeUndefined();
    expect(store.find(STORY_ID)).toBeUndefined();
    expect(existsSync(tmp)).toBe(false);
  });

  it("saveUpload rejects an empty upload and cleans temp file", async () => {
    const tmp = path.join(dir, "upload-empty");
    await writeFile(tmp, Buffer.alloc(0));
    const store = createCoverStore(dir);

    expect(await store.saveUpload(STORY_ID, tmp)).toBeUndefined();
    expect(store.find(STORY_ID)).toBeUndefined();
    expect(existsSync(tmp)).toBe(false);
  });

  it("saveUpload rejects an upload over the size limit and cleans temp file", async () => {
    const tmp = path.join(dir, "upload-big");
    const tooBig = Buffer.alloc(MAX_COVER_BYTES + 1);
    tooBig.set([0xff, 0xd8, 0xff]);
    await writeFile(tmp, tooBig);
    const store = createCoverStore(dir);

    expect(await store.saveUpload(STORY_ID, tmp)).toBeUndefined();
    expect(store.find(STORY_ID)).toBeUndefined();
    expect(existsSync(tmp)).toBe(false);
  });

  it("saveUpload returns undefined when the temp file cannot be read", async () => {
    const store = createCoverStore(dir);

    expect(await store.saveUpload(STORY_ID, path.join(dir, "missing-upload"))).toBeUndefined();
    expect(store.find(STORY_ID)).toBeUndefined();
  });

  it("saveUpload rejects invalid story id and leaves the temp file for the caller", async () => {
    const tmp = path.join(dir, "upload-x");
    await writeFile(tmp, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    const store = createCoverStore(dir);

    expect(await store.saveUpload("../../evil", tmp)).toBeUndefined();
    expect(existsSync(tmp)).toBe(true);
  });
});

describe("sniffImageExtension", () => {
  it("detects jpg, png, webp and both GIF versions", () => {
    expect(sniffImageExtension(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(sniffImageExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe("png");
    expect(sniffImageExtension(Buffer.from("RIFF????WEBP", "latin1"))).toBe("webp");
    expect(sniffImageExtension(Buffer.from("GIF87a", "latin1"))).toBe("gif");
    expect(sniffImageExtension(Buffer.from("GIF89a", "latin1"))).toBe("gif");
  });

  it("detects the shortest possible signature (3, 4 and 8 byte boundaries)", () => {
    expect(sniffImageExtension(Buffer.from([0xff, 0xd8, 0xff]))).toBe("jpg");
    expect(sniffImageExtension(Buffer.from("GIF8", "latin1"))).toBe("gif");
    expect(sniffImageExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
  });

  it("needs the complete signature (2, 7 and 11 byte boundaries)", () => {
    expect(sniffImageExtension(Buffer.from([0xff, 0xd8]))).toBeUndefined();
    expect(sniffImageExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]))).toBeUndefined();
    expect(sniffImageExtension(Buffer.from("RIFF????WEB", "latin1"))).toBeUndefined();
    expect(sniffImageExtension(Buffer.from("GIF", "latin1"))).toBeUndefined();
  });

  it("rejects RIFF containers that are not WEBP", () => {
    expect(sniffImageExtension(Buffer.from("RIFF????WAVE", "latin1"))).toBeUndefined();
  });

  it("returns undefined for empty and non-image bytes", () => {
    expect(sniffImageExtension(Buffer.alloc(0))).toBeUndefined();
    expect(sniffImageExtension(Buffer.from("<html>", "latin1"))).toBeUndefined();
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
