import { describe, expect, it, vi } from "vitest";
import type { SiteSession } from "./siteSession";
import { detailsHtml, jsiaBody, JPEG } from "./__fixtures__/archiveBorrowFixtures";
import { readerConfig } from "./archiveBorrow";
import { ArchiveLoanError, ArchiveRestrictedError, ArchiveTooManyPagesError } from "./archiveErrors";
import { ensureLoan, loanExpiryEpoch, renewLoan, returnLoan } from "./archiveBorrow";
import { captureChapters, importBorrowedBook } from "./archiveBorrow";

const SESSION: SiteSession = {
  cookies: [
    { name: "logged-in-user", value: "me%40x.com", domain: ".archive.org", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
  ],
  origins: [],
};

function baseMock(options: { html?: string; jsia?: unknown } = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    const url = String(input);
    if (url.startsWith("https://archive.org/details/testitem")) {
      return new Response(options.html ?? detailsHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (url.includes("BookReaderJSIA.php")) {
      const body = options.jsia ?? jsiaBody({});
      return new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("", { status: 404 });
  });
}

describe("readerConfig", () => {
  it("reads the config url off the details page and fetches it as json on the storage host", async () => {
    const fetchImpl = baseMock();
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem");

    expect(config.bookId).toBe("testitem");
    expect(config.subPrefix).toBe("testitem");
    expect(config.bookTitle).toBe("Namiya zakkaten no kiseki");
    expect(config.leaves.map((leaf) => leaf.leafNum)).toEqual([1, 2, 3]);
    expect(config.leaves[0].uri).toContain("BookReaderPreview.php");
    expect(config.lendingStatus.is_lendable).toBe(true);
    expect(config.metadata.creator).toBe("Keigo Higashino");

    const called = fetchImpl.mock.calls.map(([input]) => String(input));
    // format=jsonp must be rewritten to format=json, on the storage host — archive.org 404s it.
    const configCall = called.find((url) => url.includes("BookReaderJSIA.php"));
    expect(configCall).toContain("format=json");
    expect(configCall).not.toContain("format=jsonp");
    expect(configCall).toContain("ia601804.us.archive.org");
    expect(configCall).toContain("https://");
    // session headers ride both requests
    const headers = (fetchImpl.mock.calls[1]?.[1] as RequestInit)?.headers as Record<string, string>;
    expect(headers.Cookie).toContain("logged-in-user=me%40x.com");
  });

  it("fails clearly when the details page has no reader config", async () => {
    const fetchImpl = baseMock({ html: "<html><body>nothing here</body></html>" });
    await expect(readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem")).rejects.toThrow(
      /reader config/
    );
  });

  it("fails clearly when the config response has an unexpected shape", async () => {
    const fetchImpl = baseMock({ jsia: JSON.stringify({ data: { brOptions: { data: "no" } } }) });
    await expect(readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem")).rejects.toThrow(
      /unexpected shape/
    );
    const notJson = baseMock({ jsia: "<html>login</html>" });
    await expect(readerConfig(notJson as unknown as typeof fetch, SESSION, "testitem")).rejects.toThrow();
  });
});

describe("ensureLoan", () => {
  function loanMock(loanResponse?: () => Response) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.startsWith("https://archive.org/services/loans/loan")) {
        return loanResponse ? loanResponse() : new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response("", { status: 404 });
    });
  }

  it("reuses an active session without calling the loans API", async () => {
    const fetchImpl = loanMock();
    const result = await ensureLoan(fetchImpl as unknown as typeof fetch, SESSION, "testitem", {
      active_browses: 1,
      active_borrows: 0,
      is_lendable: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.session).toBe(SESSION);
    expect(result.startedBorrow).toBe(false);
  });

  it("starts a browse when no loan is active and a browse copy exists", async () => {
    const fetchImpl = loanMock(() =>
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "set-cookie": "loan-testitem=1790656967-abc; Path=/" },
      })
    );
    const { session, startedBorrow } = await ensureLoan(fetchImpl as unknown as typeof fetch, SESSION, "testitem", {
      is_lendable: true,
      active_borrows: 0,
      active_browses: 0,
      available_to_borrow: false,
      available_to_browse: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://archive.org/services/loans/loan");
    const form = init?.body as FormData;
    expect(form.get("action")).toBe("browse_book");
    expect(form.get("identifier")).toBe("testitem");
    // the Set-Cookie of the loan is merged in, so the capture rides the new loan
    expect(session.cookies?.some((cookie) => cookie.name === "loan-testitem")).toBe(true);
    expect(session.cookies?.some((cookie) => cookie.name === "logged-in-user")).toBe(true);
    // a browse is handed back by IA in an hour anyway — only borrows must be returned
    expect(startedBorrow).toBe(false);
  });

  it("prefers borrowing when a copy is borrowable and reports it started one", async () => {
    const fetchImpl = loanMock();
    const { startedBorrow } = await ensureLoan(fetchImpl as unknown as typeof fetch, SESSION, "testitem", {
      is_lendable: true,
      available_to_borrow: true,
      available_to_browse: true,
    });
    const form = fetchImpl.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("action")).toBe("borrow_book");
    expect(startedBorrow).toBe(true);
  });

  it("refuses when no copy is free and explains it", async () => {
    const fetchImpl = loanMock();
    const error = await ensureLoan(fetchImpl as unknown as typeof fetch, SESSION, "testitem", {
      is_lendable: true,
      available_to_borrow: false,
      available_to_browse: false,
    }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ArchiveLoanError);
    expect((error as Error).message).toMatch(/No copy/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a rejected loan as a dead session", async () => {
    const fetchImpl = loanMock(() => new Response(JSON.stringify({ error: "login required" }), { status: 200 }));
    const error = await ensureLoan(fetchImpl as unknown as typeof fetch, SESSION, "testitem", {
      is_lendable: true,
      available_to_browse: true,
    }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ArchiveLoanError);
    expect((error as Error).message).toMatch(/not logged in/);
  });
});

