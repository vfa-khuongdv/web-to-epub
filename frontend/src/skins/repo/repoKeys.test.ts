import { describe, expect, it } from "vitest";
import { KeyInput, RepoPlace, keyAction } from "./repoKeys";

const press = (key: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
});

const run = (input: KeyInput, place: RepoPlace, pendingG = false) => keyAction(input, { place, pendingG });

describe("keyAction", () => {
  it("opens the palette from / , s and Ctrl/Cmd+K everywhere", () => {
    for (const place of ["home", "repo", "blob"] as const) {
      expect(run(press("/"), place).action).toBe("palette");
      expect(run(press("s"), place).action).toBe("palette");
      expect(run(press("k", { ctrlKey: true }), place).action).toBe("palette");
      expect(run(press("K", { metaKey: true }), place).action).toBe("palette");
    }
  });

  it("leaves other modified keys to the browser", () => {
    expect(run(press("f", { ctrlKey: true }), "blob").action).toBeNull();
    expect(run(press("]", { altKey: true }), "blob").action).toBeNull();
    expect(run(press("k", { ctrlKey: true, altKey: true }), "blob").action).toBeNull();
  });

  it("steps through files only while one is open", () => {
    expect(run(press("]"), "blob").action).toBe("next");
    expect(run(press("j"), "blob").action).toBe("next");
    expect(run(press("["), "blob").action).toBe("previous");
    expect(run(press("k"), "blob").action).toBe("previous");
    expect(run(press("Escape"), "blob").action).toBe("up");
    expect(run(press("]"), "repo").action).toBeNull();
    expect(run(press("Escape"), "repo").action).toBeNull();
  });

  it("finds a file with t inside a repository", () => {
    expect(run(press("t"), "repo").action).toBe("find-file");
    expect(run(press("t"), "home").action).toBeNull();
  });

  it("waits for the letter after g", () => {
    expect(run(press("g"), "repo")).toEqual({ action: null, pendingG: true });
    expect(run(press("a"), "repo", true)).toEqual({ action: "go-actions", pendingG: false });
    expect(run(press("c"), "blob", true).action).toBe("go-code");
    expect(run(press("i"), "repo", true).action).toBe("go-issues");
    expect(run(press("p"), "repo", true).action).toBe("go-pulls");
    expect(run(press("s"), "repo", true).action).toBe("go-settings");
    expect(run(press("d"), "repo", true).action).toBe("go-home");
    // An unknown letter ends the chord without doing anything.
    expect(run(press("x"), "repo", true)).toEqual({ action: null, pendingG: false });
  });

  it("has no repository sections on the list", () => {
    expect(run(press("c"), "home", true).action).toBeNull();
    expect(run(press("d"), "home", true).action).toBe("go-home");
  });
});
