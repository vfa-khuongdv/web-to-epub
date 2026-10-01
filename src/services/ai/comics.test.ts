import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChapterFetchContext } from "../chapters/types";
import { extractChapterWithAi } from "./aiLocate";
import { PictureDownloadError, forgetPictureHosts, savePictures } from "./pictures";
import type { AiProvider } from "./providers";

// A made-up comic site: a banner and adverts around a strip of lazy-loaded pages.
const pageUrl = (n: number) => `https://cdn.comic.test/chapters/c1/${n}.jpg`;
const pages = [0, 1, 2, 3, 4]
  .map((n) => `<img class="lazy" data-src="${pageUrl(n)}" src="/images/loading.svg" alt="Truyện A - Chapter 1">`)
  .join("");
const html = `<html><head><title>Truyện A - Chapter 1 | Comic Site</title></head><body>
  <h1>Chapter 1</h1>
  <div class="ads"><img src="/media/ad-1.webp" alt="Mua hàng"><img src="/media/ad-2.webp" alt="Mua hàng"></div>
  <div id="reader"><img src="/media/site-banner.png" alt="Đọc truyện tại Comic Site">${pages}<img src="/media/next-card.png" alt="Đọc tiếp"></div>
  <ul class="related"><li><img src="/media/other-1.jpg"></li><li><img src="/media/other-2.jpg"></li></ul>
</body></html>`;

// Answers the way a sensible model would, from what each question shows.
const sensible: AiProvider = {
  choose: async (_q, _s, o) => {
    if ("title1" in o) return Object.keys(o).find((k) => o[k].startsWith('"Chapter 1"')) ?? "none";
    // the question names the picture; the answers always mention "banner", so only the question counts
    if ("page" in o && "site" in o) return /site-banner|next-card|ad-\d/.test(_q) ? "site" : "page";
    if ("attr1" in o) return Object.keys(o).find((k) => o[k].startsWith("data-src")) as string;
    // the strip with the most pictures: the pages, not the two adverts or the related thumbnails
    const strips = Object.keys(o).filter((k) => k.startsWith("pages"));
    const count = (k: string) => Number(/(\d+) pictures/.exec(o[k])?.[1] ?? 0);
    return strips.sort((a, b) => count(b) - count(a))[0] ?? "locked";
  },
};

describe("a comic chapter", () => {
  it("is read from the strip of pictures the AI picks, from the attribute it says holds the real address", async () => {
    const chapter = await extractChapterWithAi(sensible, "https://comic.test/truyen-a/chapter-1", html);
    expect(chapter.blocks.map((b) => b.src)).toEqual([0, 1, 2, 3, 4].map(pageUrl));
    expect(chapter.blocks.every((b) => b.type === "image")).toBe(true);
    expect(chapter.title).toBe("Chapter 1");
  });

  it("offers the strip beside the text regions, with the addresses of its first and last picture", async () => {
    let offered: Record<string, string> = {};
    const spy: AiProvider = {
      choose: async (q, s, o) => {
        if ("pages1" in o) offered = o;
        return sensible.choose(q, s, o);
      },
    };
    await extractChapterWithAi(spy, "https://comic.test/truyen-a/chapter-1", html);
    const strips = Object.keys(offered).filter((k) => k.startsWith("pages"));
    expect(strips).toHaveLength(3);
    const biggest = offered[strips.sort((a, b) => Number(/(\d+) pictures/.exec(offered[b])?.[1]) - Number(/(\d+) pictures/.exec(offered[a])?.[1]))[0]];
    expect(biggest).toContain("7 pictures");
    // the pictures' addresses are shown by attribute, so the AI can see which one is a placeholder
    expect(biggest).toContain("src=");
  });

  it("drops the banner and the next-chapter card at the ends, but never a page from the middle", async () => {
    const askedAbout: string[] = [];
    const wary: AiProvider = {
      choose: async (q, s, o) => {
        if ("page" in o && "site" in o) askedAbout.push(q);
        return sensible.choose(q, s, o);
      },
    };
    const chapter = await extractChapterWithAi(wary, "https://comic.test/truyen-a/chapter-1", html);
    expect(chapter.blocks).toHaveLength(5);
    // each end was asked about until a real page came up: banner, page 0 / next card, page 4
    expect(askedAbout.length).toBe(4);
  });

  it("keeps at most three pictures from each end of being questioned, even if all are called site pictures", async () => {
    const allSite: AiProvider = {
      choose: async (q, s, o) => ("page" in o && "site" in o ? "site" : sensible.choose(q, s, o)),
    };
    const chapter = await extractChapterWithAi(allSite, "https://comic.test/truyen-a/chapter-1", html);
    // 7 pictures in the strip (banner, 5 pages, card): three come off each end at most, one stays
    expect(chapter.blocks).toHaveLength(1);
  });

  it("says it is locked when the AI says the picture-less page is a login wall", async () => {
    const { LockedContentError } = await import("../extractor");
    const wall = "<body><div>Đăng nhập để đọc chương này.</div></body>";
    const provider: AiProvider = { choose: async () => "locked" };
    await expect(extractChapterWithAi(provider, "https://comic.test/c", wall)).rejects.toBeInstanceOf(LockedContentError);
  });
});