describe("loanExpiryEpoch", () => {
  it("reads the epoch out of the loan cookie", () => {
    const session: SiteSession = {
      cookies: [
        { name: "loan-testitem", value: "1790656967-abc", domain: ".archive.org", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
      ],
      origins: [],
    };
    expect(loanExpiryEpoch(session, "testitem")).toBe(1790656967);
    expect(loanExpiryEpoch(SESSION, "testitem")).toBeUndefined();
  });

  it("renewLoan posts renew_loan and returns merged cookies", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "set-cookie": "loan-testitem=1790999999-xyz; Path=/" },
      });
    });
    const session = await renewLoan(fetchImpl as unknown as typeof fetch, SESSION, "testitem");
    const form = fetchImpl.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("action")).toBe("renew_loan");
    expect(loanExpiryEpoch(session, "testitem")).toBe(1790999999);
  });

  it("replaces the saved loan cookie instead of appending a duplicate beside it", async () => {
    const stale: SiteSession = {
      cookies: [
        { name: "loan-testitem", value: "1790656967-stale", domain: ".archive.org", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
      ],
      origins: [],
    };
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "set-cookie": "loan-testitem=1790999999-new; Path=/" },
      })
    );
    const session = await renewLoan(fetchImpl as unknown as typeof fetch, stale, "testitem");
    const loans = (session.cookies ?? []).filter((cookie) => cookie.name === "loan-testitem");
    expect(loans).toHaveLength(1);
    expect(loans[0]!.domain).toBe(".archive.org");
    expect(loanExpiryEpoch(session, "testitem")).toBe(1790999999);
  });

  it("reads the newest epoch even when a duplicated pair is already in the session", () => {
    const session: SiteSession = {
      cookies: [
        { name: "loan-testitem", value: "1790656967-stale", domain: ".archive.org", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
        { name: "loan-testitem", value: "1790999999-fresh", domain: ".archive.org", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
      ],
      origins: [],
    };
    expect(loanExpiryEpoch(session, "testitem")).toBe(1790999999);
  });
});

it("returnLoan posts return_loan and ignores failures", async () => {
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  });
  await expect(returnLoan(fetchImpl as unknown as typeof fetch, SESSION, "testitem")).resolves.toBeUndefined();
  const form = fetchImpl.mock.calls[0]?.[1]?.body as FormData;
  expect(form.get("action")).toBe("return_loan");
  const failing = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    return new Response("", { status: 500 });
  });
  await expect(returnLoan(failing as unknown as typeof fetch, SESSION, "testitem")).resolves.toBeUndefined();
});

