import { describe, expect, it } from "vitest";
import { CALIBRATION, generate, COMPANY_LIBRARY } from "../src/index.js";

describe("source-bound aggregate calibration", () => {
  it("records source vintage and calculations, with explicit broad-industry proxies", () => {
    for (const profile of Object.values(CALIBRATION)) {
      expect(profile.cbp.employeesPerEstablishment).toBeCloseTo(profile.cbp.employees / profile.cbp.establishments);
      expect(profile.susb.smallFirmShare).toBeCloseTo(profile.susb.firmsUnder20 / profile.susb.firms);
      expect(profile.sources.every((source) => source.url.startsWith("https://"))).toBe(true);
    }
    expect(CALIBRATION["trailer-dealer"].cbp.naicsVintage).toBe(2017);
    expect(CALIBRATION["trailer-dealer"].proxy).toBe(true);
  });
  it("calibrates medium staffing only when selected and embeds provenance in metadata", () => {
    const calibrated = generate({ industry: "home-services", seed: 42, calibrated: true });
    expect(calibrated.employees.filter((employee) => employee.active)).toHaveLength(Math.round(CALIBRATION["home-services"].cbp.employeesPerEstablishment));
    expect(calibrated.meta.calibration).toMatchObject({ cbp: { year: 2023 }, susb: { year: 2022 }, oews: { year: 2023 } });
    expect(generate({ industry: "home-services", seed: 42 }).meta.calibration).toBeUndefined();
    expect(COMPANY_LIBRARY.every((entry) => entry.options.calibrated)).toBe(true);
  });
});
