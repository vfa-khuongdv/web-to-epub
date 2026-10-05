import { describe, expect, it } from "vitest";
import { en } from "../i18n/locales/en";
import { vi } from "../i18n/locales/vi";
import { SKIN_IDS } from "../lib/ui/skin";
import { SKINS } from "./registry";

// Product names that are trademarks: a lookalike may resemble the program, never claim it.
const TRADEMARKS = /visual studio|vs ?code|excel|microsoft|office|google|word\b/i;

describe("skin registry", () => {
  it("defines every skin id, each with a decoy", () => {
    expect(Object.keys(SKINS).sort()).toEqual([...SKIN_IDS].sort());
    for (const id of SKIN_IDS) {
      expect(SKINS[id].id).toBe(id);
      expect(SKINS[id].decoy.Component).toBeTypeOf("function");
      expect(SKINS[id].decoy.head.title).not.toBe("");
    }
  });

  it("gives every skin but the default a shell", () => {
    expect(SKINS.default.Shell).toBeUndefined();
    expect(SKINS.code.Shell).toBeDefined();
    expect(SKINS.sheet.Shell).toBeDefined();
  });

  it("never names another product in a tab title", () => {
    for (const id of SKIN_IDS) {
      expect(SKINS[id].head.title).not.toMatch(TRADEMARKS);
      expect(SKINS[id].decoy.head.title).not.toMatch(TRADEMARKS);
    }
  });

  it("has its settings labels translated", () => {
    for (const id of SKIN_IDS) {
      expect(en[SKINS[id].label]).toBeDefined();
      expect(vi[SKINS[id].label]).toBeDefined();
    }
  });
});
