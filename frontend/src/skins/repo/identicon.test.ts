import { describe, expect, it } from "vitest";
import { identicon } from "./identicon";

describe("identicon", () => {
  it("is a mirrored 5×5 pattern", () => {
    const { cells } = identicon("team-bot");
    expect(cells).toHaveLength(25);
    for (let row = 0; row < 5; row++) {
      expect(cells[row * 5]).toBe(cells[row * 5 + 4]);
      expect(cells[row * 5 + 1]).toBe(cells[row * 5 + 3]);
    }
  });

  it("is stable per name and differs between names", () => {
    expect(identicon("a")).toEqual(identicon("a"));
    expect(identicon("team")).not.toEqual(identicon("team-bot"));
    const { hue } = identicon("team");
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });
});
