import { currentLang, translate } from "./i18n";
import { BookMetadata, ProgressEvent, StoredChapter, StoredStory, StorySummary, SupportedSite } from "./types";

export async function fetchSupportedSites(): Promise<SupportedSite[]> {
  const res = await fetch("/api/supported-sites", { headers: langHeaders() });
  const data = await res.json();
  return data.sites || [];
}

// api.ts is not a component, so it reads the language straight from storage rather
// than the context.
const tr = (key: string) => translate(currentLang(), key);

// The server phrases its own errors, and they are shown to the user verbatim, so every
// request carries the language it should answer in.
function langHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...extra, "X-Lang": currentLang() };
}

// Errors the UI has to react to by kind, not by wording — matching the message text
// would break the moment it is translated.
export interface ApiError extends Error {
  status?: number;
}

function apiError(message: string, status: number): ApiError {
  const error: ApiError = new Error(message);
  error.status = status;
  return error;
}

async function readJsonError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return data?.message || fallback;
}

async function streamNdjson<T>(path: string, body: unknown, onEvent: (event: T) => void): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    throw new Error(await readJsonError(res, tr("Crawl failed")));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line));
    }
  }
}

// Streams NDJSON progress events from POST /api/extract, invoking onEvent
// for each line as it arrives.
export async function extractChapters(urls: string[], onEvent: (event: ProgressEvent) => void): Promise<void> {
  await streamNdjson<ProgressEvent>("/api/extract", { urls }, onEvent);
}

// Start crawling a story: server responds immediately, crawls in background,
// progress arrives via realtime channel /api/stories/:id/live (EventSource).
export async function startStoryCrawl(id: string, orders?: number[]): Promise<{ total: number }> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}/crawl`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ orders }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not start crawl")));
  return (await res.json()) as { total: number };
}

export async function fetchStories(): Promise<StorySummary[]> {
  const res = await fetch("/api/stories", { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load story list")));
  const data = await res.json();
  return data.stories || [];
}

export async function createStory(url: string): Promise<StoredStory> {
  const res = await fetch("/api/stories", {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load chapters")));
  const data = await res.json();
  return data.story as StoredStory;
}

export async function fetchStory(id: string): Promise<StoredStory> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}`, { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load story")));
  const data = await res.json();
  return data.story as StoredStory;
}

// Save book metadata from detail view (multipart because may include new cover image).
export async function saveStoryMeta(id: string, form: FormData): Promise<StoredStory> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}/meta`, {
    method: "POST",
    headers: langHeaders(),
    body: form,
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save story metadata")));
  const data = await res.json();
  return data.story as StoredStory;
}

// Save title + content of a chapter the user just edited in the editor.
// Server converts HTML to storage block format and returns chapter after saving.
export async function saveChapterEdit(
  storyId: string,
  order: number,
  edit: { title: string; contentHtml: string }
): Promise<StoredChapter> {
  const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}/chapters/${order}`, {
    method: "PATCH",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(edit),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save chapter")));
  const data = await res.json();
  return data.chapter as StoredChapter;
}

export async function deleteStory(id: string): Promise<void> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}`, { method: "DELETE", headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not delete story")));
}

// Enable/disable watching for new chapters on a story.
export async function setStoryWatch(id: string, watching: boolean): Promise<StoredStory> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}/watch`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ watching }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not change watch status")));
  const data = await res.json();
  return data.story as StoredStory;
}

export interface StoryCheckResult {
  newChapterCount: number;
  lastCheckedAt?: string;
  checkError?: string;
}

// Check TOC for new chapters; throws on fetch failure (previous successful check
// data still preserved on server).
export async function checkStoryUpdates(id: string): Promise<StoryCheckResult> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}/check`, { method: "POST", headers: langHeaders() });
  if (!res.ok) throw apiError(await readJsonError(res, tr("Could not check for new chapters")), res.status);
  return (await res.json()) as StoryCheckResult;
}

// Refetch TOC for existing story: new chapters become pending, old ones unchanged.
export async function refreshStoryToc(id: string): Promise<StoredStory> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}/refresh`, { method: "POST", headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load new chapter list")));
  const data = await res.json();
  return data.story as StoredStory;
}

