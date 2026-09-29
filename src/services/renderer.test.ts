import { beforeEach, describe, expect, it, vi } from "vitest";

const browserMocks = vi.hoisted(() => {
  const page = { goto: vi.fn(async () => ({ status: () => 200 })) };
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
    storageState: vi.fn(async () => ({ cookies: [{ name: "tok", value: "fresh" }], origins: [] })),
  };
  const browser = { newContext: vi.fn(async () => context) };
  return { page, context, browser };
});

vi.mock("playwright", () => ({
  chromium: { launch: vi.fn(async () => browserMocks.browser) },
}));

const sessionMocks = vi.hoisted(() => ({
  loadSiteSession: vi.fn(),
  persistRenderedCookies: vi.fn(),
}));

vi.mock("./siteSession", () => ({
  loadSiteSession: sessionMocks.loadSiteSession,
  persistRenderedCookies: sessionMocks.persistRenderedCookies,
}));

import { openRenderSession } from "./renderer";

beforeEach(() => {
  vi.clearAllMocks();
  sessionMocks.loadSiteSession.mockReturnValue(undefined);
});

describe("openRenderSession", () => {
  it("mở page với cookie + user agent của session đã lưu và deviceScaleFactor", async () => {
    sessionMocks.loadSiteSession.mockReturnValue({
      userAgent: "UA-SESSION",
      cookies: [{ name: "a", value: "1" }],
      origins: [],
    });

    const session = await openRenderSession("https://www.scribd.com/document/1", {
      deviceScaleFactor: 2,
      viewport: { width: 1400, height: 1600 },
    });

    expect(browserMocks.browser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({
        userAgent: "UA-SESSION",
        storageState: { cookies: [{ name: "a", value: "1" }], origins: [] },
        deviceScaleFactor: 2,
        viewport: { width: 1400, height: 1600 },
      })
    );
    expect(browserMocks.page.goto).toHaveBeenCalledWith(
      "https://www.scribd.com/document/1",
      expect.objectContaining({ waitUntil: "domcontentloaded" })
    );
    expect(session.page).toBe(browserMocks.page);

    // Cookies the site refreshed while the page ran go back to the saved session.
    await session.close();
    expect(sessionMocks.persistRenderedCookies).toHaveBeenCalledWith("https://www.scribd.com/document/1", [
      { name: "tok", value: "fresh" },
    ]);
    expect(browserMocks.context.close).toHaveBeenCalled();
  });

  it("không có session thì dùng user agent mặc định và không ghi cookie", async () => {
    const session = await openRenderSession("https://example.com/x");

    const options = browserMocks.browser.newContext.mock.calls[0][0];
    expect(options.userAgent).toEqual(expect.any(String));
    expect(options.storageState).toBeUndefined();
    expect(options.deviceScaleFactor).toBeUndefined();
    expect(options.viewport).toBeUndefined();

    await session.close();
    expect(sessionMocks.persistRenderedCookies).not.toHaveBeenCalled();
  });

  it("goto lỗi thì đóng context và ném lỗi", async () => {
    browserMocks.page.goto.mockRejectedValueOnce(new Error("net::ERR_FAILED"));

    await expect(openRenderSession("https://example.com/y")).rejects.toThrow("net::ERR_FAILED");
    expect(browserMocks.context.close).toHaveBeenCalled();
  });

  it("close gọi hai lần chỉ đóng context một lần", async () => {
    const session = await openRenderSession("https://example.com/z");

    await session.close();
    await session.close();

    expect(browserMocks.context.close).toHaveBeenCalledTimes(1);
  });
});
