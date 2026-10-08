import type { Dataset } from "./schema.js";

export interface InventoryMovement {
  id: string;
  sku: string;
  date: string;
  quantity: number;
  invoiceId: string | null;
}
export interface InventoryViolation { rule: "invalid-quantity" | "negative-stock"; movementId: string; sku: string }

/** Mock stock for completed trailer sales. Service labor is not inventory. */
export function buildInventory(dataset: Dataset): InventoryMovement[] {
  const movements: InventoryMovement[] = [];
  const quotes = new Map(dataset.quotes.map((quote) => [quote.id, quote]));
  const required = new Map<string, number>();
  for (const job of dataset.jobs) {
    if (job.status !== "completed" || job.quoteId === null) continue;
    const quote = quotes.get(job.quoteId);
    if (!quote || quote.customerId !== job.customerId) throw new RangeError("Completed stock sale requires a matching customer quote");
    const lines = quote.lineItems.filter((line) => /^(UTILITY|CARGO|EQUIPMENT)-/.test(line.sku));
    if (lines.length === 0) continue;
    if (job.completedAt === null) throw new RangeError("Completed stock sale requires a completion timestamp");
    const invoice = dataset.invoices.find((invoice) => invoice.jobId === job.id && invoice.customerId === job.customerId && invoice.status !== "draft" && invoice.status !== "void" && invoice.lineItems.some((line) => /^(UTILITY|CARGO|EQUIPMENT)-/.test(line.sku)));
    for (const [index, line] of lines.entries()) {
      if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new RangeError("Stock quantities must be positive integers");
      required.set(line.sku, (required.get(line.sku) ?? 0) + line.quantity);
      movements.push({ id: `stock_${job.id}_${index}`, sku: line.sku, date: job.completedAt.slice(0, 10), quantity: -line.quantity, invoiceId: invoice?.id ?? null });
    }
  }
  // An explicit synthetic opening-stock assumption, not measured dealer inventory.
  const opening = [...required].map(([sku, quantity]) => ({ id: `stock_opening_${sku}`, sku, date: dataset.meta.startDate, quantity: quantity + 2, invoiceId: null }));
  return [...opening, ...movements.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))];
}

export function checkInventory(movements: readonly InventoryMovement[]): InventoryViolation[] {
  const violations: InventoryViolation[] = [];
  const stock = new Map<string, number>();
  // Same-date order is caller's transaction order (opening receipts precede sales).
  for (const movement of [...movements].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!Number.isSafeInteger(movement.quantity)) {
      violations.push({ rule: "invalid-quantity", movementId: movement.id, sku: movement.sku });
      continue;
    }
    const balance = (stock.get(movement.sku) ?? 0) + movement.quantity;
    stock.set(movement.sku, balance);
    if (balance < 0) violations.push({ rule: "negative-stock", movementId: movement.id, sku: movement.sku });
  }
  return violations;
}
