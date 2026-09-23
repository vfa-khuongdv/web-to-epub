import { describe, expect, it, vi } from "vitest";
import { compareVersions, createAppUpdateChecker, pickZipAsset } from "./appUpdate";

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

describe("createAppUpdateChecker", () => {
  it("reports an update with the release and zip urls", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(release()));
    const checker = createAppUpdateChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(checker.check("1.5.1")).resolves.toEqual({
      current: "1.5.1",
      latest: "1.6.0",
      hasUpdate: true,
      releaseUrl: "https://github.com/vfa-khuongdv/web-to-epub/releases/tag/v1.6.0",
      zipUrl: "https://github.com/dl/x.zip",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("reports no update when the latest release is the current version", async () => {
    const fetchImpl = async () => jsonResponse(release({ tag_name: "v1.5.1" }));
    const checker = createAppUpdateChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(checker.check("1.5.1")).resolves.toMatchObject({ latest: "1.5.1", hasUpdate: false });
  });

  it("reports an update without a zip url when the release has no mac zip", async () => {
    const fetchImpl = async () =>
      jsonResponse(release({ assets: [{ name: "Web.to.EPUB-1.6.0-arm64.dmg", browser_download_url: "https://github.com/dl/x.dmg" }] }));
    const checker = createAppUpdateChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const status = await checker.check("1.5.1");
    expect(status.hasUpdate).toBe(true);
    expect(status.zipUrl).toBeNull();
  });

  it("stays silent when GitHub answers an error", async () => {
    const fetchImpl = async () => jsonResponse({}, false, 500);
    const checker = createAppUpdateChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(checker.check("1.5.1")).resolves.toEqual({
      current: "1.5.1",
      latest: null,
      hasUpdate: false,
      releaseUrl: null,
      zipUrl: null,
    });
  });

  it("stays silent when the network throws", async () => {
    const fetchImpl = async () => {
      throw new Error("offline");
    };
    const checker = createAppUpdateChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(checker.check("1.5.1")).resolves.toMatchObject({ hasUpdate: false, latest: null });
  });

  it("stays silent on an unexpected payload", async () => {
    const fetchImpl = async () => jsonResponse({ message: "Not Found" });
    const checker = createAppUpdateChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(checker.check("1.5.1")).resolves.toMatchObject({ hasUpdate: false, latest: null });
  });

  it("caches a successful check for six hours", async () => {
    let nowMs = 1_000_000;
    const fetchImpl = vi.fn(async () => jsonResponse(release()));
    const checker = createAppUpdateChecker({ fetchImpl: fetchImpl as unknown as typeof fetch, now: () => nowMs });
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
    const checker = createAppUpdateChecker({ fetchImpl: fetchImpl as unknown as typeof fetch, now: () => nowMs });
    await checker.check("1.5.1");
    nowMs += 10 * 60 * 1000;
    await checker.check("1.5.1");
    expect(fetchImpl).toHaveBeenCalledOnce();
    nowMs += 10 * 60 * 1000;
    await checker.check("1.5.1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
