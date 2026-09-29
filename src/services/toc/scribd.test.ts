import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderPageHtml } from "../renderer";
import {
  fetchToc,
  normalizeScribdStoryUrl,
  parseScribdDocument,
  parseScribdDocumentId,
  ScribdLockedError,
  ScribdLoginRequiredError,
  scribdChapters,
} from "./scribd";

vi.mock("../renderer", () => ({ renderPageHtml: vi.fn() }));

const mockedRender = vi.mocked(renderPageHtml);

beforeEach(() => {
  mockedRender.mockReset();
});

const readFixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");

const DOC_URL = "https://www.scribd.com/document/571686127";
const SLUG_URL =
  "https://www.scribd.com/document/571686127/%E3%83%8A%E3%83%9F%E3%83%A4%E9%9B%91%E8%B2%A8%E5%BA%97%E3%81%AE%E5%A5%87%E8%B9%9F-by-%E6%9D%B1%E9%87%8E%E5%9C%AD%E5%90%BE-Z-lib-org";

// Minimal page carrying the same inline structures the real viewer page ships:
// the docInfo JSON fragment and the docManager.addPage calls.
const documentPage = (options: {
  title?: string;
  outlineData?: string;
  pageCount?: number;
  pages?: { pageNum: number; blur?: boolean }[];
  scrambled?: boolean;
} = {}) => {
  const pages = options.pages ?? [
    { pageNum: 1 },
    { pageNum: 2 },
    { pageNum: 3 },
  ];
  const blocks = pages
    .map(
      (p) => `docManager.addPage({
          pageNum:  ${p.pageNum} ,
          fonts: [],
          origWidth:  901 ,
          origHeight:  1285 ,
          containerElem: document.getElementById("outer_page_${p.pageNum}"),
          blur:  ${p.blur ? "true" : "false"} ,
          contentUrl: "https://html.scribdassets.com/key/pages/${p.pageNum}-deadbeef.jsonp"
        });`
    )
    .join("\n");
  return `<!doctype html><html><head><title>${options.title ?? "Some Document"} | PDF</title></head><body>
<script type="application/json" data-hypernova-key="doc_page"><!--{"assetEnvironment":"production","docInfo":{"is_downloadable":true,"originalImageUrl":"https://imgv2-2-f.scribdassets.com/img/document/1/original/abc/1?v=1","outlineData":${options.outlineData ?? "[]"},"page_count":${options.pageCount ?? pages.length},"hasScrambledFonts":${options.scrambled ? "true" : "false"},"title":"${options.title ?? "Some Document"}"}}--></script>
<script>${blocks}</script>
</body></html>`;
};

describe("parseScribdDocumentId", () => {
  it("đọc id từ URL tài liệu kèm slug", () => {
    expect(parseScribdDocumentId(SLUG_URL)).toBe("571686127");
  });

  it("đọc id từ URL tài liệu không slug", () => {
    expect(parseScribdDocumentId(DOC_URL)).toBe("571686127");
  });

  it("trả undefined cho URL Scribd không phải document", () => {
    expect(parseScribdDocumentId("https://www.scribd.com/ebooks/123/title")).toBeUndefined();
    expect(parseScribdDocumentId("https://www.scribd.com/user/1/name")).toBeUndefined();
    expect(parseScribdDocumentId("khong-phai-url")).toBeUndefined();
  });
});

describe("normalizeScribdStoryUrl", () => {
  it("bỏ slug và fragment, giữ id", () => {
    expect(normalizeScribdStoryUrl(`${SLUG_URL}#pages=1-20`)).toBe(DOC_URL);
  });

  it("giữ nguyên URL không phải trang tài liệu", () => {
    expect(normalizeScribdStoryUrl("https://www.scribd.com/ebooks/123")).toBe("https://www.scribd.com/ebooks/123");
  });
});

describe("parseScribdDocument", () => {
  it("đọc metadata và danh sách trang từ trang viewer thật", () => {
    const doc = parseScribdDocument(readFixture("scribd-document.html"), DOC_URL);

    expect(doc.title).toBe("ナミヤ雑貨店の奇蹟 by 東野圭吾 (Z-lib.org)");
    expect(doc.coverUrl).toBe("https://imgv2-2-f.scribdassets.com/img/document/571686127/original/12ad5c98af/1?v=1");
    expect(doc.pages).toHaveLength(45);
    expect(doc.pages[0]).toEqual({
      pageNum: 1,
      blur: false,
      contentUrl: "https://html.scribdassets.com/2l1p15luww9r1sb0/pages/1-7046cd0c3a.jsonp",
    });
    expect(doc.pages.every((page) => page.blur === false)).toBe(true);
    expect(doc.scrambled).toBe(false);
  });

  it("đánh dấu tài liệu dùng font mã hoá (hasScrambledFonts)", () => {
    const doc = parseScribdDocument(documentPage({ scrambled: true }), DOC_URL);
    expect(doc.scrambled).toBe(true);
  });

  it("báo LockedContent khi có trang bị blur", () => {
    const html = documentPage({
      pages: [
        { pageNum: 1 },
        { pageNum: 2, blur: true },
        { pageNum: 3 },
      ],
    });

    let thrown: unknown = null;
    try {
      parseScribdDocument(html, DOC_URL);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ScribdLockedError);
    expect(thrown instanceof Error ? thrown.message : "").toMatch(/page 2/);
  });

  it("báo cần import session khi trang là tường đăng nhập", () => {
    const html = `<html><head><title>Scribd</title></head><body><div class="modal">Sign in to continue reading</div></body></html>`;
    expect(() => parseScribdDocument(html, DOC_URL)).toThrow(ScribdLoginRequiredError);
  });

  it("báo lỗi thử lại được khi trang chỉ là bot check", () => {
    const html = `<html><head><title>Client Challenge</title></head><body>A required part of this site couldn't load.</body></html>`;
    expect(() => parseScribdDocument(html, DOC_URL)).toThrow(/bot check did not finish/);
  });

  it("báo lỗi khi trang không có viewer", () => {
    const html = `<html><head><title>Scribd</title></head><body><h1>Something else</h1></body></html>`;
    expect(() => parseScribdDocument(html, DOC_URL)).toThrow(/No document viewer found/);
  });
});

