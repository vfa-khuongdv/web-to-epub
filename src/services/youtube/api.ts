import fs from "fs/promises";
import { t } from "../lang";

/**
 * The YouTube Data API calls this feature needs, over plain fetch (no googleapis package
 * for four endpoints). Tokens come from services/youtube/account.ts; every function takes
 * the token so tests can drive them without a real account.
 */
export type FetchLike = typeof fetch;

const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3/videos";
const CHUNK_BYTES = 8 * 1024 * 1024;
const UPLOAD_RETRIES = 3;

export class YouTubeApiError extends Error {
  status: number;
  reason?: string;

  constructor(message: string, status: number, reason?: string) {
    super(message);
    this.name = "YouTubeApiError";
    this.status = status;
    this.reason = reason;
  }
}

// The two quota stops plus a temporary rate limit: the run stops and the user resumes later.
export function isQuotaError(error: unknown): boolean {
  return (
    error instanceof YouTubeApiError &&
    (error.reason === "quotaExceeded" || error.reason === "uploadLimitExceeded" || error.reason === "rateLimitExceeded")
  );
}

async function googleError(res: Response, fallback: string): Promise<YouTubeApiError> {
  const data = (await res.json().catch(() => null)) as {
    error?: { message?: string; errors?: { reason?: string }[] };
  } | null;
  const reason = data?.error?.errors?.[0]?.reason;
  const message = data?.error?.message ?? fallback;
  return new YouTubeApiError(`${message}${reason ? ` (${reason})` : ""}`, res.status, reason);
}

async function authorized(token: string, url: string, init: RequestInit = {}, fetchImpl: FetchLike = fetch): Promise<Response> {
  const res = await fetchImpl(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 308) throw await googleError(res, t("YouTube request failed (HTTP {status})", { status: res.status }));
  return res;
}

interface Playlist {
  id: string;
  title: string;
}

export async function listPlaylists(token: string, fetchImpl: FetchLike = fetch): Promise<Playlist[]> {
  const playlists: Playlist[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ part: "snippet", mine: "true", maxResults: "50" });
    if (pageToken) query.set("pageToken", pageToken);
    const res = await authorized(token, `${API}/playlists?${query}`, {}, fetchImpl);
    const data = (await res.json()) as {
      items?: { id?: string; snippet?: { title?: string } }[];
      nextPageToken?: string;
    };
    for (const item of data.items ?? []) {
      if (item.id) playlists.push({ id: item.id, title: item.snippet?.title ?? "" });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return playlists;
}

// The skill matches playlists by exact name: a renamed playlist would otherwise get a
// second one created for the same story.
export async function findPlaylist(token: string, name: string, fetchImpl: FetchLike = fetch): Promise<Playlist | undefined> {
  return (await listPlaylists(token, fetchImpl)).find((playlist) => playlist.title === name);
}