export async function uploadCover(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("cover", file);
  const res = await fetch("/api/cover-upload", { method: "POST", headers: langHeaders(), body: formData });
  if (!res.ok) {
    throw new Error(await readJsonError(res, tr("Cover upload failed")));
  }
  const data = await res.json();
  return data.path as string;
}

// Chapter content, loaded when user opens chapter to view/edit (story detail no
// longer carries content to avoid loading tens of MB each time opening a story).
export async function fetchChapterContent(storyId: string, order: number): Promise<StoredChapter> {
  const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}/chapters/${order}`, {
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load chapter content")));
  const data = await res.json();
  return data.chapter as StoredChapter;
}

// Export EPUB for saved story: only send chapters being edited, rest server builds
// from DB content.
export interface StoryExportChapter {
  order: number;
  title: string;
  contentHtml?: string;
}

// Book building progress: most time spent downloading images in chapters.
export interface ExportProgress {
  phase: "images" | "media" | "packaging";
  done: number;
  total: number;
}

interface ExportEvent extends Partial<ExportProgress> {
  type: "progress" | "done" | "error";
  exportId?: string;
  message?: string;
}

// Server streams progress then returns download code; file fetched in second request because
// one response cannot be both progress stream and binary file.
async function runExport(
  path: string,
  body: unknown,
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  let exportId: string | undefined;
  let failure: string | undefined;

  await streamNdjson<ExportEvent>(path, body, (event) => {
    if (event.type === "progress" && event.phase) {
      onProgress?.({ phase: event.phase, done: event.done ?? 0, total: event.total ?? 0 });
    } else if (event.type === "done") {
      exportId = event.exportId;
    } else if (event.type === "error") {
      failure = event.message;
    }
  });

  if (failure) throw new Error(failure);
  if (!exportId) throw new Error("Export failed — stream ended without file");

  const res = await fetch(`/api/exports/${encodeURIComponent(exportId)}`, { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not download the exported EPUB file")));
  return res.blob();
}

export async function exportStoryEpub(
  storyId: string,
  metadata: BookMetadata,
  chapters: StoryExportChapter[],
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  return runExport(`/api/stories/${encodeURIComponent(storyId)}/export`, { metadata, chapters }, onProgress);
}

export interface ExportChapterPayload {
  title: string;
  includeInBook: boolean;
  contentHtml: string;
}

export async function exportEpub(
  metadata: BookMetadata,
  chapters: ExportChapterPayload[],
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  return runExport("/api/export", { metadata, chapters }, onProgress);
}

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface Highlight {
  id: string;
  chapterOrder: number;
  start: number;
  end: number;
  color: HighlightColor;
  text: string;
  createdAt: string;
}

export async function fetchHighlights(storyId: string): Promise<Highlight[]> {
  const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}/highlights`, {
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load highlights")));
  return (await res.json()).highlights as Highlight[];
}

export async function createHighlight(
  storyId: string,
  highlight: Omit<Highlight, "id" | "createdAt">
): Promise<Highlight> {
  const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}/highlights`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(highlight),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save the highlight")));
  return (await res.json()).highlight as Highlight;
}

export async function recolorHighlight(storyId: string, id: string, color: HighlightColor): Promise<void> {
  const res = await fetch(
    `/api/stories/${encodeURIComponent(storyId)}/highlights/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: langHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ color }),
    }
  );
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not change the highlight colour")));
}

export async function deleteHighlight(storyId: string, id: string): Promise<void> {
  const res = await fetch(
    `/api/stories/${encodeURIComponent(storyId)}/highlights/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: langHeaders() }
  );
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not delete the highlight")));
}
