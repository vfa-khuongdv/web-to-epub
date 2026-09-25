import { useRef, useState } from "react";
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

// Revoking the blob URL right after click() races Chromium/Electron's own async read of
// it — the click only *starts* the download, it doesn't wait for it. On macOS this raced
// often enough with several downloads back-to-back that only the last file ever finished
// (the earlier ones' URLs went dead first). A generous delay instead of an immediate
// revoke gives every download time to actually start reading the blob.
const REVOKE_DELAY_MS = 60_000;

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
  // The button disabling on `isExporting` only takes effect once React re-renders — a
  // second click landing in that gap would call pickFolder again while the first dialog
  // is still open, which Electron/Chromium reject outright ("File picker already
  // active"). A ref is set synchronously, closing that gap.
  const exporting = useRef(false);

  function download({ blob, fileName }: ExportedFile) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  }

  // Writes every part into one folder the reader picks, through the packaged app's
  // native dialog + fs bridge (see electron/preload.js). The equivalent web API,
  // window.showDirectoryPicker, turned out unusable for this: Chrome refuses write
  // access to a handful of whole well-known folders — home, Desktop, Documents, and
  // Downloads *itself* — with "can't open this folder because it contains system
  // files", so a plain browser falls back to downloadAll below instead.
  async function saveToElectronFolder(
    electronExport: ElectronExportBridge,
    folderPath: string,
    files: ExportedFile[]
  ): Promise<void> {
    for (const file of files) {
      await electronExport.writeFile(folderPath, file.fileName, await file.blob.arrayBuffer());
    }
  }

  async function downloadAll(files: ExportedFile[]): Promise<void> {
    for (let i = 0; i < files.length; i++) {
      if (i > 0) await sleep(DOWNLOAD_STAGGER_MS);
      download(files[i]);
    }
  }

  // Library story: content already in DB so server builds it, only send
  // currently edited chapters with HTML. Returns how many files were written, or null
  // if the reader cancelled the folder picker before anything was exported — the caller
  // uses that to tell a real export from a no-op when deciding whether to announce it.
  async function exportStoryBook(
    storyId: string,
    metadata: BookMetadata,
    chapters: StoryExportChapter[],
    coverFile: File | null,
    includeNarration = false
  ): Promise<number | null> {
    // Checked and set before anything else — including before pickFolder — so a second
    // click racing the first (before React re-renders the disabled button) bails out
    // instead of opening a second native dialog.
    if (exporting.current) return null;
    exporting.current = true;
    setIsExporting(true);
    setProgress(null);
    try {
      // Asked first, before the (long) network call to build the book: a folder picked
      // up front means a cancelled dialog wastes nothing. A plain browser has no
      // equivalent dialog (see saveToElectronFolder) and just downloads each part instead.
      const electronExport = window.electronExport;
      let folderPath: string | null = null;
      if (electronExport) {
        folderPath = await electronExport.pickFolder();
        if (folderPath === null) return null; // reader closed the dialog without choosing a folder
      }

      const coverUrl = coverFile ? await uploadCover(coverFile) : metadata.coverUrl;
      const files = await exportStoryEpub(storyId, { ...metadata, coverUrl }, chapters, setProgress, includeNarration);
      if (folderPath !== null && electronExport) await saveToElectronFolder(electronExport, folderPath, files);
      else await downloadAll(files);
      return files.length;
    } finally {
      exporting.current = false;
      setIsExporting(false);
      setProgress(null);
    }
  }

  return { isExporting, progress, exportStoryBook };
}
