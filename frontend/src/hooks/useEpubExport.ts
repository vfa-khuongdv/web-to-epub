import { useState } from "react";
import {
  ExportedFile,
  ExportProgress,
  exportStoryEpub,
  StoryExportChapter,
  uploadCover,
} from "../lib/api";
import { Translate } from "../i18n";
import { BookMetadata } from "../types";

// A stagger between each triggered download, not a wait for the previous one to finish:
// firing several `a.click()` downloads in the same tick makes some browsers show a
// "this site is trying to download multiple files" block on everything after the first.
const DOWNLOAD_STAGGER_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  function download({ blob, fileName }: ExportedFile) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
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
      const files = await exportStoryEpub(storyId, { ...metadata, coverUrl }, chapters, setProgress);
      for (let i = 0; i < files.length; i++) {
        if (i > 0) await sleep(DOWNLOAD_STAGGER_MS);
        download(files[i]);
      }
    } finally {
      setIsExporting(false);
      setProgress(null);
    }
  }

  return { isExporting, progress, exportStoryBook };
}
