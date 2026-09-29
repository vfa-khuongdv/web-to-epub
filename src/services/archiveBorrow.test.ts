import { describe, expect, it, vi } from "vitest";
import type { SiteSession } from "./siteSession";
import { detailsHtml, jsiaBody, JPEG } from "./__fixtures__/archiveBorrowFixtures";
import { readerConfig } from "./archiveBorrow";
import { ArchiveLoanError } from "./archiveErrors";
import { ensureLoan, loanExpiryEpoch, renewLoan, returnLoan } from "./archiveBorrow";

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
    return vi.fn(async (input: RequestInfo | URL) => {
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
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "set-cookie": "loan-testitem=1790999999-xyz; Path=/" },
        })
    );
    const session = await renewLoan(fetchImpl as unknown as typeof fetch, SESSION, "testitem");
    const form = fetchImpl.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("action")).toBe("renew_loan");
    expect(loanExpiryEpoch(session, "testitem")).toBe(1790999999);
  });
});

it("returnLoan posts return_loan and ignores failures", async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
  await expect(returnLoan(fetchImpl as unknown as typeof fetch, SESSION, "testitem")).resolves.toBeUndefined();
  const form = fetchImpl.mock.calls[0]?.[1]?.body as FormData;
  expect(form.get("action")).toBe("return_loan");
  const failing = vi.fn(async () => new Response("", { status: 500 }));
  await expect(returnLoan(failing as unknown as typeof fetch, SESSION, "testitem")).resolves.toBeUndefined();
});
