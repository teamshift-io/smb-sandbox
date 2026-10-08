import type { Dataset, Job } from "./schema.js";

export interface InvariantViolation {
  rule: "invoice-total" | "invoice-payments" | "invoice-job" | "staff-overlap";
  recordIds: string[];
  detail: string;
}

export interface InvariantReport {
  violations: InvariantViolation[];
  notChecked: string[];
}

/** Detect labeled mess as well as accidental corruption; labels do not excuse violations. */
export function checkInvariants(dataset: Dataset): InvariantReport {
  const violations: InvariantViolation[] = [];
  const jobs = new Map(dataset.jobs.map((job) => [job.id, job]));
  const paid = new Map<string, number>();
  for (const payment of dataset.payments) {
    if (payment.invoiceId !== null) paid.set(payment.invoiceId, (paid.get(payment.invoiceId) ?? 0) + payment.amountCents);
  }
  for (const invoice of dataset.invoices) {
    const total = invoice.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(invoice.totalCents) || total !== invoice.totalCents) {
      violations.push({ rule: "invoice-total", recordIds: [invoice.id], detail: "Invoice total differs from integer-cent line items" });
    }
    if ((paid.get(invoice.id) ?? 0) !== invoice.paidCents) {
      violations.push({ rule: "invoice-payments", recordIds: [invoice.id], detail: "Invoice paid cents differ from linked payments" });
    }
    const job = invoice.jobId === null ? undefined : jobs.get(invoice.jobId);
    if (!job || job.customerId !== invoice.customerId) {
      violations.push({ rule: "invoice-job", recordIds: [invoice.id, ...(invoice.jobId === null ? [] : [invoice.jobId])], detail: "Invoice needs a job belonging to the same customer" });
    }
  }
  const schedules = new Map<string, Job[]>();
  for (const job of dataset.jobs) {
    if (job.status === "canceled" || job.status === "no-show") continue;
    for (const employee of new Set(job.assigneeIds)) {
      const schedule = schedules.get(employee) ?? [];
      schedule.push(job);
      schedules.set(employee, schedule);
    }
  }
  for (const [employee, schedule] of schedules) {
    schedule.sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
    for (let i = 0; i < schedule.length; i++) {
      const current = schedule[i]!;
      for (let j = i + 1; j < schedule.length && schedule[j]!.scheduledStart < current.scheduledEnd; j++) {
        violations.push({ rule: "staff-overlap", recordIds: [employee, current.id, schedule[j]!.id], detail: "Employee is assigned to overlapping jobs" });
      }
    }
  }
  return { violations, notChecked: ["inventory", "double-entry-ledger"] };
}
