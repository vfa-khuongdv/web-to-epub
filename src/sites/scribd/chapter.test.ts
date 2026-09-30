import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LockedContentError } from "../../services/extractor";
import { openRenderSession, renderPageHtml, RenderSession } from "../../services/renderer";
import type { EpubMediaStore } from "../../services/epubMedia";
import { fetchText, fetchWithRetry } from "../../services/toc/http";
import { ScribdLockedError } from "./toc";
import { parseScribdChapterRef, parseScribdPagePayload, fetchScribdChapter } from "./chapter";

vi.mock("../../services/renderer", () => ({ renderPageHtml: vi.fn(), openRenderSession: vi.fn() }));
vi.mock("../../services/toc/http", () => ({ fetchText: vi.fn(), fetchWithRetry: vi.fn(), sleep: vi.fn() }));
vi.mock("../../services/siteSession", () => ({ loadSiteSession: vi.fn().mockReturnValue(undefined) }));

const mockedRender = vi.mocked(renderPageHtml);
const mockedFetch = vi.mocked(fetchText);
const mockedFetchWithRetry = vi.mocked(fetchWithRetry);
const mockedOpenSession = vi.mocked(openRenderSession);

beforeEach(() => {
  mockedRender.mockReset();
  mockedFetch.mockReset();
  mockedFetchWithRetry.mockReset();
  mockedOpenSession.mockReset();
});

const readFixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");

const docUrl = (id: number) => `https://www.scribd.com/document/${id}`;

// Same inline structures as a real viewer page, for the chapter tests' own documents.
const documentPage = (pages: { pageNum: number; blur?: boolean }[], options: { scrambled?: boolean } = {}) => {
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
  return `<!doctype html><html><head><title>Doc</title></head><body>
<script type="application/json" data-hypernova-key="doc_page"><!--{"docInfo":{"page_count":${pages.length},"hasScrambledFonts":${options.scrambled ? "true" : "false"},"title":"Doc"}}--></script>
<script>${blocks}</script>
</body></html>`;
};

