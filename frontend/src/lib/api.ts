import { currentLang, translate } from "../i18n";
import { currentVaultToken, noteVaultExpired } from "../vault/token";
import { AppInfo, AppSettings, BookMetadata, StoredChapter, StoredStory, StorySummary, SupportedSite } from "../types";

export async function fetchSupportedSites(): Promise<SupportedSite[]> {
  const res = await fetch("/api/supported-sites", { headers: langHeaders() });
  const data = await res.json();
  return data.sites || [];
}

// api.ts is not a component, so it reads the language straight from storage rather
// than the context.
const tr = (key: string) => translate(currentLang(), key);

// The server phrases its own errors, and they are shown to the user verbatim, so every
// request carries the language it should answer in. It also carries the private-mode
// token when one is held: that is what tells the server which library to read — no
// token means the normal one.
function langHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = currentVaultToken();
  const headers: Record<string, string> = { ...extra, "X-Lang": currentLang() };
  if (token) headers["X-Vault-Token"] = token;
  return headers;
}

// Every call goes through here so an expired private session is noticed once, in one
// place: the server answers 401 to a token it no longer knows, and the app drops back
// to the normal library instead of every later request failing on its own.
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const hadToken = currentVaultToken() !== null;
  const res = await fetch(path, init);
  if (res.status === 401 && hadToken) noteVaultExpired();
  return res;
}

export interface VaultStatus {
  configured: boolean;
}

export async function fetchVaultStatus(): Promise<VaultStatus> {
  const res = await fetch("/api/vault/status", { headers: langHeaders() });
  if (!res.ok) throw new Error(tr("Could not check private mode"));
  return (await res.json()) as VaultStatus;
}

// Both halves of "open private mode": the first time there is no code yet and the user
// picks one, afterwards they type the one they picked. Either way the answer is a
// session token.
export async function openVault(code: string, mode: "setup" | "unlock"): Promise<string> {
  const res = await fetch(`/api/vault/${mode}`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw apiError(await readJsonError(res, tr("Wrong code")), res.status);
  return ((await res.json()) as { token: string }).token;
}

// Replacing the code proves the current one, so this works from the settings page
// whether or not private mode is open right now. Open sessions keep working.
export async function changeVaultCode(code: string, newCode: string): Promise<void> {
  const res = await fetch("/api/vault/change-code", {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ code, newCode }),
  });
  if (!res.ok) throw apiError(await readJsonError(res, tr("Wrong code")), res.status);
}

export async function closeVault(): Promise<void> {
  // A failure here only means the server keeps a token nobody will send again; the
  // client forgets it regardless, so there is nothing for the user to act on.
  await fetch("/api/vault/lock", { method: "POST", headers: langHeaders() }).catch(() => undefined);
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
  const res = await apiFetch(path, {
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

export async function createStory(url: string): Promise<StoredStory> {
  const res = await apiFetch("/api/stories", {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load chapters")));
  const data = await res.json();
  return data.story as StoredStory;
}

export async function fetchStory(id: string): Promise<StoredStory> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(id)}`, { headers: langHeaders() });
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

export async function deleteStory(id: string): Promise<void> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(id)}`, { method: "DELETE", headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not delete story")));
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

// A story too big for one EPUB comes back as several files instead — see MAX_EPUB_BYTES
// in src/services/epubBuilder.ts. `fileName` already carries the "Part N/total" suffix
// server-side (translated), so the client just uses it as-is.
export interface ExportedFile {
  blob: Blob;
  fileName: string;
}

interface ExportEvent extends Partial<ExportProgress> {
  type: "progress" | "done" | "error";
  exports?: { exportId: string; fileName: string }[];
  message?: string;
}

// Server streams progress then returns download codes; files fetched in a second request
// each because one response cannot be both progress stream and binary file.
async function runExport(
  path: string,
  body: unknown,
  onProgress?: (progress: ExportProgress) => void
): Promise<ExportedFile[]> {
  let exports: { exportId: string; fileName: string }[] | undefined;
  let failure: string | undefined;

  await streamNdjson<ExportEvent>(path, body, (event) => {
    if (event.type === "progress" && event.phase) {
      onProgress?.({ phase: event.phase, done: event.done ?? 0, total: event.total ?? 0 });
    } else if (event.type === "done") {
      exports = event.exports;
    } else if (event.type === "error") {
      failure = event.message;
    }
  });

  if (failure) throw new Error(failure);
  if (!exports || exports.length === 0) throw new Error("Export failed — stream ended without file");

  const files: ExportedFile[] = [];
  for (const { exportId, fileName } of exports) {
    const res = await apiFetch(`/api/exports/${encodeURIComponent(exportId)}`, { headers: langHeaders() });
    if (!res.ok) throw new Error(await readJsonError(res, tr("Could not download the exported EPUB file")));
    files.push({ blob: await res.blob(), fileName });
  }
  return files;
}

export async function exportStoryEpub(
  storyId: string,
  metadata: BookMetadata,
  chapters: StoryExportChapter[],
  onProgress?: (progress: ExportProgress) => void
): Promise<ExportedFile[]> {
  return runExport(`/api/stories/${encodeURIComponent(storyId)}/export`, { metadata, chapters }, onProgress);
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
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/highlights`, {
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load highlights")));
  return (await res.json()).highlights as Highlight[];
}

export async function createHighlight(
  storyId: string,
  highlight: Omit<Highlight, "id" | "createdAt">
): Promise<Highlight> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/highlights`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(highlight),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save the highlight")));
  return (await res.json()).highlight as Highlight;
}

export async function recolorHighlight(storyId: string, id: string, color: HighlightColor): Promise<void> {
  const res = await apiFetch(
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
  const res = await apiFetch(
    `/api/stories/${encodeURIComponent(storyId)}/highlights/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: langHeaders() }
  );
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not delete the highlight")));
}

// ---- App settings (see src/services/settingsStore.ts) -----------------------

// One request: the values the page can change, plus the read-only facts it shows.
export async function fetchSettings(): Promise<{ settings: AppSettings; app: AppInfo }> {
  const res = await apiFetch("/api/settings", { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load settings")));
  return (await res.json()) as { settings: AppSettings; app: AppInfo };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const res = await apiFetch("/api/settings", {
    method: "PATCH",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save settings")));
  return ((await res.json()) as { settings: AppSettings }).settings;
}

// ---- Saved site sessions (see src/services/siteSession.ts) ------------------

export interface SiteSessionStatus {
  configured: boolean;
  // When the session was imported, when its login token stops working (from the token
  // itself), and the account it belongs to — the settings page shows all three so a
  // stale or wrong-account session is noticed before a crawl starts failing.
  savedAt?: string;
  expiresAt?: string;
  username?: string;
}

export async function fetchSiteSession(): Promise<SiteSessionStatus> {
  const res = await apiFetch("/api/site-sessions/asianfanfics", { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not check the saved session")));
  return (await res.json()) as SiteSessionStatus;
}

// The body is a cURL copy of a request from the user's own logged-in browser; the server
// keeps the cookies and answers only how many it saved.
export async function importSiteSession(curl: string): Promise<{ cookieCount: number; username?: string }> {
  const res = await apiFetch("/api/site-sessions/asianfanfics", {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ curl }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save the session")));
  return (await res.json()) as { cookieCount: number; username?: string };
}

export async function removeSiteSession(): Promise<void> {
  const res = await apiFetch("/api/site-sessions/asianfanfics", {
    method: "DELETE",
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not remove the session")));
}
