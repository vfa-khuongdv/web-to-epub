import { afterEach, describe, expect, it, vi } from "vitest";
import { extractChapterWithAi, parseTocWithAi } from "./aiLocate";
import { createProvider, type AiProvider } from "./providers";

const pick = (key: string): AiProvider => ({ choose: async () => key });

// Title and title-part questions get "no preference" so a test about something else is not
// disturbed; the title tests below answer them on purpose.
const around = (fn: (o: Record<string, string>) => string): AiProvider => ({
  choose: async (_q, _s, o) => ("title1" in o ? "none" : fn(o)),
});

const links = (n: number) => Array.from({ length: n }, (_, i) => `<li><a href="/c/${i + 1}">Chương ${i + 1}</a></li>`).join("");
const TOC_HTML = `<html><head><title>Truyện</title></head><body><h1>Truyện A</h1>
  <ul class="menu"><li><a href="/a">Home</a></li><li><a href="/b">Hot</a></li><li><a href="/c">New</a></li><li><a href="/d">Top</a></li><li><a href="/e">Tag</a></li></ul>
  <ol class="chapters">${links(10)}</ol></body></html>`;

describe("AI locate", () => {
  it("builds the TOC from the group the provider picks", async () => {
    const seen: Record<string, string>[] = [];
    const provider = around((options) => {
      seen.push(options);
      return Object.keys(options).find((k) => options[k].includes("Chương 1")) ?? "whole";
    });
    const toc = await parseTocWithAi(provider, "https://x.test/truyen-a", TOC_HTML);
    expect(toc.title).toBe("Truyện A");
    expect(toc.chapters).toHaveLength(10);
    expect(toc.chapters[0]).toEqual({ url: "https://x.test/c/1", title: "Chương 1" });
    expect(seen[0].none).toBeDefined();
  });

  it("fails when the provider says none of the groups is a chapter list", async () => {
    await expect(parseTocWithAi(pick("none"), "https://x.test/t", TOC_HTML)).rejects.toThrow();
  });

  it("puts a newest-first list back in reading order", async () => {
    const html = `<h1>T</h1><ol>${[10, 9, 8, 7, 6, 5].map((n) => `<li><a href="/c/${n}">Chương ${n}</a></li>`).join("")}</ol>`;
    const toc = await parseTocWithAi(pick("list1"), "https://x.test/t", html);
    expect(toc.chapters.map((c) => c.title)[0]).toBe("Chương 5");
  });

  it("takes chapter text from the DOM element the provider picks", async () => {
    const prose = "Câu chuyện bắt đầu từ đây. ".repeat(20);
    const html = `<body><h1>Chương 1</h1><div id="comments"><p>${"bình luận ".repeat(40)}</p></div>
      <div id="chapter"><p>${prose}</p><p>Đoạn hai.</p></div></body>`;
    const provider = around((options) =>
      "whole" in options ? "whole" : (Object.keys(options).find((k) => options[k].startsWith("#chapter")) as string)
    );
    const chapter = await extractChapterWithAi(provider, "https://x.test/c/1", html);
    expect(chapter.title).toBe("Chương 1");
    expect(chapter.blocks.map((b) => b.text)).toEqual([prose.trim(), "Đoạn hai."]);
  });
});

describe("chapter body without <p>", () => {
  const pickFirst: AiProvider = around((o) => Object.keys(o)[0]);

  it("keeps one paragraph per <div> leaf", async () => {
    const line = "Một đoạn văn khá dài để vượt ngưỡng nội dung tối thiểu. ".repeat(2);
    const html = `<body><div id="c">${[1, 2, 3].map((n) => `<div class="mb-4">${line}${n}</div>`).join("")}</div></body>`;
    const chapter = await extractChapterWithAi(pickFirst, "https://x.test/c/1", html);
    expect(chapter.blocks).toHaveLength(3);
  });

  it("splits on <br> when the body has no child elements", async () => {
    const line = "Một dòng văn khá dài để vượt ngưỡng nội dung tối thiểu của bài. ".repeat(2);
    const html = `<body><div id="c">${line}1<br>${line}2<br>${line}3</div></body>`;
    const chapter = await extractChapterWithAi(pickFirst, "https://x.test/c/1", html);
    expect(chapter.blocks).toHaveLength(3);
  });
});

describe("wrapper around the chapter", () => {
  it("drops the comments and chapter list that sit beside the prose", async () => {
    const prose = "Một đoạn truyện đủ dài để thành nội dung chương. ".repeat(12);
    const html = `<body><div id="wrap"><div class="ad">x</div><div class="prose"><div>${prose}1</div><div>${prose}2</div></div>
      <div class="chapters">${"Chương 2: Khéo khẩu thành tài ".repeat(5)}</div><div class="comments">Bình luận Rùa Hay quá</div></div></body>`;
    // The AI picks the wrapper first, then — shown its parts — names the one that is the prose.
    const provider = around((o) => Object.keys(o).find((k) => o[k].startsWith("whole" in o ? ".prose" : "#wrap")) ?? "whole");
    const chapter = await extractChapterWithAi(provider, "https://x.test/c/1", html);
    const text = chapter.blocks.map((b) => b.text).join(" ");
    expect(text).toContain("đủ dài");
    expect(text).not.toContain("Bình luận");
    expect(text).not.toContain("Khéo khẩu");
  });
});

