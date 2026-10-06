import { afterAll, describe, expect, it, vi } from "vitest";

const { dir } = vi.hoisted(() => ({
  dir: require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "agent-crawler-")) as string,
}));
vi.mock("../../config/paths", async (original) => ({ ...(await original<object>()), DATA_DIR: dir }));

const pages: Record<string, string> = {};
vi.mock("../toc/http", () => ({
  fetchWithRetry: vi.fn(async (url: string) => new Response(pages[url] ?? "", { status: pages[url] ? 200 : 404 })),
}));
vi.mock("../renderer", () => ({ renderPageHtml: vi.fn(async () => "") }));

import { LockedContentError } from "../extractor";
import { AgentActivityEvent, onAgentActivity } from "./agentActivity";
import { AgentDocumentPageError, articleViaAgent, chapterViaAgent, hardcodedFrom, hasAgentCrawler, hasArticleCrawler, pageScripts, rewriteCrawler, skeleton, tocViaAgent } from "./agentCrawler";
import { stopSiteRunner } from "./siteSandbox";

const pad = "<!-- -->".repeat(300);
const story = "https://novels.test/story";
pages[story] = `<html><body>${pad}<h1>Story</h1><ul id="l"><li><a href="/story/c1">One</a></li><li><a href="/story/c2">Two</a></li></ul></body></html>`;
const text = "Lorem ipsum dolor sit amet. ".repeat(12);
pages["https://novels.test/story/c1"] = `<html><body>${pad}<h2>One</h2><div id="c"><p>${text}</p></div></body></html>`;
pages["https://novels.test/story/c2"] = `<html><body>${pad}<h2>Two</h2><div id="c"><p>${text}</p></div></body></html>`;
pages["https://novels.test/story/wall"] = `<html><body>${pad}<div id="c"></div></body></html>`;

const TOC = "```js\nasync function toc(ctx) { return { title: ctx.document.querySelector('h1').textContent, chapters: [...ctx.document.querySelectorAll('#l a')].map(a => ({ url: a.href, title: a.textContent })) }; }\n```";
const CHAPTER = "async function chapter(ctx) { const p = ctx.document.querySelector('#c'); return { title: 'T', blocks: [...p.querySelectorAll('p')].map(x => ({ type: 'paragraph', text: x.innerHTML })) }; }";
const STORY_OK = '{"kind":"story","reason":"lists chapters"}';
const agent = (...replies: string[]) => {
  const model = {
    name: "opencode",
    calls: 0,
    prompts: [] as string[],
    complete: async (prompt: string) => {
      model.prompts.push(prompt);
      return replies[Math.min(model.calls++, replies.length - 1)];
    },
  };
  return model;
};
const recorded = () => {
  const events: AgentActivityEvent[] = [];
  const stop = onAgentActivity((e) => events.push(e));
  return { events, stop, kinds: () => events.map((e) => `${e.fn}:${e.kind}`) };
};

afterAll(() => stopSiteRunner());

