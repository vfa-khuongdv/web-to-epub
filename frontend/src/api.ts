import { BookMetadata, ExtractedChapter, ProgressEvent, SupportedSite } from "./types";

export async function fetchSupportedSites(): Promise<SupportedSite[]> {
  const res = await fetch("/api/supported-sites");
  const data = await res.json();
  return data.sites || [];
}

async function readJsonError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return data?.message || fallback;
}

// Streams NDJSON progress events from POST /api/extract, invoking onEvent
// for each line as it arrives.
export async function extractChapters(urls: string[], onEvent: (event: ProgressEvent) => void): Promise<void> {
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });

  if (!res.ok || !res.body) {
    throw new Error(await readJsonError(res, "Crawl thất bại"));
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

export async function extractOne(url: string): Promise<ExtractedChapter> {
  const res = await fetch("/api/extract-one", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    throw new Error(await readJsonError(res, "Thử lại thất bại"));
  }
  const data = await res.json();
  return data.chapter as ExtractedChapter;
}

export async function uploadCover(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("cover", file);
  const res = await fetch("/api/cover-upload", { method: "POST", body: formData });
  if (!res.ok) {
    throw new Error(await readJsonError(res, "Upload cover thất bại"));
  }
  const data = await res.json();
  return data.path as string;
}

export interface ExportChapterPayload {
  title: string;
  includeInBook: boolean;
  contentHtml: string;
}

export async function exportEpub(metadata: BookMetadata, chapters: ExportChapterPayload[]): Promise<Blob> {
  const res = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metadata, chapters }),
  });
  if (!res.ok) {
    throw new Error(await readJsonError(res, "Export thất bại"));
  }
  return res.blob();
}
