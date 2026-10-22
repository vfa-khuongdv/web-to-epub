import { describe, expect, it } from "vitest";
import { DEFAULT_INTRO, introSentence, spokenTitle } from "./intro";

describe("introSentence", () => {
  it("names the channel and the story, without the author", () => {
    expect(introSentence("", { channel: "Truyện FM", title: "Hoàng Tử Bé – Antoine De Saint-Exupéry" })).toBe(
      "Chào mừng các bạn đến với kênh Truyện FM. Sau đây, mời các bạn cùng nghe truyện Hoàng Tử Bé."
    );
  });

  it("uses the person's own wording and tidies the spaces", () => {
    expect(introSentence("  Xin chào   từ {channel}!  Truyện: {title}.", { channel: "K", title: "A - B" })).toBe(
      "Xin chào từ K! Truyện: A."
    );
  });

  it("keeps a title that has no author part, and caps the length", () => {
    expect(spokenTitle("Đầu Xuân Tươi Sáng")).toBe("Đầu Xuân Tươi Sáng");
    expect(introSentence("x".repeat(900), { channel: "K", title: "T" })).toHaveLength(400);
    expect(DEFAULT_INTRO).toContain("{channel}");
  });
});
