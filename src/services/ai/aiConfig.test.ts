import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("../settingsStore", () => ({
  settingsStore: {
    getRaw: (key: string) => store.get(key),
    setRaw: (key: string, value: string) => void store.set(key, value),
  },
}));

import { activeAiProvider, loadAiConfig, saveAiConfig } from "./aiConfig";

describe("aiConfig", () => {
  beforeEach(() => store.clear());

  it("is off by default", () => {
    expect(loadAiConfig()).toEqual({ enabled: false, active: "deepseek", providers: {} });
  });

  it("falls back to the default when the saved value is corrupt", () => {
    store.set("aiConfig", "{not json");
    expect(loadAiConfig().enabled).toBe(false);
  });

  it("round-trips a saved config", () => {
    saveAiConfig({ enabled: true, active: "openai", providers: { openai: { apiKey: "k" } } });
    expect(loadAiConfig()).toEqual({ enabled: true, active: "openai", providers: { openai: { apiKey: "k" } } });
  });

  describe("activeAiProvider", () => {
    it("is undefined while the feature is off", () => {
      saveAiConfig({ enabled: false, active: "openai", providers: { openai: { apiKey: "k" } } });
      expect(activeAiProvider()).toBeUndefined();
    });

    it("is undefined when the active provider has no config or is unknown", () => {
      saveAiConfig({ enabled: true, active: "openai", providers: {} });
      expect(activeAiProvider()).toBeUndefined();
      saveAiConfig({ enabled: true, active: "nope", providers: { nope: { apiKey: "k" } } });
      expect(activeAiProvider()).toBeUndefined();
    });

    it("is undefined when a keyed provider has no key", () => {
      saveAiConfig({ enabled: true, active: "openai", providers: { openai: { apiKey: "" } } });
      expect(activeAiProvider()).toBeUndefined();
    });

    it("builds a provider with a key, and for a local one without a key", () => {
      saveAiConfig({ enabled: true, active: "openai", providers: { openai: { apiKey: "k" } } });
      expect(activeAiProvider()).toBeDefined();
      saveAiConfig({ enabled: true, active: "ollama", providers: { ollama: { apiKey: "" } } });
      expect(activeAiProvider()).toBeDefined();
    });
  });
});
