import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SandboxStore } from "./store.js";
import { SandboxError } from "./types.js";
import { VERSION } from "./version.js";

/** Groups of tools that can be enabled independently. */
export const TOOLSETS = ["crm", "inbox", "calendar", "invoicing", "phone", "admin"] as const;
export type Toolset = (typeof TOOLSETS)[number];

/** Options for {@link createSandboxServer}. */
export interface SandboxServerOptions {
  /** Toolsets to expose. Default: all. */
  toolsets?: readonly Toolset[];
  /** Expose ground-truth anomalies as the `sandbox://anomalies` resource. Default false. */
  exposeAnswers?: boolean;
  /**
   * Called by the `admin_save_state` tool. Should persist the state and return
   * where it went. When omitted, `admin_save_state` reports that saving is not configured.
   */
  saveState?: () => string;
}

/** The JSON document written by `--state-out` / `admin_save_state`. */
export interface SandboxStateFile {
  savedAt: string;
  simulatedNow: string;
  dataset: ReturnType<SandboxStore["snapshot"]>;
  audit: ReturnType<SandboxStore["audit"]>;
  outbox: ReturnType<SandboxStore["outbox"]>;
}

/** Builds the state document for grading: final dataset, audit log and outbox. */
export function buildStateFile(store: SandboxStore): SandboxStateFile {
  return {
    savedAt: new Date().toISOString(),
    simulatedNow: store.now(),
    dataset: store.snapshot(),
    audit: store.audit(),
    outbox: store.outbox(),
  };
}

const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
const IDEMPOTENT_WRITE: ToolAnnotations = { ...WRITE, idempotentHint: true };

const page = {
  offset: z.number().int().min(0).optional().describe("Rows to skip (default 0)."),
  limit: z.number().int().min(1).max(100).optional().describe("Max rows to return (default 25, max 100)."),
};
const id = (what: string) => z.string().min(1).describe(`${what} id`);
const cents = (what: string) => z.number().int().describe(`${what} in integer cents, e.g. 12500 = $125.00`);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").describe("Date, YYYY-MM-DD");
const isoDateTime = z.string().min(1).describe("ISO-8601 datetime, e.g. 2026-10-01T15:00:00Z");
const lineItem = z.object({
  sku: z.string().min(1),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPriceCents: z.number().int().min(0),
});

function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function toolError(err: unknown): CallToolResult {
  const message =
    err instanceof SandboxError ? `${err.code}: ${err.message}` : `internal: ${err instanceof Error ? err.message : String(err)}`;
  return { isError: true, content: [{ type: "text", text: message }] };
}

/**
 * Creates an MCP server exposing a {@link SandboxStore} as tools and resources.
 * One store can back many servers (e.g. one per HTTP request); they share state.
 */
