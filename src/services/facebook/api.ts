import fs from "fs/promises";
import { t } from "../lang";

/**
 * The Graph API calls this feature needs, over plain fetch. Every function takes the
 * Page token so tests can drive them without a real account.
 */
export type FetchLike = typeof fetch;

const GRAPH = "https://graph.facebook.com/v21.0";
const GRAPH_VIDEO = "https://graph-video.facebook.com/v21.0";
const TRANSFER_RETRIES = 3;
// Facebook accepts a schedule between 10 minutes and 30 days ahead.
export const MIN_SCHEDULE_MS = 10 * 60_000;
export const MAX_SCHEDULE_MS = 30 * 24 * 3_600_000;

export class FacebookApiError extends Error {
  status: number;
  code?: number;

  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = "FacebookApiError";
    this.status = status;
    this.code = code;
  }
}

// Rate-limit codes: the run stops and the person resumes later.
export function isRateLimit(error: unknown): boolean {
  return error instanceof FacebookApiError && [4, 17, 32, 613].includes(error.code ?? 0);
}

async function graphError(res: Response, fallback: string): Promise<FacebookApiError> {
  let message = fallback;
  let code: number | undefined;
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: number } };
    if (body.error?.message) message = `${fallback}: ${body.error.message}`;
    code = body.error?.code;
  } catch {
    // keep the fallback
  }
  if (code === 190) message = t("The Facebook token is no longer valid — paste a new Page token in Settings → Facebook");
  return new FacebookApiError(message, res.status, code);
}

export async function fetchPage(
  pageId: string,
  token: string,
  fetchImpl: FetchLike = fetch
): Promise<{ id: string; name: string; link?: string }> {
  const url = `${GRAPH}/${encodeURIComponent(pageId)}?fields=id,name,link&access_token=${encodeURIComponent(token)}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw await graphError(res, t("Facebook refused the Page"));
  return (await res.json()) as { id: string; name: string; link?: string };
}

/** The schedule Facebook will take, or undefined when the time is outside its window. */
export function usableSchedule(publishAt: string | undefined, now = Date.now()): number | undefined {
  if (!publishAt) return undefined;
  const at = Date.parse(publishAt);
  if (!Number.isFinite(at)) return undefined;
  const ahead = at - now;
  return ahead >= MIN_SCHEDULE_MS && ahead <= MAX_SCHEDULE_MS ? Math.floor(at / 1000) : undefined;
}

/**
 * The link Facebook itself gives the video (a reel's is /reel/<id>). The generic
 * /watch/?v=<id> form redirects through the Page's profile id and can read as "removed" for a
 * video that plays fine, so it is not built by hand; if Graph does not answer, the
 * Page-scoped form is the fallback.
 */
export async function fetchVideoLink(
  pageId: string,
  videoId: string,
  token: string,
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const fallback = `https://www.facebook.com/${pageId}/videos/${videoId}`;
  try {
    const res = await fetchImpl(`${GRAPH}/${encodeURIComponent(videoId)}?fields=permalink_url&access_token=${encodeURIComponent(token)}`);
    if (!res.ok) return fallback;
    const { permalink_url: link } = (await res.json()) as { permalink_url?: string };
    if (!link) return fallback;
    return link.startsWith("http") ? link : `https://www.facebook.com${link}`;
  } catch {
    return fallback;
  }
}

export interface UploadVideoInput {
  pageId: string;
  filePath: string;
  title: string;
  description: string;
  // Unix seconds: the video is scheduled instead of published now.
  scheduledPublishTime?: number;
  // Public right away. Ignored when scheduled; false leaves the video unpublished.
  publishNow?: boolean;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function form(url: string, data: Record<string, string | Blob>, signal?: AbortSignal, fetchImpl: FetchLike = fetch) {
  const body = new FormData();
  for (const [key, value] of Object.entries(data)) body.append(key, value);
  return fetchImpl(url, { method: "POST", body, signal });
}

/**
 * Resumable upload to a Page: start (file size) → transfer (the ranges Facebook asks for)
 * → finish (title, description, then published, scheduled or left unpublished).
 */
export async function uploadVideo(
  token: string,
  input: UploadVideoInput,
  onProgress: (sent: number, total: number) => void,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch
): Promise<{ id: string }> {
  const size = (await fs.stat(input.filePath)).size;
  const url = `${GRAPH_VIDEO}/${encodeURIComponent(input.pageId)}/videos`;
  const start = await form(
    url,
    { upload_phase: "start", file_size: String(size), access_token: token },
    signal,
    fetchImpl
  );
  if (!start.ok) throw await graphError(start, t("Facebook refused the upload"));
  const opened = (await start.json()) as {
    upload_session_id?: string;
    video_id?: string;
    start_offset?: string;
    end_offset?: string;
  };
  if (!opened.upload_session_id || !opened.video_id) {
    throw new FacebookApiError(t("Facebook did not open an upload session"), start.status);
  }

  const handle = await fs.open(input.filePath, "r");
  try {
    let startOffset = Number(opened.start_offset);
    let endOffset = Number(opened.end_offset);
    onProgress(startOffset, size);
    while (startOffset < endOffset) {
      if (signal?.aborted) throw new Error(t("Upload stopped"));
      const length = endOffset - startOffset;
      const chunk = Buffer.alloc(length);
      await handle.read(chunk, 0, length, startOffset);
      let attempt = 0;
      for (;;) {
        const res = await form(
          url,
          {
            upload_phase: "transfer",
            upload_session_id: opened.upload_session_id,
            start_offset: String(startOffset),
            video_file_chunk: new Blob([chunk]),
            access_token: token,
          },
          signal,
          fetchImpl
        );
        if (res.ok) {
          const next = (await res.json()) as { start_offset?: string; end_offset?: string };
          startOffset = Number(next.start_offset);
          endOffset = Number(next.end_offset);
          onProgress(Math.min(startOffset, size), size);
          break;
        }
        if ((res.status === 429 || res.status >= 500) && attempt < TRANSFER_RETRIES) {
          attempt++;
          await delay(1_000 * attempt);
          continue;
        }
        throw await graphError(res, t("Facebook refused the upload"));
      }
    }
  } finally {
    await handle.close();
  }

  const finish: Record<string, string> = {
    upload_phase: "finish",
    upload_session_id: opened.upload_session_id,
    title: input.title,
    description: input.description,
    published: input.publishNow && !input.scheduledPublishTime ? "true" : "false",
    access_token: token,
  };
  if (input.scheduledPublishTime) finish.scheduled_publish_time = String(input.scheduledPublishTime);
  const done = await form(url, finish, signal, fetchImpl);
  if (!done.ok) throw await graphError(done, t("Facebook refused the upload"));
  const result = (await done.json()) as { success?: boolean };
  if (result.success === false) throw new FacebookApiError(t("Facebook did not finish the upload"), done.status);
  onProgress(size, size);
  return { id: opened.video_id };
}