export async function createPlaylist(
  token: string,
  input: { title: string; description?: string },
  fetchImpl: FetchLike = fetch
): Promise<Playlist> {
  const res = await authorized(
    token,
    `${API}/playlists?part=snippet,status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        snippet: { title: input.title, ...(input.description ? { description: input.description } : {}) },
        status: { privacyStatus: "public" },
      }),
    },
    fetchImpl
  );
  const data = (await res.json()) as { id?: string; snippet?: { title?: string } };
  if (!data.id) throw new YouTubeApiError(t("YouTube did not return the new playlist"), 500);
  return { id: data.id, title: data.snippet?.title ?? input.title };
}

export interface PlaylistItem {
  videoId?: string;
  title: string;
}

export async function listPlaylistItems(
  token: string,
  playlistId: string,
  fetchImpl: FetchLike = fetch
): Promise<PlaylistItem[]> {
  const items: PlaylistItem[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ part: "snippet", playlistId, maxResults: "50" });
    if (pageToken) query.set("pageToken", pageToken);
    const res = await authorized(token, `${API}/playlistItems?${query}`, {}, fetchImpl);
    const data = (await res.json()) as {
      items?: { snippet?: { title?: string; resourceId?: { videoId?: string } } }[];
      nextPageToken?: string;
    };
    for (const item of data.items ?? []) {
      items.push({ title: item.snippet?.title ?? "", videoId: item.snippet?.resourceId?.videoId });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

export interface VideoDetails {
  title?: string;
  description?: string;
  tags?: string[];
  publishAt?: string;
  privacyStatus?: string;
  uploadStatus?: string;
}

// snippet + status of up to 50 videos at a time: what a video uploaded elsewhere looks
// like on the channel (description, tags, schedule), for the panel to show it faithfully.
export async function listVideoDetails(
  token: string,
  ids: string[],
  fetchImpl: FetchLike = fetch
): Promise<Map<string, VideoDetails>> {
  const details = new Map<string, VideoDetails>();
  for (let index = 0; index < ids.length; index += 50) {
    const chunk = ids.slice(index, index + 50);
    const res = await authorized(token, `${API}/videos?part=snippet,status&id=${chunk.join(",")}`, {}, fetchImpl);
    const data = (await res.json()) as {
      items?: {
        id?: string;
        snippet?: { title?: string; description?: string; tags?: string[] };
        status?: { publishAt?: string; privacyStatus?: string; uploadStatus?: string };
      }[];
    };
    for (const item of data.items ?? []) {
      if (!item.id) continue;
      details.set(item.id, {
        title: item.snippet?.title,
        description: item.snippet?.description,
        tags: item.snippet?.tags,
        publishAt: item.status?.publishAt,
        privacyStatus: item.status?.privacyStatus,
        uploadStatus: item.status?.uploadStatus,
      });
    }
  }
  return details;
}

export function chapterNumber(title: string): number | undefined {
  const match = /(?:chương|chuong|chapter)\s*(\d+)/i.exec(title);
  return match ? Number(match[1]) : undefined;
}

// Where a chapter belongs in the playlist: after every item whose title names an earlier
// chapter, whatever order they were uploaded in. Items whose number cannot be read do not
// push it back (same rule as the upload skill).
export function playlistPosition(items: { title: string }[], order: number): number {
  const numbers = items.map((item) => chapterNumber(item.title));
  return numbers.filter((value): value is number => value !== undefined && value < order).length;
}

export async function insertPlaylistItem(
  token: string,
  input: { playlistId: string; videoId: string; position: number },
  fetchImpl: FetchLike = fetch
): Promise<void> {
  await authorized(
    token,
    `${API}/playlistItems?part=snippet`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        snippet: {
          playlistId: input.playlistId,
          position: input.position,
          resourceId: { kind: "youtube#video", videoId: input.videoId },
        },
      }),
    },
    fetchImpl
  );
}

export interface UploadVideoInput {
  filePath: string;
  title: string;
  description: string;
  tags: string[];
  // ISO 8601; only allowed on a private video.
  publishAt?: string;
  categoryId?: string;
  language?: string;
  madeForKids?: boolean;
  syntheticMedia?: boolean;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resumable upload: the app keeps the video private and can hand YouTube a publish time.
 * Chunks are 8 MB; a 308 tells how much arrived, so a broken chunk resumes instead of
 * starting over.
 */
export async function uploadVideo(
  token: string,
  input: UploadVideoInput,
  onProgress: (sent: number, total: number) => void,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch
): Promise<{ id: string; privacyStatus?: string }> {
  const size = (await fs.stat(input.filePath)).size;
  const status: Record<string, unknown> = {
    privacyStatus: "private",
    selfDeclaredMadeForKids: input.madeForKids ?? false,
  };
  if (input.publishAt) status.publishAt = input.publishAt;
  if (input.syntheticMedia !== false) status.containsSyntheticMedia = true;
  const body = {
    snippet: {
      title: input.title,
      description: input.description,
      tags: input.tags,
      categoryId: input.categoryId ?? "24",
      defaultLanguage: input.language ?? "vi",
    },
    status,
  };

  const init = await fetchImpl(`${UPLOAD_API}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!init.ok) throw await googleError(init, t("YouTube refused the upload"));
  const session = init.headers.get("location");
  if (!session) throw new YouTubeApiError(t("YouTube did not open an upload session"), init.status);

  const handle = await fs.open(input.filePath, "r");
  try {
    let offset = 0;
    onProgress(0, size);
    while (offset < size) {
      if (signal?.aborted) throw new Error(t("Upload stopped"));
      const end = Math.min(offset + CHUNK_BYTES, size) - 1;
      const length = end - offset + 1;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      let attempt = 0;
      for (;;) {
        const res = await fetchImpl(session, {
          method: "PUT",
          headers: { "Content-Range": `bytes ${offset}-${end}/${size}`, "Content-Length": String(length) },
          body: buffer,
          signal,
        });
        if (res.status === 200 || res.status === 201) {
          const data = (await res.json()) as { id?: string; status?: { privacyStatus?: string } };
          if (!data.id) throw new YouTubeApiError(t("YouTube ended the upload without a video id"), res.status);
          onProgress(size, size);
          return { id: data.id, privacyStatus: data.status?.privacyStatus };
        }
        if (res.status === 308) {
          const range = res.headers.get("range");
          const received = range ? Number(range.split("-").pop()) + 1 : end + 1;
          offset = Number.isFinite(received) && received > offset ? received : end + 1;
          onProgress(Math.min(offset, size), size);
          break;
        }
        if ((res.status === 429 || res.status >= 500) && attempt < UPLOAD_RETRIES) {
          attempt++;
          await delay(1_000 * attempt);
          continue;
        }
        throw await googleError(res, t("YouTube refused the upload"));
      }
    }
    throw new YouTubeApiError(t("YouTube ended the upload without a video id"), 500);
  } finally {
    await handle.close();
  }
}
