import { describe, expect, it } from "vitest";
import { descriptionFor, hashtagFromTitle, playlistTitle, tagsFor, videoTitle } from "./meta";

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
    expect(full).toContain('🎧 Nghe truyện audio "A" – Chương 2.');
    expect(full).toContain("📖 Tóm tắt.");
    expect(full).toContain("✍️ Tác giả: Tác giả");
    expect(full).not.toContain("🌐 Dịch:");
    expect(full).toContain("⏰ Cập nhật mỗi tối lúc 18:00.");
    expect(full).toContain("#TruyệnFM #A #TruyệnAudio #NgheTruyện");

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
    expect(other).toContain("Đăng ký kênh Kênh Khác");
    expect(other).toContain("#KênhKhác #A #TruyệnAudio #NgheTruyện");
    expect(other).not.toContain("#TruyệnFM");
    // An empty channel leaves the other hashtags alone.
    expect(descriptionFor({ storyTitle: "A", order: 1, channel: "" })).toContain("#A #TruyệnAudio #NgheTruyện");
  });

  it("turns the story title into a hashtag", () => {
    expect(hashtagFromTitle("nữ phụ hằng ngày cầu ly hôn")).toBe("NữPhụHằngNgàyCầuLyHôn");
  });
});
