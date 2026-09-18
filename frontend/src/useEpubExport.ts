import { useState } from "react";
import {
  exportEpub,
  ExportChapterPayload,
  ExportProgress,
  exportStoryEpub,
  StoryExportChapter,
  uploadCover,
} from "./api";

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

// Câu mô tả cho thanh tiến trình. Tải ảnh là giai đoạn dài nhất nên nói rõ số
// lượng; đóng gói thì epub-gen chạy một mạch, không chia nhỏ được.
export function exportProgressLabel(progress: ExportProgress): string {
  if (progress.phase === "packaging") return "Đang đóng gói EPUB…";
  const what = progress.phase === "images" ? "ảnh" : "audio/video";
  return `Đang tải ${what} ${progress.done}/${progress.total}…`;
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

  // Truyện trong thư viện: nội dung đã nằm trong DB nên server tự dựng, chỉ
  // chương đang sửa dở mới gửi kèm HTML.
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

  async function exportBook(
    metadata: BookMetadata,
    chapters: ExportChapterPayload[],
    coverFile: File | null
  ): Promise<void> {
    setIsExporting(true);
    setProgress(null);
    try {
      // Chọn file thì file thắng (chỉ cho lần xuất này); không chọn thì dùng bìa
      // đã lưu của truyện (tải về khi crawl).
      const coverUrl = coverFile ? await uploadCover(coverFile) : metadata.coverUrl;
      download(await exportEpub({ ...metadata, coverUrl }, chapters, setProgress), metadata.title);
    } finally {
      setIsExporting(false);
      setProgress(null);
    }
  }

  return { isExporting, progress, exportBook, exportStoryBook };
}
