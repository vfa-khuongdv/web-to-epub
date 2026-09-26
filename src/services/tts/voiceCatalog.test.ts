import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVoiceCatalog, sampleName } from "./voiceCatalog";

describe("voice catalog", () => {
  let dir: string;
  let bundled: string;
  let cache: string;
  let catalog: ReturnType<typeof createVoiceCatalog>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "voice-catalog-"));
    bundled = path.join(dir, "bundled");
    cache = path.join(dir, "cache");
    await fs.mkdir(bundled);
    catalog = createVoiceCatalog(bundled, cache);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("names samples safely, the default voice included", () => {
    expect(sampleName("")).toBe("default");
    expect(sampleName("Xuân Vĩnh")).toBe("Xu%C3%A2n%20V%C4%A9nh");
    expect(sampleName("../x")).not.toContain("/");
  });

  it("lists VieNeu presets from the bundle, and nothing to go on without it", async () => {
    expect(await catalog.presets("turbo")).toBeUndefined();
    await fs.writeFile(path.join(bundled, "presets.json"), JSON.stringify({ turbo: [{ id: "Xuân Vĩnh", label: "Xuân Vĩnh" }] }));
    expect(await catalog.presets("turbo")).toEqual([{ id: "Xuân Vĩnh", label: "Xuân Vĩnh" }]);
    expect(await catalog.presets("nano")).toBeUndefined();
    expect(await catalog.presets("omnivoice")).toEqual([]);
  });

  it("resolves a built-in clip, with its prompt kept outside the bundle", async () => {
    expect(await catalog.builtins()).toEqual([]);
    await fs.writeFile(
      path.join(bundled, "omnivoice.json"),
      JSON.stringify([{ id: "an", label: "An", clip: "an.mp3", transcript: "Xin chào" }])
    );
    expect(await catalog.builtin("an")).toEqual({
      refAudio: path.join(bundled, "clips", "an.mp3"),
      refText: "Xin chào",
      refPrompt: path.join(cache, "builtin", "an.omnivoice.pt"),
    });
    expect(await catalog.builtin("nope")).toBeUndefined();
  });

  it("finds a bundled sample only when the file is there", async () => {
    expect(await catalog.bundledSample("turbo", "")).toBeUndefined();
    await fs.mkdir(path.join(bundled, "samples", "turbo"), { recursive: true });
    await fs.writeFile(path.join(bundled, "samples", "turbo", "default.mp3"), "mp3");
    expect(await catalog.bundledSample("turbo", "")).toBe(path.join(bundled, "samples", "turbo", "default.mp3"));
    expect(await catalog.bundledSample("nano", "")).toBeUndefined();
  });

  it("caches a custom voice's preview next to its clip, others in the cache folder", () => {
    expect(catalog.cachedSamplePath("turbo", "custom:x", "/voices/x.mp3")).toBe("/voices/x.mp3.preview-turbo.mp3");
    expect(catalog.cachedSamplePath("nano", "Xuân Vĩnh")).toBe(path.join(cache, "samples", "nano", `${sampleName("Xuân Vĩnh")}.mp3`));
  });
});
