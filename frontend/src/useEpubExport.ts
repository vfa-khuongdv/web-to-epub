import { useState } from "react";
import { exportEpub, ExportChapterPayload, uploadCover } from "./api";

// Giữ đồng bộ với epubFileName trong src/services/epubBuilder.ts: giữ tiếng Việt
// có dấu, chỉ thay ký tự không hợp lệ trong tên file.
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
import { BookMetadata } from "./types";

export function useEpubExport() {
  const [isExporting, setIsExporting] = useState(false);

  async function exportBook(
    metadata: BookMetadata,
    chapters: ExportChapterPayload[],
    coverFile: File | null
  ): Promise<void> {
    setIsExporting(true);
    try {
      // Chọn file thì file thắng (chỉ cho lần xuất này); không chọn thì dùng bìa
      // đã lưu của truyện (tải về khi crawl).
      const coverUrl = coverFile ? await uploadCover(coverFile) : metadata.coverUrl;
      const blob = await exportEpub({ ...metadata, coverUrl }, chapters);

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = epubFileName(metadata.title || "book");
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