const STORED: string[] = [];
const storeImage = (bytes: Buffer, extension: string) => {
  STORED.push(`${bytes.length}:${extension}`);
  return `epub-media/test/${STORED.length}.jpg`;
};

// One mock for the whole capture: JSIA (config) + grant + page image.
function captureMock(options: {
  leafCount?: number;
  lendingStatus?: Record<string, unknown>;
  grant?: (leafNum: number) => Response;
  preview?: (leafNum: number) => Response;
  loan?: () => Response;
} = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://archive.org/details/testitem")) {
      return new Response(detailsHtml(), { status: 200, headers: { "content-type": "text/html" } });
    }
    if (url.includes("BookReaderJSIA.php")) {
      return new Response(
        JSON.stringify(jsiaBody({ leafCount: options.leafCount, lendingStatus: options.lendingStatus })),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.startsWith("https://archive.org/services/loans/loan")) {
      return options.loan
        ? options.loan()
        : new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (url.includes("/services/bookreader/request_page")) {
      const leafNum = Number(new URL(url).searchParams.get("leafNum"));
      return options.grant
        ? options.grant(leafNum)
        : new Response(JSON.stringify({ success: true, value: [leafNum, leafNum + 1] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    }
    if (url.includes("BookReaderPreview.php")) {
      const leafNum = Number(/page=leaf(\d+)/.exec(url)?.[1] ?? 0);
      return options.preview
        ? options.preview(leafNum)
        : new Response(new Uint8Array(JPEG), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    return new Response("", { status: 404 });
  });
}

describe("captureChapters", () => {
  it("grants each spread once, stores every page and chunks 45 leaves into 3 chapters", async () => {
    STORED.length = 0;
    const fetchImpl = captureMock({ leafCount: 45 });
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem");
    const chapters = await captureChapters(fetchImpl as unknown as typeof fetch, SESSION, config, storeImage, "Fallback");

    expect(chapters.map((chapter) => chapter.title)).toEqual(["Pages 1–20", "Pages 21–40", "Pages 41–45"]);
    expect(chapters.flatMap((chapter) => chapter.blocks)).toHaveLength(45);
    expect(chapters[0].blocks[0]).toEqual({ type: "image", src: "epub-media/test/1.jpg", alt: "" });
    expect(STORED).toHaveLength(45);

    // one grant covers the pair: 45 leaves → ceil(45/2) request_page calls
    const grants = fetchImpl.mock.calls.filter(([input]) => String(input).includes("request_page"));
    expect(grants).toHaveLength(23);
  });

  it("keeps a book that fits one chunk under the book's title", async () => {
    const fetchImpl = captureMock({ leafCount: 3 });
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem");
    const chapters = await captureChapters(fetchImpl as unknown as typeof fetch, SESSION, config, storeImage, "Fallback");
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe("Namiya zakkaten no kiseki");
  });

  it("retries a refused page once after renewing, then reports the loan as ended", async () => {
    const unavailable = () =>
      new Response("", { status: 302, headers: { location: "https://archive.org/bookreader/static/preview-unavailable.png" } });
    const fetchImpl = captureMock({
      leafCount: 3,
      lendingStatus: { active_browses: 0, available_to_browse: true },
      preview: unavailable,
    });
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem");
    const error = await captureChapters(fetchImpl as unknown as typeof fetch, SESSION, config, storeImage, "F").catch(
      (err: unknown) => err
    );
    expect(error).toBeInstanceOf(ArchiveLoanError);
    expect((error as Error).message).toMatch(/loan ended/);
    // the reactive renewal was attempted before giving up
    const loans = fetchImpl.mock.calls.filter(([input]) => String(input).includes("/services/loans/loan"));
    expect(loans.length).toBeGreaterThanOrEqual(1);
  });

  it("names the page when a granted page still cannot be read", async () => {
    const fetchImpl = captureMock({
      leafCount: 2,
      preview: () => new Response("", { status: 500 }),
    });
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem");
    const error = await captureChapters(fetchImpl as unknown as typeof fetch, SESSION, config, storeImage, "F").catch(
      (err: unknown) => err
    );
    expect(error).toBeInstanceOf(ArchiveLoanError);
    expect((error as Error).message).toMatch(/page 1/);
  });

  it("skips an oversized page image but keeps the chapter structure", async () => {
    const fetchImpl = captureMock({
      leafCount: 3,
      preview: (leafNum: number) => {
        if (leafNum !== 1) return new Response(new Uint8Array(JPEG), { status: 200, headers: { "content-type": "image/jpeg" } });
        const big = Buffer.alloc(8 * 1024 * 1024 + 1, 0x41);
        big[0] = 0xff;
        big[1] = 0xd8;
        big[2] = 0xff;
        return new Response(new Uint8Array(big));
      },
    });
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem");
    const chapters = await captureChapters(fetchImpl as unknown as typeof fetch, SESSION, config, storeImage, "F");
    expect(chapters).toHaveLength(1);
    expect(chapters[0].blocks).toHaveLength(2);
  });

  it("refuses a book with more than MAX_PAGES leaves", async () => {
    const fetchImpl = captureMock({ leafCount: 5001 });
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem");
    await expect(
      captureChapters(fetchImpl as unknown as typeof fetch, SESSION, config, storeImage, "F")
    ).rejects.toBeInstanceOf(ArchiveTooManyPagesError);
  });

  it("renews a nearly expired loan once, not on every remaining leaf", async () => {
    const now = Math.floor(Date.now() / 1000);
    const nearExpiry: SiteSession = {
      cookies: [
        { name: "loan-testitem", value: `${now + 5 * 60}-stale`, domain: ".archive.org", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
      ],
      origins: [],
    };
    const renew = () =>
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "set-cookie": `loan-testitem=${now + 2 * 3600}-fresh; Path=/` },
      });
    const fetchImpl = captureMock({ leafCount: 6, loan: renew });
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, nearExpiry, "testitem");
    const chapters = await captureChapters(fetchImpl as unknown as typeof fetch, nearExpiry, config, storeImage, "F");
    expect(chapters.flatMap((chapter) => chapter.blocks)).toHaveLength(6);
    // the merged cookie carries the fresh epoch, so the window check stops re-firing
    const loans = fetchImpl.mock.calls.filter(([input]) => String(input).includes("/services/loans/loan"));
    expect(loans).toHaveLength(1);
  });

  it("grants exactly the leaves the API reports when the answer omits the pair", async () => {
    const fetchImpl = captureMock({
      leafCount: 8,
      grant: (leafNum) =>
        new Response(JSON.stringify({ success: true, value: [leafNum] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem");
    const chapters = await captureChapters(fetchImpl as unknown as typeof fetch, SESSION, config, storeImage, "F");
    expect(chapters.flatMap((chapter) => chapter.blocks)).toHaveLength(8);
    // leaf n+1 was never granted, so every leaf needs its own request_page call
    const grants = fetchImpl.mock.calls.filter(([input]) => String(input).includes("request_page"));
    expect(grants).toHaveLength(8);
  });

  it("covers the spread when the API reports both leaves of a pair", async () => {
    const fetchImpl = captureMock({ leafCount: 8 });
    const config = await readerConfig(fetchImpl as unknown as typeof fetch, SESSION, "testitem");
    const chapters = await captureChapters(fetchImpl as unknown as typeof fetch, SESSION, config, storeImage, "F");
    expect(chapters.flatMap((chapter) => chapter.blocks)).toHaveLength(8);
    const grants = fetchImpl.mock.calls.filter(([input]) => String(input).includes("request_page"));
    expect(grants).toHaveLength(4);
  });
});

describe("importBorrowedBook", () => {
  it("refuses an item the catalog marks not lendable", async () => {
    const fetchImpl = captureMock({ lendingStatus: { is_lendable: false } });
    await expect(
      importBorrowedBook(fetchImpl as unknown as typeof fetch, SESSION, "testitem", { title: "Fallback" }, storeImage)
    ).rejects.toBeInstanceOf(ArchiveRestrictedError);
  });

  it("returns a book whose chapters are image blocks", async () => {
    const fetchImpl = captureMock({ leafCount: 2 });
    const book = await importBorrowedBook(fetchImpl as unknown as typeof fetch, SESSION, "testitem", { title: "Fallback" }, storeImage);
    expect(book.title).toBe("Namiya zakkaten no kiseki");
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].blocks.every((block) => block.type === "image")).toBe(true);
  });
});
