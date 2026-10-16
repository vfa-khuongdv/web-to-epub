import { describe, expect, it } from "vitest";
import { chapterFromTwists, parseScanReply, windowSegments } from "./plotTwistText";

describe("parseScanReply", () => {
  const text = "[Chương 3]\nAnh nhìn cô.  Hoá ra anh là cha của cô.\nCô khóc.";
  it("reads twists, clamps importance and tolerates whitespace in the quote", () => {
    const reply = 'ok {"twists":[{"order":3,"title":"A","quote":" Hoá ra anh là   cha của cô. ","importance":9}]}';
    expect(parseScanReply(reply, [2, 3], text)).toEqual([{ order: 3, title: "A", quote: "Hoá ra anh là cha của cô.", importance: 5 }]);
  });
  it("accepts an empty list", () => {
    expect(parseScanReply('{"twists":[]}', [1], text)).toEqual([]);
  });
  it("rejects a chapter that was not shown", () => {
    expect(() => parseScanReply('{"twists":[{"order":9,"quote":"x"}]}', [1, 2], text)).toThrow(/not one of the chapters/);
  });
  it("rejects a quote that is not in the text", () => {
    expect(() => parseScanReply('{"twists":[{"order":3,"quote":"Anh là kẻ phản bội."}]}', [3], text)).toThrow(/word for word/);
  });
  it("rejects a quote that is too long", () => {
    const long = Array(81).fill("a").join(" ");
    expect(() => parseScanReply(JSON.stringify({ twists: [{ order: 3, quote: long }] }), [3], long)).toThrow(/longer than/);
  });
  it("rejects a reply without JSON", () => {
    expect(() => parseScanReply("no twist", [1], text)).toThrow(/JSON/);
  });
});

describe("chapterFromTwists", () => {
  it("keeps the strongest quotes in story order, without repeats", () => {
    const twist = (order: number, quote: string, importance: number) => ({ order, title: "", quote, importance });
    const all = [twist(9, "c", 5), twist(1, "a", 4), twist(5, "b", 3), twist(5, "b", 3), twist(7, "x", 1), twist(8, "y", 1), twist(2, "z", 1)];
    expect(chapterFromTwists(all)).toEqual(["a", "b", "x", "c"]);
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
