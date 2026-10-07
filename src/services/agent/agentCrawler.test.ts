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
import { AgentDocumentPageError, articleViaAgent, chapterViaAgent, hardcodedFrom, hasAgentCrawler, toArticle, partialList, hasArticleCrawler, pageScripts, rewriteCrawler, skeleton, tocViaAgent } from "./agentCrawler";
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

  it("reads a URL the agent says is not a story page as a page of content, and writes nothing", async () => {
    const log = recorded();
    pages["https://chapters.test/c1"] = pages[story];
    const model = agent('{"kind":"chapter","reason":"it is the text of one chapter"}');
    await expect(tocViaAgent(model, "https://chapters.test/c1")).rejects.toBeInstanceOf(AgentDocumentPageError);
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

    it("rejects code that reads only the first of several pages of the list, and takes the code that reads them all", async () => {
      const pager = [2, 3, 4].map((n) => `<a href="/long?page=${n}">${n}</a>`).join("");
      const list = (from: number, host = "") => [from, from + 1].map((n) => `<a href="${host}/long/chapter-${n}">C${n}</a>`).join("");
      pages["https://long.test/long"] = `<html><body>${pad}<h1>Long</h1><div id="l">${list(1)}</div>${pager}</body></html>`;
      // The later pages name the site's mirror domain, as metruyenhotvn.com's do.
      pages["https://long.test/long?page=2"] = `<html><body><div id="l">${list(3, "https://mirror.test")}</div></body></html>`;
      pages["https://long.test/long?page=3"] = `<html><body><div id="l">${list(5, "https://mirror.test")}</div></body></html>`;
      pages["https://long.test/long?page=4"] = `<html><body><div id="l">${list(7, "https://mirror.test")}</div></body></html>`;
      const firstOnly = "async function toc(ctx) { return { title: 'L', chapters: [...ctx.document.querySelectorAll('#l a')].map(a => ({ url: a.href, title: a.textContent })) }; }";
      const all =
        "async function toc(ctx) { const out = []; const take = (d) => d.querySelectorAll('#l a').forEach(a => out.push({ url: new URL(new URL(a.href).pathname, ctx.url).href, title: a.textContent })); take(ctx.document);" +
        " for (let p = 2; p <= 4; p++) take(ctx.parseHtml(await ctx.fetchText(ctx.url + '?page=' + p), ctx.url)); return { title: 'L', chapters: out }; }";
      const log = recorded();
      const toc = await tocViaAgent(agent(STORY_OK, firstOnly, all), "https://long.test/long");
      expect(toc.chapters).toHaveLength(8);
      expect(log.events.find((e) => e.kind === "retry")?.reason).toMatch(/only the 2 chapters this page itself lists.*3 more pages/);
      log.stop();
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
      expect(model.prompts[1]).toMatch(/failed: chapter\(\) returned 2 pictures[\s\S]*data-original-src/);
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
      expect(hardcodedFrom("book: '12345'", "https://c.test/read?book=12345")).toBe("12345");
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

  it("turns a list in a paragraph into one bullet paragraph per item, nested ones indented", () => {
    const html = "<ul><li><p>One <b>bold</b></p></li><li>Two<ol><li>Sub</li></ol></li></ul>";
    const intro = "Intro text that is long enough to count as the page's content. ".repeat(5);
    const read = toArticle({ chapters: [{ title: "A", blocks: [{ type: "paragraph", text: `${intro}${html}Tail` }] }] }, "https://a.test/p", "");
    expect(read.chapters[0].blocks.map((b) => b.text)).toEqual([
      intro.trim(),
      "• One <b>bold</b>",
      "• Two",
      "\u00a0\u00a01. Sub",
      "Tail",
    ]);
  });

  it("keeps a table or code block of an article as one html block", () => {
    const intro = "Intro text that is long enough to count as the page's content. ".repeat(5);
    const read = toArticle({ chapters: [{ title: "A", blocks: [
      { type: "paragraph", text: intro },
      { type: "html", text: '<table id="t" class="w" onclick="x()"><tr><th scope="col">A</th><td colspan="2" data-x="1">1</td></tr></table>' },
      { type: "html", text: "<pre>a &lt; b\n  c</pre>" },
    ] }] }, "https://a.test/p", "");
    expect(read.chapters[0].blocks.slice(1)).toEqual([
      { type: "html", text: '<table><tbody><tr><th scope="col">A</th><td colspan="2">1</td></tr></tbody></table>' },
      { type: "html", text: "<pre>a &lt; b\n  c</pre>" },
    ]);
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

describe("what the agent is told about earlier tries", () => {
  const url = "https://learn.test/learn";
  const html = `<html><body>${pad}<h1>L</h1><ul id="l"><li><a href="/learn/c1">One</a></li><li><a href="/learn/c2">Two</a></li></ul></body></html>`;
  const bad = (n: number) => `async function toc(ctx) { /* attempt ${n} */ return { title: 'L', chapters: [] }; }`;
  const good = "async function toc(ctx) { return { title: 'L', chapters: [...ctx.document.querySelectorAll('#l a')].map(a => ({ url: a.href, title: a.textContent })) }; }";

  it("shows every earlier try's code and why it failed, not just the last", async () => {
    pages[url] = html;
    const model = agent(STORY_OK, bad(1), bad(2), good);
    await tocViaAgent(model, url);
    const third = model.prompts[3];
    expect(third).toMatch(/Do not repeat these approaches/);
    expect(third).toContain("attempt 1");
    expect(third).toContain("attempt 2");
    expect(third.match(/failed: toc\(\) returned no chapter/g)).toHaveLength(2);
  });

  it("starts a rewrite from the saved code, why it stopped working, and the person's note", async () => {
    const { DATA_DIR } = await import("../../config/paths");
    const fs = await import("node:fs/promises");
    await fs.mkdir(`${DATA_DIR}/agent-crawlers`, { recursive: true });
    await fs.writeFile(`${DATA_DIR}/agent-crawlers/learn.test.toc.js`, bad(0));
    const model = agent(good);
    await rewriteCrawler(model, { storyUrl: url, note: "only 50 chapters" });
    expect(model.prompts[0]).toContain("attempt 0");
    expect(model.prompts[0]).toContain("only 50 chapters");
  });
});

describe("a list that is only part of what its own numbers say", () => {
  const list = (titles: string[]) => ({ title: "T", chapters: titles.map((t, i) => ({ url: `https://a.test/s/${i}`, title: t })) });
  it("is partial when the titles reach chapter 735 and only 6 are listed", () => {
    const toc = list(["Chương 1 - A", "Chương 731 - B", "Chương 732 - C", "Chương 733 - D", "Chương 734 - E", "Chương 735 - F"]);
    expect(partialList(toc)).toMatch(/returned 6 chapters, but their titles go up to chapter 735/);
  });
  it("accepts a full list, one with gaps, volumes that restart their numbers, and short stories", () => {
    expect(partialList(list(Array.from({ length: 1917 }, (_, i) => `Chương ${i + 1 + (i > 676 ? 1 : 0)}`)))).toBeNull();
    expect(partialList(list([...Array.from({ length: 30 }, (_, i) => `Chapter ${i + 1}`), ...Array.from({ length: 30 }, (_, i) => `Chapter ${i + 1}`)]))).toBeNull();
    expect(partialList(list(["Chương 1", "Chương 12"]))).toBeNull();
    expect(partialList(list(["Prologue", "Epilogue"]))).toBeNull();
  });
});

describe("a list the page's own script requests page by page", () => {
  const url = "https://pager.test/truyen/story";
  const buttons = [2, 3, 33].map((n) => `<button>${n}</button>`).join("");
  const html = `<html><head><script src="/_next/static/chunks/app.js"></script></head><body>${pad}<h1>S</h1><div id="box"><ol id="l"><li><a href="/truyen/story/1-a">C1</a></li><li><a href="/truyen/story/2-b">C2</a></li></ol><div>${buttons}</div></div></body></html>`;
  const firstOnly = "async function toc(ctx) { return { title: 'S', chapters: [...ctx.document.querySelectorAll('#l a')].map(a => ({ url: a.href, title: a.textContent })) }; }";
  const viaApi =
    "async function toc(ctx) { const out = []; for (let p = 0; p < 2; p++) { const j = await ctx.fetchJson('/api/truyen/story/chuong?page=' + p + '&size=2'); for (const c of j.data) out.push({ url: new URL('/truyen/story/' + c.slug, ctx.url).href, title: c.ten }); } return { title: 'S', chapters: out }; }";

  it("shows the agent the request found in the site's script files, and rejects a list that ignores the pager", async () => {
    pages[url] = html;
    pages["https://pager.test/_next/static/chunks/app.js"] = "var x=1;async function load(e,a=0,l=50){return get(`/truyen/${e}/chuong`,{params:{page:a,size:l}})};";
    pages["https://pager.test/api/truyen/story/chuong?page=0&size=2"] = JSON.stringify({ data: [{ slug: "1-a", ten: "Chương 1" }, { slug: "2-b", ten: "Chương 2" }] });
    pages["https://pager.test/api/truyen/story/chuong?page=1&size=2"] = JSON.stringify({ data: [{ slug: "3-c", ten: "Chương 3" }, { slug: "4-d", ten: "Chương 4" }] });
    const log = recorded();
    const model = agent(STORY_OK, firstOnly, viaApi);
    const toc = await tocViaAgent(model, url);
    expect(toc.chapters).toHaveLength(4);
    expect(model.prompts[1]).toContain("params:{page:a,size:l}");
    expect(model.prompts[1]).toContain("/truyen/${e}/chuong");
    expect(log.events.find((e) => e.kind === "retry")?.reason).toMatch(/only the 2 chapters this page itself lists.*more pages/);
    log.stop();
  });
});
