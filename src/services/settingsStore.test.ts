import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
    settings.update({ autoScanOnOpen: false, defaultBookLanguage: "en", defaultAuthor: "Ẩn danh" });
    expect(createSettingsStore(dir).get()).toEqual({
      autoScanOnOpen: false,
      defaultBookLanguage: "en",
      defaultAuthor: "Ẩn danh",
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
