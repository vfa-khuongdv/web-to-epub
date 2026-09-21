import { useState } from "react";
import {
  ExportProgress,
  exportStoryEpub,
  StoryExportChapter,
  uploadCover,
} from "../lib/api";

// Keep in sync with epubFileName in src/services/epubBuilder.ts: keep diacritics,
// only replace invalid filename characters.
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

function epubFileName(title: string): string {
  const base = title
    .replace(ILLEGAL_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return `${base || "book"}.epub`;
}
import { Translate } from "../i18n";
import { BookMetadata } from "../types";

// Description for progress bar. Image download is longest phase so show count;
// packaging runs in one batch, cannot be subdivided.
export function exportProgressLabel(progress: ExportProgress, t: Translate): string {
  if (progress.phase === "packaging") return t("Packaging EPUB…");
  const counts = { done: progress.done, total: progress.total };
  return progress.phase === "images"
    ? t("Downloading images {done}/{total}…", counts)
    : t("Downloading audio/video {done}/{total}…", counts);
}

export function useEpubExport() {
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);

  function download(blob: Blob, title: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = epubFileName(title || "book");
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Library story: content already in DB so server builds it, only send
  // currently edited chapters with HTML.
  async function exportStoryBook(
    storyId: string,
    metadata: BookMetadata,
    chapters: StoryExportChapter[],
    coverFile: File | null
  ): Promise<void> {
    setIsExporting(true);
    setProgress(null);
    try {
      const coverUrl = coverFile ? await uploadCover(coverFile) : metadata.coverUrl;
      download(await exportStoryEpub(storyId, { ...metadata, coverUrl }, chapters, setProgress), metadata.title);
    } finally {
      setIsExporting(false);
      setProgress(null);
    }
  }

  return { isExporting, progress, exportStoryBook };
}
