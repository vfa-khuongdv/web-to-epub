import { describe, expect, it } from "vitest";
import { heyzineId, isHeyzineUrl } from "./heyzineUrl";

describe("heyzineUrl", () => {
  it("accepts a Heyzine flipbook", () => {
    expect(heyzineId("https://heyzine.com/flip-book/19b8fa685a.html")).toBe("19b8fa685a");
    expect(heyzineId("https://www.heyzine.com/flip-book/19b8fa685a.html#page/6")).toBe("19b8fa685a");
    expect(isHeyzineUrl("https://heyzine.com/flip-book/8088bfc321.html?foo=1")).toBe(true);
  });

  it("rejects other pages of the same site and any other host", () => {
    expect(isHeyzineUrl("https://heyzine.com/")).toBe(false);
    expect(isHeyzineUrl("https://heyzine.com/flip-book")).toBe(false);
    expect(isHeyzineUrl("https://cdnm.heyzine.com/files/uploaded/x.pdf")).toBe(false);
    expect(isHeyzineUrl("https://example.com/flip-book/19b8fa685a.html")).toBe(false);
    expect(isHeyzineUrl("not a url")).toBe(false);
  });
});