// A viewer page whose `#outer_page_N` elements mount after a few scroll steps, unless
// listed as missing; blurred pages report Scribd's preview lock.
const capturePage = (options: { blurred?: number[]; missing?: number[] } = {}) => {
  let scrollCalls = 0;
  return {
    $: vi.fn(async (selector: string) => {
      scrollCalls += 1;
      const num = Number(/#outer_page_(\d+)/.exec(selector)?.[1]);
      if (options.missing?.includes(num) || scrollCalls < 2) return null;
      return {
        evaluate: vi.fn(async (fn: (el: unknown) => unknown) =>
          fn({
            classList: { contains: (cls: string) => cls === "blurred_page" && !!options.blurred?.includes(num) },
            scrollIntoView: () => undefined,
          })
        ),
        screenshot: vi.fn(async () => Buffer.from(`page-${num}`)),
      };
    }),
    evaluate: vi.fn(async () => undefined),
    waitForFunction: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
  };
};

const mediaStore = () => {
  const saved: Buffer[] = [];
  return {
    saved,
    save: vi.fn((_storyId: string, bytes: Buffer) => {
      saved.push(bytes);
      return `epub-media/0123456789abcdef/${String(saved.length).padStart(12, "0")}.jpg`;
    }),
    find: vi.fn(),
    remove: vi.fn(),
  } as unknown as EpubMediaStore & { saved: Buffer[] };
};

const context = (media: EpubMediaStore) => ({ storyId: "0123456789abcdef", media });

const sessionFor = (page: unknown) =>
  ({ page, close: vi.fn() }) as unknown as RenderSession;

describe("parseScribdChapterRef", () => {
  it("đọc id tài liệu và khoảng trang từ fragment", () => {
    expect(parseScribdChapterRef(`${docUrl(571686127)}#pages=21-40`)).toEqual({
      docId: "571686127",
      from: 21,
      to: 40,
    });
  });

  it("trả undefined khi thiếu fragment hoặc khoảng trang sai", () => {
    expect(parseScribdChapterRef(docUrl(571686127))).toBeUndefined();
    expect(parseScribdChapterRef(`${docUrl(571686127)}#pages=40-21`)).toBeUndefined();
    expect(parseScribdChapterRef(`${docUrl(571686127)}#pages=a-b`)).toBeUndefined();
    expect(parseScribdChapterRef("khong-phai-url")).toBeUndefined();
  });
});

describe("parseScribdPagePayload", () => {
  it("trang scan: chỉ có image_layer, trả ảnh gốc https", () => {
    const parsed = parseScribdPagePayload(readFixture("scribd-page-scan.jsonp"), 10);

    expect(parsed.width).toBe(899);
    expect(parsed.lines).toEqual([]);
    // Tile vẽ ở top -1, clip rect(1px 903px 1365px 1px): phần nhìn thấy bắt đầu ở 0.
    expect(parsed.images).toEqual([
      {
        top: 0,
        src: "https://html.scribd.com/2l1p15luww9r1sb0/images/10-f959f226f3.jpg",
        clip: { left: 1, top: 1, width: 902, height: 1364 },
      },
    ]);
    expect(parsed.imageArea).toBeCloseTo((904 * 1366) / (899 * 1362), 3);
  });

  it("trang text: gom span thành dòng theo top, nối mảnh cùng dòng theo left", () => {
    const parsed = parseScribdPagePayload(readFixture("scribd-page-text.jsonp"), 6);

    expect(parsed.width).toBe(902);
    expect(parsed.lines.length).toBeGreaterThan(20);
    expect(parsed.imageArea).toBe(0);
    expect(parsed.lines.some((line) => line.text === "1 Introduction" && line.size === 127)).toBe(true);
    const merged = parsed.lines.find((line) => line.text.startsWith("November 2022"));
    expect(merged?.text).toBe("November 2022 (“ChatGPT Announcement,” 2022). While the people actively following");
  });

  it("bỏ số trang đứng riêng ở đầu/cuối trang nhưng giữ dòng số trong thân trang", () => {
    const parsed = parseScribdPagePayload(readFixture("scribd-page-text.jsonp"), 6);
    expect(parsed.lines.some((line) => line.text === "6")).toBe(false);

    const mixed = parseScribdPagePayload(readFixture("scribd-page-mixed.jsonp"), 1);
    expect(mixed.lines.some((line) => line.text === "2024")).toBe(true);
  });

  it("trang trộn: giữ cả dòng chữ lẫn ảnh kèm vị trí", () => {
    const parsed = parseScribdPagePayload(readFixture("scribd-page-mixed.jsonp"), 1);

    expect(parsed.lines.some((line) => line.text === "INTERACTIVE DOCUMENT SUMMARIZER USING LLM TECHNOLOGY")).toBe(
      true
    );
    expect(parsed.lines.some((line) => line.text === "Lappeenranta – Lahti University of Technology LUT")).toBe(true);
    expect(parsed.images).toEqual([
      {
        top: 184,
        src: "https://html.scribd.com/15q5d82jr4dtf08h/images/1-2ff75f9af6.jpg",
        clip: { left: 1, top: 1, width: 217, height: 94 },
      },
    ]);
    expect(parsed.imageArea).toBeCloseTo((219 * 96) / (902 * 1274), 4);
  });

  it("ảnh bị cắt thành nhiều tile: giữ từng mảnh với vùng cắt và vị trí hiển thị", () => {
    const parsed = parseScribdPagePayload(readFixture("scribd-page-tiled.jsonp"), 1);

    // (doc 354014758) cover 1-bf783a8b89.jpg vẽ 2 mảnh: mảnh góc dưới (top 41) và phần
    // thân (top 193); cùng file nhưng hai vùng cắt khác nhau.
    expect(parsed.images).toEqual([
      {
        top: 41,
        src: "https://html.scribd.com/1sc08z9dq85ysm5r/images/1-bf783a8b89.jpg",
        clip: { left: 1, top: 1084, width: 118, height: 111 },
      },
      {
        top: 193,
        src: "https://html.scribd.com/1sc08z9dq85ysm5r/images/1-bf783a8b89.jpg",
        clip: { left: 1, top: 1, width: 902, height: 1081 },
      },
    ]);
    expect(parsed.imageArea).toBeCloseTo((2 * 904 * 1196) / (902 * 1274), 2);
  });

  it("đổi ligature private-use (fi/fl/ff/ffi) về chữ thường", () => {
    const payload = `window.page1_callback([${JSON.stringify(
      '<div class="newpage" id="page1" style="width: 902px; height:1274px"><div class=text_layer><div class=ie_fix>\n' +
        '<div class="ff6" style="font-size:103px"><span class=a style="left:10px;top:100px">signi\uE000cantly di\uE002erent</span></div>\n' +
        '<div class="ff6" style="font-size:103px"><span class=a style="left:10px;top:200px">di\uE003cult to \uE001ip</span></div>\n' +
        "</div></div></div>"
    )}]);`;

    const parsed = parseScribdPagePayload(payload, 1);

    expect(parsed.lines.map((line) => line.text)).toEqual(["significantly different", "difficult to flip"]);
  });

  it("báo lỗi khi payload không phải JSONP đọc được", () => {
    expect(() => parseScribdPagePayload("<html>not jsonp</html>", 3)).toThrow(/unreadable page/);
  });
});

describe("fetchScribdChapter", () => {
  it("dựng chương scan từ các trang trong khoảng, mỗi trang một ảnh", async () => {
    mockedRender.mockResolvedValue(documentPage([{ pageNum: 1 }, { pageNum: 2 }, { pageNum: 3 }]));
    mockedFetch.mockImplementation(async () => readFixture("scribd-page-scan.jsonp"));

    const chapter = await fetchScribdChapter(`${docUrl(771)}#pages=1-3`);

    expect(chapter.sourceUrl).toBe(`${docUrl(771)}#pages=1-3`);
    expect(chapter.title).toBe("Pages 1–3");
    expect(chapter.error).toBeUndefined();
    expect(chapter.blocks).toEqual([
      { type: "image", src: "https://html.scribd.com/2l1p15luww9r1sb0/images/10-f959f226f3.jpg", alt: "" },
      { type: "image", src: "https://html.scribd.com/2l1p15luww9r1sb0/images/10-f959f226f3.jpg", alt: "" },
      { type: "image", src: "https://html.scribd.com/2l1p15luww9r1sb0/images/10-f959f226f3.jpg", alt: "" },
    ]);
    expect(mockedFetch).toHaveBeenCalledTimes(3);
    expect(mockedFetch).toHaveBeenCalledWith("https://html.scribdassets.com/key/pages/2-deadbeef.jsonp");
    // Trang scan không cần chụp lại bằng trình duyệt.
    expect(mockedOpenSession).not.toHaveBeenCalled();
  });

  it("trang slide (chữ nằm trên hình lớn) được chụp ảnh thay vì trích chữ", async () => {
    mockedRender.mockResolvedValue(documentPage([{ pageNum: 1 }]));
    mockedFetch.mockImplementation(async () => readFixture("scribd-page-tiled.jsonp"));
    mockedOpenSession.mockResolvedValue(sessionFor(capturePage()));
    const media = mediaStore();

    const chapter = await fetchScribdChapter(`${docUrl(778)}#pages=1-1`, context(media));

    expect(chapter.blocks).toEqual([
      { type: "image", src: "epub-media/0123456789abcdef/000000000001.jpg", alt: "" },
    ]);
    expect(media.save).toHaveBeenCalledWith("0123456789abcdef", Buffer.from("page-1"), "jpg");
    // Chữ của trang vốn đã nằm trong ảnh chụp, không trích lại thành heading/paragraph.
    expect(chapter.blocks.some((b) => b.type === "heading" || b.type === "paragraph")).toBe(false);
  });

  it("trang slide mà thiếu media store thì báo lỗi thử lại được", async () => {
    mockedRender.mockResolvedValue(documentPage([{ pageNum: 1 }]));
    mockedFetch.mockImplementation(async () => readFixture("scribd-page-tiled.jsonp"));

    await expect(fetchScribdChapter(`${docUrl(779)}#pages=1-1`)).rejects.toThrow(/Could not store/);
    expect(mockedOpenSession).not.toHaveBeenCalled();
  });

  it("trang chữ có ảnh sprite: cắt từng mảnh theo clip rồi lưu vào media store", async () => {
    mockedRender.mockResolvedValue(documentPage([{ pageNum: 13 }]));
    mockedFetch.mockImplementation(async () => readFixture("scribd-page-bullets.jsonp"));
    const sprite = await sharp({ create: { width: 171, height: 209, channels: 3, background: "#ffffff" } })
      .jpeg()
      .toBuffer();
    mockedFetchWithRetry.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => sprite,
    } as unknown as Response);
    const media = mediaStore();

    const chapter = await fetchScribdChapter(`${docUrl(780)}#pages=13-13`, context(media));

    // Logo + 3 vạch bullet của sprite 13-5d128b1c61.jpg.
    expect(chapter.blocks.filter((b) => b.type === "image")).toHaveLength(4);
    expect(chapter.blocks.some((b) => b.type === "heading" && b.text === "Nouns")).toBe(true);
    // Cùng một file: chỉ tải một lần cho cả trang.
    expect(mockedFetchWithRetry).toHaveBeenCalledTimes(1);
    expect(mockedFetchWithRetry).toHaveBeenCalledWith(
      "https://html.scribd.com/1sc08z9dq85ysm5r/images/13-5d128b1c61.jpg",
      expect.anything(),
      expect.anything()
    );
    const sizes = await Promise.all(
      media.saved.map(async (bytes) => {
        const meta = await sharp(bytes).metadata();
        return [meta.width, meta.height];
      })
    );
    expect(sizes).toEqual([
      [169, 42],
      [6, 91],
      [6, 163],
      [6, 89],
    ]);
  });

  it("ảnh sprite tải lỗi thì giữ nguyên URL gốc", async () => {
    mockedRender.mockResolvedValue(documentPage([{ pageNum: 13 }]));
    mockedFetch.mockImplementation(async () => readFixture("scribd-page-bullets.jsonp"));
    mockedFetchWithRetry.mockRejectedValue(new Error("offline"));
    const media = mediaStore();

    const chapter = await fetchScribdChapter(`${docUrl(781)}#pages=13-13`, context(media));

    expect(media.save).not.toHaveBeenCalled();
    expect(chapter.blocks.find((b) => b.type === "image")).toEqual({
      type: "image",
      src: "https://html.scribd.com/1sc08z9dq85ysm5r/images/13-5d128b1c61.jpg",
      alt: "",
    });
  });

  it("dựng heading và đoạn văn từ trang text", async () => {
    mockedRender.mockResolvedValue(documentPage([{ pageNum: 6 }]));
    mockedFetch.mockImplementation(async () => readFixture("scribd-page-text.jsonp"));

    const chapter = await fetchScribdChapter(`${docUrl(772)}#pages=6-6`);

    expect(chapter.blocks[0]).toEqual({ type: "heading", level: 2, text: "1 Introduction" });
    expect(
      chapter.blocks.some(
        (b) => b.type === "paragraph" && (b.text ?? "").includes("intelligent chatbots have been in the headlines")
      )
    ).toBe(true);
  });

  it("dùng lại bản render đã cache khi lấy nhiều chương của cùng tài liệu", async () => {
    mockedRender.mockResolvedValue(documentPage([{ pageNum: 1 }, { pageNum: 2 }]));
    mockedFetch.mockImplementation(async () => readFixture("scribd-page-scan.jsonp"));

    await fetchScribdChapter(`${docUrl(773)}#pages=1-1`);
    await fetchScribdChapter(`${docUrl(773)}#pages=2-2`);

    expect(mockedRender).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("tài liệu có trang blur bị từ chối, không tải trang nào", async () => {
    mockedRender.mockResolvedValue(documentPage([{ pageNum: 1 }, { pageNum: 2, blur: true }]));

    await expect(fetchScribdChapter(`${docUrl(774)}#pages=1-2`)).rejects.toThrow(ScribdLockedError);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("URL không có khoảng trang thì báo lỗi trước khi render", async () => {
    await expect(fetchScribdChapter(docUrl(775))).rejects.toThrow(/not a Scribd chapter URL/);
    expect(mockedRender).not.toHaveBeenCalled();
  });

  it("tải trang lỗi thì lỗi nổi lên cho lần retry", async () => {
    mockedRender.mockResolvedValue(documentPage([{ pageNum: 1 }]));
    mockedFetch.mockRejectedValueOnce(new Error("Failed to fetch page"));

    await expect(fetchScribdChapter(`${docUrl(776)}#pages=1-1`)).rejects.toThrow(/Failed to fetch page/);
  });

  it("trang rỗng hoàn toàn thì báo lỗi không đọc được nội dung", async () => {
    mockedRender.mockResolvedValue(documentPage([{ pageNum: 1 }]));
    mockedFetch.mockResolvedValue(
      `window.page1_callback([${JSON.stringify(
        '<div class="newpage" id="page1" style="width: 100px; height:100px"></div>'
      )}]);`
    );

    await expect(fetchScribdChapter(`${docUrl(777)}#pages=1-1`)).rejects.toThrow(/Could not read any content/);
  });
});

describe("fetchScribdChapter — tài liệu mã hoá font", () => {
  it("chụp từng trang thành ảnh lưu vào media store", async () => {
    mockedRender.mockResolvedValue(
      documentPage([{ pageNum: 1 }, { pageNum: 2 }], { scrambled: true })
    );
    mockedOpenSession.mockResolvedValue(sessionFor(capturePage()));
    const media = mediaStore();

    const chapter = await fetchScribdChapter(`${docUrl(901)}#pages=1-2`, context(media));

    expect(chapter.title).toBe("Pages 1–2");
    expect(chapter.error).toBeUndefined();
    expect(chapter.blocks).toEqual([
      { type: "image", src: "epub-media/0123456789abcdef/000000000001.jpg", alt: "" },
      { type: "image", src: "epub-media/0123456789abcdef/000000000002.jpg", alt: "" },
    ]);
    expect(media.save).toHaveBeenNthCalledWith(1, "0123456789abcdef", Buffer.from("page-1"), "jpg");
    expect(media.save).toHaveBeenNthCalledWith(2, "0123456789abcdef", Buffer.from("page-2"), "jpg");
    expect(mockedOpenSession).toHaveBeenCalledWith(docUrl(901), {
      deviceScaleFactor: 2,
      viewport: { width: 1400, height: 1600 },
    });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("trang bị khoá (blurred_page) thì dừng với LockedContentError, không lưu ảnh đó", async () => {
    mockedRender.mockResolvedValue(
      documentPage([{ pageNum: 1 }, { pageNum: 2 }], { scrambled: true })
    );
    mockedOpenSession.mockResolvedValue(sessionFor(capturePage({ blurred: [2] })));
    const media = mediaStore();

    await expect(fetchScribdChapter(`${docUrl(902)}#pages=1-2`, context(media))).rejects.toThrow(
      LockedContentError
    );
    expect(media.save).toHaveBeenCalledTimes(1);
    expect(media.save).toHaveBeenCalledWith("0123456789abcdef", Buffer.from("page-1"), "jpg");
  });

  it("dùng lại trang viewer giữa các chương của cùng tài liệu", async () => {
    mockedRender.mockResolvedValue(
      documentPage(
        [{ pageNum: 1 }, { pageNum: 2 }, { pageNum: 3 }, { pageNum: 4 }],
        { scrambled: true }
      )
    );
    mockedOpenSession.mockResolvedValue(sessionFor(capturePage()));
    const media = mediaStore();

    await fetchScribdChapter(`${docUrl(903)}#pages=1-2`, context(media));
    await fetchScribdChapter(`${docUrl(903)}#pages=3-4`, context(media));

    expect(mockedOpenSession).toHaveBeenCalledTimes(1);
    expect(media.save).toHaveBeenCalledTimes(4);
  });

  it("không mount được trang thì báo lỗi thử lại được", async () => {
    mockedRender.mockResolvedValue(documentPage([{ pageNum: 1 }], { scrambled: true }));
    mockedOpenSession.mockResolvedValue(sessionFor(capturePage({ missing: [1] })));

    await expect(fetchScribdChapter(`${docUrl(904)}#pages=1-1`, context(mediaStore()))).rejects.toThrow(
      /Could not load page 1/
    );
  });

  it("thiếu media store thì báo lỗi rõ thay vì lưu ảnh thất lạc", async () => {
    mockedRender.mockResolvedValue(documentPage([{ pageNum: 1 }], { scrambled: true }));

    await expect(fetchScribdChapter(`${docUrl(905)}#pages=1-1`)).rejects.toThrow(/Could not store/);
    expect(mockedOpenSession).not.toHaveBeenCalled();
  });
});
