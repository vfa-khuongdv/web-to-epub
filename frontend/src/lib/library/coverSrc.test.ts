import { afterEach, describe, expect, it } from "vitest";
import { setVaultToken } from "../../vault/token";
import { coverSrc } from "./coverSrc";

afterEach(() => setVaultToken(null));

describe("coverSrc", () => {
  it("has no source without a cover", () => {
    expect(coverSrc("s1", undefined)).toBeUndefined();
  });

  it("keeps the original address of a cover that was never downloaded", () => {
    expect(coverSrc("s1", "https://x.test/c.jpg")).toBe("https://x.test/c.jpg");
  });

  it("serves a saved cover through the app, carrying the private token", () => {
    expect(coverSrc("s 1", "covers/a.jpg")).toBe("/api/stories/s%201/cover?v=covers%2Fa.jpg");
    setVaultToken("tok");
    expect(coverSrc("s1", "covers/a.jpg")).toContain("vault=tok");
  });
});
