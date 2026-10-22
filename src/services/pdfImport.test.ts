import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getResolvedPDFJS } from "unpdf";
import { isPdf, linesToBlocks, NotPdfError, parsePdf, PdfLockedError } from "./pdfImport";

// The real pdf.js, except that a test can make the document report restricted permissions
// (no fixture tool here can encrypt a PDF) or stand in a fake document (no fixture tool here
// can write an inline image).
const permissions = vi.hoisted(() => ({ value: null as number[] | null }));
const fakeDocument = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("unpdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("unpdf")>();
  return {
    ...actual,
    getDocumentProxy: async (...args: Parameters<typeof actual.getDocumentProxy>) => {
      if (fakeDocument.value) return fakeDocument.value as Awaited<ReturnType<typeof actual.getDocumentProxy>>;
      const pdf = await actual.getDocumentProxy(...args);
      if (permissions.value) {
        const value = permissions.value;
        pdf.getPermissions = async () => value;
      }
      return pdf;
    },
  };
});

// The fixtures are small PDFs printed by Chromium (Vietnamese text, real text layer):
// pdf-outline.pdf has bookmarks, pdf-headings.pdf only "Chương N" headings, pdf-scan.pdf
// one page holding nothing but an image, pdf-typeset.pdf a faux-bold title and a drop cap.
const fixture = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name));

function imageSink() {
  const stored: { bytes: Buffer; extension: string }[] = [];
  const store = (bytes: Buffer, extension: string) => {
    stored.push({ bytes, extension });
    return `epub-media/0123456789abcdef/img-${stored.length}.${extension}`;
  };
  return { stored, store };
}

describe("isPdf", () => {
  it("recognizes the PDF header, not an EPUB zip", () => {
    expect(isPdf(fixture("pdf-scan.pdf"))).toBe(true);
    expect(isPdf(Buffer.from("PK\u0003\u0004mimetypeapplication/epub+zip"))).toBe(false);
  });
});