describe("a chapter that is a single picture", () => {
  // The chapter's one page, and a carousel of 20 thumbnail cards for other stories, each inside a link.
  const cards = Array.from(
    { length: 20 },
    (_, i) => `<li class="slide"><a href="/truyen/other-${i}"><figure><img data-src="https://cdn.comic.test/covers/${i}.webp" alt="Other ${i}"></figure></a></li>`
  ).join("");
  const page = `<html><head><title>Chapter 1</title></head><body><h1>Chapter 1</h1>
    <section id="content"><div class="imageload"><img src="https://cdn.comic.test/chapters/c1/0.webp" data-mirror="https://mirror.test/0.webp" alt="page"></div></section>
    <ul class="carousel">${cards}</ul></body></html>`;

  let offered: Record<string, string> = {};
  const provider: AiProvider = {
    choose: async (_q, _s, o) => {
      if ("title1" in o) return "title1";
      if ("attr1" in o) return Object.keys(o).find((k) => o[k].startsWith("src ")) as string;
      offered = o;
      // the strip that is not a card of links to other pages
      return Object.keys(o).find((k) => k.startsWith("pages") && /none inside a link/.test(o[k])) ?? "locked";
    },
  };

  it("is offered as a strip of one picture, and chosen", async () => {
    const chapter = await extractChapterWithAi(provider, "https://comic.test/truyen-a/chapter-1", page);
    expect(chapter.blocks.map((b) => b.src)).toEqual(["https://cdn.comic.test/chapters/c1/0.webp"]);
  });

  it("shows the carousel once, as 'one of 20 like it', and says its pictures sit inside links", async () => {
    await extractChapterWithAi(provider, "https://comic.test/truyen-a/chapter-1", page);
    const strips = Object.values(offered).filter((d) => /picture/.test(d));
    const carousel = strips.filter((d) => /one of 20 like it/.test(d));
    expect(carousel).toHaveLength(1);
    expect(carousel[0]).toMatch(/1 of them inside links to other pages/);
    // twenty cards did not become twenty candidates, and the page itself is among them
    expect(strips.length).toBeLessThanOrEqual(8);
    expect(strips.some((d) => /none inside a link/.test(d) && /1 picture/.test(d))).toBe(true);
  });

  it("lets the AI pick which address attribute is the real page picture", async () => {
    const asked: Record<string, string>[] = [];
    const spy: AiProvider = {
      choose: async (q, s, o) => {
        if ("attr1" in o) asked.push(o);
        return provider.choose(q, s, o);
      },
    };
    await extractChapterWithAi(spy, "https://comic.test/truyen-a/chapter-1", page);
    expect(asked).toHaveLength(1);
    expect(Object.values(asked[0]).some((d) => d.startsWith("src ") && d.includes("cdn.comic.test"))).toBe(true);
    expect(Object.values(asked[0]).some((d) => d.startsWith("data-mirror ") && d.includes("mirror.test"))).toBe(true);
  });
});

