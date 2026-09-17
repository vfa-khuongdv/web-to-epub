import { useState } from "react";
import { exportEpub, ExportChapterPayload, uploadCover } from "./api";
import { BookMetadata } from "./types";

export function useEpubExport() {
  const [isExporting, setIsExporting] = useState(false);

  async function exportBook(
    metadata: Omit<BookMetadata, "coverUrl">,
    chapters: ExportChapterPayload[],
    coverFile: File | null
  ): Promise<void> {
    setIsExporting(true);
    try {
      const coverUrl = coverFile ? await uploadCover(coverFile) : undefined;
      const blob = await exportEpub({ ...metadata, coverUrl }, chapters);

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(metadata.title || "book").replace(/[^a-z0-9]+/gi, "_")}.epub`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }

  return { isExporting, exportBook };
}
