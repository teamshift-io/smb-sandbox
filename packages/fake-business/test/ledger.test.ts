import { describe, expect, it } from "vitest";
import { buildLedger, checkLedger, generate } from "../src/index.js";

describe("mock double-entry ledger", () => {
  it("balances posted invoices and payments and keeps unmatched cash in suspense", () => {
    const dataset = generate({ industry: "trailer-dealer", seed: 42 });
    const ledger = buildLedger(dataset);
    expect(checkLedger(ledger)).toEqual([]);
    expect(ledger.some((entry) => entry.lines.some((line) => line.account === "unapplied-cash"))).toBe(true);
    const cash = ledger.flatMap((entry) => entry.lines).filter((line) => line.account === "cash").reduce((sum, line) => sum + line.debitCents - line.creditCents, 0);
    expect(cash).toBe(dataset.payments.reduce((sum, payment) => sum + payment.amountCents, 0));
    const invoices = dataset.invoices.filter((invoice) => invoice.status !== "draft" && invoice.status !== "void");
    expect(ledger.filter((entry) => entry.sourceType === "invoice")).toHaveLength(invoices.length);
  });
  it("detects an unbalanced entry and unsafe money rather than rounding it", () => {
    const ledger = buildLedger(generate({ industry: "home-services", seed: 42 }));
    ledger[0]!.lines[0]!.debitCents++;
    expect(checkLedger(ledger)).toContainEqual(expect.objectContaining({ rule: "unbalanced-entry", entryId: ledger[0]!.id }));
    ledger[0]!.lines[0]!.debitCents = 0.5;
    expect(checkLedger(ledger)).toContainEqual(expect.objectContaining({ rule: "invalid-money" }));
  });
});
