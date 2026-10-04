import { describe, expect, it, vi } from "vitest";

vi.mock("./siteSession", () => ({ loadSiteSession: vi.fn() }));

import { cloudflareBlockedMessage, isCloudflareChallenge } from "./cloudflare";

describe("isCloudflareChallenge", () => {
  it.each([
    "Just a moment...",
    "Chờ một chút...",
    "Performing security verification",
    "Xác minh bảo mật",
  ])("recognizes the interstitial titled %j", (title) => {
    expect(isCloudflareChallenge(`<html><head><title>${title}</title></head></html>`)).toBe(true);
  });

  it("matches only the title: chapter text saying 'Chờ một chút' is a real page", () => {
    const html = "<html><head><title>Chương 1</title></head><body><p>Chờ một chút nhé.</p></body></html>";
    expect(isCloudflareChallenge(html)).toBe(false);
  });

  it("is false when there is no title", () => {
    expect(isCloudflareChallenge("<p>Just a moment</p>")).toBe(false);
  });
});

describe("cloudflareBlockedMessage", () => {
  it("tells a reader with a saved session it is no longer accepted", () => {
    expect(cloudflareBlockedMessage("https://x.test/a", true)).toContain("no longer accepted");
  });

  it("tells a reader without a session to import one, and names the page", () => {
    const message = cloudflareBlockedMessage("https://x.test/a", false);
    expect(message).toContain("import a session");
    expect(message).toContain("https://x.test/a");
  });
});