describe("keeping a comic's pictures", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetPictureHosts();
  });

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const context = (): ChapterFetchContext & { saved: string[] } => {
    const saved: string[] = [];
    return {
      storyId: "0123456789abcdef",
      media: {
        save: (id, _bytes, extension) => {
          saved.push(extension);
          return `epub-media/${id}/${String(saved.length).padStart(12, "0")}.${extension}`;
        },
        find: () => undefined,
        remove: async () => {},
      },
      saved,
    };
  };
  const blocks = (n: number, host = "cdn.comic.test") =>
    Array.from({ length: n }, (_, i) => ({ type: "image" as const, src: `https://${host}/chapters/c1/${i}.jpg`, alt: "" }));
  const referer = (init: RequestInit) => (init.headers as Record<string, string>).referer;

  // A hotlink-protected CDN: 403 without a referrer, the picture with one.
  const protectedCdn = (log: { url: string; referer?: string }[] = []) =>
    vi.fn(async (url: string, init: RequestInit) => {
      log.push({ url, referer: referer(init) });
      return referer(init) ? new Response(jpeg, { headers: { "content-type": "image/jpeg" } }) : new Response("no hotlinking", { status: 403 });
    });

  it("keeps the links when the site hands a picture to a request with no referrer", async () => {
    const asked: { url: string; referer?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        asked.push({ url, referer: referer(init) });
        return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
      })
    );
    const ctx = context();
    const kept = await savePictures(blocks(4), "https://comic.test/truyen-a/chapter-1", ctx);
    expect(kept.map((b) => b.src)).toEqual(blocks(4).map((b) => b.src));
    expect(ctx.saved).toEqual([]);
    // one picture was asked for, with no referrer: the way the preview and the export ask
    expect(asked).toHaveLength(1);
    expect(asked[0].referer).toBeUndefined();
  });

  it("saves the pictures, fetched with the chapter's address as the referrer, when the site refuses", async () => {
    const log: { url: string; referer?: string }[] = [];
    vi.stubGlobal("fetch", protectedCdn(log));
    const ctx = context();
    const saved = await savePictures(blocks(3), "https://comic.test/truyen-a/chapter-1", ctx);
    expect(saved.map((b) => b.src)).toEqual([1, 2, 3].map((n) => `epub-media/0123456789abcdef/${String(n).padStart(12, "0")}.jpg`));
    // the probe came with no referrer and failed; every download came with the chapter's address
    expect(log[0].referer).toBeUndefined();
    expect(log.slice(1).map((l) => l.referer)).toEqual(Array(3).fill("https://comic.test/truyen-a/chapter-1"));
  });

  it("decides per host: links for the open one, saved pictures for the protected one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) =>
        url.includes("open.test") || referer(init) ? new Response(jpeg) : new Response("", { status: 403 })
      )
    );
    const ctx = context();
    const mixed = [...blocks(2, "open.test"), ...blocks(2, "closed.test")];
    const kept = await savePictures(mixed, "https://comic.test/c", ctx);
    expect(kept.slice(0, 2).map((b) => b.src)).toEqual(blocks(2, "open.test").map((b) => b.src));
    expect(kept.slice(2).every((b) => b.src?.startsWith("epub-media/"))).toBe(true);
    expect(ctx.saved).toHaveLength(2);
  });

  it("does not take an HTML page that says 'no hotlinking' for a picture", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) =>
        referer(init) ? new Response(jpeg) : new Response("<html>Hotlinking is not allowed</html>", { status: 200 })
      )
    );
    const ctx = context();
    const saved = await savePictures(blocks(2), "https://comic.test/c", ctx);
    expect(saved.every((b) => b.src?.startsWith("epub-media/"))).toBe(true);
  });

  it("asks a host once, not once per chapter", async () => {
    const log: { url: string; referer?: string }[] = [];
    vi.stubGlobal("fetch", protectedCdn(log));
    await savePictures(blocks(2), "https://comic.test/c1", context());
    await savePictures(blocks(2), "https://comic.test/c2", context());
    expect(log.filter((l) => l.referer === undefined)).toHaveLength(1);
  });

  it("fails the whole chapter when a picture that must be saved cannot be had", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) =>
        !referer(init) || url.endsWith("/2.jpg") ? new Response("", { status: 403 }) : new Response(jpeg)
      )
    );
    await expect(savePictures(blocks(4), "https://comic.test/c", context())).rejects.toBeInstanceOf(PictureDownloadError);
  });

  it("fetches a saved picture once however many times a chapter repeats it", async () => {
    const log: { url: string; referer?: string }[] = [];
    vi.stubGlobal("fetch", protectedCdn(log));
    const saved = await savePictures([...blocks(2), ...blocks(2)], "https://comic.test/c", context());
    expect(log.filter((l) => l.referer)).toHaveLength(2);
    expect(saved[0].src).toBe(saved[2].src);
  });

  it("leaves text blocks alone", async () => {
    vi.stubGlobal("fetch", protectedCdn());
    const mixed = [{ type: "paragraph" as const, text: "xin chào" }, ...blocks(1)];
    const saved = await savePictures(mixed, "https://comic.test/c", context());
    expect(saved[0]).toEqual({ type: "paragraph", text: "xin chào" });
  });
});
