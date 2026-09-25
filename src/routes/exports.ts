import { randomUUID } from "crypto";
import { pathToFileURL } from "url";
import { Response as ExpressResponse, Router } from "express";
import { BuildProgress, buildEpub, contentDisposition, epubFileName } from "../services/epubBuilder";
import { coverPathForExport } from "../services/coverStore";
import { blocksToHtml } from "../services/chapterHtml";
import { t } from "../services/lang";
import { BookMetadata, ExportChapter } from "../types";
import { settingsStore } from "../services/settingsStore";
import { storyAudioDir } from "../services/tts/audioCache";
import { freshChapterAudio, isNarratable } from "../services/tts/narrate";
import { libraryFor } from "./library";

export const exportsRouter = Router();

// Exporting EPUB with many images takes tens of seconds. A single response that both
// reports progress and returns binary data is not feasible, so we split it: POST streams
// NDJSON progress then returns an export ID, client GET that ID to fetch the file.
// File waits in RAM — single machine, single process, like library.runningCrawls.
const EXPORT_TTL_MS = 5 * 60_000;
// With many images the progress stream sends one line per image; batch them to avoid
// flooding the network with thousands of useless lines and thousands of re-renders.
const PROGRESS_INTERVAL_MS = 150;

const pendingExports = new Map<string, { buffer: Buffer; fileName: string }>();

function stashExport(buffer: Buffer, fileName: string): string {
  const exportId = randomUUID();
  pendingExports.set(exportId, { buffer, fileName });
  // unref: an expired export should not keep the process alive.
  setTimeout(() => pendingExports.delete(exportId), EXPORT_TTL_MS).unref();
  return exportId;
}

// Build book and stream progress to response. Errors go in the stream, not HTTP status:
// headers are already sent before we know if the build succeeds.
async function streamExport(
  res: ExpressResponse,
  metadata: BookMetadata,
  chapters: ExportChapter[],
  baseTitle: string,
  dataDir: string,
  localMediaRoots: string[] = []
): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });
  const send = (event: unknown) => res.write(`${JSON.stringify(event)}\n`);

  let lastSent = 0;
  let lastPhase = "";
  const onProgress = (progress: BuildProgress) => {
    const now = Date.now();
    // Always send when phase changes or when a phase completes: if we skip messages,
    // the UI will get stuck showing "Loading image 651/651…" during the final zip step.
    const keep = progress.phase !== lastPhase || progress.done === progress.total;
    if (!keep && now - lastSent < PROGRESS_INTERVAL_MS) return;
    lastSent = now;
    lastPhase = progress.phase;
    send({ type: "progress", ...progress });
  };

  try {
    const parts = await buildEpub(
      { ...metadata, coverUrl: metadata.coverUrl ? coverPathForExport(metadata.coverUrl, dataDir) : undefined },
      chapters,
      onProgress,
      undefined,
      localMediaRoots
    );
    // Only a story too big for one file gets numbered — a normal export keeps its plain name.
    const exports = parts.map((part) => {
      const fileName = epubFileName(
        part.total > 1
          ? t("{title} - Part {index}/{total}", { title: baseTitle, index: part.index + 1, total: part.total })
          : baseTitle
      );
      return { exportId: stashExport(part.buffer, fileName), fileName };
    });
    send({ type: "done", exports });
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : "EPUB export error" });
  }
  res.end();
}

// Fetch the built file. Download once and remove: don't keep tens of MB in RAM longer
// than necessary.
exportsRouter.get("/exports/:exportId", (req, res) => {
  const pending = pendingExports.get(req.params.exportId);
  if (!pending) {
    res.status(404).json({ message: t("Export has expired or already been downloaded — click Export EPUB again") });
    return;
  }
  pendingExports.delete(req.params.exportId);
  res.writeHead(200, {
    "Content-Type": "application/epub+zip",
    "Content-Disposition": contentDisposition(pending.fileName),
    "Content-Length": pending.buffer.length,
  });
  res.end(pending.buffer);
});

// Export EPUB for saved story: content comes straight from DB, client only sends
// chapters it's editing — no need to download the entire story and push it back.
exportsRouter.post("/stories/:id/export", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { id } = req.params;
  const { metadata, chapters, includeNarration } = req.body as {
    metadata?: BookMetadata;
    chapters?: { order: number; title?: string; contentHtml?: string }[];
    // Put each chapter's narration (when current) at the top of the chapter.
    includeNarration?: boolean;
  };
  if (!metadata || !Array.isArray(chapters)) {
    res.status(400).json({ message: t("metadata and chapters are required") });
    return;
  }

  const story = await library.stories.get(id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }

  try {
    const byOrder = new Map(story.chapters.map((c) => [c.order, c]));
    const withNarration = includeNarration === true && isNarratable(story);
    const { ttsVariant, ttsVoice } = settingsStore.get();
    const included: ExportChapter[] = [];
    for (const wanted of chapters) {
      const stored = byOrder.get(wanted.order);
      // If client sends content for a chapter (still editing it), use that; otherwise
      // build from saved blocks.
      // Empty string (chapter opened but content failed to load) also falls back to DB
      // so we don't silently export blank chapters.
      let contentHtml = wanted.contentHtml || (stored ? blocksToHtml(stored.blocks ?? []) : "");
      if (!contentHtml) continue;
      // Only audio matching the saved text: unsaved edits in the editor are not narrated.
      const audio = withNarration
        ? await freshChapterAudio(library.stories, library.dataDir, id, wanted.order, { variant: ttsVariant, voice: ttsVoice })
        : undefined;
      if (audio) contentHtml = `<audio controls src="${pathToFileURL(audio.filePath).href}">${t("Narration")}</audio>\n${contentHtml}`;
      included.push({ title: wanted.title ?? stored?.title ?? "", includeInBook: true, contentHtml });
    }

    await streamExport(
      res,
      metadata,
      included,
      metadata.title || story.title || "book",
      library.dataDir,
      withNarration ? [storyAudioDir(library.dataDir, id)] : []
    );
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : "EPUB export error" });
  }
});
