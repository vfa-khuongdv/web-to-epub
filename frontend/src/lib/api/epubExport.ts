import { BookMetadata } from "../../types";
import { apiFetch, langHeaders, readJsonError, streamNdjson, tr } from "./http";

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
  onProgress?: (progress: ExportProgress) => void,
  // Put each chapter's current narration at its top (Vietnamese stories).
  includeNarration = false
): Promise<ExportedFile[]> {
  return runExport(
    `/api/stories/${encodeURIComponent(storyId)}/export`,
    { metadata, chapters, includeNarration },
    onProgress
  );
}
