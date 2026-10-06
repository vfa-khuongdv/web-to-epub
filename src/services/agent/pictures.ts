/**
 * Comic chapters are pictures. A picture is kept as a link while the site lets anyone load it, and
 * saved in the story's media folder (where an imported book's images live) only when the site
 * refuses: comic CDNs often answer 403 to a request that does not say which page it comes from, and
 * the reader preview and the EPUB export both ask without a referrer. A saved picture's block holds
 * the media marker, like an imported book's.
 *
 * Whether a site lets anyone load its pictures is tried once per host with one picture, asked for
 * exactly as the preview and the export will ask — no referrer — and remembered for a while.
 */
import sharp from "sharp";
import { ContentBlock } from "../../types";
import type { ChapterFetchContext } from "../chapters/types";
import { sniffImageExtension } from "../coverStore";
import { t } from "../lang";
import { fetchWithRetry } from "../toc/http";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
// A chapter's pages are fetched a few at a time: all at once is a burst a CDN may answer with 429.
const CONCURRENCY = 4;
const MAX_PICTURE_BYTES = 32 * 1024 * 1024;
const ATTEMPTS = 3;

export class PictureDownloadError extends Error {}

// What is known about a picture host: does it hand a picture to a request with no referrer?
const PROBE_TTL_MS = 30 * 60 * 1000;
const openHosts = new Map<string, { open: boolean; at: number }>();

export function forgetPictureHosts(): void {
  openHosts.clear();
}

const hostOf = (src: string) => {
  try {
    return new URL(src).host;
  } catch {
    return "";
  }
};

// One picture, asked for the way the preview and the export ask: no referrer. Open means a real
// picture came back; anything else (403, an HTML page saying "hotlinking not allowed", a timeout)
// means the host must be fetched with the chapter's address, and the pictures kept.
async function hostIsOpen(src: string, now = Date.now()): Promise<boolean> {
  const host = hostOf(src);
  const known = openHosts.get(host);
  if (known && now - known.at < PROBE_TTL_MS) return known.open;
  let open = false;
  try {
    const res = await fetchWithRetry(
      src,
      { headers: { "user-agent": USER_AGENT, accept: "image/*,*/*;q=0.8" } },
      { maxAttempts: 1, timeoutMs: 15_000 }
    );
    if (res.ok) {
      const bytes = Buffer.from(await res.arrayBuffer());
      open = bytes.length > 0 && bytes.length <= MAX_PICTURE_BYTES && sniffImageExtension(bytes) !== undefined;
    }
  } catch {
    open = false;
  }
  openHosts.set(host, { open, at: now });
  return open;
}

// What the media folder can hold. A format it cannot hold (AVIF, BMP…) is re-encoded as JPEG.
async function storable(bytes: Buffer): Promise<{ bytes: Buffer; extension: string }> {
  const extension = sniffImageExtension(bytes);
  if (extension) return { bytes, extension };
  try {
    return { bytes: await sharp(bytes).jpeg({ quality: 88 }).toBuffer(), extension: "jpg" };
  } catch {
    throw new PictureDownloadError("not a picture the library can keep");
  }
}

async function fetchPicture(src: string, referer: string): Promise<Buffer> {
  let last = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithRetry(
        src,
        { headers: { "user-agent": USER_AGENT, accept: "image/*,*/*;q=0.8", referer } },
        { maxAttempts: 2, timeoutMs: 30_000 }
      );
      if (!res.ok) {
        last = `HTTP ${res.status}`;
        continue;
      }
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_PICTURE_BYTES) throw new PictureDownloadError("too large");
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_PICTURE_BYTES) throw new PictureDownloadError("empty or too large");
      return bytes;
    } catch (err) {
      if (err instanceof PictureDownloadError) throw err;
      last = err instanceof Error ? err.message : String(err);
    }
  }
  throw new PictureDownloadError(last || "no answer");
}

/**
 * Keep every picture of a chapter: as the link it already is when its host lets anyone load it,
 * and otherwise fetched with the chapter's address as the referrer and swapped for its media
 * marker. All or nothing for the pictures that must be saved: a chapter with a page missing is
 * worse than a chapter that fails and can be retried, so one picture that cannot be had fails the
 * chapter.
 */
export async function savePictures(
  blocks: ContentBlock[],
  referer: string,
  context: ChapterFetchContext
): Promise<ContentBlock[]> {
  // One fetch per address, however many times the chapter repeats it; and only for the pictures
  // whose host refuses a request with no referrer.
  const all = [
    ...new Set(blocks.filter((b) => b.type === "image" && b.src && /^https?:/i.test(b.src)).map((b) => b.src as string)),
  ];
  const firstOfHost = new Map<string, string>();
  for (const src of all) if (!firstOfHost.has(hostOf(src))) firstOfHost.set(hostOf(src), src);
  const open = new Map<string, boolean>();
  for (const [host, sample] of firstOfHost) open.set(host, await hostIsOpen(sample));
  const sources = all.filter((src) => !open.get(hostOf(src)));
  if (sources.length === 0) return blocks;
  const marker = new Map<string, string>();
  let next = 0;
  let failure: string | undefined;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, sources.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= sources.length || failure) return;
        const src = sources[index];
        try {
          const { bytes, extension } = await storable(await fetchPicture(src, referer));
          marker.set(src, context.media.save(context.storyId, bytes, extension));
        } catch (err) {
          failure = `${src} (${err instanceof Error ? err.message : String(err)})`;
          return;
        }
      }
    })
  );
  if (failure) {
    throw new PictureDownloadError(
      t("Could not download a page picture of {url}: {picture}", { url: referer, picture: failure })
    );
  }
  return blocks.map((b) => (b.type === "image" && b.src && marker.has(b.src) ? { ...b, src: marker.get(b.src) } : b));
}
