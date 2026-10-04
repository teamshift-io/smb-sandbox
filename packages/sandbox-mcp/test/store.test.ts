import { beforeEach, describe, expect, it } from "vitest";
import { SandboxError, SandboxStore } from "../src/index.js";
import { fixture } from "./fixture.js";

let store: SandboxStore;
beforeEach(() => {
  store = new SandboxStore(fixture());
});

function expectError(fn: () => unknown, code: SandboxError["code"], match?: RegExp): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(SandboxError);
    expect((err as SandboxError).code).toBe(code);
    if (match) expect((err as SandboxError).message).toMatch(match);
    return;
  }
  throw new Error("expected a SandboxError");
}

describe("construction, clock and lifecycle", () => {
  it("deep-clones the input dataset", () => {
    const ds = fixture();
    const s = new SandboxStore(ds);
    s.updateDeal({ dealId: "deal_000002", stage: "qualified" });
    expect(ds.deals[1]!.stage).toBe("new");
  });

  it("starts at 09:00 company time on asOf and advances 1 minute per successful mutation", () => {
    expect(store.now()).toBe("2026-09-30T14:00:00.000Z");
    expect(store.today()).toBe("2026-09-30");
    store.completeTask("task_000001");
    expect(store.now()).toBe("2026-09-30T14:01:00.000Z");
    expectError(() => store.completeTask("task_000001"), "failed_precondition");
    expect(store.now()).toBe("2026-09-30T14:01:00.000Z");
    expect(store.advanceClock(60)).toBe("2026-09-30T15:01:00.000Z");
  });

  it("respects startAt override", () => {
    expect(new SandboxStore(fixture(), { startAt: "2026-01-01T00:00:00Z" }).now()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("reads return copies that cannot mutate state", () => {
    const deal = store.getDeal("deal_000001");
    deal.stage = "won";
    expect(store.getDeal("deal_000001").stage).toBe("quote-sent");
  });

  it("reset restores the original dataset and clears audit, events and outbox", () => {
    const before = store.snapshot();
    store.sendEmail({ contactId: "con_000001", subject: "Hi", body: "Hello" });
    store.updateDeal({ dealId: "deal_000002", stage: "qualified" });
    expect(store.audit()).toHaveLength(2);
    store.reset();
    expect(store.snapshot()).toEqual(before);
    expect(store.audit()).toEqual([]);
    expect(store.emittedEvents()).toEqual([]);
    expect(store.outbox()).toEqual([]);
    expect(store.now()).toBe("2026-09-30T14:00:00.000Z");
  });
});

describe("hardening", () => {
  it("rejects empty-string foreign keys instead of storing them", () => {
    expectError(() => store.createContact({ customerId: "", firstName: "A", lastName: "B" }), "invalid_argument");
    expectError(() => store.updateDeal({ dealId: "deal_000001", ownerId: "" }), "invalid_argument");
    expectError(() => store.createTask({ title: "x", assigneeId: "" }), "invalid_argument");
  });

  it("does not accept anomaly or event ids as relatedIds", () => {
    expectError(() => store.createTask({ title: "x", relatedIds: ["anm_000001"] }), "not_found");
  });

  it("requires a UTC offset on job datetimes and treats date filters as company-local", () => {
    expectError(() => store.scheduleJob({ customerId: "cus_000001", title: "x", scheduledStart: "2026-10-05T14:00", scheduledEnd: "2026-10-05T15:00" }), "invalid_argument", /offset/);
    const job = store.scheduleJob({ customerId: "cus_000001", title: "Evening", scheduledStart: "2026-10-05T19:00:00-05:00", scheduledEnd: "2026-10-05T20:00:00-05:00" });
    expect(job.scheduledStart).toBe("2026-10-06T00:00:00.000Z");
    expect(store.listJobs({ from: "2026-10-05", to: "2026-10-06" }).items.map((j) => j.id)).toContain(job.id);
    expect(store.listJobs({ from: "2026-10-06" }).items.map((j) => j.id)).not.toContain(job.id);
  });

  it("rejects nextAction on closed deals and unknown lead statuses", () => {
    expectError(() => store.updateDeal({ dealId: "deal_000001", stage: "won", nextAction: { summary: "x", dueOn: "2026-10-01" } }), "invalid_argument", /won/);
    expectError(() => store.updateLead({ leadId: "lead_000001", status: "bogus" as never }), "invalid_argument");
  });

  it("reset({ keepAudit }) keeps history and records the reset; advanceClock is audited", () => {
    store.completeTask("task_000001");
    store.advanceClock(5);
    store.reset({ keepAudit: true });
    expect(store.audit().map((e) => e.tool)).toEqual(["crm_complete_task", "admin_advance_clock", "admin_reset"]);
    expect(store.getRecord("task_000001")).toMatchObject({ status: "open" });
  });
});

describe("audit log and events", () => {
  it("records ok and error entries with seq, at, tool, input, changedIds", () => {
    store.updateDeal({ dealId: "deal_000002", stage: "qualified" });
    expectError(() => store.updateDeal({ dealId: "deal_nope", stage: "qualified" }), "not_found");
    const audit = store.audit();
    expect(audit).toEqual([
      { seq: 1, at: "2026-09-30T14:00:00.000Z", tool: "crm_update_deal", input: { dealId: "deal_000002", stage: "qualified" }, result: "ok", changedIds: ["deal_000002"] },
      expect.objectContaining({ seq: 2, at: "2026-09-30T14:01:00.000Z", tool: "crm_update_deal", result: "error", changedIds: [], error: expect.stringMatching(/deal_nope/) }),
    ]);
  });

  it("emits a BusinessEvent per mutation into snapshot().events", () => {
    store.updateDeal({ dealId: "deal_000002", stage: "qualified" });
    const events = store.snapshot().events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "DealStageChanged", subjectId: "deal_000002", at: "2026-09-30T14:00:00.000Z", data: { from: "new", to: "qualified", source: "sandbox" } });
    expect(events[0]!.id).toMatch(/^evt_/);
    expect(store.emittedEvents()).toEqual(events);
  });

  it("a failed mutation changes nothing", () => {
    const before = store.snapshot();
    expectError(() => store.recordPayment({ invoiceId: "inv_000002", amountCents: 999999, method: "card" }), "failed_precondition", /exceeds/);
    expect(store.snapshot()).toEqual(before);
  });
});

describe("reads", () => {
  it("searchContacts matches name, email and phone digits, with pagination", () => {
    expect(store.searchContacts({ query: "rivera" }).total).toBe(2);
    expect(store.searchContacts({ query: "5550100114" }).items.map((c) => c.id)).toEqual(["con_000004"]);
    expect(store.searchContacts({ missingInfo: true }).items.map((c) => c.id).sort()).toEqual(["con_000002", "con_000003"]);
    const p = store.searchContacts({ limit: 3 });
    expect(p).toMatchObject({ total: 4, offset: 0, limit: 3, nextOffset: 3 });
    expect(store.searchContacts({ offset: 3, limit: 3 }).nextOffset).toBeNull();
  });

  it("filters deals, quotes, invoices, payments, leads, jobs, calls, tasks", () => {
    expect(store.listDeals({ openOnly: true }).total).toBe(2);
    expect(store.listDeals({ staleDays: 14 }).items.map((d) => d.id)).toEqual(["deal_000001"]);
    expect(store.listQuotes({ notFollowedUp: true }).items.map((q) => q.id)).toEqual(["quo_000001"]);
    expect(store.listInvoices({ overdue: true }).items.map((i) => i.id)).toEqual(["inv_000002"]);
    expect(store.listPayments({ unmatched: true }).items.map((p) => p.id)).toEqual(["pay_000002"]);
    expect(store.listLeads({ uncontacted: true }).items.map((l) => l.id)).toEqual(["lead_000001"]);
    expect(store.listJobs({ from: "2026-10-01", to: "2026-10-03" }).items.map((j) => j.id)).toEqual(["job_000002"]);
    expect(store.listCalls({ outcome: "missed" }).total).toBe(1);
    expect(store.listTasks({ relatedId: "deal_000001" }).total).toBe(1);
    expect(store.listEmployees()).toHaveLength(2);
    expect(store.listCustomers({ query: "oak" }).items[0]!.id).toBe("cus_000002");
  });

  it("lists threads with unread counts and gets a thread", () => {
    const threads = store.listThreads({ unreadOnly: true });
    expect(threads.total).toBe(2);
    expect(threads.items[0]).toMatchObject({ threadId: "thr_000002", channel: "sms", unreadCount: 1 });
    expect(store.getThread("thr_000001").messages).toHaveLength(1);
    expectError(() => store.getThread("thr_missing"), "not_found");
  });

  it("getRecord resolves any id by prefix", () => {
    expect(store.getRecord("inv_000002")).toMatchObject({ number: "INV-2002" });
    expect(store.getRecord("thr_000001")).toMatchObject({ threadId: "thr_000001" });
    expect(store.getRecord("co_abc123")).toMatchObject({ name: "Brightline Home Services" });
    expect(store.getRecord("inv_nope")).toBeNull();
    expect(store.getAnomalies()).toHaveLength(2);
    expect(store.getPolicies()[0]!.id).toBe("pol_000001");
  });
});

describe("CRM writes", () => {
  it("createContact validates customer and email", () => {
    const c = store.createContact({ customerId: "cus_000002", firstName: "Ana", lastName: "Oak", email: "ana@oakcafe.example" });
    expect(c.id).toMatch(/^con_/);
    expect(c.createdAt).toBe("2026-09-30T14:00:00.000Z");
    expect(store.snapshot().events.at(-1)).toMatchObject({ type: "ContactCreated", subjectId: c.id });
    expectError(() => store.createContact({ customerId: "cus_missing", firstName: "A", lastName: "B" }), "not_found");
    expectError(() => store.createContact({ firstName: "A", lastName: "B", email: "not-an-email" }), "invalid_argument");
    expectError(() => store.createContact({ firstName: " ", lastName: "B" }), "invalid_argument");
  });

  it("updateContact patches fields and rejects no-ops", () => {
    const c = store.updateContact({ contactId: "con_000003", phone: "(555) 010-0133" });
    expect(c.phone).toBe("(555) 010-0133");
    expect(store.snapshot().events.at(-1)).toMatchObject({ type: "ContactUpdated", data: { changes: { phone: { from: null, to: "(555) 010-0133" } } } });
    expectError(() => store.updateContact({ contactId: "con_000003", phone: "(555) 010-0133" }), "invalid_argument", /No changes/);
  });

  it("mergeContacts fills gaps, re-points references and removes the duplicate", () => {
    const kept = store.mergeContacts({ keepId: "con_000001", mergeId: "con_000002" });
    expect(kept.title).toBe("Homeowner");
    const snap = store.snapshot();
    expect(snap.contacts.find((c) => c.id === "con_000002")).toBeUndefined();
    expect(snap.deals.find((d) => d.id === "deal_000003")!.contactId).toBe("con_000001");
    expect(snap.messages.find((m) => m.id === "msg_000002")!.contactId).toBe("con_000001");
    expect(snap.tasks[0]!.relatedIds).toEqual(["deal_000001", "con_000001"]);
    expect(store.audit()[0]!.changedIds).toEqual(expect.arrayContaining(["con_000001", "con_000002", "deal_000003", "msg_000002", "task_000001"]));
    expect(snap.events.at(-1)).toMatchObject({ type: "ContactsMerged", subjectId: "con_000001", data: { mergedId: "con_000002" } });
    expectError(() => store.mergeContacts({ keepId: "con_000001", mergeId: "con_000001" }), "invalid_argument");
    expectError(() => store.mergeContacts({ keepId: "con_000001", mergeId: "con_000003" }), "failed_precondition", /different customers/);
  });

  it("updateLead sets status/owner and first response", () => {
    const lead = store.updateLead({ leadId: "lead_000001", status: "contacted", ownerId: "emp_000001" });
    expect(lead).toMatchObject({ status: "contacted", ownerId: "emp_000001", firstResponseAt: "2026-09-30T14:00:00.000Z" });
    expect(store.snapshot().events.at(-1)!.type).toBe("LeadContacted");
    expectError(() => store.updateLead({ leadId: "lead_000001", ownerId: "emp_000003" }), "failed_precondition", /inactive/);
  });

  it("updateDeal enforces stage transitions, lostReason, money and nextAction", () => {
    expectError(() => store.updateDeal({ dealId: "deal_000002", stage: "won" }), "failed_precondition", /Allowed: qualified, quote-sent, lost/);
    expectError(() => store.updateDeal({ dealId: "deal_000003", stage: "lost", lostReason: "x" }), "failed_precondition", /won is final/);
    expectError(() => store.updateDeal({ dealId: "deal_000001", stage: "lost" }), "invalid_argument", /lostReason/);
    expectError(() => store.updateDeal({ dealId: "deal_000001", amountCents: 12.5 }), "invalid_argument", /integer/);
    expectError(() => store.updateDeal({ dealId: "deal_000001", nextAction: { summary: "Call", dueOn: "10/01/2026" } }), "invalid_argument");
    expectError(() => store.updateDeal({ dealId: "deal_000001" }), "invalid_argument");

    const d1 = store.updateDeal({ dealId: "deal_000001", nextAction: { summary: "Call Maria about quote", dueOn: "2026-10-01" } });
    expect(d1.nextAction).toEqual({ summary: "Call Maria about quote", dueOn: "2026-10-01" });
    expect(d1.updatedAt).toBe("2026-09-30T14:00:00.000Z");
    expect(store.snapshot().events.at(-1)!.type).toBe("DealUpdated");

    const won = store.updateDeal({ dealId: "deal_000001", stage: "won" });
    expect(won).toMatchObject({ stage: "won", closedAt: "2026-09-30T14:01:00.000Z", nextAction: null });

    const lost = store.updateDeal({ dealId: "deal_000002", stage: "lost", lostReason: "Went with competitor" });
    expect(lost).toMatchObject({ lostReason: "Went with competitor" });
    const reopened = store.updateDeal({ dealId: "deal_000002", stage: "qualified" });
    expect(reopened).toMatchObject({ stage: "qualified", closedAt: null, lostReason: null });
  });

  it("sendQuote only sends drafts", () => {
    const q = store.sendQuote({ quoteId: "quo_000002" });
    expect(q).toMatchObject({ status: "sent", sentAt: "2026-09-30T14:00:00.000Z", expiresOn: "2026-10-30" });
    expectError(() => store.sendQuote({ quoteId: "quo_000002" }), "failed_precondition");
  });

  it("followUpQuote messages the deal contact and records the follow-up", () => {
    const { quote, message } = store.followUpQuote({ quoteId: "quo_000001", body: "Any questions on the furnace quote?" });
    expect(quote.followUps).toEqual(["2026-09-30T14:00:00.000Z"]);
    expect(message).toMatchObject({ direction: "outbound", channel: "email", to: ["maria@rivera.example"], contactId: "con_000001", relatedIds: ["quo_000001", "deal_000001"] });
    expect(store.outbox().map((m) => m.id)).toEqual([message.id]);
    const types = store.emittedEvents().map((e) => e.type);
    expect(types).toEqual(["MessageSent", "QuoteFollowedUp"]);
    expectError(() => store.followUpQuote({ quoteId: "quo_000002", body: "x" }), "failed_precondition");
  });

  it("createTask validates related ids; completeTask closes it once", () => {
    const t = store.createTask({ title: "Call Lee back", assigneeId: "emp_000001", dueOn: "2026-09-30", relatedIds: ["call_000001", "con_000004"] });
    expect(t).toMatchObject({ status: "open", relatedIds: ["call_000001", "con_000004"] });
    expectError(() => store.createTask({ title: "x", relatedIds: ["deal_missing"] }), "not_found");
    const done = store.completeTask(t.id);
    expect(done).toMatchObject({ status: "done", completedAt: "2026-09-30T14:01:00.000Z" });
    expect(store.emittedEvents().map((e) => e.type)).toEqual(["TaskCreated", "TaskCompleted"]);
  });
});

describe("calendar writes", () => {
  it("scheduleJob validates and detects double-booking", () => {
    const job = store.scheduleJob({ customerId: "cus_000001", title: "Furnace install", scheduledStart: "2026-10-05T14:00:00Z", scheduledEnd: "2026-10-05T20:00:00Z", assigneeIds: ["emp_000002"] });
    expect(job).toMatchObject({ status: "scheduled", scheduledStart: "2026-10-05T14:00:00.000Z" });
    expectError(() => store.scheduleJob({ customerId: "cus_000001", title: "Overlap", scheduledStart: "2026-10-02T15:00:00Z", scheduledEnd: "2026-10-02T17:00:00Z", assigneeIds: ["emp_000002"] }), "conflict", /job_000002/);
    expect(store.scheduleJob({ customerId: "cus_000001", title: "Overlap ok", scheduledStart: "2026-10-02T15:00:00Z", scheduledEnd: "2026-10-02T17:00:00Z", assigneeIds: ["emp_000002"], allowOverlap: true }).id).toMatch(/^job_/);
    expectError(() => store.scheduleJob({ customerId: "cus_000001", title: "Bad", scheduledStart: "2026-10-05T14:00:00Z", scheduledEnd: "2026-10-05T13:00:00Z" }), "invalid_argument");
    expectError(() => store.scheduleJob({ customerId: "cus_000001", title: "Bad", scheduledStart: "2026-10-05", scheduledEnd: "2026-10-06" }), "invalid_argument");
    expectError(() => store.scheduleJob({ customerId: "cus_000001", title: "Bad", scheduledStart: "2026-10-05T14:00:00Z", scheduledEnd: "2026-10-05T15:00:00Z", assigneeIds: ["emp_000003"] }), "failed_precondition");
    expectError(() => store.scheduleJob({ customerId: "cus_000002", title: "Bad", scheduledStart: "2026-10-05T14:00:00Z", scheduledEnd: "2026-10-05T15:00:00Z", quoteId: "quo_000001" }), "invalid_argument");
  });

  it("rescheduleJob updates the job times and emits JobRescheduled", () => {
    const job = store.rescheduleJob({ jobId: "job_000002", scheduledStart: "2026-10-03T14:00:00Z", scheduledEnd: "2026-10-03T16:00:00Z", reason: "Customer asked" });
    expect(job).toMatchObject({ scheduledStart: "2026-10-03T14:00:00.000Z", scheduledEnd: "2026-10-03T16:00:00.000Z", notes: "Rescheduled: Customer asked" });
    expect(store.getJob("job_000002").scheduledStart).toBe("2026-10-03T14:00:00.000Z");
    expect(store.emittedEvents()[0]).toMatchObject({ type: "JobRescheduled", data: { previous: { scheduledStart: "2026-10-02T14:00:00.000Z" } } });
    expectError(() => store.rescheduleJob({ jobId: "job_000001", scheduledStart: "2026-10-03T14:00:00Z", scheduledEnd: "2026-10-03T16:00:00Z" }), "failed_precondition");
  });

  it("cancelJob and completeJob enforce status", () => {
    expectError(() => store.cancelJob({ jobId: "job_000002", reason: "" }), "invalid_argument");
    expect(store.cancelJob({ jobId: "job_000002", reason: "Fixed it themselves" }).status).toBe("canceled");
    expectError(() => store.completeJob({ jobId: "job_000002" }), "failed_precondition");
    const s2 = new SandboxStore(fixture());
    expect(s2.completeJob({ jobId: "job_000002", notes: "Replaced valve" })).toMatchObject({ status: "completed", completedAt: "2026-09-30T14:00:00.000Z", notes: "Replaced valve" });
  });
});

describe("invoicing writes", () => {
  it("createInvoice computes totals, numbering and due date", () => {
    const inv = store.createInvoice({ customerId: "cus_000002", jobId: "job_000002", lineItems: [{ sku: "LAB", description: "Labor", quantity: 1.5, unitPriceCents: 10000 }, { sku: "P", description: "Part", quantity: 2, unitPriceCents: 1234 }] });
    expect(inv).toMatchObject({ number: "INV-2004", status: "open", totalCents: 17468, issuedOn: "2026-09-30", dueOn: "2026-10-30", paidCents: 0 });
    expectError(() => store.createInvoice({ customerId: "cus_000001", jobId: "job_000002", lineItems: [{ sku: "a", description: "b", quantity: 1, unitPriceCents: 1 }] }), "invalid_argument", /belongs to customer/);
    expectError(() => store.createInvoice({ customerId: "cus_000001", lineItems: [] }), "invalid_argument");
    expectError(() => store.createInvoice({ customerId: "cus_000001", lineItems: [{ sku: "a", description: "b", quantity: 1, unitPriceCents: 1.5 }] }), "invalid_argument", /integer/);
  });

  it("recordPayment applies partial and full payments; rejects void, paid and overpayment", () => {
    const r1 = store.recordPayment({ invoiceId: "inv_000002", amountCents: 5000, method: "card" });
    expect(r1.invoice).toMatchObject({ status: "partially-paid", paidCents: 5000 });
    expect(r1.payment).toMatchObject({ invoiceId: "inv_000002", customerId: "cus_000002", amountCents: 5000 });
    const r2 = store.recordPayment({ invoiceId: "inv_000002", amountCents: 10000, method: "ach", reference: "ACH-1" });
    expect(r2.invoice).toMatchObject({ status: "paid", paidCents: 15000 });
    expectError(() => store.recordPayment({ invoiceId: "inv_000003", amountCents: 100, method: "cash" }), "failed_precondition", /void/);
    expectError(() => store.recordPayment({ invoiceId: "inv_000001", amountCents: 100, method: "cash" }), "failed_precondition", /paid/);
    expectError(() => store.recordPayment({ invoiceId: "inv_000002", amountCents: -5, method: "cash" }), "invalid_argument");
    expect(store.emittedEvents().map((e) => e.type)).toEqual(["PaymentReceived", "PaymentReceived"]);
  });

  it("matchPayment applies an unmatched payment once, same customer only", () => {
    expectError(() => store.matchPayment({ paymentId: "pay_000002", invoiceId: "inv_000001" }), "failed_precondition", /customer/);
    const { payment, invoice } = store.matchPayment({ paymentId: "pay_000002", invoiceId: "inv_000002" });
    expect(payment.invoiceId).toBe("inv_000002");
    expect(invoice).toMatchObject({ status: "partially-paid", paidCents: 5000 });
    expectError(() => store.matchPayment({ paymentId: "pay_000002", invoiceId: "inv_000002" }), "failed_precondition", /already matched/);
  });

  it("voidInvoice requires no payments and a reason", () => {
    expectError(() => store.voidInvoice({ invoiceId: "inv_000001", reason: "oops" }), "failed_precondition", /refunded/);
    expectError(() => store.voidInvoice({ invoiceId: "inv_000003", reason: "again" }), "failed_precondition", /already void/);
    expect(store.voidInvoice({ invoiceId: "inv_000002", reason: "Wrong job" }).status).toBe("void");
    expectError(() => store.recordPayment({ invoiceId: "inv_000002", amountCents: 100, method: "cash" }), "failed_precondition", /void/);
  });

  it("sendInvoiceReminder messages a customer contact", () => {
    const { message } = store.sendInvoiceReminder({ invoiceId: "inv_000002" });
    expect(message).toMatchObject({ to: ["sam@oakcafe.example"], subject: "Reminder: invoice INV-2002", relatedIds: ["inv_000002"] });
    expect(message.body).toMatch(/\$150\.00/);
    expectError(() => store.sendInvoiceReminder({ invoiceId: "inv_000002", channel: "sms" }), "failed_precondition", /valid phone/);
    expectError(() => store.sendInvoiceReminder({ invoiceId: "inv_000001" }), "failed_precondition");
    expect(store.emittedEvents().map((e) => e.type)).toEqual(["MessageSent", "InvoiceReminderSent"]);
  });
});

describe("inbox and phone writes", () => {
  it("sendEmail replies in thread and goes to outbox only", () => {
    const m = store.sendEmail({ threadId: "thr_000001", body: "We can come Thursday." });
    expect(m).toMatchObject({ threadId: "thr_000001", direction: "outbound", subject: "Re: Leak under sink", to: ["sam@oakcafe.example"], from: "office@brightline.example", contactId: "con_000003", read: true });
    expect(store.getThread("thr_000001").messages).toHaveLength(2);
    expect(store.outbox()).toHaveLength(1);
    expectError(() => store.sendEmail({ contactId: "con_000002", subject: "x", body: "y" }), "failed_precondition", /no email/);
    expectError(() => store.sendEmail({ contactId: "con_000001", body: "y" }), "invalid_argument", /subject/);
    expectError(() => store.sendEmail({ threadId: "thr_000002", body: "y" }), "invalid_argument", /sms thread/);
    expectError(() => store.sendEmail({ to: ["bad"], subject: "s", body: "y" }), "failed_precondition");
  });

  it("sending to a lead's contact marks the lead contacted", () => {
    const m = store.sendSms({ contactId: "con_000004", body: "Hi Lee, we got your request." });
    expect(m).toMatchObject({ channel: "sms", subject: null, to: ["(555) 010-0114"] });
    expect(store.listLeads({ uncontacted: true }).total).toBe(0);
    expect(store.emittedEvents().map((e) => e.type)).toEqual(["MessageSent", "LeadContacted"]);
    expect(store.audit()[0]!.changedIds).toEqual(expect.arrayContaining([m.id, "lead_000001"]));
  });

  it("markThreadRead marks messages read", () => {
    expect(store.markThreadRead("thr_000001")).toEqual({ threadId: "thr_000001", updated: 1 });
    expect(store.listThreads({ unreadOnly: true }).total).toBe(1);
  });

  it("logCall records a callback and validates phone", () => {
    const call = store.logCall({ contactId: "con_000004", outcome: "answered", summary: "Booked a visit", employeeId: "emp_000001" });
    expect(call).toMatchObject({ direction: "outbound", from: "(555) 010-0101", to: "(555) 010-0114", durationSec: 180, startedAt: "2026-09-30T14:00:00.000Z" });
    expect(store.getRecord("lead_000001")).toMatchObject({ status: "contacted" });
    expectError(() => store.logCall({ contactId: "con_000003", outcome: "answered" }), "failed_precondition", /no valid phone/);
    expectError(() => store.logCall({ outcome: "answered" }), "failed_precondition");
  });
});
