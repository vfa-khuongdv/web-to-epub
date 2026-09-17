import Epub = require("epub-gen");
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { BookMetadata, ExportChapter } from "../types";

// Simple, Kindle-friendly reading styles: system-safe fonts, no fixed sizes
// or absolute positioning, so it reflows correctly on any device.
const KINDLE_CSS = `
body { font-family: serif; line-height: 1.5; }
h1, h2, h3 { font-family: sans-serif; }
img { max-width: 100%; height: auto; }
`;

export async function buildEpub(metadata: BookMetadata, chapters: ExportChapter[]): Promise<Buffer> {
  const included = chapters.filter((c) => c.includeInBook);
  if (included.length === 0) {
    throw new Error("Không có chapter nào được chọn để export");
  }

  const outputPath = path.join(os.tmpdir(), `epub-${randomUUID()}.epub`);

  const epub = new Epub(
    {
      title: metadata.title || "Untitled Book",
      author: metadata.author || "Unknown",
      lang: metadata.language || "en",
      cover: metadata.coverUrl || undefined,
      tocTitle: "Mục lục",
      css: KINDLE_CSS,
      content: included.map((c) => ({ title: c.title, data: c.contentHtml })),
    },
    outputPath
  );

  await epub.promise;

  try {
    return await fs.readFile(outputPath);
  } finally {
    await fs.unlink(outputPath).catch(() => {});
  }
}
