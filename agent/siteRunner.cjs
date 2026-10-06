"use strict";
/**
 * Child process that runs crawler code a local agent wrote for one site (see
 * src/services/agent/siteSandbox.ts, which starts it with Node's permission model: no file writes,
 * no child processes, no native bindings). The code comes from a model that read untrusted page
 * text, so on top of that this file takes away what could still reach the network or load more
 * code, and gives the code one way out: `ctx.fetchText / fetchJson / render`, which ask the parent,
 * which only answers for the site being crawled.
 *
 * Not a hard security boundary — Node has no network permission before v25 — but the code gets no
 * network API, no `require`, no `import()`, no string-to-code, no secrets in the environment.
 */
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const send = process.send.bind(process);
const waiting = new Map();
let nextId = 0;

function ask(run, kind, url, body) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve, reject });
    send({ type: "fetch", id, run, kind, url: String(url), body });
  });
}

// A form body: plain values only, so nothing of the code's own objects crosses over.
const formBody = (data) =>
  new URLSearchParams(Object.entries(data || {}).map(([key, value]) => [String(key), String(value)])).toString();

function makeContext(run, url, html, windows) {
  const parse = (source, base) => {
    const dom = new JSDOM(String(source), { url: String(base || url) });
    windows.push(dom.window);
    return dom.window.document;
  };
  return {
    url,
    html,
    document: parse(html, url),
    parseHtml: parse,
    fetchText: (target) => ask(run, "text", target),
    fetchJson: async (target) => JSON.parse(await ask(run, "text", target)),
    render: (target) => ask(run, "render", target),
    post: (target, data) => ask(run, "post", target, formBody(data)),
    postJson: async (target, data) => JSON.parse(await ask(run, "post", target, formBody(data))),
  };
}

// Strict mode keeps the code from walking up `arguments.callee.caller`; the script is compiled
// without an import callback, so `import()` inside it fails.
function compile(code, fn) {
  const script = new vm.Script(`(function () {"use strict";\n${code}\n;return typeof ${fn} === "function" ? ${fn} : undefined;})()`, {
    filename: `site-${fn}.js`,
  });
  return script.runInThisContext();
}

async function execute(message) {
  const windows = [];
  try {
    const entry = compile(message.code, message.fn);
    if (!entry) throw new Error(`The code defines no ${message.fn}() function`);
    const value = await entry(makeContext(message.run, message.url, message.html, windows));
    return JSON.parse(JSON.stringify(value ?? null));
  } finally {
    for (const window of windows) window.close();
  }
}

process.on("message", async (message) => {
  if (message.type === "fetched") {
    const entry = waiting.get(message.id);
    waiting.delete(message.id);
    if (entry) message.ok ? entry.resolve(message.body) : entry.reject(new Error(message.error));
    return;
  }
  if (message.type !== "run") return;
  try {
    send({ type: "result", run: message.run, value: await execute(message) });
  } catch (err) {
    send({ type: "error", run: message.run, message: String((err && err.message) || err).slice(0, 500) });
  }
});

// ---- lock down, after everything this file needs has been loaded ----
const drop = (target, key) => {
  try {
    delete target[key];
  } catch {
    /* already gone */
  }
};
for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "Request", "Response", "eval"]) drop(globalThis, name);
for (const name of ["getBuiltinModule", "mainModule", "send", "binding", "dlopen"]) drop(process, name);
// jsdom's selector engine (nwsapi) compiles selectors with `new Function`, so the constructor stays
// usable for that one caller and nobody else: the frame that called it must be inside nwsapi. A stack
// that cannot be read (the code changed Error.stackTraceLimit) fails closed.
const RealFunction = Function;
const guarded = function Function(...args) {
  const caller = (new Error().stack || "").split("\n")[2] || "";
  if (!/node_modules[\\/]nwsapi[\\/]/.test(caller)) throw new Error("Building code from text is not allowed here");
  return RealFunction(...args);
};
guarded.prototype = RealFunction.prototype;
for (const sample of [function () {}, async function () {}, function* () {}, async function* () {}]) {
  Object.defineProperty(Object.getPrototypeOf(sample), "constructor", { value: guarded });
}
globalThis.Function = guarded;
// The check above reads `error.stack`; the code must not be able to rewrite how it is built.
Object.defineProperty(Error, "prepareStackTrace", { value: undefined, writable: false, configurable: false });

send({ type: "ready" });
