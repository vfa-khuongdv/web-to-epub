import fs from "fs";
import path from "path";
import { fetchWithRetry } from "./toc/http";
import { DATA_DIR } from "../config/paths";

// Real story covers are usually under 500KB; cap at 8MB so a wrong URL (scan image,
// movie file) doesn't bloat data/.
export const MAX_COVER_BYTES = 8 * 1024 * 1024;

// Story ID = sha1(storyUrl).slice(0, 16) (see storyStore) — reject unknown IDs to
// prevent writing files outside the cover directory.
const STORY_ID_RE = /^[0-9a-f]{16}$/;

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export const EXTENSION_BY_TYPE = new Map(Object.entries(CONTENT_TYPES).map(([extension, type]) => [type, extension]));

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// Many image CDNs return generic content-types (application/octet-stream) —
// encountered this with img.xtruyen.vn — so identify images by magic bytes first;
// only trust content-type when the signature can't be read.
export function sniffImageExtension(bytes: Buffer): string | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
    return "webp";
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString("latin1").startsWith("GIF8")) return "gif";
  return undefined;
}

export interface StoredCover {
  filePath: string;
  contentType: string;
}

export interface CoverStore {
  // Download cover to <dataDir>/covers/<id>.<ext> and return the path to store in DB
  // ("covers/<id>.jpg"). If already saved, do nothing; if an external URL fails to download
  // (network error, not an image, too large), return undefined so the caller keeps the original URL.
  save(storyId: string, coverUrl: string | undefined, referer?: string): Promise<string | undefined>;
  // Save the image the user picked (multer temp file) as the story cover, replacing the old one.
  saveUpload(storyId: string, tmpPath: string): Promise<string | undefined>;
  find(storyId: string): StoredCover | undefined;
  remove(storyId: string): Promise<void>;
}

export function createCoverStore(dataDir: string, options: { fetchImpl?: typeof fetch } = {}): CoverStore {
  const fetchImpl = options.fetchImpl ?? fetch;
  const coversDir = path.join(dataDir, "covers");

  function find(storyId: string): StoredCover | undefined {
    if (!STORY_ID_RE.test(storyId)) return undefined;
    for (const [extension, contentType] of Object.entries(CONTENT_TYPES)) {
      const filePath = path.join(coversDir, `${storyId}.${extension}`);
      if (fs.existsSync(filePath)) return { filePath, contentType };
    }
    return undefined;
  }

  async function save(storyId: string, coverUrl: string | undefined, referer?: string): Promise<string | undefined> {
    if (!STORY_ID_RE.test(storyId)) return undefined;
    const existing = find(storyId);
    if (existing) return path.join("covers", path.basename(existing.filePath));
    if (!coverUrl || !/^https?:/i.test(coverUrl)) return undefined;

    let res: Response;
    try {
      res = await fetchWithRetry(
        coverUrl,
        { headers: { "User-Agent": USER_AGENT, Accept: "image/*", ...(referer ? { Referer: referer } : {}) } },
        { fetchImpl, maxAttempts: 2 }
      );
    } catch {
      return undefined;
    }
    if (!res.ok) return undefined;

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const declaredLength = Number(res.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_COVER_BYTES) return undefined;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_COVER_BYTES) return undefined;

    const extension = sniffImageExtension(bytes) ?? EXTENSION_BY_TYPE.get(contentType);
    if (!extension) return undefined;

    fs.mkdirSync(coversDir, { recursive: true });
    const filePath = path.join(coversDir, `${storyId}.${extension}`);
    // Write to temp then rename: never serve an incomplete cover file.
    fs.writeFileSync(`${filePath}.tmp`, bytes);
    fs.renameSync(`${filePath}.tmp`, filePath);
    return path.join("covers", `${storyId}.${extension}`);
  }

  async function saveUpload(storyId: string, tmpPath: string): Promise<string | undefined> {
    if (!STORY_ID_RE.test(storyId)) return undefined;
    let bytes: Buffer;
    try {
      bytes = await fs.promises.readFile(tmpPath);
    } catch {
      return undefined;
    }

    const extension = sniffImageExtension(bytes);
    if (!extension || bytes.length === 0 || bytes.length > MAX_COVER_BYTES) {
      await fs.promises.rm(tmpPath, { force: true });
      return undefined;
    }

    fs.mkdirSync(coversDir, { recursive: true });
    const filePath = path.join(coversDir, `${storyId}.${extension}`);
    const existing = find(storyId);
    if (existing && existing.filePath !== filePath) await fs.promises.rm(existing.filePath, { force: true });
    fs.writeFileSync(`${filePath}.tmp`, bytes);
    fs.renameSync(`${filePath}.tmp`, filePath);
    await fs.promises.rm(tmpPath, { force: true });
    return path.join("covers", `${storyId}.${extension}`);
  }

  async function remove(storyId: string): Promise<void> {
    if (!STORY_ID_RE.test(storyId)) return;
    for (const extension of Object.keys(CONTENT_TYPES)) {
      await fs.promises.rm(path.join(coversDir, `${storyId}.${extension}`), { force: true });
    }
  }

  return { save, saveUpload, find, remove };
}

// epub-gen reads local files directly (path stored in DB) and fetches external URLs itself,
// so only convert internal paths to absolute paths.
export function coverPathForExport(coverUrl: string, dataDir = DATA_DIR): string {
  if (/^https?:/i.test(coverUrl) || path.isAbsolute(coverUrl)) return coverUrl;
  return path.resolve(dataDir, coverUrl);
}
