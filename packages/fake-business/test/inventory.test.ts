import { describe, expect, it } from "vitest";
import { checkInventory, buildInventory, generate, generateCompany } from "../src/index.js";

describe("mock inventory movements", () => {
  it("covers shipped trailer SKUs with explicit synthetic opening stock and no negative stock", () => {
    const dataset = generate({ industry: "trailer-dealer", seed: 42, months: 36 });
    const movements = buildInventory(dataset);
    expect(checkInventory(movements)).toEqual([]);
    expect(movements.some((movement) => movement.quantity < 0)).toBe(true);
    expect(movements.every((movement) => /^(UTILITY|CARGO|EQUIPMENT)-/.test(movement.sku))).toBe(true);
  });
  it("ships completed quoted sales despite mislabeled invoice job links", () => {
    const dataset = generateCompany("company-096");
    const movements = buildInventory(dataset);
    const quotes = new Map(dataset.quotes.map((quote) => [quote.id, quote]));
    const expected = dataset.jobs.filter((job) => job.status === "completed").flatMap((job) =>
      (quotes.get(job.quoteId ?? "")?.lineItems ?? []).filter((line) => /^(UTILITY|CARGO|EQUIPMENT)-/.test(line.sku)));
    expect(movements.filter((movement) => movement.quantity < 0)).toHaveLength(expected.length);
    expect(checkInventory(movements)).toEqual([]);
    for (const movement of movements.filter((movement) => movement.invoiceId !== null)) {
      const invoice = dataset.invoices.find((invoice) => invoice.id === movement.invoiceId)!;
      const job = dataset.jobs.find((job) => job.id === invoice.jobId)!;
      expect(job.customerId).toBe(invoice.customerId);
    }
  });
  it("detects an oversold SKU and noninteger quantities", () => {
    expect(checkInventory([{ id: "sale", sku: "TRAILER", date: "2026-09-30", quantity: -1, invoiceId: "inv_1" }])).toContainEqual(expect.objectContaining({ rule: "negative-stock" }));
    expect(checkInventory([{ id: "receipt", sku: "TRAILER", date: "2026-09-30", quantity: 0.5, invoiceId: null }])).toContainEqual(expect.objectContaining({ rule: "invalid-quantity" }));
  });
});
