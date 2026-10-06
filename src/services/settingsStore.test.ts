import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import v8 from "node:v8";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSettingsStore, DEFAULT_SETTINGS, type SettingsStore } from "./settingsStore";

describe("settingsStore", () => {
  let dir: string;
  let settings: SettingsStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "settings-test-"));
    settings = createSettingsStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // node:sqlite on Node 22.13 finalizes a database's statements once the database object
  // is garbage-collected; the store keeps only statements, so the server crashed on the
  // first settings request after a collection ("statement has been finalized").
  it("keeps working after a garbage collection", async () => {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    settings.update({ defaultAuthor: "A" });
    for (let i = 0; i < 3; i++) {
      gc();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(settings.get().defaultAuthor).toBe("A");
    settings.setRaw("k", "v");
    expect(settings.getRaw("k")).toBe("v");
  });

  it("answers with the defaults before anything is saved", () => {
    expect(settings.get()).toEqual(DEFAULT_SETTINGS);
  });

  it("checks for new chapters on open by default — the behaviour before this setting existed", () => {
    expect(DEFAULT_SETTINGS.autoScanOnOpen).toBe(true);
  });

  it("writes only the keys it is given", () => {
    settings.update({ defaultAuthor: "Nguyễn Văn A" });
    expect(settings.get()).toEqual({ ...DEFAULT_SETTINGS, defaultAuthor: "Nguyễn Văn A" });

    settings.update({ autoScanOnOpen: false });
    expect(settings.get()).toEqual({
      ...DEFAULT_SETTINGS,
      defaultAuthor: "Nguyễn Văn A",
      autoScanOnOpen: false,
    });
  });

  it("saves the narration model and voice; an unknown saved variant reads as the default", () => {
    settings.update({ ttsVariant: "nano", ttsVoice: "Mỹ Duyên" });
    expect(settings.get()).toMatchObject({ ttsVariant: "nano", ttsVoice: "Mỹ Duyên" });
    settings.update({ ttsVariant: "bogus" as never });
    expect(settings.get().ttsVariant).toBe(DEFAULT_SETTINGS.ttsVariant);
  });

  it("returns the settings it just saved", () => {
    expect(settings.update({ defaultBookLanguage: "en" })).toEqual({
      ...DEFAULT_SETTINGS,
      defaultBookLanguage: "en",
    });
  });

  // `false` and `""` are the two values an "is it set?" check would read as absent and
  // quietly replace with the default.
  it("keeps a setting turned off, and an author cleared", () => {
    settings.update({ autoScanOnOpen: false, defaultAuthor: "" });
    const reopened = createSettingsStore(dir);
    expect(reopened.get().autoScanOnOpen).toBe(false);
    expect(reopened.get().defaultAuthor).toBe("");
  });

  it("survives a restart", () => {
    settings.update({
      autoScanOnOpen: false,
      defaultBookLanguage: "en",
      defaultAuthor: "Ẩn danh",
      ttsVariant: "nano",
      ttsVoice: "Adam",
    });
    expect(createSettingsStore(dir).get()).toEqual({
      autoScanOnOpen: false,
      defaultBookLanguage: "en",
      defaultAuthor: "Ẩn danh",
      ttsVariant: "nano",
      ttsVoice: "Adam",
    });
  });

  it("shares stories.db with the story store without disturbing it", async () => {
    const { createStoryStore } = await import("./storyStore");
    const stories = createStoryStore(dir);
    settings.update({ defaultAuthor: "Tác giả" });
    expect(await stories.list()).toEqual([]);
    expect(createSettingsStore(dir).get().defaultAuthor).toBe("Tác giả");
  });
});
