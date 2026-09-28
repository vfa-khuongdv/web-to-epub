import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { ContentBlock } from "../types";

// Story ID = sha1(storyUrl).slice(0, 16) (storyStore) — same guard as the cover store:
// reject unknown IDs so a crafted name cannot write outside the media directory.
const STORY_ID_RE = /^[0-9a-f]{16}$/;
const IMAGE_NAME_RE = /^([0-9a-f]{12})\.(jpg|png|webp|gif)$/;

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export interface StoredMedia {
  filePath: string;
  contentType: string;
}

export interface EpubMediaStore {
  // Write one image from an imported book; returns the src stored in the block
  // ("epub-media/<storyId>/<sha1-12>.<ext>"). Identical bytes are stored once.
  save(storyId: string, bytes: Buffer, extension: string): string;
  find(storyId: string, name: string): StoredMedia | undefined;
  remove(storyId: string): Promise<void>;
}

export function mediaMarker(storyId: string, name: string): string {
  return `epub-media/${storyId}/${name}`;
}

export function storyMediaDir(dataDir: string, storyId: string): string {
  return path.join(dataDir, "epub-media", storyId);
}

export function createEpubMediaStore(dataDir: string): EpubMediaStore {
  const mediaRoot = path.join(dataDir, "epub-media");

  function save(storyId: string, bytes: Buffer, extension: string): string {
    if (!STORY_ID_RE.test(storyId) || !IMAGE_CONTENT_TYPES[extension]) {
      throw new Error(`Invalid media save: ${storyId} .${extension}`);
    }
    const name = `${crypto.createHash("sha1").update(bytes).digest("hex").slice(0, 12)}.${extension}`;
    const dir = path.join(mediaRoot, storyId);
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(dir, { recursive: true });
      // Temp then rename, like covers: a reader never sees a half-written file.
      fs.writeFileSync(`${filePath}.tmp`, bytes);
      fs.renameSync(`${filePath}.tmp`, filePath);
    }
    return mediaMarker(storyId, name);
  }

  function find(storyId: string, name: string): StoredMedia | undefined {
    if (!STORY_ID_RE.test(storyId)) return undefined;
    const match = name.match(IMAGE_NAME_RE);
    if (!match) return undefined;
    const filePath = path.join(mediaRoot, storyId, name);
    if (!fs.existsSync(filePath)) return undefined;
    return { filePath, contentType: IMAGE_CONTENT_TYPES[match[2]] };
  }

  async function remove(storyId: string): Promise<void> {
    if (!STORY_ID_RE.test(storyId)) return;
    await fs.promises.rm(path.join(mediaRoot, storyId), { recursive: true, force: true });
  }

  return { save, find, remove };
}

const MEDIA_NAME = "([0-9a-f]{12}\\.(?:jpg|png|webp|gif))";

const markerRe = (storyId: string) => new RegExp(`epub-media/${storyId}/${MEDIA_NAME}`, "g");
const apiRe = (storyId: string) => new RegExp(`/api/stories/${storyId}/media/${MEDIA_NAME}(?:\\?[^"'\\s>]*)?`, "g");

// DB → reader/editor: markers become something a browser can load, with the private-mode
// token appended when the request carries one (the cover <img> does the same).
export function resolveMediaHtml(html: string, storyId: string, vaultToken?: string): string {
  if (!storyId || !html.includes("epub-media/")) return html;
  const suffix = vaultToken ? `?vault=${encodeURIComponent(vaultToken)}` : "";
  return html.replace(markerRe(storyId), (_match, name: string) => `/api/stories/${storyId}/media/${name}${suffix}`);
}

// Editor content → DB: the resolved URL (and any token/query) goes back to the marker,
// so a saved chapter never bakes an origin or a token into the library.
export function restoreMediaHtml(html: string, storyId: string): string {
  if (!storyId || !html.includes(`/api/stories/${storyId}/media/`)) return html;
  return html.replace(apiRe(storyId), (_match, name: string) => mediaMarker(storyId, name));
}

// DB/client HTML → the export: local files inside the story's media folder, which
// embedImages may read (localRoots). Anything else keeps the existing rules.
export function exportMediaHtml(html: string, storyId: string, dataDir: string): string {
  const toFileUrl = (_match: string, name: string) =>
    pathToFileURL(path.join(storyMediaDir(dataDir, storyId), name)).href;
  return html.replace(markerRe(storyId), toFileUrl).replace(apiRe(storyId), toFileUrl);
}

export function mapBlockMedia(blocks: ContentBlock[], transform: (html: string) => string): ContentBlock[] {
  return blocks.map((block) => {
    const next: ContentBlock = { ...block };
    if (next.src) next.src = transform(next.src);
    if (next.text) next.text = transform(next.text);
    return next;
  });
}
