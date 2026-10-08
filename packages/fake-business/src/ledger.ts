import type { Dataset } from "./schema.js";

export type LedgerAccount = "cash" | "accounts-receivable" | "sales" | "unapplied-cash";
export interface LedgerLine { account: LedgerAccount; debitCents: number; creditCents: number }
export interface LedgerEntry {
  id: string;
  sourceType: "invoice" | "payment";
  sourceId: string;
  date: string;
  lines: LedgerLine[];
}
export interface LedgerViolation { rule: "invalid-money" | "unbalanced-entry"; entryId: string }

/** Illustrative accrual ledger, not tax/accounting advice or a production posting adapter. */
export function buildLedger(dataset: Dataset): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  const posted = new Set<string>();
  const pair = (debit: LedgerAccount, credit: LedgerAccount, amount: number): LedgerLine[] => {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("Ledger amounts must be non-negative integer cents");
    return [{ account: debit, debitCents: amount, creditCents: 0 }, { account: credit, debitCents: 0, creditCents: amount }];
  };
  for (const invoice of dataset.invoices) {
    if (invoice.status === "draft" || invoice.status === "void") continue;
    posted.add(invoice.id);
    entries.push({ id: `ledger_${invoice.id}`, sourceType: "invoice", sourceId: invoice.id, date: invoice.issuedOn,
      lines: pair("accounts-receivable", "sales", invoice.totalCents) });
  }
  for (const payment of dataset.payments) {
    entries.push({ id: `ledger_${payment.id}`, sourceType: "payment", sourceId: payment.id, date: payment.receivedAt.slice(0, 10),
      lines: pair("cash", payment.invoiceId !== null && posted.has(payment.invoiceId) ? "accounts-receivable" : "unapplied-cash", payment.amountCents) });
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function checkLedger(entries: readonly LedgerEntry[]): LedgerViolation[] {
  const violations: LedgerViolation[] = [];
  for (const entry of entries) {
    if (entry.lines.some((line) => !Number.isSafeInteger(line.debitCents) || !Number.isSafeInteger(line.creditCents) || line.debitCents < 0 || line.creditCents < 0 || (line.debitCents > 0 && line.creditCents > 0))) {
      violations.push({ rule: "invalid-money", entryId: entry.id });
    }
    const debit = entry.lines.reduce((sum, line) => sum + line.debitCents, 0);
    const credit = entry.lines.reduce((sum, line) => sum + line.creditCents, 0);
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit !== credit) violations.push({ rule: "unbalanced-entry", entryId: entry.id });
  }
  return violations;
}
