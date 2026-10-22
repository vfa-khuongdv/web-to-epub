import { describe, expect, it } from "vitest";
import { ChapterLine } from "../../lib/skins/chapterLines";
import {
  ConversationItem,
  MEMBERS,
  buildConversation,
  castFor,
  dayLabel,
  seeded,
  threadDate,
  threadLines,
} from "./threadModel";

const today = new Date(2026, 9, 6); // a Tuesday

function paragraphs(count: number): ChapterLine[] {
  return Array.from({ length: count }, (_, index) => ({ kind: "text" as const, text: `Đoạn ${index + 1}` }));
}

const groups = (items: ConversationItem[]) =>
  items.filter((item): item is Extract<ConversationItem, { kind: "group" }> => item.kind === "group");

function minutes(time: string): number {
  const [, hours, mins, suffix] = /^(\d+):(\d+) (AM|PM)$/.exec(time)!;
  return ((Number(hours) % 12) + (suffix === "PM" ? 12 : 0)) * 60 + Number(mins);
}

describe("thread dates", () => {
  it("counts back in working days", () => {
    expect(threadDate(today, 0).getDate()).toBe(6);
    expect(threadDate(today, 1)).toEqual(new Date(2026, 9, 5)); // the Monday
    // Two working days back from Tuesday is the Friday before.
    expect(threadDate(today, 2)).toEqual(new Date(2026, 9, 2));
    expect(threadDate(today, 5)).toEqual(new Date(2026, 8, 29));
    for (let days = 0; days < 30; days++) {
      const day = threadDate(today, days).getDay();
      if (days > 0) expect([0, 6]).not.toContain(day);
    }
  });

  it("says Today, Yesterday, or the weekday and date", () => {
    expect(dayLabel(today, today)).toBe("Today");
    expect(dayLabel(new Date(2026, 9, 5), today)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 2), today)).toBe("Friday, October 2");
    expect(dayLabel(new Date(2024, 1, 29), today)).toBe("Thursday, February 29, 2024");
  });
});

describe("the cast", () => {
  it("picks four different colleagues per space, the same each time", () => {
    const cast = castFor("story-a");
    expect(cast).toHaveLength(4);
    expect(new Set(cast.map((member) => member.id)).size).toBe(4);
    expect(castFor("story-a")).toEqual(cast);
    for (const member of cast) expect(MEMBERS).toContain(member);
  });

  it("draws numbers in [0, 1) from a seed", () => {
    const a = seeded(42);
    const b = seeded(42);
    for (let index = 0; index < 20; index++) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("buildConversation", () => {
  const options = { spaceKey: "story-a", order: 3, date: today, today };

  it("is the same every time for the same thread", () => {
    const lines = paragraphs(40);
    expect(buildConversation(lines, options)).toEqual(buildConversation(lines, options));
    expect(buildConversation(lines, { ...options, order: 4 })).not.toEqual(buildConversation(lines, options));
  });

  it("opens with the day and keeps every line, in order", () => {
    const lines: ChapterLine[] = [
      { kind: "text", text: "Một" },
      { kind: "media", text: "[image: minh họa]" },
      { kind: "heading", text: "Phần hai" },
      { kind: "text", text: "Hai" },
    ];
    const items = buildConversation(lines, options);
    expect(items[0]).toEqual({ kind: "day", key: "day", label: "Today" });
    const shown: number[] = [];
    for (const item of items) {
      if (item.kind === "heading") shown.push(item.line);
      if (item.kind === "group") shown.push(...item.messages.map((message) => message.line));
    }
    expect(shown).toEqual([0, 1, 2, 3]);
    const media = groups(items).flatMap((group) => group.messages).find((message) => message.line === 1);
    expect(media).toMatchObject({ kind: "media", text: "[image: minh họa]" });
    expect(items.find((item) => item.kind === "heading")).toMatchObject({ text: "Phần hai", line: 2 });
  });

  it("groups runs of one to three messages, never the same sender twice in a row", () => {
    const items = buildConversation(paragraphs(200), options);
    const runs = groups(items);
    for (const group of runs) {
      expect(group.messages.length).toBeGreaterThanOrEqual(1);
      expect(group.messages.length).toBeLessThanOrEqual(3);
    }
    for (let index = 1; index < runs.length; index++) expect(runs[index].member).not.toBe(runs[index - 1].member);
  });

  it("starts a new group after a heading", () => {
    const lines: ChapterLine[] = [
      { kind: "text", text: "a" },
      { kind: "heading", text: "H" },
      { kind: "text", text: "b" },
    ];
    const items = buildConversation(lines, options);
    expect(items.map((item) => item.kind)).toEqual(["day", "group", "heading", "group"]);
  });

  it("keeps times in office hours and never going back, however long the thread", () => {
    for (const count of [3, 60, 2000]) {
      const times = groups(buildConversation(paragraphs(count), options)).map((group) => minutes(group.time));
      expect(times[0]).toBeGreaterThanOrEqual(8 * 60 + 30);
      expect(times[times.length - 1]).toBeLessThanOrEqual(17 * 60 + 50);
      for (let index = 1; index < times.length; index++) expect(times[index]).toBeGreaterThanOrEqual(times[index - 1]);
    }
  });

  it("draws an empty thread as its day alone", () => {
    expect(buildConversation([], options)).toEqual([{ kind: "day", key: "day", label: "Today" }]);
  });
});

describe("what a thread shows of a chapter", () => {
  const heading = (text: string): ChapterLine => ({ kind: "heading", text });
  const text = (value: string): ChapterLine => ({ kind: "text", text: value });

  it("leaves the chapter's own title heading out, neutral names or not", () => {
    const lines = [heading("Chương 3: Gặp lại"), text("Đoạn 1"), text("Đoạn 2")];
    expect(threadLines(lines, { title: "Chương 3: Gặp lại", titleDropped: false })).toEqual([text("Đoạn 1"), text("Đoạn 2")]);
    // Neutral names took the heading already: a second one is not taken for the title.
    const afterHook = [heading("Ngày đầu tiên"), text("Đoạn 1")];
    expect(threadLines(afterHook, { title: "Chương 3", titleDropped: true })).toEqual([heading("Ngày đầu tiên"), text("Đoạn 1")]);
  });

  it("leaves a title written out as a paragraph out too", () => {
    const lines = [heading("Chương 3"), text("Chương 3: Gặp lại"), text("Đoạn 1")];
    expect(threadLines(lines, { title: "Chương 3: Gặp lại", titleDropped: false })).toEqual([text("Đoạn 1")]);
    expect(threadLines([text("Gặp lại"), text("Đoạn 1")], { title: "Gặp lại", titleDropped: true })).toEqual([text("Đoạn 1")]);
  });

  it("takes part labels off later headings and drops lines that were only one", () => {
    const lines = [heading("Mở đầu"), text("Đoạn 1"), heading("Chương 4: Mưa"), text("Chương 5"), heading("Chapter 6"), text("Đoạn 2")];
    expect(threadLines(lines, { title: "Mở đầu", titleDropped: false })).toEqual([text("Đoạn 1"), heading("Mưa"), text("Đoạn 2")]);
  });

  it("keeps paragraphs that merely start like a label, and pictures", () => {
    const lines = [heading("Chương 1"), text("Hồi 3 giờ sáng, trời mưa."), { kind: "media" as const, text: "[image]" }];
    expect(threadLines(lines, { title: "Chương 1", titleDropped: false })).toEqual(lines.slice(1));
  });
});
