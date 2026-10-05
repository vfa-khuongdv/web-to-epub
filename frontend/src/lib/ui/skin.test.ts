// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  REAL_HEAD,
  applyHead,
  faviconDataUri,
  isSkinId,
  readHeadCache,
  readSkin,
  saveSkin,
  writeHeadCache,
} from "./skin";

afterEach(() => {
  localStorage.clear();
  document.head.innerHTML = "";
});

describe("skin choice", () => {
  it("is the default skin until one is chosen, and the default is not stored", () => {
    expect(readSkin()).toBe("default");
    saveSkin("code");
    expect(readSkin()).toBe("code");
    saveSkin("default");
    expect(localStorage.getItem("skin")).toBeNull();
    expect(readSkin()).toBe("default");
  });

  it("ignores an unknown stored skin", () => {
    localStorage.setItem("skin", "word");
    expect(readSkin()).toBe("default");
    expect(isSkinId("sheet")).toBe(true);
    expect(isSkinId("word")).toBe(false);
  });
});

describe("head cache", () => {
  it("round-trips, and clears with null", () => {
    writeHeadCache({ title: "a.md — workspace", favicon: "data:x" });
    expect(readHeadCache()).toEqual({ title: "a.md — workspace", favicon: "data:x" });
    writeHeadCache(null);
    expect(readHeadCache()).toBeNull();
  });

  it("rejects a damaged entry", () => {
    localStorage.setItem("skin-head", JSON.stringify({ title: 3 }));
    expect(readHeadCache()).toBeNull();
    localStorage.setItem("skin-head", "{");
    expect(readHeadCache()).toBeNull();
  });
});

describe("applyHead", () => {
  it("sets the title and the icon link, creating the link when the page has none", () => {
    applyHead({ title: "Ngan_sach_Q4.xlsx", favicon: "data:image/svg+xml,abc" });
    expect(document.title).toBe("Ngan_sach_Q4.xlsx");
    const link = document.querySelector('link[rel="icon"]');
    expect(link?.getAttribute("href")).toBe("data:image/svg+xml,abc");
    expect(link?.getAttribute("type")).toBe("image/svg+xml");

    applyHead(REAL_HEAD);
    expect(document.title).toBe(REAL_HEAD.title);
    expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
    expect(document.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("/favicon.svg");
  });
});

describe("faviconDataUri", () => {
  it("draws the glyph as escaped SVG text", () => {
    const uri = faviconDataUri("<>", "#0e639c");
    expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
    const svg = decodeURIComponent(uri.slice("data:image/svg+xml,".length));
    expect(svg).toContain("&lt;&gt;");
    expect(svg).toContain('fill="#0e639c"');
    expect(svg).not.toContain("<>");
  });
});
