import { describe, expect, it } from "vitest";
import { chapterOpening, descriptionFor, hashtagFromTitle, playlistTitle, tagsFor, videoTitle } from "./meta";

describe("YouTube metadata", () => {
  it("names the playlist the way the upload skill does", () => {
    expect(playlistTitle("Nữ Phụ Hằng Ngày Cầu Ly Hôn", "Truyện FM")).toBe(
      "Nữ Phụ Hằng Ngày Cầu Ly Hôn – Truyện Audio Full | Truyện FM"
    );
  });

  it("writes the video title and keeps it under YouTube's limit", () => {
    expect(videoTitle("Đầu Xuân Tươi Sáng", 4, "Truyện FM")).toBe("Đầu Xuân Tươi Sáng – Chương 4 | Truyện FM");
    expect(videoTitle("x".repeat(120), 4, "Truyện FM").length).toBeLessThanOrEqual(100);
  });

  it("strips < and >", () => {
    expect(videoTitle("A <B>", 1, "T")).toBe("A B – Chương 1 | T");
  });

  it("builds the description from the skill template and omits unknown credits", () => {
    const full = descriptionFor({
      storyTitle: "A",
      order: 2,
      channel: "Truyện FM",
      summary: "Tóm tắt.",
      author: "Tác giả",
      scheduleTime: "18:00",
    });
    expect(full).toContain(chapterOpening("A", 2));
    expect(full).not.toContain("giải trí");
    expect(full).toContain("📖 Tóm tắt.");
    expect(full).toContain("✍️ Tác giả: Tác giả");
    expect(full).not.toContain("🌐 Dịch:");
    expect(full).toContain("⏰ Cập nhật mỗi tối lúc 18:00.");
    expect(full).toContain("#TruyệnFM #A #TácGiả #TruyệnAudio #NgheTruyện");

    const bare = descriptionFor({ storyTitle: "A", order: 1, channel: "Truyện FM" });
    expect(bare).not.toContain("📖");
    expect(bare).not.toContain("✍️");
  });

  it("lists the skill's tags with the genre tags", () => {
    expect(tagsFor({ storyTitle: "A", order: 3, channel: "Truyện FM", genreTags: "truyện ngôn tình, xuyên sách" })).toEqual([
      "A",
      "truyện audio",
      "nghe truyện",
      "Truyện FM",
      "A chương 3",
      "truyện ngôn tình",
      "xuyên sách",
      "nghe truyện đêm khuya",
    ]);
  });

  it("takes the channel hashtag from the configured channel, not a hard-coded one", () => {
    const other = descriptionFor({ storyTitle: "A", order: 1, channel: "Kênh Khác" });
    expect(other).toContain("kênh Kênh Khác");
    expect(other).toContain("#KênhKhác #A #TruyệnAudio #NgheTruyện");
    expect(other).not.toContain("#TruyệnFM");
    // An empty channel leaves the other hashtags alone.
    expect(descriptionFor({ storyTitle: "A", order: 1, channel: "" })).toContain("#A #TruyệnAudio #NgheTruyện");
  });

  it("turns the story title into a hashtag", () => {
    expect(hashtagFromTitle("nữ phụ hằng ngày cầu ly hôn")).toBe("NữPhụHằngNgàyCầuLyHôn");
  });

  it("keeps the author and punctuation out of hashtags and tags", () => {
    const title = "Hoàng Tử Bé – Antoine De Saint-Exupéry";
    expect(hashtagFromTitle("Anh, Em! (Tập 2)")).toBe("AnhEmTập2");
    const description = descriptionFor({ storyTitle: title, order: 1, channel: "K" });
    expect(description).toContain("#K #HoàngTửBé #AntoineDeSaintExupéry #TruyệnAudio");
    // The author field wins over the title's suffix, and a repeat is not listed twice.
    expect(descriptionFor({ storyTitle: title, order: 1, channel: "K", author: "Antoine De Saint-Exupéry" })).toContain("#HoàngTửBé #AntoineDeSaintExupéry #TruyệnAudio");
    expect(descriptionFor({ storyTitle: "A", order: 1, channel: "K", author: "A" })).toContain("#K #A #TruyệnAudio");
    expect(tagsFor({ storyTitle: title, order: 1, channel: "K" })).toContain("Hoàng Tử Bé chương 1");
  });
});

describe("description variety", () => {
  it("does not repeat the same opening and call to action across chapters, but is stable per chapter", () => {
    const texts = Array.from({ length: 12 }, (_, i) => descriptionFor({ storyTitle: "A", order: i + 1, channel: "K" }));
    expect(new Set(texts.map((text) => text.split("\n")[0])).size).toBeGreaterThan(1);
    expect(new Set(texts.map((text) => text.split("\n").find((line) => line.includes("kênh K")))).size).toBeGreaterThan(1);
    expect(descriptionFor({ storyTitle: "A", order: 3, channel: "K" })).toBe(texts[2]);
  });
});