export function createSandboxServer(store: SandboxStore, options: SandboxServerOptions = {}): McpServer {
  const enabled = new Set<Toolset>(options.toolsets ?? TOOLSETS);
  const company = store.getCompany();
  const server = new McpServer(
    { name: "sandbox-mcp", title: "SMB Sandbox", version: VERSION },
    {
      instructions:
        `You are operating the business systems of ${company.name}, a fictional small business (${company.description}; timezone ${company.timezone}, currency ${company.currency}). ` +
        "Everything is simulated and offline: sending email or SMS only writes to an outbox. Money is always integer cents. " +
        "Read sandbox://policies (or call admin_get_company_policies) before acting, look records up before changing them, and prefer the most specific tool.",
    },
  );

  const tool = <S extends z.ZodRawShape>(
    toolset: Toolset,
    name: string,
    config: { title: string; description: string; inputSchema: S; annotations: ToolAnnotations },
    handler: (args: z.infer<z.ZodObject<S>>) => unknown,
  ): void => {
    if (!enabled.has(toolset)) return;
    server.registerTool(name, { ...config, annotations: { title: config.title, ...config.annotations } }, (async (args: z.infer<z.ZodObject<S>>) => {
      try {
        return ok(handler(args));
      } catch (err) {
        return toolError(err);
      }
    }) as never);
  };

  // ------------------------------------------------------------------ CRM
  tool("crm", "crm_search_contacts", {
    title: "Search contacts",
    description: "Find people by name, email, phone digits or title. Use before any contact-specific action to get the contact id. Set missingInfo to find contacts lacking a valid email or phone.",
    inputSchema: { query: z.string().optional(), customerId: z.string().optional(), missingInfo: z.boolean().optional(), ...page },
    annotations: READ,
  }, (a) => store.searchContacts(a));

  tool("crm", "crm_get_contact", {
    title: "Get contact",
    description: "Full profile of one contact plus their customer account, leads, deals and recent calls. Use when you need context before replying to or changing a contact.",
    inputSchema: { contactId: id("Contact") },
    annotations: READ,
  }, ({ contactId }) => {
    const contact = store.getContact(contactId);
    return {
      contact,
      customer: contact.customerId ? store.getCustomer(contact.customerId) : null,
      leads: store.listLeads({ contactId, limit: 100 }).items,
      deals: store.listDeals({ contactId, limit: 100 }).items,
      recentCalls: store.listCalls({ contactId, limit: 5 }).items,
    };
  });

  tool("crm", "crm_create_contact", {
    title: "Create contact",
    description: "Add a new person, optionally linked to a customer account. Search first to avoid creating duplicates.",
    inputSchema: {
      customerId: z.string().nullable().optional(),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      email: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      title: z.string().nullable().optional(),
    },
    annotations: WRITE,
  }, (a) => store.createContact(a));

  tool("crm", "crm_update_contact", {
    title: "Update contact",
    description: "Change a contact's name, email, phone, title or customer link. Omitted fields stay as they are; null clears a field. Use to fix missing or malformed contact info.",
    inputSchema: {
      contactId: id("Contact"),
      customerId: z.string().nullable().optional(),
      firstName: z.string().min(1).optional(),
      lastName: z.string().min(1).optional(),
      email: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      title: z.string().nullable().optional(),
    },
    annotations: IDEMPOTENT_WRITE,
  }, (a) => store.updateContact(a));

  tool("crm", "crm_merge_contacts", {
    title: "Merge duplicate contacts",
    description: "Fold a duplicate contact (mergeId) into the one to keep (keepId): empty fields are filled from the duplicate, all leads/deals/messages/calls are re-pointed, and the duplicate is deleted. Irreversible; confirm they are the same person first.",
    inputSchema: { keepId: id("Contact to keep"), mergeId: id("Duplicate contact to remove") },
    annotations: DESTRUCTIVE,
  }, (a) => store.mergeContacts(a));

  tool("crm", "crm_list_customers", {
    title: "List customers",
    description: "List customer accounts (households or businesses), newest first. Filter by text, status or owner.",
    inputSchema: { query: z.string().optional(), status: z.enum(["active", "inactive", "churned"]).optional(), ownerId: z.string().optional(), ...page },
    annotations: READ,
  }, (a) => store.listCustomers(a));

  tool("crm", "crm_get_customer", {
    title: "Get customer",
    description: "One customer account with its contacts, deals, jobs and invoices. Use for a full account picture.",
    inputSchema: { customerId: id("Customer") },
    annotations: READ,
  }, ({ customerId }) => ({
    customer: store.getCustomer(customerId),
    contacts: store.searchContacts({ customerId, limit: 100 }).items,
    deals: store.listDeals({ customerId, limit: 100 }).items,
    jobs: store.listJobs({ customerId, limit: 100 }).items,
    invoices: store.listInvoices({ customerId, limit: 100 }).items,
  }));

  tool("crm", "crm_list_employees", {
    title: "List employees",
    description: "Active staff with ids and roles. Use to pick an owner for a deal/lead or an assignee for a job or task.",
    inputSchema: { includeInactive: z.boolean().optional() },
    annotations: READ,
  }, (a) => store.listEmployees(a));

  tool("crm", "crm_list_leads", {
    title: "List leads",
    description: "Inbound leads, newest first. Set uncontacted: true to find leads nobody has responded to yet.",
    inputSchema: {
      status: z.enum(["new", "contacted", "qualified", "disqualified", "converted"]).optional(),
      ownerId: z.string().optional(),
      contactId: z.string().optional(),
      uncontacted: z.boolean().optional(),
      ...page,
    },
    annotations: READ,
  }, (a) => store.listLeads(a));

  tool("crm", "crm_update_lead", {
    title: "Update lead",
    description: "Change a lead's status or owner. Note: sending an email/SMS or logging an outbound call to the lead's contact marks it contacted automatically.",
    inputSchema: {
      leadId: id("Lead"),
      status: z.enum(["new", "contacted", "qualified", "disqualified", "converted"]).optional(),
      ownerId: z.string().nullable().optional(),
    },
    annotations: WRITE,
  }, (a) => store.updateLead(a));

  tool("crm", "crm_list_deals", {
    title: "List deals",
    description: "Sales pipeline deals, most recently updated first. Use staleDays to find open deals with no activity for N days, openOnly to skip won/lost.",
    inputSchema: {
      stage: z.enum(["new", "qualified", "quote-sent", "negotiation", "won", "lost"]).optional(),
      ownerId: z.string().optional(),
      customerId: z.string().optional(),
      contactId: z.string().optional(),
      openOnly: z.boolean().optional(),
      staleDays: z.number().int().min(0).optional(),
      ...page,
    },
    annotations: READ,
  }, (a) => store.listDeals(a));

  tool("crm", "crm_get_deal", {
    title: "Get deal",
    description: "One deal with its quotes and contact.",
    inputSchema: { dealId: id("Deal") },
    annotations: READ,
  }, ({ dealId }) => {
    const deal = store.getDeal(dealId);
    return { deal, contact: store.getContact(deal.contactId), quotes: store.listQuotes({ dealId, limit: 100 }).items };
  });

  tool("crm", "crm_update_deal", {
    title: "Update deal",
    description:
      "Move a deal to a new stage and/or set its next action, amount or owner. Stage moves must follow the pipeline (new→qualified→quote-sent→negotiation→won/lost; won is final; lost can reopen). Moving to lost requires lostReason. Set nextAction to {summary, dueOn} so every open deal has a next step.",
    inputSchema: {
      dealId: id("Deal"),
      stage: z.enum(["new", "qualified", "quote-sent", "negotiation", "won", "lost"]).optional(),
      lostReason: z.string().optional(),
      nextAction: z.object({ summary: z.string().min(1), dueOn: isoDate }).nullable().optional(),
      amountCents: cents("Deal value").optional(),
      ownerId: z.string().nullable().optional(),
    },
    annotations: WRITE,
  }, (a) => store.updateDeal(a));

  tool("crm", "crm_list_quotes", {
    title: "List quotes",
    description: "Quotes/estimates. Set notFollowedUp: true to find sent quotes that never got a follow-up.",
    inputSchema: {
      status: z.enum(["draft", "sent", "viewed", "accepted", "declined", "expired"]).optional(),
      dealId: z.string().optional(),
      customerId: z.string().optional(),
      notFollowedUp: z.boolean().optional(),
      ...page,
    },
    annotations: READ,
  }, (a) => store.listQuotes(a));

  tool("crm", "crm_send_quote", {
    title: "Send quote",
    description: "Send a draft quote to the customer (status becomes sent). Only works on drafts.",
    inputSchema: { quoteId: id("Quote"), expiresOn: isoDate.optional() },
    annotations: WRITE,
  }, (a) => store.sendQuote(a));

  tool("crm", "crm_follow_up_quote", {
    title: "Follow up on quote",
    description: "Message the deal's contact about a sent/viewed quote and record the follow-up on the quote. Write the full message body. Goes to the outbox; nothing is really delivered.",
    inputSchema: {
      quoteId: id("Quote"),
      body: z.string().min(1),
      channel: z.enum(["email", "sms"]).optional().describe("Default email"),
      contactId: z.string().optional().describe("Defaults to the deal's contact"),
      employeeId: z.string().optional().describe("Sender; defaults to the company address"),
    },
    annotations: WRITE,
  }, (a) => store.followUpQuote(a));

  tool("crm", "crm_list_tasks", {
    title: "List tasks",
    description: "To-dos for staff. Filter by status, assignee or a related record id.",
    inputSchema: { status: z.enum(["open", "done", "canceled"]).optional(), assigneeId: z.string().optional(), relatedId: z.string().optional(), ...page },
    annotations: READ,
  }, (a) => store.listTasks(a));

  tool("crm", "crm_create_task", {
    title: "Create task",
    description: "Create a to-do for a staff member, linked to the records it is about (relatedIds). Use when a human must do something you cannot.",
    inputSchema: {
      title: z.string().min(1),
      assigneeId: z.string().nullable().optional(),
      dueOn: isoDate.nullable().optional(),
      relatedIds: z.array(z.string()).optional(),
    },
    annotations: WRITE,
  }, (a) => store.createTask(a));

  tool("crm", "crm_complete_task", {
    title: "Complete task",
    description: "Mark an open task done.",
    inputSchema: { taskId: id("Task") },
    annotations: WRITE,
  }, ({ taskId }) => store.completeTask(taskId));

  // ------------------------------------------------------------------ inbox
  tool("inbox", "inbox_list_threads", {
    title: "List inbox threads",
    description: "Email and SMS conversations, newest activity first, with unread counts and the last message snippet. Use unreadOnly to triage.",
    inputSchema: { channel: z.enum(["email", "sms"]).optional(), contactId: z.string().optional(), unreadOnly: z.boolean().optional(), query: z.string().optional(), ...page },
    annotations: READ,
  }, (a) => store.listThreads(a));

  tool("inbox", "inbox_get_thread", {
    title: "Get thread",
    description: "All messages in one thread, oldest first. Read before replying.",
    inputSchema: { threadId: id("Thread (thr_…)") },
    annotations: READ,
  }, ({ threadId }) => store.getThread(threadId));

  tool("inbox", "inbox_send_email", {
    title: "Send email",
    description: "Send an email to a contact, raw address, or as a reply in an existing thread (threadId). Subject is required for new threads. Written to the outbox only; nothing leaves the sandbox.",
    inputSchema: {
      contactId: z.string().optional(),
      to: z.array(z.string()).optional(),
      threadId: z.string().optional(),
      subject: z.string().optional(),
      body: z.string().min(1),
      employeeId: z.string().optional().describe("Sender; defaults to the company address"),
      relatedIds: z.array(z.string()).optional().describe("Records this email is about"),
    },
    annotations: WRITE,
  }, (a) => store.sendEmail(a));

  tool("inbox", "inbox_send_sms", {
    title: "Send SMS",
    description: "Send a text message to a contact, raw number, or within an SMS thread. Outbox only.",
    inputSchema: {
      contactId: z.string().optional(),
      to: z.string().optional(),
      threadId: z.string().optional(),
      body: z.string().min(1).max(1600),
      employeeId: z.string().optional(),
      relatedIds: z.array(z.string()).optional(),
    },
    annotations: WRITE,
  }, (a) => store.sendSms(a));

  tool("inbox", "inbox_mark_thread_read", {
    title: "Mark thread read",
    description: "Mark every message in a thread as read after handling it.",
    inputSchema: { threadId: id("Thread") },
    annotations: IDEMPOTENT_WRITE,
  }, ({ threadId }) => store.markThreadRead(threadId));

  // ------------------------------------------------------------------ calendar
  tool("calendar", "calendar_list_jobs", {
    title: "List jobs",
    description: "Scheduled work (appointments / work orders / projects), latest start first. Filter by status, customer, assignee, or a start-time window [from, to).",
    inputSchema: {
      status: z.enum(["scheduled", "in-progress", "completed", "canceled", "no-show"]).optional(),
      customerId: z.string().optional(),
      assigneeId: z.string().optional(),
      from: z.string().optional().describe("Inclusive; YYYY-MM-DD or datetime"),
      to: z.string().optional().describe("Exclusive; YYYY-MM-DD or datetime"),
      ...page,
    },
    annotations: READ,
  }, (a) => store.listJobs(a));

  tool("calendar", "calendar_get_job", {
    title: "Get job",
    description: "One job with its customer and invoices.",
    inputSchema: { jobId: id("Job") },
    annotations: READ,
  }, ({ jobId }) => {
    const job = store.getJob(jobId);
    return { job, customer: store.getCustomer(job.customerId), invoices: store.listInvoices({ jobId, limit: 100 }).items };
  });

  tool("calendar", "calendar_schedule_job", {
    title: "Schedule job",
    description: "Book new work for a customer. Assignees must be active employees and not double-booked (pass allowOverlap to override).",
    inputSchema: {
      customerId: id("Customer"),
      title: z.string().min(1),
      scheduledStart: isoDateTime,
      scheduledEnd: isoDateTime,
      assigneeIds: z.array(z.string()).optional(),
      quoteId: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      allowOverlap: z.boolean().optional(),
    },
    annotations: WRITE,
  }, (a) => store.scheduleJob(a));

  tool("calendar", "calendar_reschedule_job", {
    title: "Reschedule job",
    description: "Move a scheduled or no-show job to a new time window (optionally new assignees). Does NOT notify the customer; send them a message separately if policy requires.",
    inputSchema: {
      jobId: id("Job"),
      scheduledStart: isoDateTime,
      scheduledEnd: isoDateTime,
      assigneeIds: z.array(z.string()).optional(),
      reason: z.string().optional(),
      allowOverlap: z.boolean().optional(),
    },
    annotations: WRITE,
  }, (a) => store.rescheduleJob(a));

  tool("calendar", "calendar_cancel_job", {
    title: "Cancel job",
    description: "Cancel a scheduled or in-progress job. Requires a reason. Cannot be undone.",
    inputSchema: { jobId: id("Job"), reason: z.string().min(1) },
    annotations: DESTRUCTIVE,
  }, (a) => store.cancelJob(a));

  tool("calendar", "calendar_complete_job", {
    title: "Complete job",
    description: "Mark a scheduled or in-progress job completed now, with optional notes.",
    inputSchema: { jobId: id("Job"), notes: z.string().optional() },
    annotations: WRITE,
  }, (a) => store.completeJob(a));

  // ------------------------------------------------------------------ invoicing
  tool("invoicing", "invoicing_list_invoices", {
    title: "List invoices",
    description: "Invoices, newest first. Set overdue: true for unpaid invoices past their due date.",
    inputSchema: {
      status: z.enum(["draft", "open", "paid", "partially-paid", "void"]).optional(),
      customerId: z.string().optional(),
      jobId: z.string().optional(),
      overdue: z.boolean().optional(),
      ...page,
    },
    annotations: READ,
  }, (a) => store.listInvoices(a));

  tool("invoicing", "invoicing_get_invoice", {
    title: "Get invoice",
    description: "One invoice with its payments and balance due.",
    inputSchema: { invoiceId: id("Invoice") },
    annotations: READ,
  }, ({ invoiceId }) => {
    const invoice = store.getInvoice(invoiceId);
    return { invoice, balanceCents: invoice.totalCents - invoice.paidCents, payments: store.listPayments({ invoiceId, limit: 100 }).items };
  });

  tool("invoicing", "invoicing_create_invoice", {
    title: "Create invoice",
    description: "Issue an invoice to a customer (optionally for a job of that customer). Total is computed from line items; due date defaults to company payment terms.",
    inputSchema: {
      customerId: id("Customer"),
      jobId: z.string().nullable().optional(),
      lineItems: z.array(lineItem).min(1),
      issuedOn: isoDate.optional(),
      dueOn: isoDate.optional(),
    },
    annotations: WRITE,
  }, (a) => store.createInvoice(a));

  tool("invoicing", "invoicing_send_reminder", {
    title: "Send invoice reminder",
    description: "Send a payment reminder for an open or partially-paid invoice to the customer's contact (outbox only). A default polite body is used if none is given.",
    inputSchema: {
      invoiceId: id("Invoice"),
      channel: z.enum(["email", "sms"]).optional(),
      body: z.string().optional(),
      contactId: z.string().optional(),
      employeeId: z.string().optional(),
    },
    annotations: WRITE,
  }, (a) => store.sendInvoiceReminder(a));

  tool("invoicing", "invoicing_void_invoice", {
    title: "Void invoice",
    description: "Void an invoice that has no payments applied (e.g. issued against the wrong job). Irreversible; requires a reason.",
    inputSchema: { invoiceId: id("Invoice"), reason: z.string().min(1) },
    annotations: DESTRUCTIVE,
  }, (a) => store.voidInvoice(a));

  tool("invoicing", "invoicing_record_payment", {
    title: "Record payment",
    description: "Record money received against an invoice. Cannot exceed the balance; void, draft and paid invoices are rejected.",
    inputSchema: {
      invoiceId: id("Invoice"),
      amountCents: cents("Amount received"),
      method: z.enum(["card", "ach", "check", "cash"]),
      reference: z.string().optional(),
    },
    annotations: WRITE,
  }, (a) => store.recordPayment(a));

  tool("invoicing", "invoicing_list_payments", {
    title: "List payments",
    description: "Payments received, newest first. Set unmatched: true for payments not yet applied to any invoice.",
    inputSchema: { invoiceId: z.string().optional(), customerId: z.string().optional(), unmatched: z.boolean().optional(), ...page },
    annotations: READ,
  }, (a) => store.listPayments(a));

  tool("invoicing", "invoicing_match_payment", {
    title: "Match payment to invoice",
    description: "Apply an unmatched payment to the invoice it pays. Customer must match and amount must not exceed the balance.",
    inputSchema: { paymentId: id("Payment"), invoiceId: id("Invoice") },
    annotations: WRITE,
  }, (a) => store.matchPayment(a));

  // ------------------------------------------------------------------ phone
  tool("phone", "phone_list_calls", {
    title: "List calls",
    description: "Phone call log, newest first. Use outcome: missed and direction: inbound to find calls that may need a callback.",
    inputSchema: {
      direction: z.enum(["inbound", "outbound"]).optional(),
      outcome: z.enum(["answered", "missed", "voicemail"]).optional(),
      contactId: z.string().optional(),
      since: z.string().optional().describe("Inclusive; YYYY-MM-DD or datetime"),
      ...page,
    },
    annotations: READ,
  }, (a) => store.listCalls(a));

  tool("phone", "phone_log_call", {
    title: "Log call",
    description: "Record a call you made or took (e.g. a callback), with outcome and a short summary. No real call is placed.",
    inputSchema: {
      contactId: z.string().optional(),
      phone: z.string().optional().describe("Defaults to the contact's phone"),
      direction: z.enum(["inbound", "outbound"]).optional().describe("Default outbound"),
      outcome: z.enum(["answered", "missed", "voicemail"]),
      durationSec: z.number().int().min(0).optional(),
      summary: z.string().nullable().optional(),
      employeeId: z.string().optional(),
    },
    annotations: WRITE,
  }, (a) => store.logCall(a));

  // ------------------------------------------------------------------ admin
  tool("admin", "admin_get_company_policies", {
    title: "Get company policies",
    description: "The company's plain-language operating rules (response times, follow-up cadence, payment terms...). Read before acting.",
    inputSchema: {},
    annotations: READ,
  }, () => store.getPolicies());

  tool("admin", "admin_get_company", {
    title: "Get company profile",
    description: "Company profile plus the simulated current time and today's date in company time.",
    inputSchema: {},
    annotations: READ,
  }, () => ({ company: store.getCompany(), now: store.now(), today: store.today() }));

  tool("admin", "admin_get_audit_log", {
    title: "Get audit log",
    description: "Every mutation attempted so far (tool, input, ok/error, changed ids), in order. Use sinceSeq to fetch only newer entries.",
    inputSchema: { sinceSeq: z.number().int().min(0).optional() },
    annotations: READ,
  }, ({ sinceSeq }) => store.audit().filter((e) => e.seq > (sinceSeq ?? 0)));

  tool("admin", "admin_reset", {
    title: "Reset sandbox",
    description: "Restore the original dataset and clock, discarding every change. The audit log is kept and records the reset.",
    inputSchema: {},
    annotations: DESTRUCTIVE,
  }, () => {
    store.reset({ keepAudit: true });
    return { reset: true, now: store.now() };
  });

  tool("admin", "admin_save_state", {
    title: "Save state",
    description: "Write the current dataset, audit log and outbox to the --state-out file for grading.",
    inputSchema: {},
    annotations: IDEMPOTENT_WRITE,
  }, () => {
    if (!options.saveState) throw new SandboxError("failed_precondition", "Saving is not configured; start the server with --state-out <file>.");
    return { savedTo: options.saveState() };
  });

  tool("admin", "admin_advance_clock", {
    title: "Advance clock",
    description: "Move simulated time forward by N minutes (e.g. to simulate waiting for a reply).",
    inputSchema: { minutes: z.number().int().min(0).max(60 * 24 * 30) },
    annotations: WRITE,
  }, ({ minutes }) => ({ now: store.advanceClock(minutes) }));

  // ------------------------------------------------------------------ resources
  const json = (uri: URL, value: unknown) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(value) }] });
  server.registerResource("company", "sandbox://company", {
    title: "Company profile",
    description: "The fictional company: name, industry, timezone, contact info, payment terms.",
    mimeType: "application/json",
  }, (uri) => json(uri, store.getCompany()));
  server.registerResource("policies", "sandbox://policies", {
    title: "Company policies",
    description: "Operating rules agents should follow.",
    mimeType: "application/json",
  }, (uri) => json(uri, store.getPolicies()));
  if (options.exposeAnswers) {
    server.registerResource("anomalies", "sandbox://anomalies", {
      title: "Ground-truth anomalies (answers)",
      description: "Labeled data problems injected into the dataset. For graders, not agents under test.",
      mimeType: "application/json",
    }, (uri) => json(uri, store.getAnomalies()));
  }

  return server;
}
