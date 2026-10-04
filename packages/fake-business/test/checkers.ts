/**
 * Independent ground-truth checkers: for each anomaly kind, does the labeled
 * condition actually hold in the data? Written against the public schema only.
 */
import type { Anomaly, AnomalyKind, Dataset } from "../src/index.js";

const DAY = 86_400_000;

export function indexById(d: Dataset): Map<string, unknown> {
  const all = new Map<string, unknown>();
  all.set(d.company.id, d.company);
  for (const p of d.company.policies) all.set(p.id, p);
  for (const key of [
    "employees", "customers", "contacts", "leads", "deals", "quotes", "jobs", "invoices",
    "payments", "messages", "calls", "tasks", "events", "anomalies",
  ] as const) {
    for (const r of d[key] as Array<{ id: string }>) all.set(r.id, r);
  }
  return all;
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const asOfMs = (d: Dataset) => Date.parse(`${d.meta.asOf}T23:59:59Z`);
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

type Check = (d: Dataset, a: Anomaly) => string | null;

function find<T extends { id: string }>(list: T[], id: string | undefined): T | undefined {
  return list.find((x) => x.id === id);
}

function outboundAfter(d: Dataset, contactId: string, phone: string | null, afterIso: string): boolean {
  const calls = d.calls.some(
    (c) => c.direction === "outbound" && c.startedAt > afterIso && (c.contactId === contactId || (phone !== null && digits(c.to) === digits(phone))),
  );
  const msgs = d.messages.some((m) => m.direction === "outbound" && m.sentAt > afterIso && m.contactId === contactId);
  return calls || msgs;
}

export const CHECKERS: Record<AnomalyKind, Check> = {
  "duplicate-contact": (d, a) => {
    const [dupId, origId] = a.recordIds;
    const dup = find(d.contacts, dupId);
    const orig = find(d.contacts, origId);
    if (!dup || !orig) return "contacts missing";
    if (dup.id === orig.id) return "same record";
    if (dup.lastName.toLowerCase() !== orig.lastName.toLowerCase()) return "last names differ";
    if (!dup.phone || digits(dup.phone) !== digits(orig.phone)) return "phones differ";
    if (dup.email === orig.email && dup.firstName === orig.firstName) return "exact duplicate, not a near-duplicate";
    if (dup.createdAt < orig.createdAt) return "duplicate predates original";
    return null;
  },
  "quote-not-followed-up": (d, a) => {
    const q = find(d.quotes, a.recordIds[0]);
    if (!q) return "quote missing";
    const deal = find(d.deals, q.dealId);
    if (!q.sentAt) return "never sent";
    if (q.followUps.length > 0) return "has follow-ups";
    if (!["sent", "viewed", "expired"].includes(q.status)) return `status ${q.status}`;
    if (!deal || deal.stage === "won") return "deal won or missing";
    if (d.events.some((e) => e.type === "QuoteFollowedUp" && e.subjectId === q.id)) return "follow-up event exists";
    const aging = Date.parse(q.sentAt) <= asOfMs(d) - 7 * DAY;
    const expired = q.expiresOn !== null && q.expiresOn < d.meta.asOf;
    if (!aging && !expired) return "neither aging nor expired";
    if (a.amountAtRiskCents !== q.totalCents) return "amount mismatch";
    return null;
  },
  "missed-call-no-callback": (d, a) => {
    const call = find(d.calls, a.recordIds[0]);
    const contact = find(d.contacts, a.recordIds[1]);
    if (!call || !contact) return "records missing";
    if (call.direction !== "inbound" || call.outcome === "answered") return "not a missed inbound call";
    if (outboundAfter(d, contact.id, contact.phone, call.startedAt)) return "was called/messaged back";
    if (!d.events.some((e) => e.type === "CallMissed" && e.subjectId === call.id)) return "no CallMissed event";
    return null;
  },
  "stale-deal": (d, a) => {
    const deal = find(d.deals, a.recordIds[0]);
    if (!deal) return "deal missing";
    if (deal.stage === "won" || deal.stage === "lost") return "deal closed";
    if (Date.parse(deal.updatedAt) > asOfMs(d) - 30 * DAY) return "recently updated";
    if (deal.nextAction && deal.nextAction.dueOn >= d.meta.asOf) return "has a future next action";
    return null;
  },
  "overdue-invoice": (d, a) => {
    const inv = find(d.invoices, a.recordIds[0]);
    if (!inv) return "invoice missing";
    if (inv.status !== "open" && inv.status !== "partially-paid") return `status ${inv.status}`;
    if (inv.dueOn >= d.meta.asOf) return "not yet due";
    if (inv.paidCents >= inv.totalCents) return "fully paid";
    if (a.amountAtRiskCents !== inv.totalCents - inv.paidCents) return "amount mismatch";
    if (!d.events.some((e) => e.type === "InvoiceOverdue" && e.subjectId === inv.id)) return "no InvoiceOverdue event";
    return null;
  },
  "invoice-wrong-job": (d, a) => {
    const inv = find(d.invoices, a.recordIds[0]);
    const wrong = find(d.jobs, a.recordIds[1]);
    const right = find(d.jobs, a.recordIds[2]);
    if (!inv || !wrong || !right) return "records missing";
    if (inv.jobId !== wrong.id) return "invoice not linked to the wrong job";
    if (wrong.customerId === inv.customerId) return "job belongs to the same customer";
    if (right.customerId !== inv.customerId) return "suggested correct job is for another customer";
    return null;
  },
  "reschedule-not-propagated": (d, a) => {
    const job = find(d.jobs, a.recordIds[0]);
    const task = find(d.tasks, a.recordIds[1]);
    const msg = find(d.messages, a.recordIds[2]);
    if (!job || !task || !msg) return "records missing";
    const ev = d.events.find((e) => e.type === "JobRescheduled" && e.subjectId === job.id);
    if (!ev) return "no JobRescheduled event";
    if (ev.data.to !== job.scheduledStart) return "event does not match job";
    if (!task.relatedIds.includes(job.id)) return "task not related to job";
    if (task.dueOn === job.scheduledStart.slice(0, 10)) return "task already shows the new date";
    if (task.dueOn !== String(ev.data.from).slice(0, 10)) return "task does not show the old date";
    if (!msg.relatedIds.includes(job.id)) return "message not about job";
    // A schedule notice: an outbound message about this job (not an invoice) sent after the move.
    const laterNotice = d.messages.some(
      (m) => m.direction === "outbound" && m.relatedIds.includes(job.id) && !m.relatedIds.some((r) => r.startsWith("inv_")) && m.sentAt >= ev.at,
    );
    if (laterNotice) return "customer was notified of the new time";
    return null;
  },
  "missing-contact-info": (d, a) => {
    const c = find(d.contacts, a.recordIds[0]);
    if (!c) return "contact missing";
    const bad = c.email === null || !EMAIL.test(c.email) || c.phone === null;
    return bad ? null : "contact info is complete";
  },
  "conflicting-status": (d, a) => {
    const id = a.recordIds[0] ?? "";
    if (id.startsWith("deal_")) {
      const deal = find(d.deals, id);
      const q = find(d.quotes, a.recordIds[1]);
      if (!deal || !q) return "records missing";
      if (deal.stage !== "lost") return "deal not lost";
      if (q.dealId !== deal.id || q.status !== "accepted") return "quote not accepted for this deal";
      return null;
    }
    if (id.startsWith("job_")) {
      const job = find(d.jobs, id);
      const inv = find(d.invoices, a.recordIds[1]);
      if (!job || !inv) return "records missing";
      if (job.status !== "canceled") return "job not canceled";
      if (!job.completedAt) return "job never completed";
      if (inv.jobId !== job.id || inv.paidCents <= 0) return "no paid invoice for the job";
      return null;
    }
    const inv = find(d.invoices, id);
    if (!inv) return "unknown variant";
    if (inv.status !== "paid") return "invoice not marked paid";
    const paid = d.payments.filter((p) => p.invoiceId === inv.id).reduce((s, p) => s + p.amountCents, 0);
    return paid < inv.totalCents ? null : "invoice is actually paid";
  },
  "unmatched-payment": (d, a) => {
    const p = find(d.payments, a.recordIds[0]);
    if (!p) return "payment missing";
    if (p.invoiceId !== null) return "payment is matched";
    const inv = find(d.invoices, a.recordIds[1]);
    if (inv && inv.paidCents + p.amountCents > inv.totalCents) return "suggested invoice would be overpaid";
    return a.amountAtRiskCents === p.amountCents ? null : "amount mismatch";
  },
  "lead-never-contacted": (d, a) => {
    const lead = find(d.leads, a.recordIds[0]);
    if (!lead) return "lead missing";
    if (lead.status !== "new" || lead.firstResponseAt !== null) return "lead was contacted";
    if (Date.parse(lead.createdAt) > asOfMs(d) - DAY) return "lead is too new to count";
    const contact = find(d.contacts, lead.contactId);
    if (!contact) return "contact missing";
    if (outboundAfter(d, contact.id, contact.phone, lead.createdAt)) return "contact was reached";
    return null;
  },
};

/** Structural invariants every dataset must satisfy; returns human-readable problems. */
export function integrityProblems(d: Dataset): string[] {
  const out: string[] = [];
  const byId = indexById(d);
  const ref = (where: string, id: string | null, prefix: string) => {
    if (id === null) return;
    if (!byId.has(id)) out.push(`${where}: dangling ${id}`);
    else if (!id.startsWith(prefix)) out.push(`${where}: ${id} is not ${prefix}`);
  };
  const lo = `${d.meta.startDate}T00:00:00Z`;
  const hi = `${d.meta.asOf}T23:59:59Z`;
  for (const c of d.contacts) ref("contact.customerId", c.customerId, "cus_");
  for (const l of d.leads) [ref("lead.contactId", l.contactId, "con_"), ref("lead.dealId", l.dealId, "deal_"), ref("lead.ownerId", l.ownerId, "emp_")];
  for (const x of d.deals) [ref("deal.customerId", x.customerId, "cus_"), ref("deal.contactId", x.contactId, "con_")];
  for (const q of d.quotes) ref("quote.dealId", q.dealId, "deal_");
  for (const j of d.jobs) [ref("job.customerId", j.customerId, "cus_"), ref("job.quoteId", j.quoteId, "quo_"), ...j.assigneeIds.map((e) => ref("job.assignee", e, "emp_"))];
  for (const i of d.invoices) {
    ref("invoice.jobId", i.jobId, "job_");
    const sum = i.lineItems.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
    if (sum !== i.totalCents) out.push(`${i.number}: total ${i.totalCents} != lines ${sum}`);
    const paid = d.payments.filter((p) => p.invoiceId === i.id).reduce((s, p) => s + p.amountCents, 0);
    if (paid !== i.paidCents) out.push(`${i.number}: paidCents ${i.paidCents} != payments ${paid}`);
  }
  for (const q of d.quotes) {
    const sum = q.lineItems.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
    if (sum !== q.totalCents) out.push(`${q.number}: total mismatch`);
  }
  for (const p of d.payments) ref("payment.invoiceId", p.invoiceId, "inv_");
  for (const m of d.messages) m.relatedIds.forEach((r) => (byId.has(r) ? null : out.push(`message ${m.id}: dangling ${r}`)));
  for (const t of d.tasks) t.relatedIds.forEach((r) => (byId.has(r) ? null : out.push(`task ${t.id}: dangling ${r}`)));
  for (const a of d.anomalies) a.recordIds.forEach((r) => (byId.has(r) ? null : out.push(`anomaly ${a.id}: dangling ${r}`)));
  let prev = "";
  for (const e of d.events) {
    if (!byId.has(e.subjectId)) out.push(`event ${e.id}: dangling subject ${e.subjectId}`);
    if (e.at < lo || e.at > hi) out.push(`event ${e.type} at ${e.at} outside window`);
    if (e.at < prev) out.push(`events out of order at ${e.at}`);
    prev = e.at;
  }
  if (JSON.stringify(d).includes("{{#")) out.push("unresolved placeholder");
  return out;
}
