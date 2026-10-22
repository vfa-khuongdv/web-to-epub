import { describe, expect, it } from "vitest";
import { CONTACTS, DECOY_ITEMS, DECOY_MEMBERS, DECOY_SPACES } from "./fakeData";

// Words a disguise must not show: the app's own vocabulary, and addresses.
const GIVEAWAY = /https?:|www\.|truyện|chương|epub|kindle|novel|story|chapter|crawl/i;

describe("made-up conversations", () => {
  it("never mention the app or an address", () => {
    const texts = [
      ...CONTACTS.flatMap((contact) => [contact.name, ...contact.lines.map((line) => line.text)]),
      ...DECOY_ITEMS.flatMap((item) => Object.values(item).filter((value): value is string => typeof value === "string")),
      ...DECOY_SPACES.map((space) => space.name),
    ];
    for (const text of texts) expect(text).not.toMatch(GIVEAWAY);
  });

  it("only use members the decoy knows", () => {
    for (const item of DECOY_ITEMS) if (item.kind !== "day") expect(DECOY_MEMBERS[item.from]).toBeDefined();
  });

  it("give every contact a conversation", () => {
    expect(new Set(CONTACTS.map((contact) => contact.id)).size).toBe(CONTACTS.length);
    for (const contact of CONTACTS) expect(contact.lines.length).toBeGreaterThan(0);
  });
});
