import type { Dataset } from "@teamshift/fake-business";

const addr = { line1: "100 Example St", city: "Springfield", region: "IL", postalCode: "62701", country: "US" as const };

/** A tiny hand-written dataset that satisfies the schema, for store tests. */
export function fixture(): Dataset {
  return {
    meta: {
      generator: "@teamshift/fake-business",
      generatorVersion: "0.0.0-fixture",
      schemaVersion: "1.0.0",
      industry: "home-services",
      seed: 1,
      startDate: "2025-10-01",
      asOf: "2026-09-30",
      synthetic: true,
    },
    company: {
      id: "co_abc123",
      name: "Brightline Home Services",
      industry: "home-services",
      description: "Residential HVAC and plumbing",
      timezone: "America/Chicago",
      currency: "USD",
      phone: "(555) 010-0100",
      email: "office@brightline.example",
      website: "https://brightline.example",
      address: addr,
      paymentTermsDays: 30,
      policies: [{ id: "pol_000001", title: "Respond fast", rule: "Respond to new leads within 1 business hour." }],
    },
    employees: [
      { id: "emp_000001", name: "Dana Owner", email: "dana@brightline.example", phone: "(555) 010-0101", role: "owner", hiredOn: "2020-01-01", active: true },
      { id: "emp_000002", name: "Tom Tech", email: "tom@brightline.example", phone: "(555) 010-0102", role: "technician", hiredOn: "2021-01-01", active: true },
      { id: "emp_000003", name: "Gone Person", email: "gone@brightline.example", phone: "(555) 010-0103", role: "sales", hiredOn: "2019-01-01", active: false },
    ],
    customers: [
      { id: "cus_000001", kind: "household", name: "Rivera Household", address: addr, createdAt: "2026-01-05T15:00:00.000Z", source: "web-form", status: "active", ownerId: "emp_000001", tags: ["hvac"] },
      { id: "cus_000002", kind: "business", name: "Oak Cafe", address: addr, createdAt: "2026-02-05T15:00:00.000Z", source: "referral", status: "active", ownerId: "emp_000001", tags: [] },
    ],
    contacts: [
      { id: "con_000001", customerId: "cus_000001", firstName: "Maria", lastName: "Rivera", email: "maria@rivera.example", phone: "(555) 010-0111", title: null, createdAt: "2026-01-05T15:00:00.000Z" },
      { id: "con_000002", customerId: "cus_000001", firstName: "Maria", lastName: "Rivera", email: null, phone: "(555) 010-0111", title: "Homeowner", createdAt: "2026-03-05T15:00:00.000Z" },
      { id: "con_000003", customerId: "cus_000002", firstName: "Sam", lastName: "Oak", email: "sam@oakcafe.example", phone: null, title: "Owner", createdAt: "2026-02-05T15:00:00.000Z" },
      { id: "con_000004", customerId: null, firstName: "Lee", lastName: "Prospect", email: "lee@prospect.example", phone: "(555) 010-0114", title: null, createdAt: "2026-09-29T15:00:00.000Z" },
    ],
    leads: [
      { id: "lead_000001", contactId: "con_000004", source: "web-form", createdAt: "2026-09-29T15:00:00.000Z", request: "AC is making a noise", status: "new", firstResponseAt: null, ownerId: null, dealId: null },
      { id: "lead_000002", contactId: "con_000001", source: "phone", createdAt: "2026-01-05T15:00:00.000Z", request: "Furnace tune-up", status: "converted", firstResponseAt: "2026-01-05T15:20:00.000Z", ownerId: "emp_000001", dealId: "deal_000001" },
    ],
    deals: [
      { id: "deal_000001", customerId: "cus_000001", contactId: "con_000001", title: "Furnace replacement", stage: "quote-sent", amountCents: 650000, ownerId: "emp_000001", createdAt: "2026-08-01T15:00:00.000Z", updatedAt: "2026-08-20T15:00:00.000Z", closedAt: null, lostReason: null, nextAction: null },
      { id: "deal_000002", customerId: "cus_000002", contactId: "con_000003", title: "Kitchen plumbing", stage: "new", amountCents: 120000, ownerId: null, createdAt: "2026-09-25T15:00:00.000Z", updatedAt: "2026-09-25T15:00:00.000Z", closedAt: null, lostReason: null, nextAction: null },
      { id: "deal_000003", customerId: "cus_000001", contactId: "con_000002", title: "AC tune-up", stage: "won", amountCents: 15000, ownerId: "emp_000001", createdAt: "2026-03-05T15:00:00.000Z", updatedAt: "2026-03-10T15:00:00.000Z", closedAt: "2026-03-10T15:00:00.000Z", lostReason: null, nextAction: null },
    ],
    quotes: [
      { id: "quo_000001", dealId: "deal_000001", customerId: "cus_000001", number: "Q-1001", status: "sent", lineItems: [{ sku: "FURN-80", description: "80% furnace installed", quantity: 1, unitPriceCents: 650000 }], totalCents: 650000, createdAt: "2026-08-19T15:00:00.000Z", sentAt: "2026-08-20T15:00:00.000Z", expiresOn: "2026-10-20", followUps: [] },
      { id: "quo_000002", dealId: "deal_000002", customerId: "cus_000002", number: "Q-1002", status: "draft", lineItems: [{ sku: "PLUMB-HR", description: "Plumbing labor", quantity: 8, unitPriceCents: 15000 }], totalCents: 120000, createdAt: "2026-09-26T15:00:00.000Z", sentAt: null, expiresOn: null, followUps: [] },
    ],
    jobs: [
      { id: "job_000001", customerId: "cus_000001", quoteId: null, title: "AC tune-up", status: "completed", scheduledStart: "2026-03-12T14:00:00.000Z", scheduledEnd: "2026-03-12T16:00:00.000Z", assigneeIds: ["emp_000002"], completedAt: "2026-03-12T16:00:00.000Z", notes: null },
      { id: "job_000002", customerId: "cus_000002", quoteId: null, title: "Leak inspection", status: "scheduled", scheduledStart: "2026-10-02T14:00:00.000Z", scheduledEnd: "2026-10-02T16:00:00.000Z", assigneeIds: ["emp_000002"], completedAt: null, notes: null },
    ],
    invoices: [
      { id: "inv_000001", customerId: "cus_000001", jobId: "job_000001", number: "INV-2001", status: "paid", lineItems: [{ sku: "AC-TUNE", description: "AC tune-up", quantity: 1, unitPriceCents: 15000 }], totalCents: 15000, issuedOn: "2026-03-12", dueOn: "2026-04-11", paidCents: 15000 },
      { id: "inv_000002", customerId: "cus_000002", jobId: null, number: "INV-2002", status: "open", lineItems: [{ sku: "DIAG", description: "Diagnostic visit", quantity: 1, unitPriceCents: 9900 }, { sku: "PART", description: "Valve", quantity: 2, unitPriceCents: 2550 }], totalCents: 15000, issuedOn: "2026-08-01", dueOn: "2026-08-31", paidCents: 0 },
      { id: "inv_000003", customerId: "cus_000001", jobId: null, number: "INV-2003", status: "void", lineItems: [{ sku: "DIAG", description: "Diagnostic visit", quantity: 1, unitPriceCents: 9900 }], totalCents: 9900, issuedOn: "2026-05-01", dueOn: "2026-05-31", paidCents: 0 },
    ],
    payments: [
      { id: "pay_000001", invoiceId: "inv_000001", customerId: "cus_000001", amountCents: 15000, method: "card", receivedAt: "2026-03-15T15:00:00.000Z", reference: "ch_1" },
      { id: "pay_000002", invoiceId: null, customerId: "cus_000002", amountCents: 5000, method: "check", receivedAt: "2026-09-10T15:00:00.000Z", reference: "chk 1043" },
    ],
    messages: [
      { id: "msg_000001", channel: "email", direction: "inbound", threadId: "thr_000001", from: "sam@oakcafe.example", to: ["office@brightline.example"], subject: "Leak under sink", body: "Can someone come look at a leak?", sentAt: "2026-09-25T14:00:00.000Z", contactId: "con_000003", employeeId: null, relatedIds: [], read: false },
      { id: "msg_000002", channel: "sms", direction: "inbound", threadId: "thr_000002", from: "(555) 010-0111", to: ["(555) 010-0100"], subject: null, body: "Any update on the quote?", sentAt: "2026-09-28T14:00:00.000Z", contactId: "con_000002", employeeId: null, relatedIds: ["con_000002"], read: false },
    ],
    calls: [
      { id: "call_000001", direction: "inbound", from: "(555) 010-0114", to: "(555) 010-0100", startedAt: "2026-09-29T16:00:00.000Z", durationSec: 0, outcome: "missed", contactId: "con_000004", employeeId: null, summary: null },
    ],
    tasks: [
      { id: "task_000001", title: "Order furnace parts", assigneeId: "emp_000002", dueOn: "2026-10-05", status: "open", createdAt: "2026-09-20T15:00:00.000Z", completedAt: null, relatedIds: ["deal_000001", "con_000002"] },
    ],
    events: [],
    anomalies: [
      { id: "anm_000001", kind: "duplicate-contact", recordIds: ["con_000002", "con_000001"], description: "Maria Rivera exists twice.", amountAtRiskCents: null },
      { id: "anm_000002", kind: "unmatched-payment", recordIds: ["pay_000002", "inv_000002"], description: "Check 1043 pays part of INV-2002.", amountAtRiskCents: 5000 },
    ],
  };
}
