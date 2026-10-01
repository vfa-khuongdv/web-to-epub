import { describe, expect, it } from "vitest";
import { SESSION_SITES, sessionSiteForUrl } from "./siteSessions";

describe("sessionSiteForUrl", () => {
  it("matches archive.org item URLs, deep links included", () => {
    expect(sessionSiteForUrl("https://archive.org/details/namiyazakkatenno0000higa/page/n161/mode/2up")?.slug).toBe(
      "archive"
    );
    expect(sessionSiteForUrl("https://www.archive.org/metadata/x")?.slug).toBe("archive");
    expect(sessionSiteForUrl("https://ia601804.us.archive.org/BookReader/x")?.slug).toBe("archive");
  });

  it("keeps the existing session sites", () => {
    expect(sessionSiteForUrl("https://www.asianfanfics.com/story/view/1")?.slug).toBe("asianfanfics");
    expect(sessionSiteForUrl("https://truyenfull.live/truyen/x/")?.slug).toBe("truyenfull");
    expect(sessionSiteForUrl("https://example.com/x")).toBeUndefined();
  });

  it("archive shows no expiry and skips cleanly", () => {
    const archive = SESSION_SITES.find((site) => site.slug === "archive");
    expect(archive?.domain).toBe("archive.org");
    expect(archive?.showsExpiry).toBe(false);
    expect(archive?.accountUrl).toBeUndefined();
    expect(archive?.skipNote).toContain("public items");
  });
});
