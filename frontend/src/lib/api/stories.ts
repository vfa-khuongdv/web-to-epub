import { StoredChapter, StoredStory, StorySummary } from "../../types";
import { apiError, apiFetch, langHeaders, readJsonError, tr } from "./http";

// Start crawling a story: server responds immediately, crawls in background,
// progress arrives via realtime channel /api/stories/:id/live (EventSource).
export async function startStoryCrawl(id: string, orders?: number[]): Promise<{ total: number }> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(id)}/crawl`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ orders }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not start crawl")));
  return (await res.json()) as { total: number };
}

// Ends a running crawl: checked between chapters, so the chapter already in flight
// still finishes and saves before the crawl stops.
export async function stopStoryCrawl(id: string): Promise<void> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(id)}/crawl/stop`, {
    method: "POST",
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not stop crawl")));
}

export async function fetchStories(): Promise<StorySummary[]> {
  const res = await apiFetch("/api/stories", { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load story list")));
  const data = await res.json();
  return data.stories || [];
}

// `ai` asks the server to read a site it has no adapter for with the AI crawler.
export async function createStory(url: string, options: { ai?: boolean } = {}): Promise<StoredStory> {
  const res = await apiFetch("/api/stories", {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ url, ...(options.ai ? { ai: true } : {}) }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load chapters")));
  const data = await res.json();
  return data.story as StoredStory;
}

// Import an .epub or .pdf file as a story. `overwrite` is the user confirming the "already in
// the library" dialog; without it the server answers 409 with code "exists".
export async function importEpub(file: File, options: { overwrite?: boolean } = {}): Promise<StoredStory> {
  const params = new URLSearchParams({ name: file.name });
  if (options.overwrite) params.set("overwrite", "1");
  const res = await apiFetch(`/api/stories/import-epub?${params}`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": file.type || "application/octet-stream" }),
    body: file,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw apiError(data?.message || tr("Could not import the file"), res.status, data?.code, data?.story);
  }
  const data = await res.json();
  return data.story as StoredStory;
}

// Import an archive.org book by item URL. `overwrite` is the user confirming the "already in
// the library" dialog; without it the server answers 409 with code "exists".
export async function importArchive(url: string, options: { overwrite?: boolean } = {}): Promise<StoredStory> {
  const params = new URLSearchParams();
  if (options.overwrite) params.set("overwrite", "1");
  const query = params.toString();
  const res = await apiFetch(`/api/stories/import-archive${query ? `?${query}` : ""}`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw apiError(
      data?.message || tr("Could not import from Internet Archive"),
      res.status,
      data?.code,
      data?.story
    );
  }
  const data = await res.json();
  return data.story as StoredStory;
}

// Import a book from dtv-ebook.com.vn by its page URL. `overwrite` is the user confirming
// the "already in the library" dialog; without it the server answers 409 with code "exists".
export async function importDtvEbook(url: string, options: { overwrite?: boolean } = {}): Promise<StoredStory> {
  const params = new URLSearchParams();
  if (options.overwrite) params.set("overwrite", "1");
  const query = params.toString();
  const res = await apiFetch(`/api/stories/import-dtvebook${query ? `?${query}` : ""}`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw apiError(data?.message || tr("Could not import from DTV Ebook"), res.status, data?.code, data?.story);
  }
  const data = await res.json();
  return data.story as StoredStory;
}

// Import a book from a heyzine.com flipbook by its page URL. `overwrite` is the user
// confirming the "already in the library" dialog; without it the server answers 409 with
// code "exists".
export async function importHeyzine(url: string, options: { overwrite?: boolean } = {}): Promise<StoredStory> {
  const params = new URLSearchParams();
  if (options.overwrite) params.set("overwrite", "1");
  const query = params.toString();
  const res = await apiFetch(`/api/stories/import-heyzine${query ? `?${query}` : ""}`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw apiError(data?.message || tr("Could not import from Heyzine"), res.status, data?.code, data?.story);
  }
  const data = await res.json();
  return data.story as StoredStory;
}

export async function fetchStory(id: string): Promise<StoredStory> {  const res = await apiFetch(`/api/stories/${encodeURIComponent(id)}`, { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load story")));
  const data = await res.json();
  return data.story as StoredStory;
}

// Save book metadata from detail view (multipart because may include new cover image).
export async function saveStoryMeta(id: string, form: FormData): Promise<StoredStory> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(id)}/meta`, {
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
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/chapters/${order}`, {
    method: "PATCH",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(edit),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save chapter")));
  const data = await res.json();
  return data.chapter as StoredChapter;
}

// Correct a chapter's source URL (e.g. a stale TOC entry) without touching its
// content or status — use Retry afterwards to re-crawl it from the new URL.
export async function saveChapterUrl(storyId: string, order: number, url: string): Promise<StoredChapter> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/chapters/${order}/url`, {
    method: "PATCH",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save chapter URL")));
  const data = await res.json();
  return data.chapter as StoredChapter;
}

// Correct a chapter's title without requiring content — works before the chapter has
// even been crawled (the source site's own name can be wrong), same route also works
// on an already-crawled chapter.
export async function saveChapterTitle(storyId: string, order: number, title: string): Promise<StoredChapter> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/chapters/${order}/title`, {
    method: "PATCH",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save chapter title")));
  const data = await res.json();
  return data.chapter as StoredChapter;
}

// Mark a chapter's typos as fixed (or not). Only the flag changes, not the text.
export async function saveChapterSpellChecked(storyId: string, order: number, spellChecked: boolean): Promise<StoredChapter> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/chapters/${order}/spell-checked`, {
    method: "PATCH",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ spellChecked }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not update spell-check mark")));
  const data = await res.json();
  return data.chapter as StoredChapter;
}

export async function deleteStory(id: string): Promise<void> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(id)}`, { method: "DELETE", headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not delete story")));
}

// Remove one chapter (and its highlights) from the library. Order is the TOC position, so
// the rest keeps theirs — the list shows a gap, not a renumbering.
export async function deleteChapter(storyId: string, order: number): Promise<void> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/chapters/${order}`, {
    method: "DELETE",
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not delete chapter")));
}

// Enable/disable watching for new chapters on a story.
export async function setStoryWatch(id: string, watching: boolean): Promise<StoredStory> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(id)}/watch`, {
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
  const res = await apiFetch(`/api/stories/${encodeURIComponent(id)}/check`, { method: "POST", headers: langHeaders() });
  if (!res.ok) throw apiError(await readJsonError(res, tr("Could not check for new chapters")), res.status);
  return (await res.json()) as StoryCheckResult;
}

// Refetch TOC for existing story: new chapters become pending, old ones unchanged.
export async function refreshStoryToc(id: string): Promise<StoredStory> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(id)}/refresh`, { method: "POST", headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load new chapter list")));
  const data = await res.json();
  return data.story as StoredStory;
}

export async function uploadCover(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("cover", file);
  const res = await apiFetch("/api/cover-upload", { method: "POST", headers: langHeaders(), body: formData });
  if (!res.ok) {
    throw new Error(await readJsonError(res, tr("Cover upload failed")));
  }
  const data = await res.json();
  return data.path as string;
}

// Chapter content, loaded when user opens chapter to view/edit (story detail no
// longer carries content to avoid loading tens of MB each time opening a story).
export async function fetchChapterContent(storyId: string, order: number): Promise<StoredChapter> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/chapters/${order}`, {
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load chapter content")));
  const data = await res.json();
  return data.chapter as StoredChapter;
}
