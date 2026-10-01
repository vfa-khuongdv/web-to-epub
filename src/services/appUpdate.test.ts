import { describe, expect, it, vi } from "vitest";
import { MAX_NOTES_CHARS, compareVersions, createAppUpdateChecker, pickUpdateAsset, pickZipAsset, releaseNotes } from "./appUpdate";

const release = (overrides: Record<string, unknown> = {}) => ({
  tag_name: "v1.6.0",
  html_url: "https://github.com/vfa-khuongdv/web-to-epub/releases/tag/v1.6.0",
  assets: [
    { name: "Web.to.EPUB-1.6.0-arm64.dmg", browser_download_url: "https://github.com/dl/x.dmg" },
    { name: "Web.to.EPUB-1.6.0-arm64-mac.zip", browser_download_url: "https://github.com/dl/x.zip" },
  ],
  ...overrides,
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("compareVersions", () => {
  it("orders numeric segments", () => {
    expect(compareVersions("1.6.0", "1.5.1")).toBe(1);
    expect(compareVersions("1.5.1", "1.6.0")).toBe(-1);
    expect(compareVersions("1.5.1", "1.5.1")).toBe(0);
  });

  it("ignores a leading v and a prerelease suffix", () => {
    expect(compareVersions("v1.5.1", "1.5.1")).toBe(0);
    expect(compareVersions("1.6.0-beta.1", "1.5.1")).toBe(1);
  });

  it("treats missing segments as zero", () => {
    expect(compareVersions("1.5", "1.5.0")).toBe(0);
  });

  it("treats garbage as zero", () => {
    expect(compareVersions("unknown", "0.0.0")).toBe(0);
  });
});

describe("pickZipAsset", () => {
  it("picks the dot-mangled arm64 zip", () => {
    expect(pickZipAsset(release().assets, "1.6.0")).toBe("https://github.com/dl/x.zip");
  });

  it("prefers the asset naming the version", () => {
    const assets = [
      { name: "Web.to.EPUB-1.5.0-arm64-mac.zip", browser_download_url: "https://github.com/dl/old.zip" },
      { name: "Web.to.EPUB-1.6.0-arm64-mac.zip", browser_download_url: "https://github.com/dl/new.zip" },
    ];
    expect(pickZipAsset(assets, "1.6.0")).toBe("https://github.com/dl/new.zip");
  });

  it("returns null when the release has no mac zip", () => {
    const assets = [{ name: "Web.to.EPUB-1.6.0-arm64.dmg", browser_download_url: "https://github.com/dl/x.dmg" }];
    expect(pickZipAsset(assets, "1.6.0")).toBeNull();
  });
});

describe("pickUpdateAsset", () => {
  const assets = [
    { name: "Web.to.EPUB-1.7.0-arm64.dmg", browser_download_url: "https://dl/mac.dmg" },
    { name: "Web.to.EPUB-1.7.0-arm64-mac.zip", browser_download_url: "https://dl/mac.zip" },
    { name: "Web.to.EPUB.Setup.1.7.0.exe", browser_download_url: "https://dl/setup.exe" },
    { name: "Web.to.EPUB-1.7.0-win.zip", browser_download_url: "https://dl/win.zip" },
    { name: "Web.to.EPUB-1.7.0.AppImage", browser_download_url: "https://dl/app.AppImage" },
    { name: "web-to-epub_1.7.0_amd64.deb", browser_download_url: "https://dl/x.deb" },
  ];

  it("picks each platform's own asset", () => {
    expect(pickUpdateAsset(assets, "1.7.0", "darwin")).toBe("https://dl/mac.zip");
    expect(pickUpdateAsset(assets, "1.7.0", "win32")).toBe("https://dl/setup.exe");
    expect(pickUpdateAsset(assets, "1.7.0", "linux")).toBe("https://dl/app.AppImage");
  });

  it("is null where the release has no asset for the platform", () => {
    expect(pickUpdateAsset(assets.slice(0, 2), "1.7.0", "win32")).toBeNull();
    expect(pickUpdateAsset(assets, "1.7.0", "freebsd")).toBeNull();
  });
});

describe("releaseNotes", () => {
  it("returns what the maintainer wrote on the release, as markdown", () => {
    expect(releaseNotes("Adds an AI crawler.\n\n## AI crawler\n\n- Read any site")).toBe(
      "Adds an AI crawler.\n\n## AI crawler\n\n- Read any site"
    );
  });

  it("normalizes line endings and drops HTML comments", () => {
    expect(releaseNotes("Line one\r\n<!-- note for the editor -->Line two\r\n")).toBe("Line one\nLine two");
  });

  it("is null when there is nothing to show", () => {
    expect(releaseNotes(undefined)).toBeNull();
    expect(releaseNotes(null)).toBeNull();
    expect(releaseNotes(42)).toBeNull();
    expect(releaseNotes("  \n  ")).toBeNull();
    expect(releaseNotes("<!-- only a comment -->")).toBeNull();
  });

  it("cuts a very long body at a line end and marks the cut", () => {
    const line = "- a bullet of the changelog that goes on for a while";
    const body = Array.from({ length: 400 }, () => line).join("\n");
    const notes = releaseNotes(body) as string;
    expect(notes.length).toBeLessThanOrEqual(MAX_NOTES_CHARS + 2);
    expect(notes.endsWith("\n…")).toBe(true);
    // every kept line is whole
    expect(notes.split("\n").slice(0, -1).every((l) => l === line)).toBe(true);
  });
});

describe("createAppUpdateChecker", () => {
  it("carries the release's notes to the dialog", async () => {
    const fetchImpl = async () => jsonResponse(release({ body: "## What's new\n\n- A thing" }));
    const checker = createAppUpdateChecker({ platform: "darwin", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(checker.check("1.5.1")).resolves.toMatchObject({ hasUpdate: true, notes: "## What's new\n\n- A thing" });
  });

  it("has no notes when the release has none, or when the check fails", async () => {
    const empty = createAppUpdateChecker({ platform: "darwin", fetchImpl: (async () => jsonResponse(release({ body: "" }))) as unknown as typeof fetch });
    await expect(empty.check("1.5.1")).resolves.toMatchObject({ hasUpdate: true, notes: null });
    const failing = createAppUpdateChecker({ platform: "darwin", fetchImpl: (async () => jsonResponse({}, false, 500)) as unknown as typeof fetch });
    await expect(failing.check("1.5.1")).resolves.toMatchObject({ hasUpdate: false, notes: null });
  });

  it("reports an update with the release and zip urls", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(release()));
    const checker = createAppUpdateChecker({ platform: "darwin", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(checker.check("1.5.1")).resolves.toEqual({
      current: "1.5.1",
      latest: "1.6.0",
      hasUpdate: true,
      releaseUrl: "https://github.com/vfa-khuongdv/web-to-epub/releases/tag/v1.6.0",
      zipUrl: "https://github.com/dl/x.zip",
      notes: null,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("reports no update when the latest release is the current version", async () => {
    const fetchImpl = async () => jsonResponse(release({ tag_name: "v1.5.1" }));
    const checker = createAppUpdateChecker({ platform: "darwin", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(checker.check("1.5.1")).resolves.toMatchObject({ latest: "1.5.1", hasUpdate: false });
  });

  it("reports an update without a zip url when the release has no mac zip", async () => {
    const fetchImpl = async () =>
      jsonResponse(release({ assets: [{ name: "Web.to.EPUB-1.6.0-arm64.dmg", browser_download_url: "https://github.com/dl/x.dmg" }] }));
    const checker = createAppUpdateChecker({ platform: "darwin", fetchImpl: fetchImpl as unknown as typeof fetch });
    const status = await checker.check("1.5.1");
    expect(status.hasUpdate).toBe(true);
    expect(status.zipUrl).toBeNull();
  });

  it("stays silent when GitHub answers an error", async () => {
    const fetchImpl = async () => jsonResponse({}, false, 500);
    const checker = createAppUpdateChecker({ platform: "darwin", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(checker.check("1.5.1")).resolves.toEqual({
      current: "1.5.1",
      latest: null,
      hasUpdate: false,
      releaseUrl: null,
      zipUrl: null,
      notes: null,
    });
  });

  it("stays silent when the network throws", async () => {
    const fetchImpl = async () => {
      throw new Error("offline");
    };
    const checker = createAppUpdateChecker({ platform: "darwin", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(checker.check("1.5.1")).resolves.toMatchObject({ hasUpdate: false, latest: null });
  });

  it("stays silent on an unexpected payload", async () => {
    const fetchImpl = async () => jsonResponse({ message: "Not Found" });
    const checker = createAppUpdateChecker({ platform: "darwin", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(checker.check("1.5.1")).resolves.toMatchObject({ hasUpdate: false, latest: null });
  });

  it("caches a successful check for six hours", async () => {
    let nowMs = 1_000_000;
    const fetchImpl = vi.fn(async () => jsonResponse(release()));
    const checker = createAppUpdateChecker({ platform: "darwin", fetchImpl: fetchImpl as unknown as typeof fetch, now: () => nowMs });
    await checker.check("1.5.1");
    nowMs += 5 * 60 * 60 * 1000;
    await checker.check("1.5.1");
    expect(fetchImpl).toHaveBeenCalledOnce();
    nowMs += 2 * 60 * 60 * 1000;
    await checker.check("1.5.1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("negative-caches a failure for fifteen minutes", async () => {
    let nowMs = 1_000_000;
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500));
    const checker = createAppUpdateChecker({ platform: "darwin", fetchImpl: fetchImpl as unknown as typeof fetch, now: () => nowMs });
    await checker.check("1.5.1");
    nowMs += 10 * 60 * 1000;
    await checker.check("1.5.1");
    expect(fetchImpl).toHaveBeenCalledOnce();
    nowMs += 10 * 60 * 1000;
    await checker.check("1.5.1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
