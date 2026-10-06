import { describe, expect, it } from "vitest";
import { endedCrawls } from "./useCrawlVersions";

describe("endedCrawls", () => {
  it("lists the stories that left the live channel", () => {
    expect(endedCrawls("a,b,c", "b")).toEqual(["a", "c"]);
    expect(endedCrawls("", "a")).toEqual([]);
    expect(endedCrawls("a", "a,b")).toEqual([]);
  });
});