describe("parsePdf", () => {
  afterEach(() => {
    permissions.value = null;
    fakeDocument.value = null;
  });

  it("splits chapters by the outline, even two chapters on one page", async () => {
    const book = await parsePdf(fixture("pdf-outline.pdf"), { fallbackTitle: "file-name" });

    expect(book.title).toBe("Sách PDF");
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      "Chương 1: Khởi đầu",
      "Chương 2: Tiếp",
      "Chương 3: Kết",
    ]);
    // Wrapped lines join into one paragraph, the heading repeating the title is dropped,
    // and text is escaped because blocks hold HTML.
    expect(book.chapters[0].blocks).toEqual([
      {
        type: "paragraph",
        text:
          "Một câu khá dài để văn bản xuống dòng trong khổ giấy A4, thêm vài chữ nữa cho chắc chắn sẽ tràn sang dòng thứ hai &amp; &lt;thẻ&gt;.",
      },
      { type: "paragraph", text: "Đoạn ngắn." },
    ]);
    expect(book.chapters[1].blocks).toEqual([{ type: "paragraph", text: "Nội dung chương hai." }]);
    expect(book.chapters[2].blocks).toEqual([{ type: "paragraph", text: "Nội dung chương ba." }]);
  });

  it("falls back to chapter headings, keeping what comes before as its own chapter", async () => {
    const book = await parsePdf(fixture("pdf-headings.pdf"), { fallbackTitle: "Tên file" });

    expect(book.title).toBe("Tên file");
    expect(book.chapters).toEqual([
      { title: "Tên file", blocks: [{ type: "paragraph", text: "Lời nói đầu." }] },
      {
        title: "Chương 1",
        blocks: [
          { type: "paragraph", text: "Dòng một." },
          { type: "paragraph", text: "Dòng hai." },
        ],
      },
      { title: "Chương 2", blocks: [{ type: "paragraph", text: "Dòng ba." }] },
    ]);
  });

  it("keeps a page without text as a JPEG of its image", async () => {
    const sink = imageSink();
    const book = await parsePdf(fixture("pdf-scan.pdf"), { fallbackTitle: "Bản scan", storeImage: sink.store });

    expect(book.chapters).toEqual([
      { title: "Bản scan", blocks: [{ type: "image", src: "epub-media/0123456789abcdef/img-1.jpg", alt: "" }] },
    ]);
    expect(sink.stored).toHaveLength(1);
    expect(sink.stored[0].extension).toBe("jpg");
    expect(sink.stored[0].bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it("takes the first image of the first page as the cover", async () => {
    const sink = imageSink();
    const book = await parsePdf(fixture("pdf-scan.pdf"), { storeImage: sink.store });

    expect(book.cover).toEqual({ bytes: sink.stored[0].bytes, extension: "jpg" });
  });

  it("keeps a page whose scan is an inline image, not a named one", async () => {
    const { OPS } = await getResolvedPDFJS();
    const data = new Uint8Array(200 * 200 * 3).fill(128);
    const page = {
      view: [0, 0, 200, 200],
      getTextContent: async () => ({ items: [] }),
      getOperatorList: async () => ({
        fnArray: [OPS.paintInlineImageXObject],
        argsArray: [[{ width: 200, height: 200, data }]],
      }),
      cleanup: () => {},
    };
    fakeDocument.value = {
      numPages: 1,
      getPermissions: async () => null,
      getMetadata: async () => ({ info: {} }),
      getPage: async () => page,
      getOutline: async () => null,
      loadingTask: { destroy: async () => {} },
    };
    try {
      const sink = imageSink();
      const book = await parsePdf(Buffer.from("%PDF-1.4\n"), { fallbackTitle: "Bản scan", storeImage: sink.store });

      expect(sink.stored).toHaveLength(1);
      expect(sink.stored[0].bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      expect(book.chapters).toEqual([
        { title: "Bản scan", blocks: [{ type: "image", src: "epub-media/0123456789abcdef/img-1.jpg", alt: "" }] },
      ]);
    } finally {
      fakeDocument.value = null;
    }
  });

  it("has no cover when the first page holds no image", async () => {
    const book = await parsePdf(fixture("pdf-outline.pdf"));

    expect(book.cover).toBeUndefined();
  });

  it("reads a title drawn three times at one spot once, and joins a drop cap to its word", async () => {
    const book = await parsePdf(fixture("pdf-typeset.pdf"), { fallbackTitle: "Sách" });

    expect(book.chapters).toEqual([
      {
        title: "Sách",
        blocks: [
          { type: "heading", level: 2, text: "CHƯƠNG MỘT" },
          { type: "paragraph", text: "Người thứ nhất bước vào." },
        ],
      },
    ]);
  });

  it("rejects a file that is not a PDF", async () => {
    await expect(parsePdf(Buffer.from("hello"))).rejects.toBeInstanceOf(NotPdfError);
    await expect(parsePdf(Buffer.from("%PDF-1.4\ngarbage"))).rejects.toBeInstanceOf(NotPdfError);
  });

  it("refuses a PDF whose permissions forbid copying", async () => {
    permissions.value = [4]; // print only
    await expect(parsePdf(fixture("pdf-scan.pdf"))).rejects.toBeInstanceOf(PdfLockedError);

    permissions.value = [4, 16]; // print + copy
    await expect(parsePdf(fixture("pdf-scan.pdf"))).resolves.toBeTruthy();
  });
});

describe("linesToBlocks", () => {
  it("joins a drop cap that sits on its own line to the rest of its word", () => {
    const line = (text: string, size: number, y: number) => ({ page: 1, x: 10, y, size, right: 200, text });
    const margins = new Map([[1, { left: 10, right: 200 }]]);
    const blocks = linesToBlocks([line("C", 30, 700), line("opilot ngu ngục", 12, 712)], 12, 14, margins);

    expect(blocks).toEqual([{ type: "paragraph", text: "Copilot ngu ngục" }]);
  });
});
