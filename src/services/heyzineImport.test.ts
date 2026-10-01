import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  HeyzineNotFoundError,
  HeyzineUnavailableError,
  heyzineId,
  importHeyzine,
  pdfFileFromPage,
} from "./heyzineImport";

// The flipbook page always names the PDF it renders; pdf-outline.pdf stands in for it.
const PDF = readFileSync(path.join(__dirname, "__fixtures__", "pdf-outline.pdf"));
const PDF_URL = "https://cdnm.heyzine.com/files/uploaded/v2/19b8fa685a6c345fb0b1c195cad7e96240d363f7.pdf";
const SHELL_URL = "https://heyzine.com/flip-book/19b8fa685a.html";

const shellPage = (html?: string) =>
  new Response(html ?? `<script>$( () => { heyzine.load('${PDF_URL}', flipbookcfg); });</script>`, {
    status: 200,
    headers: { "content-type": "text/html" },
  });

// One mock for both calls an import makes: the flipbook shell, then the PDF it names.
function heyzineFetch(options: { shell?: () => Response; pdf?: () => Response } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://heyzine.com/flip-book/")) return options.shell?.() ?? shellPage();
    if (options.pdf) return options.pdf();
    return new Response(new Uint8Array(PDF), { status: 200, headers: { "content-type": "application/pdf" } });
  });
}

describe("heyzineId", () => {
  it("reads the id from a flipbook URL", () => {
    expect(heyzineId("https://heyzine.com/flip-book/19b8fa685a.html")).toBe("19b8fa685a");
    expect(heyzineId("https://www.heyzine.com/flip-book/19b8fa685a.html#page/6")).toBe("19b8fa685a");
    expect(heyzineId("https://heyzine.com/flip-book/8088bfc321.html?foo=1")).toBe("8088bfc321");
  });

  it("rejects other pages of the same site and any other host", () => {
    expect(heyzineId("https://heyzine.com/flip-book")).toBeUndefined();
    expect(heyzineId("https://heyzine.com/flip-book/19b8fa685a")).toBeUndefined();
    expect(heyzineId("https://cdnm.heyzine.com/files/uploaded/x.pdf")).toBeUndefined();
    expect(heyzineId("https://example.com/flip-book/19b8fa685a.html")).toBeUndefined();
    expect(heyzineId("not a url")).toBeUndefined();
  });
});

describe("pdfFileFromPage", () => {
  it("reads the PDF URL out of the heyzine.load call", () => {
    expect(pdfFileFromPage(shellPageHtml())).toBe(PDF_URL);
  });

  it("has no file when the page ships no flipbook (password-protected or removed)", () => {
    expect(pdfFileFromPage("<html><body><form class='password'>...</form></body></html>")).toBeUndefined();
    expect(pdfFileFromPage("<html><body>Page not found</body></html>")).toBeUndefined();
  });

  it("only accepts a PDF on the site's own CDN", () => {
    expect(pdfFileFromPage(`<script>heyzine.load('https://evil.example/x.pdf', flipbookcfg)</script>`)).toBeUndefined();
    expect(pdfFileFromPage(`<script>heyzine.load('http://cdnm.heyzine.com/x.pdf', flipbookcfg)</script>`)).toBeUndefined();
  });

  function shellPageHtml() {
    return `<script>PDFJS_WORKER = 'x'; $( () => { heyzine.load('${PDF_URL}', flipbookcfg).then(() => {}); });</script>`;
  }
});

describe("importHeyzine", () => {
  it("downloads the PDF the flipbook renders and parses it into chapters", async () => {
    const fetchImpl = heyzineFetch();
    const book = await importHeyzine("19b8fa685a", {
      fetchImpl,
      storeImage: (_bytes: Buffer, extension: string) => `epub-media/${extension}`,
    });

    expect(book.title).toBe("Sách PDF");
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      "Chương 1: Khởi đầu",
      "Chương 2: Tiếp",
      "Chương 3: Kết",
    ]);
    // The flipbook shell first, then the PDF it names.
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual([SHELL_URL, PDF_URL]);
  });

  it("reports a flipbook the site does not serve", async () => {
    await expect(
      importHeyzine("0000000000", { fetchImpl: heyzineFetch({ shell: () => new Response("", { status: 404 }) }) })
    ).rejects.toBeInstanceOf(HeyzineNotFoundError);
    await expect(
      importHeyzine("0000000000", { fetchImpl: heyzineFetch({ shell: () => shellPage("Page not found") }) })
    ).rejects.toBeInstanceOf(HeyzineNotFoundError);
  });

  it("refuses a flipbook that exposes no public PDF", async () => {
    await expect(
      importHeyzine("19b8fa685a", { fetchImpl: heyzineFetch({ shell: () => shellPage("<p>Enter password</p>") }) })
    ).rejects.toBeInstanceOf(HeyzineUnavailableError);
  });

  it("refuses a PDF over the size cap instead of buffering it", async () => {
    await expect(
      importHeyzine("19b8fa685a", {
        fetchImpl: heyzineFetch({
          pdf: () => new Response(new Uint8Array(PDF), { headers: { "content-length": "999999999" } }),
        }),
        maxFileBytes: 1024,
      })
    ).rejects.toThrow();
  });
});
