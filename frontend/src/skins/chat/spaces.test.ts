import { describe, expect, it } from "vitest";
import { hashString } from "../../lib/skins/hash";
import {
  badgeText,
  clockText,
  listTime,
  memberCount,
  pageBounds,
  pageCount,
  pageOfIndex,
  spaceInitials,
  spaceName,
  threadLabel,
  toneFor,
  unreadEstimate,
  unreadExact,
  withoutPartLabel,
} from "./spaces";

// A stand-in for t(): the English source with its placeholders filled.
const t = (key: string, params: Record<string, string | number> = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
const vi = (key: string, params: Record<string, string | number> = {}) =>
  t(key === "Team {n}" ? "Nhóm {n}" : key === "Thread {n}" ? "Chủ đề {n}" : key, params);

describe("space and thread names", () => {
  it("uses the folder slug, or a numbered team with neutral names on", () => {
    expect(spaceName("Trở về thời niên thiếu", 0, false, t)).toBe("tro-ve-thoi-nien-thieu");
    expect(spaceName("Trở về thời niên thiếu", 2, true, t)).toBe("Team 03");
    expect(spaceName("Trở về thời niên thiếu", 2, true, vi)).toBe("Nhóm 03");
    expect(spaceName("", 4, false, t)).toBe("module-05");
  });

  it("names a thread after its chapter, without the part label, only when titles may show", () => {
    expect(threadLabel(12, "Chương 12:  Gặp lại ", false, t)).toBe("Gặp lại");
    expect(threadLabel(12, "Chương 12", false, t)).toBe("Thread 0012");
    expect(threadLabel(12, "Chương 12: Gặp lại", true, t)).toBe("Thread 0012");
    expect(threadLabel(12, "Chương 12: Gặp lại", true, vi)).toBe("Chủ đề 0012");
    expect(threadLabel(7, "   ", false, t)).toBe("Thread 0007");
    expect(threadLabel(3, "Bữa trưa ở quán cũ", false, t)).toBe("Bữa trưa ở quán cũ");
  });

  it("takes two initials for a space avatar", () => {
    expect(spaceInitials("tro-ve-thoi")).toBe("TV");
    expect(spaceInitials("Nhóm 03")).toBe("N0");
    expect(spaceInitials("Đối soát Q4")).toBe("ĐS");
    expect(spaceInitials("")).toBe("#");
  });
});

describe("part labels", () => {
  it("takes a leading chapter label off and keeps the subtitle", () => {
    expect(withoutPartLabel("Chương 3: Gặp lại")).toBe("Gặp lại");
    expect(withoutPartLabel("Chương 3 - Gặp lại")).toBe("Gặp lại");
    expect(withoutPartLabel("Chương 3 Gặp lại")).toBe("Gặp lại");
    expect(withoutPartLabel("chương 10.5. Ngoại lệ")).toBe("Ngoại lệ");
    expect(withoutPartLabel("Chapter 12 – The Return")).toBe("The Return");
    expect(withoutPartLabel("CHAPTER IV")).toBe("");
    expect(withoutPartLabel("Chương thứ nhất: Mở màn")).toBe("Mở màn");
    expect(withoutPartLabel("Chương cuối")).toBe("");
    expect(withoutPartLabel("[Chương 7] Mưa")).toBe("Mưa");
    expect(withoutPartLabel("第十二章 归来")).toBe("归来");
  });

  it("takes several labels off one title", () => {
    expect(withoutPartLabel("Quyển 2 - Chương 5: Sương sớm")).toBe("Sương sớm");
    expect(withoutPartLabel("Quyển 2 Chương 5")).toBe("");
    expect(withoutPartLabel("Hồi 3: Lên đường")).toBe("Lên đường");
    expect(withoutPartLabel("Tập 1")).toBe("");
    expect(withoutPartLabel("Ngoại truyện 2: Mùa hạ")).toBe("Mùa hạ");
    expect(withoutPartLabel("Prologue")).toBe("");
  });

  it("leaves everyday words that only look like labels", () => {
    expect(withoutPartLabel("Hồi 3 giờ sáng")).toBe("Hồi 3 giờ sáng");
    expect(withoutPartLabel("Hồi năm đó")).toBe("Hồi năm đó");
    expect(withoutPartLabel("Phần mềm mới")).toBe("Phần mềm mới");
    expect(withoutPartLabel("Part of the plan")).toBe("Part of the plan");
    expect(withoutPartLabel("Chương trình họp")).toBe("Chương trình họp");
    expect(withoutPartLabel("12 giờ trưa")).toBe("12 giờ trưa");
  });

  it("reads decomposed Vietnamese the same", () => {
    expect(withoutPartLabel("Chương 3: Gặp lại".normalize("NFD"))).toBe("Gặp lại");
  });
});

describe("made-up details", () => {
  it("are stable for the same id", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
    expect(toneFor("story-1")).toBe(toneFor("story-1"));
  });

  it("stay in range", () => {
    for (const id of ["a", "b", "c", "story-42", "x".repeat(50)]) {
      expect(toneFor(id)).toBeGreaterThanOrEqual(1);
      expect(toneFor(id)).toBeLessThanOrEqual(8);
      expect(memberCount(id)).toBeGreaterThanOrEqual(4);
      expect(memberCount(id)).toBeLessThanOrEqual(15);
    }
  });
});

describe("unread threads", () => {
  it("counts everything as unread before the space was ever opened", () => {
    expect(unreadEstimate(12, null)).toBe(12);
    expect(unreadExact([1, 2, 3], null)).toBe(3);
  });

  it("counts the threads after the saved one", () => {
    expect(unreadEstimate(12, 5)).toBe(7);
    expect(unreadEstimate(12, 40)).toBe(0);
    expect(unreadExact([1, 2, 4, 9], 2)).toBe(2);
  });

  it("caps the badge", () => {
    expect(badgeText(7)).toBe("7");
    expect(badgeText(100)).toBe("99+");
  });
});

describe("paging", () => {
  it("splits a long list into pages", () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(1234, 50)).toBe(25);
    expect(pageOfIndex(0, 50)).toBe(0);
    expect(pageOfIndex(1233, 50)).toBe(24);
    expect(pageOfIndex(-1, 50)).toBe(0);
    expect(pageBounds(24, 50, 1234)).toEqual({ start: 1200, end: 1234 });
    expect(pageBounds(99, 50, 120)).toEqual({ start: 100, end: 120 });
    expect(pageBounds(0, 50, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe("times", () => {
  it("prints a twelve-hour clock", () => {
    expect(clockText(9 * 60 + 5)).toBe("9:05 AM");
    expect(clockText(12 * 60)).toBe("12:00 PM");
    expect(clockText(0)).toBe("12:00 AM");
    expect(clockText(17 * 60 + 42)).toBe("5:42 PM");
  });

  it("shows the clock today, the date before, the year when not this one", () => {
    const now = new Date(2026, 9, 6, 15, 0);
    expect(listTime(new Date(2026, 9, 6, 8, 30).toISOString(), now)).toBe("8:30 AM");
    expect(listTime(new Date(2026, 8, 29, 8, 30).toISOString(), now)).toBe("Sep 29");
    expect(listTime(new Date(2025, 0, 2, 8, 30).toISOString(), now)).toBe("Jan 2, 2025");
    expect(listTime("not a date", now)).toBe("");
  });
});
