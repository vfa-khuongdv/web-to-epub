import { describe, expect, it } from "vitest";
import { msvcRuntimePackages, omnivoiceUvDownloadUrl, uvDownloadUrl } from "./tts";

describe("omnivoiceUvDownloadUrl", () => {
  const gpu = () => true;
  const noGpu = () => false;

  it("is offered on Apple Silicon, where it runs on MPS", () => {
    expect(omnivoiceUvDownloadUrl("darwin", "arm64", noGpu)).toBe(uvDownloadUrl("darwin", "arm64"));
    expect(omnivoiceUvDownloadUrl("darwin", "x64", gpu)).toBeUndefined();
  });

  it("is offered on Windows/Linux x64 only with an NVIDIA GPU (CPU is ~17x real time)", () => {
    expect(omnivoiceUvDownloadUrl("linux", "x64", gpu)).toBe(uvDownloadUrl("linux", "x64"));
    expect(omnivoiceUvDownloadUrl("win32", "x64", gpu)).toBe(uvDownloadUrl("win32", "x64"));
    expect(omnivoiceUvDownloadUrl("linux", "x64", noGpu)).toBeUndefined();
    expect(omnivoiceUvDownloadUrl("win32", "x64", noGpu)).toBeUndefined();
    expect(omnivoiceUvDownloadUrl("linux", "arm64", gpu)).toBeUndefined();
  });

  it("does not look for a GPU where the answer is already known", () => {
    const probe = () => {
      throw new Error("probed");
    };
    expect(() => omnivoiceUvDownloadUrl("darwin", "arm64", probe)).not.toThrow();
    expect(() => omnivoiceUvDownloadUrl("linux", "arm64", probe)).not.toThrow();
  });
});

describe("uvDownloadUrl", () => {
  it("is a tarball on macOS/Linux and a zip on Windows", () => {
    expect(uvDownloadUrl("linux", "x64")).toMatch(/x86_64-unknown-linux-gnu\.tar\.gz$/);
    expect(uvDownloadUrl("win32", "x64")).toMatch(/x86_64-pc-windows-msvc\.zip$/);
    expect(uvDownloadUrl("win32", "arm64")).toBeUndefined();
  });
});

describe("msvcRuntimePackages", () => {
  it("adds the Visual C++ runtime DLLs on Windows only (onnxruntime cannot load without them)", () => {
    expect(msvcRuntimePackages("win32")).toEqual([expect.stringMatching(/^msvc-runtime==/)]);
    expect(msvcRuntimePackages("darwin")).toEqual([]);
    expect(msvcRuntimePackages("linux")).toEqual([]);
  });
});
