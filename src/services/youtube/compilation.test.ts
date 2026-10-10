import { describe, expect, it } from "vitest";
import {
  FACEBOOK_PART_SECONDS,
  MAX_PART_SECONDS,
  compilationLabel,
  compilationVideoPath,
  maxPartSeconds,
  compilationMeta,
  compilationPlaylistTitle,
  planCompilationParts,
  timestamp,
  tocFor,
  withIntro,
} from "./compilation";

describe("planCompilationParts", () => {
  it("splits in chapter order under the limit", () => {
    const seconds = new Map([
      [1, 100],
      [2, 100],
      [3, 100],
      [4, 100],
    ]);
    // 250s fits two chapters; the third starts a new part.
    expect(planCompilationParts([1, 2, 3, 4], seconds, 250)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(planCompilationParts([1, 2, 3, 4], seconds, 10_000)).toEqual([[1, 2, 3, 4]]);
  });

  it("keeps a chapter longer than the limit in a part of its own", () => {
    const seconds = new Map([
      [1, 500],
      [2, 10],
    ]);
    expect(planCompilationParts([1, 2], seconds, 100)).toEqual([[1], [2]]);
  });
});

describe("timestamps and table of contents", () => {
  it("prints m:ss and h:mm:ss", () => {
    expect(timestamp(65)).toBe("1:05");
    expect(timestamp(3725)).toBe("1:02:05");
  });

  it("starts each part at 0:00 and accumulates the chapter lengths", () => {
    const seconds = new Map([
      [1, 60],
      [2, 125],
    ]);
    expect(tocFor([1, 2], seconds)).toEqual(["0:00 Chương 1", "1:00 Chương 2"]);
  });
});

describe("withIntro", () => {
  it("puts the 📖 line under the opening line when the render had no intro", () => {
    const description = '🎧 Nghe truyện audio "A".\n\n⏱️ Mục lục:\n0:00 Chương 1\n\n#A #TruyệnAudio';
    expect(withIntro(description, "Mở đầu.")).toBe(
      '🎧 Nghe truyện audio "A".\n\n📖 Mở đầu.\n\n⏱️ Mục lục:\n0:00 Chương 1\n\n#A #TruyệnAudio'
    );
  });

  it("replaces an intro the render already wrote", () => {
    const description = '🎧 Nghe truyện audio "A".\n\n📖 Cũ.\n\n⏱️ Mục lục:\n\n#A';
    expect(withIntro(description, "Mới.")).toBe('🎧 Nghe truyện audio "A".\n\n📖 Mới.\n\n⏱️ Mục lục:\n\n#A');
  });

  it("handles a record whose description was never written", () => {
    expect(withIntro("", "Mở đầu.")).toBe("📖 Mở đầu.");
  });
});

describe("compilation metadata", () => {
  const base = {
    storyTitle: "Truyện",
    channel: "Kênh Khác",
    labelWord: "Trọn bộ",
    intro: "Một câu giới thiệu.",
    toc: ["0:00 Chương 1", "1:00 Chương 2"],
    author: "Tác giả",
  };

  it("names parts, videos and the playlist the way the skill does", () => {
    expect(compilationLabel("Trọn bộ", 1, 3, 1, 50)).toBe("Trọn bộ Phần 1 (Chương 1-50)");
    expect(compilationLabel("Trọn bộ", 1, 1, 1, 50)).toBe("Trọn bộ (Chương 1-50)");
    expect(compilationPlaylistTitle("Truyện", "Truyện FM")).toBe("Truyện – Trọn bộ | Truyện FM");
  });

  it("builds the title, the timestamped description and the tags", () => {
    const meta = compilationMeta({ ...base, label: "Trọn bộ Phần 1 (Chương 1-50)" });
    expect(meta.title).toBe("Truyện – Trọn bộ Phần 1 (Chương 1–50) | Kênh Khác");
    expect(meta.description).toContain('🎧 Nghe truyện audio "Truyện" – Trọn bộ Phần 1 (Chương 1–50).');
    expect(meta.description).toContain("📖 Một câu giới thiệu.");
    expect(meta.description).toContain("⏱️ Mục lục:\n0:00 Chương 1\n1:00 Chương 2");
    expect(meta.description).toContain("✍️ Tác giả: Tác giả");
    expect(meta.description).toContain("kênh Kênh Khác");
    expect(meta.description).not.toContain("giải trí");
    expect(meta.description).toContain("#KênhKhác #Truyện #TruyệnAudio #NgheTruyện");
    expect(meta.tags).toContain("Truyện trọn bộ");
    expect(meta.tags).toContain("nghe truyện ngủ");
    expect(meta.playlistTitle).toBe("Truyện – Trọn bộ | Kênh Khác");
  });

  it("leaves the intro out when it is empty", () => {
    const meta = compilationMeta({ ...base, intro: "  ", label: "Trọn bộ (Chương 1-2)" });
    expect(meta.description).not.toContain("📖");
  });
});

describe("compilation platforms", () => {
  it("cuts Facebook parts to fit 4 hours and YouTube's to 11", () => {
    expect(maxPartSeconds("youtube")).toBe(MAX_PART_SECONDS);
    expect(maxPartSeconds("facebook")).toBe(FACEBOOK_PART_SECONDS);
    expect(FACEBOOK_PART_SECONDS).toBeLessThan(4 * 3600);
    // Ten one-hour chapters: three per Facebook part, all of them in one YouTube part.
    const seconds = new Map(Array.from({ length: 10 }, (_, i) => [i + 1, 3600] as [number, number]));
    const orders = [...seconds.keys()];
    expect(planCompilationParts(orders, seconds, maxPartSeconds("facebook")).map((part) => part.length)).toEqual([3, 3, 3, 1]);
    expect(planCompilationParts(orders, seconds, maxPartSeconds("youtube"))).toHaveLength(1);
  });

  it("writes Facebook parts to their own files", () => {
    expect(compilationVideoPath("s", 1, 20)).toBe("youtube/s/compilation-1-20.mp4");
    expect(compilationVideoPath("s", 1, 20, "facebook")).toBe("youtube/s/facebook-compilation-1-20.mp4");
  });
});
