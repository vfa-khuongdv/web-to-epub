import { describe, expect, it } from "vitest";
import { distributeSchedule, isoFromLocalInput, localInputValue, tomorrowLocalDate } from "./schedule";

describe("distributeSchedule", () => {
  it("spreads chapters per day from the start date at the given time, in order", () => {
    const schedule = distributeSchedule([3, 1, 2], "2026-10-09", "18:00", 2);
    expect(Object.keys(schedule)).toEqual(["1", "2", "3"]);
    expect(schedule[1]).toMatch(/^2026-10-09T18:00:00[+-]\d{2}:\d{2}$/);
    expect(schedule[2]).toMatch(/^2026-10-09T18:00:00/);
    expect(schedule[3]).toMatch(/^2026-10-10T18:00:00/);
  });

  it("returns nothing for a bad date, time or per-day count", () => {
    expect(distributeSchedule([1], "not-a-date", "18:00", 1)).toEqual({});
    expect(distributeSchedule([1], "2026-10-09", "nope", 1)).toEqual({});
    expect(distributeSchedule([1], "2026-10-09", "18:00", 0)).toEqual({});
  });
});

describe("datetime-local helpers", () => {
  it("round-trips a local input value", () => {
    const iso = isoFromLocalInput("2026-10-09T18:00");
    expect(iso).toMatch(/^2026-10-09T18:00:00[+-]\d{2}:\d{2}$/);
    expect(localInputValue(iso)).toBe("2026-10-09T18:00");
  });

  it("ignores empty or unparsable values", () => {
    expect(isoFromLocalInput("")).toBeUndefined();
    expect(localInputValue(undefined)).toBe("");
    expect(localInputValue("nonsense")).toBe("");
  });
});

describe("tomorrowLocalDate", () => {
  it("is the next calendar day, not 24 hours later", () => {
    expect(tomorrowLocalDate(new Date(2026, 9, 8, 23, 30))).toBe("2026-10-09");
    expect(tomorrowLocalDate(new Date(2026, 11, 31, 0, 5))).toBe("2027-01-01");
  });
});
