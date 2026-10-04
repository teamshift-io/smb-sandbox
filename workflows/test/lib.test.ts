import { describe, expect, it } from "vitest";
import { includesToken, keywordOverlap, mentionsMoney, moneyAmounts } from "../src/lib/text.js";
import { dateInZone, formatLocal, mentionsLocalTime, zonedTimeToUtcMs } from "../src/lib/time.js";
import { render } from "../src/lib/workflow.js";

describe("money parsing", () => {
  it("reads common dollar formats as cents", () => {
    expect(moneyAmounts("Total $1,234.56, deposit $500 and $ 99.5")).toEqual([123456, 50000, 9950]);
  });
  it("matches with tolerance", () => {
    expect(mentionsMoney("about $8,315", 831500)).toBe(true);
    expect(mentionsMoney("about $8,316", 831500)).toBe(false);
    expect(mentionsMoney("about $8,316", 831500, 100)).toBe(true);
  });
});

describe("tokens and keywords", () => {
  it("does not match a prefix of a longer number", () => {
    expect(includesToken("see Q-1284 attached", "Q-128")).toBe(false);
    expect(includesToken("see Q-1284.", "Q-1284")).toBe(true);
  });
  it("ignores filler words when comparing to a request", () => {
    expect(keywordOverlap("Thanks for reaching out, we'd love to help", "Can we talk about a rebuild?")).toBe(0);
    expect(keywordOverlap("Happy to quote both a tank and a tankless water heater", "water heater popping, tankless quote?")).toBeGreaterThanOrEqual(2);
  });
});

describe("timezones", () => {
  it("round-trips local wall-clock time", () => {
    const ms = zonedTimeToUtcMs("2026-10-07", 8, 0, "America/Chicago");
    expect(new Date(ms).toISOString()).toBe("2026-10-07T13:00:00.000Z");
    expect(dateInZone(ms, "America/Chicago")).toBe("2026-10-07");
    expect(formatLocal(ms, "America/Chicago")).toBe("Wed, Oct 7 at 8:00 AM");
  });
  it("recognizes the day and time written many ways", () => {
    const ms = Date.parse("2026-10-07T13:00:00Z");
    for (const text of ["Wed, Oct 7 at 8:00 AM", "October 7th at 8am", "10/7 at 8 a.m.", "2026-10-07 08:00"]) {
      expect(mentionsLocalTime(text, ms, "America/Chicago"), text).toBe(true);
    }
    expect(mentionsLocalTime("Oct 5 at 8:00 AM", ms, "America/Chicago")).toBe(false);
    expect(mentionsLocalTime("Oct 7 at 18:00", ms, "America/Chicago")).toBe(false);
  });
});

describe("templates", () => {
  it("fails loudly on unknown variables", () => {
    expect(render("Hi {{name}}", { name: "Ana" })).toBe("Hi Ana");
    expect(() => render("Hi {{nope}}", {})).toThrow(/nope/);
  });
});
