import { describe, expect, it } from "vitest";
import { omnivoiceUvDownloadUrl, uvDownloadUrl } from "./tts";

describe("omnivoiceUvDownloadUrl", () => {
  it("is offered on Apple Silicon only, where it runs on MPS", () => {
    expect(omnivoiceUvDownloadUrl("darwin", "arm64")).toBe(uvDownloadUrl("darwin", "arm64"));
    expect(omnivoiceUvDownloadUrl("darwin", "x64")).toBeUndefined();
    expect(omnivoiceUvDownloadUrl("linux", "x64")).toBeUndefined();
    expect(omnivoiceUvDownloadUrl("linux", "arm64")).toBeUndefined();
  });
});
