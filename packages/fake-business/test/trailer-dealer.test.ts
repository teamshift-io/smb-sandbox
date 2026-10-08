import { describe, expect, it } from "vitest";
import { generate, INDUSTRIES, COMPANY_LIBRARY } from "../src/index.js";

describe("trailer dealer", () => {
  it("generates trailer sales and servicing with coherent money, jobs and reserved contacts", () => {
    const dataset = generate({ industry: "trailer-dealer", seed: 42, months: 36 });
    expect(dataset.company.industry).toBe("trailer-dealer");
    expect(dataset.meta.startDate).toBe("2023-10-01");
    expect(dataset.jobs.some((job) => /trailer|hitch|brake/i.test(job.title))).toBe(true);
    expect(dataset.invoices.every((invoice) => invoice.totalCents === invoice.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0))).toBe(true);
    expect(dataset.company.website).toMatch(/\.example$/);
    expect(INDUSTRIES.some((industry) => industry.id === "trailer-dealer")).toBe(true);
    expect(COMPANY_LIBRARY.some((entry) => entry.options.industry === "trailer-dealer")).toBe(true);
  });
});