describe("titles chosen by the AI", () => {
  it("takes the title part of each chapter link, not its number or date", async () => {
    const row = (n: number) =>
      `<li><a href="/c/${n}"><span>${n}</span><span>Chương ${n}: Mở đầu ${n}</span><span>2174 từ · 8 phút đọc</span></a></li>`;
    const html = `<h1>Truyện A</h1><ol>${[1, 2, 3, 4, 5, 6].map(row).join("")}</ol>`;
    const asked: Record<string, string>[] = [];
    const provider: AiProvider = {
      choose: async (_q, _s, o) => {
        asked.push(o);
        if ("title1" in o) return "none";
        if ("whole" in o) return Object.keys(o).find((k) => k.startsWith("part") && o[k].includes("Chương 1: Mở đầu 1")) as string;
        return "list1";
      },
    };
    const toc = await parseTocWithAi(provider, "https://x.test/t", html);
    expect(toc.chapters.map((c) => c.title)).toEqual(
      [1, 2, 3, 4, 5, 6].map((n) => `Chương ${n}: Mở đầu ${n}`)
    );
  });

  it("uses the heading the AI picks for the chapter title and drops a duplicate first line", async () => {
    const prose = "Một đoạn truyện đủ dài để thành nội dung chương. ".repeat(6);
    const html = `<head><title>Chương 3: Cái chợ | Tên truyện | Tên trang</title></head>
      <body><div id="c"><div>Chương 3: Cái chợ</div><div>${prose}</div></div></body>`;
    const provider: AiProvider = {
      choose: async (_q, _s, o) => {
        if ("title1" in o) return Object.keys(o).find((k) => o[k].startsWith('"Chương 3: Cái chợ"')) as string;
        return "whole" in o ? "whole" : "body1";
      },
    };
    const chapter = await extractChapterWithAi(provider, "https://x.test/c/3", html);
    expect(chapter.title).toBe("Chương 3: Cái chợ");
    expect(chapter.blocks.map((b) => b.text)).toEqual([prose.trim()]);
  });

  it("falls back to the page heading when the AI finds no clean title", async () => {
    const prose = "Một đoạn truyện đủ dài để thành nội dung chương. ".repeat(6);
    const html = `<body><h1>Chương 9: Hồi kết</h1><div id="c"><div>${prose}</div></div></body>`;
    const provider = around(() => "body1");
    const chapter = await extractChapterWithAi(provider, "https://x.test/c/9", html);
    expect(chapter.title).toBe("Chương 9: Hồi kết");
  });
});

describe("cover chosen by the AI", () => {
  const rows = [1, 2, 3, 4, 5, 6].map((n) => `<li><a href="/c/${n}">Chương ${n}</a></li>`).join("");
  const html = `<head><meta property="og:image" content="/img/site-logo.png"></head><body>
    <img src="/_next/image?url=%2Fmedia%2Fcovers%2Fa.jpg&w=640" alt="Truyện A">
    <img data-src="/lazy/avatar.png" alt="avatar" width="32">
    <a href="/truyen/khac"><img src="/media/covers/khac.jpg" alt="Truyện khác"></a>
    <h1>Truyện A</h1><ol>${rows}</ol></body>`;

  it("offers og:image, lazy and Next.js images, and returns the one the AI picks", async () => {
    let offered: Record<string, string> = {};
    const provider: AiProvider = {
      choose: async (_q, _s, o) => {
        if ("title1" in o) return "none";
        if ("image1" in o) {
          offered = o;
          return Object.keys(o).find((k) => o[k].includes("/media/covers/a.jpg")) as string;
        }
        return "list1";
      },
    };
    const toc = await parseTocWithAi(provider, "https://x.test/truyen/a", html);
    expect(toc.coverUrl).toBe("https://x.test/media/covers/a.jpg");
    const text = Object.values(offered).join("\n");
    expect(text).toContain("https://x.test/img/site-logo.png");
    expect(text).not.toContain("avatar.png"); // 32px wide: not a candidate
    expect(text).toContain("inside a link to /truyen/khac");
  });

  it("has no cover when the AI says none of the pictures is one", async () => {
    const provider: AiProvider = { choose: async (_q, _s, o) => ("image1" in o || "title1" in o ? "none" : "list1") };
    const toc = await parseTocWithAi(provider, "https://x.test/truyen/a", html);
    expect(toc.coverUrl).toBeUndefined();
  });
});

describe("login wall", () => {
  it("lets the AI call a page locked even when it has text", async () => {
    const text = "Vui lòng đăng nhập để đọc tiếp chương này, nội dung chỉ dành cho thành viên. ".repeat(4);
    const { LockedContentError } = await import("../extractor");
    await expect(extractChapterWithAi(pick("locked"), "https://x.test/c/1", `<body><div>${text}</div></body>`)).rejects.toBeInstanceOf(LockedContentError);
  });

  it("reports a chapter the AI judges locked as locked, not as a failed extraction", async () => {
    const html = "<body><div>Bạn cần đăng nhập để đọc chương. Vui lòng đăng nhập để tiếp tục.</div></body>";
    const { LockedContentError } = await import("../extractor");
    await expect(extractChapterWithAi(pick("locked"), "https://x.test/c/1", html)).rejects.toBeInstanceOf(LockedContentError);
  });
});

describe("providers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("openai-compatible: finds the option key in the reply", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "`list2`." } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const p = createProvider("deepseek", { apiKey: "k" });
    expect(await p.choose("q", "s", { list1: "a", list2: "b" })).toBe("list2");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
  });

  it("jev: asks a choice question and reads the choice", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answers: { answer: { type: "choice", choice: "b" } } })));
    vi.stubGlobal("fetch", fetchMock);
    const p = createProvider("jev", { apiKey: "k" });
    expect(await p.choose("q", "s", { a: "x", b: "y" })).toBe("b");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(JSON.parse(init.body as string).questions.answer.type).toBe("choice");
  });

  it("refuses an answer outside the options", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "zzz" } }] }))));
    await expect(createProvider("openai", { apiKey: "k" }).choose("q", "s", { a: "x" })).rejects.toThrow();
  });
});
