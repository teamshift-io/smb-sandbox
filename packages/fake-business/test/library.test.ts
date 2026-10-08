import { describe, expect, it } from "vitest";
import { COMPANY_LIBRARY, generateCompany, generate, checkInvariants } from "../src/index.js";

describe("ready-made three-year company library", () => {
  it("has 100 distinct stable configurations spanning every existing industry", () => {
    expect(COMPANY_LIBRARY).toHaveLength(100);
    expect(new Set(COMPANY_LIBRARY.map((entry) => entry.id)).size).toBe(100);
    expect(new Set(COMPANY_LIBRARY.map((entry) => entry.options.industry)).size).toBeGreaterThanOrEqual(3);
    expect(COMPANY_LIBRARY.every((entry) => entry.options.months === 36)).toBe(true);
  });

  it("loads independent deterministic datasets without changing generate defaults", () => {
    const entry = COMPANY_LIBRARY[0]!;
    const first = generateCompany(entry.id);
    expect(first.meta.startDate).toBe("2023-10-01");
    expect(first).toEqual(generate(entry.options));
    first.company.name = "changed by caller";
    expect(generateCompany(entry.id).company.name).not.toBe(first.company.name);
    expect(generate({ industry: "home-services", seed: 42 }).meta.startDate).toBe("2025-10-01");
  });

  it("does not double-book staff in the calibrated three-year library", () => {
    for (const entry of COMPANY_LIBRARY) {
      expect(checkInvariants(generateCompany(entry.id)).violations.filter((issue) => issue.rule === "staff-overlap"), entry.id).toEqual([]);
    }
  });

  it("rejects unknown library IDs rather than silently selecting another company", () => {
    expect(() => generateCompany("company-missing")).toThrow(/Unknown company/);
  });
});