describe("scribdChapters", () => {
  it("cắt tài liệu không mục lục thành các chương 20 trang", () => {
    const doc = parseScribdDocument(readFixture("scribd-document.html"), DOC_URL);
    const chapters = scribdChapters(doc, DOC_URL);

    expect(chapters).toEqual([
      { url: `${DOC_URL}#pages=1-20`, title: "Pages 1–20" },
      { url: `${DOC_URL}#pages=21-40`, title: "Pages 21–40" },
      { url: `${DOC_URL}#pages=41-45`, title: "Pages 41–45" },
    ]);
  });

  it("dùng outline khi tài liệu có sẵn, trang đầu chưa vào outline thành chương riêng", () => {
    const html = documentPage({
      outlineData:
        '[{"title":"Introduction","page":6},{"title":"Method","page":21}]',
      pages: Array.from({ length: 30 }, (_, i) => ({ pageNum: i + 1 })),
    });
    const doc = parseScribdDocument(html, DOC_URL);

    expect(scribdChapters(doc, DOC_URL)).toEqual([
      { url: `${DOC_URL}#pages=1-5`, title: "Pages 1–5" },
      { url: `${DOC_URL}#pages=6-20`, title: "Introduction" },
      { url: `${DOC_URL}#pages=21-30`, title: "Method" },
    ]);
  });

  it("bỏ qua outline hỏng (sai shape) và quay về cắt 20 trang", () => {
    const html = documentPage({
      outlineData: '[{"label":"Nope"},{"page":"x"}]',
      pages: Array.from({ length: 25 }, (_, i) => ({ pageNum: i + 1 })),
    });
    const doc = parseScribdDocument(html, DOC_URL);

    expect(scribdChapters(doc, DOC_URL)).toEqual([
      { url: `${DOC_URL}#pages=1-20`, title: "Pages 1–20" },
      { url: `${DOC_URL}#pages=21-25`, title: "Pages 21–25" },
    ]);
  });
});

describe("fetchToc (scribd)", () => {
  it("render URL chuẩn hoá rồi trả mục lục", async () => {
    mockedRender.mockResolvedValueOnce(readFixture("scribd-document.html"));

    const toc = await fetchToc(SLUG_URL);

    expect(mockedRender).toHaveBeenCalledWith(DOC_URL);
    expect(toc.title).toBe("ナミヤ雑貨店の奇蹟 by 東野圭吾 (Z-lib.org)");
    expect(toc.chapters).toHaveLength(3);
    expect(toc.coverUrl).toContain("imgv2-2-f.scribdassets.com");
  });

  it("từ chối URL không phải trang tài liệu trước khi render", async () => {
    await expect(fetchToc("https://www.scribd.com/ebooks/123/title")).rejects.toThrow(
      /not a Scribd document page/
    );
    expect(mockedRender).not.toHaveBeenCalled();
  });

  it("thử lại khi renderer lỗi", async () => {
    mockedRender
      .mockRejectedValueOnce(new Error("Page blanked before content could be read"))
      .mockResolvedValueOnce(readFixture("scribd-document.html"));

    const toc = await fetchToc(DOC_URL);

    expect(mockedRender).toHaveBeenCalledTimes(2);
    expect(toc.chapters).toHaveLength(3);
  });

  it("thử lại khi trang chỉ là bot check, hết lượt thì báo lỗi rõ", async () => {
    mockedRender.mockResolvedValue(
      `<html><head><title>Client Challenge</title></head><body></body></html>`
    );

    await expect(fetchToc(DOC_URL)).rejects.toThrow(/bot check did not finish/);
    expect(mockedRender).toHaveBeenCalledTimes(3);
  });

  it("trang bị khoá blur thì dừng ngay, không thử lại", async () => {
    mockedRender.mockResolvedValue(
      documentPage({
        pages: [
          { pageNum: 1 },
          { pageNum: 2, blur: true },
        ],
      })
    );

    await expect(fetchToc(DOC_URL)).rejects.toThrow(ScribdLockedError);
    expect(mockedRender).toHaveBeenCalledTimes(1);
  });

  it("tường đăng nhập thì dừng ngay và nói cần session", async () => {
    mockedRender.mockResolvedValue(
      `<html><head><title>Scribd</title></head><body><p>Sign in to continue reading</p></body></html>`
    );

    await expect(fetchToc(DOC_URL)).rejects.toThrow(ScribdLoginRequiredError);
    expect(mockedRender).toHaveBeenCalledTimes(1);
  });
});