describe("agent crawler", () => {
  it("analyses the URL first, writes the story code (retrying a bad try), and from then on only runs it", async () => {
    const log = recorded();
    const model = agent(STORY_OK, "async function toc(ctx) { return { chapters: [] }; }", TOC);
    const toc = await tocViaAgent(model, story);
    expect(toc.chapters.map((c) => c.title)).toEqual(["One", "Two"]);
    expect(log.kinds()).toEqual(["url:classify", "url:verdict", "toc:ask", "toc:answer", "toc:retry", "toc:ask", "toc:answer", "toc:saved"]);
    expect(log.events[1]).toMatchObject({ verdict: "story", reason: "lists chapters" });
    expect(log.events.at(-1)).toMatchObject({ kind: "saved", count: 2 });
    expect(await hasAgentCrawler(story)).toBe(true);

    log.events.length = 0;
    const idle = agent("never asked");
    await tocViaAgent(idle, story);
    await tocViaAgent(idle, story);
    expect(idle.calls).toBe(0);
    expect(log.kinds()).toEqual(["toc:reuse"]);
    log.stop();
  });

  it("refuses a URL the agent says is not a story page, and writes nothing", async () => {
    const log = recorded();
    pages["https://chapters.test/c1"] = pages[story];
    const model = agent('{"kind":"chapter","reason":"it is the text of one chapter"}');
    await expect(tocViaAgent(model, "https://chapters.test/c1")).rejects.toThrow(/home page of a story: it is the text of one chapter/);
    expect(model.calls).toBe(1);
    expect(log.kinds()).toEqual(["url:classify", "url:verdict"]);
    expect(await hasAgentCrawler("https://chapters.test/c1")).toBe(false);
    log.stop();
  });

  it("carries on when the agent's verdict cannot be read", async () => {
    pages["https://garbled.test/s"] = pages[story];
    const model = agent("hmm, not sure", TOC);
    expect((await tocViaAgent(model, "https://garbled.test/s")).chapters).toHaveLength(2);
  });

  it("writes chapter code from one chapter, reuses it for others (in parallel too), and reports a login wall as locked", async () => {
    const log = recorded();
    const model = agent(CHAPTER);
    const [one, two] = await Promise.all([
      chapterViaAgent(model, "https://novels.test/story/c1"),
      chapterViaAgent(model, "https://novels.test/story/c2"),
    ]);
    expect(model.calls).toBe(1);
    expect([one.blocks.length, two.blocks.length]).toEqual([1, 1]);
    expect(log.kinds().filter((k) => k === "chapter:saved")).toHaveLength(1);

    log.events.length = 0;
    const walled = agent("never asked");
    // The saved code finds an empty element on a page that shows a wall: the crawl says the code stopped working.
    await expect(chapterViaAgent(walled, "https://novels.test/story/wall")).rejects.toThrow(/stopped working/);
    expect(walled.calls).toBe(0);
    log.stop();
  });

  it("reports a login wall the agent's code recognises as locked, and saves nothing", async () => {
    const log = recorded();
    pages["https://walled.test/c1"] = pages["https://novels.test/story/wall"];
    const model = agent("async function chapter(ctx) { return { locked: true }; }");
    await expect(chapterViaAgent(model, "https://walled.test/c1")).rejects.toBeInstanceOf(LockedContentError);
    expect(log.kinds()).toEqual(["chapter:ask", "chapter:answer", "chapter:locked"]);
    expect(await hasAgentCrawler("https://walled.test/c1")).toBe(false);
    log.stop();
  });

  it("never rewrites by itself: saved code that stops working is reported with the way to rewrite it", async () => {
    const log = recorded();
    const broken = { ...pages };
    pages[story] = "<html><body><p>The site changed</p></body></html>";
    const model = agent("never asked");
    await expect(tocViaAgent(model, story)).rejects.toThrow(/stopped working .* rewrite it with the agent/);
    expect(model.calls).toBe(0);
    expect(log.kinds()).toEqual(["toc:stale"]);
    pages[story] = broken[story];
    log.stop();
  });

  it("rewrites on request, keeping the old code when the new one fails", async () => {
    const log = recorded();
    const failing = agent("async function toc(ctx) { return { chapters: [] }; }");
    await expect(rewriteCrawler(failing, { storyUrl: story, chapterUrl: "https://novels.test/story/c1" })).rejects.toThrow(/could not write a crawler/);
    expect(failing.calls).toBe(3);
    expect((await tocViaAgent(agent("never asked"), story)).chapters).toHaveLength(2);

    log.events.length = 0;
    const better = agent(TOC.replace("a.href", "a.href + '?v=2'"), CHAPTER);
    await rewriteCrawler(better, { storyUrl: story, chapterUrl: "https://novels.test/story/c1" });
    expect(log.kinds().filter((k) => k.endsWith(":saved"))).toEqual(["toc:saved", "chapter:saved"]);
    expect((await tocViaAgent(agent("never asked"), story)).chapters[0].url).toContain("?v=2");
    log.stop();
  });

  it("reports failed after every attempt, with the last reason", async () => {
    const log = recorded();
    pages["https://other.test/story"] = pages[story];
    const model = agent(STORY_OK, "not code at all");
    await expect(tocViaAgent(model, "https://other.test/story")).rejects.toThrow(/could not write a crawler for other.test/);
    expect(model.calls).toBe(4);
    expect(log.events.filter((e) => e.kind === "retry")).toHaveLength(2);
    expect(log.events.at(-1)).toMatchObject({ kind: "failed", host: "other.test" });
    log.stop();
  });

  describe("a list whose items do not share the same markup", () => {
    // Like truyenqq.com.vn: the first items' links carry a class, the later ones have none.
    const item = (n: number, withClass: boolean) => `<div class="item"><div class="item-name"><a href="/mixed/chapter-${n}"${withClass ? ' class="chapter-name"' : ""}>Chapter ${n}</a></div></div>`;
    const html = `<html><body>${pad}<h1>Mixed</h1><div id="chapter-list">${[10, 9, 8, 7].map((n) => item(n, true)).join("")}${[6, 5, 4, 3, 2, 1].map((n) => item(n, false)).join("")}</div></body></html>`;
    const byClass = "async function toc(ctx) { return { title: 'Mixed', chapters: [...ctx.document.querySelectorAll('a.chapter-name')].map(a => ({ url: a.href, title: a.textContent })) }; }";
    const byAddress = "async function toc(ctx) { return { title: 'Mixed', chapters: [...ctx.document.querySelectorAll('a[href*=\"/chapter-\"]')].map(a => ({ url: a.href, title: a.textContent })) }; }";

    it("shows the agent the difference instead of folding the items together", () => {
      const outline = skeleton(html, "https://mixed.test/mixed");
      expect(outline).toContain("a.chapter-name");
      expect(outline).toMatch(/<a href="\/mixed\/chapter-6">/);
    });

    it("rejects code that misses links of the same shape, telling the agent why, and takes the code that gets them all", async () => {
      pages["https://mixed.test/mixed"] = html;
      const log = recorded();
      const model = agent(STORY_OK, byClass, byAddress);
      const toc = await tocViaAgent(model, "https://mixed.test/mixed");
      expect(toc.chapters).toHaveLength(10);
      const retry = log.events.find((e) => e.kind === "retry");
      expect(retry?.reason).toMatch(/returned 4 chapters, but this page has 6 more links addressed like \/mixed\/chapter-#/);
      log.stop();
    });

    it("treats saved code that leaves chapters out as broken instead of crawling a truncated story, and never asks the agent itself", async () => {
      const log = recorded();
      pages["https://old.test/mixed"] = html.replace(/\/mixed\//g, "/mixed/");
      // The code that was saved before the completeness check existed: written for the class of the first items.
      const { DATA_DIR } = await import("../../config/paths");
      const fs = await import("node:fs/promises");
      await fs.mkdir(`${DATA_DIR}/agent-crawlers`, { recursive: true });
      await fs.writeFile(`${DATA_DIR}/agent-crawlers/old.test.toc.js`, byClass);
      const model = agent("never asked");
      await expect(tocViaAgent(model, "https://old.test/mixed")).rejects.toThrow(/stopped working \(toc\(\) returned 4 chapters, but this page has 6 more links/);
      expect(model.calls).toBe(0);
      expect(log.kinds()).toEqual(["toc:stale"]);
      log.stop();
    });

    it("does not count links of a list that continues on another page", async () => {
      const two = `<html><body>${pad}<h1>Paged</h1><div id="l"><a href="/paged/chapter-2">Two</a><a href="/paged/chapter-1">One</a><a class="next" href="/paged?page=2">next</a></div></body></html>`;
      pages["https://paged.test/paged"] = two;
      const model = agent(STORY_OK, "async function toc(ctx) { return { title: 'P', chapters: [...ctx.document.querySelectorAll('#l a[href*=\"/chapter-\"]')].map(a => ({ url: a.href, title: a.textContent })) }; }");
      expect((await tocViaAgent(model, "https://paged.test/paged")).chapters).toHaveLength(2);
    });

    it("does not count a wiki's menu and file links, which share the chapters' address shape", async () => {
      const wiki = `<html><body>${pad}<div id="menu"><a href="/w/index.php?title=Main">Main</a><a href="/w/index.php?title=Special:Recent">Recent</a></div><h1>Wiki</h1><div id="content"><ul><li><a href="/w/index.php?title=Vol_1">Vol 1</a></li><li><a href="/w/index.php?title=Vol_2">Vol 2</a></li></ul><div class="thumb"><a href="/w/index.php?title=File:Cover.jpg">cover</a></div></div></body></html>`;
      pages["https://wiki.test/w/index.php?title=Series"] = wiki;
      const model = agent(STORY_OK, "async function toc(ctx) { return { title: 'W', chapters: [...ctx.document.querySelectorAll('#content li a')].map(a => ({ url: a.href, title: a.textContent })) }; }");
      expect((await tocViaAgent(model, "https://wiki.test/w/index.php?title=Series")).chapters).toHaveLength(2);
    });
  });

  describe("a comic that loads its pictures lazily", () => {
    // Like sangchanhteam.com: the first pictures carry a real src, the rest a placeholder and the real address in data-original-src.
    const eager = (n: number) => `<div class="pg"><img class="p" alt="" src="/uploads/m/1/000${n}.jpg"></div>`;
    const lazy = (n: number) => `<div class="pg"><img class="p" alt="" data-original-src="/uploads/m/1/00${n}.jpg" src="data:image/svg+xml,%3Csvg%20xmlns%3D%22x%22%3E"></div>`;
    const html = `<html><body>${pad}<h1>Ch 1</h1><div id="reader">${eager(1)}${eager(2)}${[3, 4, 5, 6, 7].map(lazy).join("")}</div><aside><img src="/uploads/m/1/0099.jpg"></aside></body></html>`;
    const url = "https://comic.test/m/chap-1/";
    const bySrc = "async function chapter(ctx) { return { title: 'C', blocks: [...ctx.document.querySelectorAll('#reader img')].filter(i => i.getAttribute('src') && !i.getAttribute('src').startsWith('data:')).map(i => ({ type: 'image', src: new URL(i.getAttribute('src'), ctx.url).href, alt: '' })) }; }";
    const byAttrs = "async function chapter(ctx) { return { title: 'C', blocks: [...ctx.document.querySelectorAll('#reader img')].map(i => { const v = i.getAttribute('data-original-src') || i.getAttribute('src'); return { type: 'image', src: new URL(v, ctx.url).href, alt: '' }; }) }; }";

    it("shows the agent each picture's attributes, keeping the lazy ones apart from the eager ones", () => {
      const outline = skeleton(html, url);
      expect(outline).toContain('data-original-src="/uploads/m/1/003.jpg"');
      expect(outline).toContain('src="data:…"');
      expect(outline).toContain('src="/uploads/m/1/0001.jpg"');
    });

    it("rejects code that only takes src (the first pictures), telling the agent about the other attribute", async () => {
      pages[url] = html;
      const log = recorded();
      const model = agent(bySrc, byAttrs);
      const chapter = await chapterViaAgent(model, url);
      expect(chapter.blocks).toHaveLength(7);
      expect(log.events.find((e) => e.kind === "retry")?.reason).toMatch(/returned 2 pictures, but the same list on this page has 5 more/);
      // The agent is told which attribute to look at.
      expect(model.prompts[1]).toMatch(/Your previous code failed: chapter\(\) returned 2 pictures[\s\S]*data-original-src/);
      log.stop();
    });

    it("treats saved code that leaves pictures out as broken, without asking the agent", async () => {
      const { DATA_DIR } = await import("../../config/paths");
      const fs = await import("node:fs/promises");
      pages["https://old-comic.test/m/chap-1/"] = html;
      await fs.mkdir(`${DATA_DIR}/agent-crawlers`, { recursive: true });
      await fs.writeFile(`${DATA_DIR}/agent-crawlers/old-comic.test.chapter.js`, bySrc);
      const model = agent("never asked");
      await expect(chapterViaAgent(model, "https://old-comic.test/m/chap-1/")).rejects.toThrow(/stopped working \(chapter\(\) returned 2 pictures/);
      expect(model.calls).toBe(0);
    });

    it("ignores pictures in a sidebar", async () => {
      const side = `<html><body>${pad}<h1>C</h1><div id="reader">${eager(1)}${eager(2)}</div><aside>${[3, 4, 5, 6].map(lazy).join("")}</aside></body></html>`;
      pages["https://side.test/m/chap-1/"] = side;
      const model = agent("async function chapter(ctx) { return { title: 'C', blocks: [...ctx.document.querySelectorAll('#reader img')].map(i => ({ type: 'image', src: new URL(i.getAttribute('src'), ctx.url).href, alt: '' })) }; }");
      expect((await chapterViaAgent(model, "https://side.test/m/chap-1/")).blocks).toHaveLength(2);
    });
  });

  describe("code must work for the whole site, not for the page it was written from", () => {
    it("finds a story's slug or id copied into the code, but not words every address of the site shares", () => {
      const url = "https://novels.test/truyen/the-story-of-a-hero/chap-12/";
      expect(hardcodedFrom("a[href*='/the-story-of-a-hero/chap-']", url)).toBe("the-story-of-a-hero");
      expect(hardcodedFrom("x.includes('chap-12')", url)).toBe("chap-12");
      expect(hardcodedFrom("a[href*='/truyen/'] a[href*='/chap-']", url)).toBeNull();
      expect(hardcodedFrom("const id = '3374';", "https://c.test/m/3374/1/")).toBe("3374");
      expect(hardcodedFrom("anything", "https://c.test/")).toBeNull();
    });

    it("rejects code that hardcodes the story, telling the agent, and accepts the general version", async () => {
      pages["https://dyn.test/truyen/my-special-story-name"] = pages[story];
      const hardcoded = "async function toc(ctx) { return { title: 'x', chapters: [...ctx.document.querySelectorAll('#l a[href*=\"/story/\"]')].filter(a => a.href.includes('my-special-story-name') || true).map(a => ({ url: a.href, title: a.textContent })) }; }";
      const log = recorded();
      const model = agent(STORY_OK, hardcoded, TOC);
      const toc = await tocViaAgent(model, "https://dyn.test/truyen/my-special-story-name");
      expect(toc.chapters).toHaveLength(2);
      expect(log.events.find((e) => e.kind === "retry")?.reason).toMatch(/contains "my-special-story-name", copied from this page's own address/);
      expect(model.prompts[1]).toMatch(/never put anything in it that belongs to the page you were shown/);
      log.stop();
    });

    it("keeps examples taken from particular sites out of what the agent is told", async () => {
      const model = agent(STORY_OK, TOC);
      pages["https://prompt.test/s/story"] = pages[story];
      await tocViaAgent(model, "https://prompt.test/s/story");
      for (const prompt of model.prompts) expect(prompt).not.toMatch(/data-original|data-src|data-lazy|\/chapter-|\/chap-/);
    });
  });

  describe("a list the page's script loads", () => {
    const url = "https://ajax.test/read/55501/";
    const html = `<html><head><script src="/js/app.js"></script><script>$(function(){ var bid = $("#bid").val(); $.ajax({ type: "POST", url: "/novel/html/", data: {bid: bid}, success: function(r){ clist = r; } }); });</script></head><body>${pad}<input id="bid" type="hidden" value="55501"><h1>Ajax story</h1><ul class="u-chapter"></ul></body></html>`;

    it("shows the agent the page's scripts, which the outline leaves out", () => {
      expect(skeleton(html, url)).not.toContain("novel/html");
      const scripts = pageScripts(html, url);
      expect(scripts).toContain("External scripts: /js/app.js");
      expect(scripts).toContain('url: "/novel/html/"');
      expect(pageScripts("<html><body><p>x</p></body></html>", url)).toBe("(none)");
    });

    it("takes a list from a POST the page's own script makes, reading the id from the page and not from the address", async () => {
      pages[url] = html;
      const mocked = (await import("../toc/http")).fetchWithRetry as unknown as ReturnType<typeof vi.fn>;
      const original = mocked.getMockImplementation();
      mocked.mockImplementation(async (target: string, init?: RequestInit) =>
        init?.method === "POST"
          ? new Response(`<li><a href="/read/55501/p1.html">One</a></li><li><a href="/read/55501/p2.html">Two</a></li><li><a href="/read/55501/p3.html">Three</a></li>`)
          : new Response(pages[target] ?? "", { status: pages[target] ? 200 : 404 })
      );
      const code = "async function toc(ctx) { const bid = ctx.document.querySelector('#bid').value; const doc = ctx.parseHtml(await ctx.post('/novel/html/', { bid }), ctx.url); return { title: ctx.document.querySelector('h1').textContent, chapters: [...doc.querySelectorAll('a')].map(a => ({ url: a.href, title: a.textContent })) }; }";
      const model = agent(STORY_OK, code);
      const toc = await tocViaAgent(model, url);
      expect(toc.chapters.map((c) => c.title)).toEqual(["One", "Two", "Three"]);
      expect(model.prompts[1]).toContain('url: "/novel/html/"');
      expect(model.prompts[1]).toMatch(/ctx\.post\(url/);
      mocked.mockImplementation(original!);
    });
  });

  describe("a reply that is not code", () => {
    it("tells the agent it has no tools, instead of judging its attempted tool calls as code", async () => {
      pages["https://notcode.test/read/12345/"] = pages[story];
      const log = recorded();
      const calls = `<invoke name="bash"><parameter name="command">curl -s https://notcode.test/read/12345/ -o /tmp/page.html</parameter></invoke>`;
      const model = agent(STORY_OK, calls, TOC);
      expect((await tocViaAgent(model, "https://notcode.test/read/12345/")).chapters).toHaveLength(2);
      const retry = log.events.find((e) => e.kind === "retry");
      expect(retry?.reason).toMatch(/holds no `async function toc\(ctx\)`/);
      expect(retry?.reason).not.toMatch(/copied from this page's own address/);
      expect(model.prompts[1]).toMatch(/You cannot run commands, open pages or search anything/);
      log.stop();
    });
  });
});

describe("a page that is one whole text", () => {
  const body = "Call me Ishmael. Some years ago, never mind how long precisely. ".repeat(6);
  const book = "https://library.test/books/whale.html";
  pages[book] = `<html lang="en"><body>${pad}<h1>Moby</h1><div class="chapter"><h2>One</h2><p>${body}</p></div><div class="chapter"><h2>Two</h2><p>${body}</p></div></body></html>`;
  const other = "https://library.test/books/other.html";
  pages[other] = `<html lang="en"><body>${pad}<h1>Other</h1><div class="chapter"><h2>Only</h2><p>${body}</p></div></body></html>`;
  const ARTICLE =
    "async function article(ctx) { return { title: ctx.document.querySelector('h1').textContent, chapters: [...ctx.document.querySelectorAll('.chapter')].map(c => ({ title: c.querySelector('h2').textContent, blocks: [...c.querySelectorAll('p')].map(p => ({ type: 'paragraph', text: p.innerHTML })) })) }; }";

  it("is told apart from a story by the first classification, so the caller can read it as a text", async () => {
    const model = agent('{"kind":"document","reason":"a whole book on one page"}');
    await expect(tocViaAgent(model, book)).rejects.toBeInstanceOf(AgentDocumentPageError);
    expect(await hasAgentCrawler(book)).toBe(false);
  });

  it("writes article code, splits the text into chapters with the page's language, and reuses the code for another page", async () => {
    const log = recorded();
    const model = agent("async function article(ctx) { return { chapters: [] }; }", ARTICLE);
    const read = await articleViaAgent(model, book);
    expect(read.title).toBe("Moby");
    expect(read.language).toBe("en");
    expect(read.chapters.map((c) => c.title)).toEqual(["One", "Two"]);
    expect(log.kinds()).toEqual(["article:ask", "article:answer", "article:retry", "article:ask", "article:answer", "article:saved"]);
    expect(await hasArticleCrawler(other)).toBe(true);

    const again = await articleViaAgent(agent("never asked"), other);
    expect(again.chapters.map((c) => c.title)).toEqual(["Only"]);
    log.stop();
  });

  it("rejects code that leaves most of a long text out", async () => {
    const long = "https://long.test/book.html";
    const paragraphs = Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i}. ${"word ".repeat(60)}</p>`).join("");
    pages[long] = `<html><body>${pad}<h1>Long</h1><div id="a">${paragraphs}</div></body></html>`;
    const firstOnly =
      "async function article(ctx) { return { title: 'L', chapters: [{ title: 'A', blocks: [...ctx.document.querySelectorAll('#a p')].slice(0, 2).map(p => ({ type: 'paragraph', text: p.innerHTML })) }] }; }";
    const all =
      "async function article(ctx) { return { title: 'L', chapters: [{ title: 'A', blocks: [...ctx.document.querySelectorAll('#a p')].map(p => ({ type: 'paragraph', text: p.innerHTML })) }] }; }";
    const model = agent(firstOnly, all);
    const read = await articleViaAgent(model, long);
    expect(model.calls).toBe(2);
    expect(model.prompts[1]).toContain("left most of the text out");
    expect(read.chapters[0].blocks).toHaveLength(40);
  });
});
