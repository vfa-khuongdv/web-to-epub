import { describe, expect, it } from "vitest";
import { parseScanReply, parseWriteReply, validateWrite, windowSegments } from "./plotTwistText";

describe("parseScanReply", () => {
  it("reads twists and clamps importance", () => {
    const reply = 'ok {"twists":[{"order":3,"title":"A","what":"  Hoá ra  anh là cha. ","importance":9}]}';
    expect(parseScanReply(reply, [2, 3])).toEqual([{ order: 3, title: "A", what: "Hoá ra anh là cha.", importance: 5 }]);
  });
  it("accepts an empty list", () => {
    expect(parseScanReply('{"twists":[]}', [1])).toEqual([]);
  });
  it("rejects a chapter that was not shown", () => {
    expect(() => parseScanReply('{"twists":[{"order":9,"what":"x"}]}', [1, 2])).toThrow(/not one of the chapters/);
  });
  it("rejects a reply without JSON", () => {
    expect(() => parseScanReply("no twist", [1])).toThrow(/JSON/);
  });
});

describe("write reply", () => {
  it("parses paragraphs", () => {
    expect(parseWriteReply('{"paragraphs":[" a  b ","", 3]}')).toEqual(["a b"]);
  });
  it("rejects short text, digits and symbols", () => {
    const words = (n: number) => Array(n).fill("từ").join(" ");
    expect(validateWrite([words(10)])).toMatch(/too short/);
    expect(validateWrite([words(130) + " 5"])).toMatch(/digits/);
    expect(validateWrite([words(130) + " *"])).toMatch(/symbol/);
    expect(validateWrite([words(130)])).toBeNull();
  });
});

describe("windowSegments", () => {
  it("groups segments by size and marks chapters", () => {
    const w = Array(60).fill("a").join(" ");
    const windows = windowSegments([{ order: 1, text: w }, { order: 2, text: w }, { order: 3, text: w }], 100);
    expect(windows.map((x) => x.orders)).toEqual([[1], [2], [3]]);
    expect(windows[1].text.startsWith("[Chương 2]")).toBe(true);
  });
});
