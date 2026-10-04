// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentLang, LangProvider, translate, useLang } from "./index";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "";
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("translate", () => {
  it("returns English text for en and the key for unknown keys", () => {
    expect(translate("en", "Close")).toBe("Close");
    expect(translate("en", "no such key")).toBe("no such key");
  });

  it("uses the language's own entry", () => {
    expect(translate("vi", "Crawling")).toBe("Đang crawl");
  });

  it("fills placeholders and leaves unknown ones", () => {
    expect(translate("en", "Imported {title}", { title: "X" })).toBe("Imported X");
    expect(translate("en", "Crawling {done}/{total}", { done: 1 })).toBe("Crawling 1/{total}");
    expect(translate("en", "Crawling {done}/{total}", { done: 0, total: 0 })).toBe("Crawling 0/0");
  });
});

describe("currentLang", () => {
  it("defaults to vi, reads a saved language, ignores an unknown one", () => {
    expect(currentLang()).toBe("vi");
    localStorage.setItem("lang", "en");
    expect(currentLang()).toBe("en");
    localStorage.setItem("lang", "xx");
    expect(currentLang()).toBe("vi");
  });

  it("falls back when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(currentLang()).toBe("vi");
  });
});

describe("LangProvider / useLang", () => {
  it("starts from the saved language and persists it on the document", () => {
    localStorage.setItem("lang", "en");
    const { result } = renderHook(() => useLang(), { wrapper: LangProvider });
    expect(result.current.lang).toBe("en");
    expect(result.current.t("Imported {title}", { title: "B" })).toBe("Imported B");
    expect(document.documentElement.lang).toBe("en");
  });

  it("switches language, re-translates and saves", () => {
    localStorage.setItem("lang", "en");
    const { result } = renderHook(() => useLang(), { wrapper: LangProvider });
    act(() => result.current.setLang("vi"));
    expect(result.current.lang).toBe("vi");
    expect(result.current.t("Crawling")).toBe("Đang crawl");
    expect(localStorage.getItem("lang")).toBe("vi");
    expect(document.documentElement.lang).toBe("vi");
  });

  it("still switches when storage cannot be written", () => {
    localStorage.setItem("lang", "en");
    const { result } = renderHook(() => useLang(), { wrapper: LangProvider });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    act(() => result.current.setLang("vi"));
    expect(result.current.lang).toBe("vi");
  });

  it("works without a provider using the default language", () => {
    const { result } = renderHook(() => useLang());
    expect(result.current.lang).toBe("vi");
    expect(result.current.t("Crawling")).toBe("Đang crawl");
    expect(() => result.current.setLang("en")).not.toThrow();
  });
});
