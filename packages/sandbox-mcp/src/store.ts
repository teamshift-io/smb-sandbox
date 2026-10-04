import type {
  Anomaly,
  Call,
  Company,
  Contact,
  Customer,
  Dataset,
  Deal,
  DealStage,
  Employee,
  Invoice,
  Job,
  Lead,
  LineItem,
  Message,
  Payment,
  Policy,
  Quote,
  Task,
  BusinessEvent,
  BusinessEventType,
} from "@teamshift/fake-business";
import {
  SandboxError,
  type AuditEntry,
  type CallFilter,
  type CancelJobInput,
  type CompleteJobInput,
  type ContactSearch,
  type CreateContactInput,
  type CreateInvoiceInput,
  type CreateTaskInput,
  type CustomerSearch,
  type DealFilter,
  type FollowUpQuoteInput,
  type InvoiceFilter,
  type JobFilter,
  type LeadFilter,
  type LogCallInput,
  type MatchPaymentInput,
  type MergeContactsInput,
  type Page,
  type PageOptions,
  type PaymentFilter,
  type QuoteFilter,
  type RecordPaymentInput,
  type RescheduleJobInput,
  type SandboxStoreOptions,
  type ScheduleJobInput,
  type SendEmailInput,
  type SendInvoiceReminderInput,
  type SendQuoteInput,
  type SendSmsInput,
  type TaskFilter,
  type ThreadFilter,
  type ThreadSummary,
  type UpdateContactInput,
  type UpdateDealInput,
  type UpdateLeadInput,
  type VoidInvoiceInput,
} from "./types.js";
import { addDays, dateInZone, daysBetween, isIsoDate, MINUTE_MS, zonedTimeToUtcMs } from "./time.js";

/**
 * Allowed deal stage transitions. `won` is terminal; `lost` deals can be reopened.
 */
export const DEAL_STAGE_TRANSITIONS: Readonly<Record<DealStage, readonly DealStage[]>> = {
  new: ["qualified", "quote-sent", "lost"],
  qualified: ["quote-sent", "negotiation", "won", "lost"],
  "quote-sent": ["qualified", "negotiation", "won", "lost"],
  negotiation: ["quote-sent", "won", "lost"],
  won: [],
  lost: ["new", "qualified"],
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const LEAD_STATUSES = ["new", "contacted", "qualified", "disqualified", "converted"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Record collections addressable by id prefix. */
const PREFIX_COLLECTION = {
  emp: "employees",
  cus: "customers",
  con: "contacts",
  lead: "leads",
  deal: "deals",
  quo: "quotes",
  job: "jobs",
  inv: "invoices",
  pay: "payments",
  msg: "messages",
  call: "calls",
  task: "tasks",
  evt: "events",
  anm: "anomalies",
} as const satisfies Record<string, keyof Dataset>;

type CollectionKey = (typeof PREFIX_COLLECTION)[keyof typeof PREFIX_COLLECTION];

interface MutationCtx {
  at: string;
  changed: Set<string>;
  emit(type: BusinessEventType, subjectId: string, data?: Record<string, unknown>, actorId?: string | null): void;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function fail(code: SandboxError["code"], message: string): never {
  throw new SandboxError(code, message);
}

function digits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function isValidEmail(value: string | null | undefined): value is string {
  return typeof value === "string" && EMAIL_RE.test(value);
}

function isValidPhone(value: string | null | undefined): value is string {
  const d = digits(value);
  return d.length >= 10 && d.length <= 15;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") fail("invalid_argument", `${field} must be a non-empty string.`);
  return value.trim();
}

function requireCents(value: unknown, field: string, { allowZero = false } = {}): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    fail("invalid_argument", `${field} must be a ${allowZero ? "non-negative" : "positive"} integer number of cents (e.g. 12500 for $125.00).`);
  }
  return value;
}

function requireDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !isIsoDate(value)) fail("invalid_argument", `${field} must be a calendar date in YYYY-MM-DD format.`);
  return value;
}

function requireInstant(value: unknown, field: string): number {
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(ms) || !/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(String(value))) {
    fail("invalid_argument", `${field} must be an ISO-8601 datetime with a UTC offset, e.g. 2026-10-01T15:00:00Z or 2026-10-01T10:00:00-05:00.`);
  }
  return ms;
}


function paginate<T>(rows: T[], opts: PageOptions = {}): Page<T> {
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(opts.limit ?? DEFAULT_LIMIT)));
  const items = rows.slice(offset, offset + limit);
  const next = offset + items.length;
  return { items: clone(items), total: rows.length, offset, limit, nextOffset: next < rows.length ? next : null };
}

function byDesc<T>(key: (row: T) => string): (a: T, b: T) => number {
  return (a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0);
}

function lineTotal(items: LineItem[]): number {
  return items.reduce((sum, li) => sum + Math.round(li.quantity * li.unitPriceCents), 0);
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * An in-memory, fully offline simulation of a small business's systems
 * (CRM, inbox, calendar, invoicing, phone) over one {@link Dataset}.
 *
 * - Reads return deep copies; mutate only through the write methods.
 * - Every write validates input and invariants first, then applies the change
 *   atomically (rolled back on any error), emits one or more {@link BusinessEvent}s, appends an
 *   {@link AuditEntry}, and advances the simulated clock by one minute.
 * - Failed writes throw {@link SandboxError}, change nothing, are still
 *   audited (`result: "error"`), and do not advance the clock.
 * - Nothing leaves the process: sent email/SMS are recorded as outbound
 *   messages and listed by {@link SandboxStore.outbox}.
 *
 * @example
 * ```ts
 * import { generate } from "@teamshift/fake-business";
 * import { SandboxStore } from "@teamshift/sandbox-mcp";
 *
 * const store = new SandboxStore(generate({ industry: "home-services", seed: 42 }));
 * const [deal] = store.listDeals({ staleDays: 14 }).items;
 * store.updateDeal({ dealId: deal!.id, nextAction: { summary: "Call back", dueOn: "2026-10-02" } });
 * console.log(store.audit());
 * ```
 */
export class SandboxStore {
  private readonly original: Dataset;
  private readonly startMs: number;
  private data!: Dataset;
  private clockMs!: number;
  private auditLog!: AuditEntry[];
  private emitted!: BusinessEvent[];
  private outboxIds!: string[];
  private idCounter!: number;

  /**
   * @param dataset A dataset, typically from `generate()` in `@teamshift/fake-business`. It is deep-cloned; the caller's copy is never modified.
   * @param options See {@link SandboxStoreOptions}.
   */
  constructor(dataset: Dataset, options: SandboxStoreOptions = {}) {
    if (!dataset || typeof dataset !== "object" || !dataset.meta || !dataset.company) {
      throw new SandboxError("invalid_argument", "SandboxStore requires a Dataset with meta and company.");
    }
    this.original = clone(dataset);
    if (options.startAt !== undefined) {
      const ms = Date.parse(options.startAt);
      if (!Number.isFinite(ms)) throw new SandboxError("invalid_argument", "startAt must be an ISO-8601 datetime.");
      this.startMs = ms;
    } else {
      this.startMs = zonedTimeToUtcMs(dataset.meta.asOf, 9, 0, dataset.company.timezone);
    }
    this.reset();
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Restores the original dataset and clock, and clears emitted events and the outbox.
   * The audit log is cleared too, unless `keepAudit` is set: then it is kept and an
   * `admin_reset` entry is appended, so a grader can see that a reset happened.
   */
  reset(options: { keepAudit?: boolean } = {}): void {
    const previous = options.keepAudit ? (this.auditLog ?? []) : [];
    this.data = clone(this.original);
    this.clockMs = this.startMs;
    this.auditLog = previous;
    if (options.keepAudit) this.auditLog.push({ seq: previous.length + 1, at: this.now(), tool: "admin_reset", input: {}, result: "ok", changedIds: [] });
    this.emitted = [];
    this.outboxIds = [];
    this.idCounter = 0;
  }

  /** Current simulated time (ISO-8601 UTC). Starts at 09:00 company time on `meta.asOf`. */
  now(): string {
    return new Date(this.clockMs).toISOString();
  }

  /** Today's date (YYYY-MM-DD) in the company's timezone, per the simulated clock. */
  today(): string {
    return dateInZone(this.clockMs, this.data.company.timezone);
  }

  /** Moves the simulated clock forward. Audited as `admin_advance_clock`; emits no event. */
  advanceClock(minutes: number): string {
    const at = this.now();
    const entry = { seq: this.auditLog.length + 1, at, tool: "admin_advance_clock", input: { minutes } };
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) {
      const error = new SandboxError("invalid_argument", "minutes must be a non-negative number.");
      this.auditLog.push({ ...entry, result: "error", error: error.message, changedIds: [] });
      throw error;
    }
    this.auditLog.push({ ...entry, result: "ok", changedIds: [] });
    this.clockMs += Math.round(minutes * MINUTE_MS);
    return this.now();
  }

  /** A deep copy of the current dataset, including sandbox-emitted events. */
  snapshot(): Dataset {
    return clone(this.data);
  }

  /** A copy of the audit log (one entry per mutation attempt, in order). */
  audit(): AuditEntry[] {
    return clone(this.auditLog);
  }

  /** Events emitted by sandbox mutations since construction or the last reset. */
  emittedEvents(): BusinessEvent[] {
    return clone(this.emitted);
  }

  /** Outbound email/SMS "sent" through the sandbox (never actually delivered). */
  outbox(): Message[] {
    return clone(this.outboxIds.map((id) => this.mustFind("messages", id)));
  }

  // -------------------------------------------------------------------- reads

  /** Company profile, including policies. */
  getCompany(): Company {
    return clone(this.data.company);
  }

  /** The company's operating policies agents are expected to follow. */
  getPolicies(): Policy[] {
    return clone(this.data.company.policies);
  }

  /** Ground-truth labels for injected data problems. Hide these from agents under test. */
  getAnomalies(): Anomaly[] {
    return clone(this.data.anomalies);
  }

  /** Employees; inactive ones are excluded unless `includeInactive`. */
  listEmployees(opts: { includeInactive?: boolean } = {}): Employee[] {
    return clone(this.data.employees.filter((e) => opts.includeInactive || e.active));
  }

  /** Looks up any record by id (prefix decides the collection). Returns null if absent. */
  getRecord(id: string): unknown {
    if (id === this.data.company.id) return clone(this.data.company);
    if (id.startsWith("thr_")) {
      const messages = this.threadMessages(id);
      return messages.length ? { threadId: id, messages: clone(messages) } : null;
    }
    const coll = this.collectionFor(id);
    if (!coll) return null;
    const rec = (this.data[coll] as Array<{ id: string }>).find((r) => r.id === id);
    return rec ? clone(rec) : null;
  }

  searchContacts(filter: ContactSearch = {}): Page<Contact> {
    const q = filter.query?.trim().toLowerCase();
    const qDigits = digits(filter.query);
    const rows = this.data.contacts.filter((c) => {
      if (filter.customerId && c.customerId !== filter.customerId) return false;
      if (filter.missingInfo && isValidEmail(c.email) && isValidPhone(c.phone)) return false;
      if (!q) return true;
      const hay = `${c.firstName} ${c.lastName} ${c.email ?? ""} ${c.title ?? ""}`.toLowerCase();
      return hay.includes(q) || (qDigits.length >= 4 && digits(c.phone).includes(qDigits));
    });
    return paginate(rows.sort(byDesc((c) => c.createdAt)), filter);
  }

  getContact(contactId: string): Contact {
    return clone(this.mustFind("contacts", contactId));
  }

  listCustomers(filter: CustomerSearch = {}): Page<Customer> {
    const q = filter.query?.trim().toLowerCase();
    const rows = this.data.customers.filter(
      (c) =>
        (!filter.status || c.status === filter.status) &&
        (!filter.ownerId || c.ownerId === filter.ownerId) &&
        (!q || `${c.name} ${c.address.line1} ${c.address.city} ${c.tags.join(" ")}`.toLowerCase().includes(q)),
    );
    return paginate(rows.sort(byDesc((c) => c.createdAt)), filter);
  }

  getCustomer(customerId: string): Customer {
    return clone(this.mustFind("customers", customerId));
  }

  listLeads(filter: LeadFilter = {}): Page<Lead> {
    const rows = this.data.leads.filter(
      (l) =>
        (!filter.status || l.status === filter.status) &&
        (!filter.ownerId || l.ownerId === filter.ownerId) &&
        (!filter.contactId || l.contactId === filter.contactId) &&
        (!filter.uncontacted || l.firstResponseAt === null),
    );
    return paginate(rows.sort(byDesc((l) => l.createdAt)), filter);
  }

  listDeals(filter: DealFilter = {}): Page<Deal> {
    const today = this.today();
    const rows = this.data.deals.filter((d) => {
      const open = d.stage !== "won" && d.stage !== "lost";
      if (filter.stage && d.stage !== filter.stage) return false;
      if (filter.ownerId && d.ownerId !== filter.ownerId) return false;
      if (filter.customerId && d.customerId !== filter.customerId) return false;
      if (filter.contactId && d.contactId !== filter.contactId) return false;
      if (filter.openOnly && !open) return false;
      if (filter.staleDays !== undefined && (!open || daysBetween(dateInZone(Date.parse(d.updatedAt), this.data.company.timezone), today) < filter.staleDays)) return false;
      return true;
    });
    return paginate(rows.sort(byDesc((d) => d.updatedAt)), filter);
  }

  getDeal(dealId: string): Deal {
    return clone(this.mustFind("deals", dealId));
  }

  listQuotes(filter: QuoteFilter = {}): Page<Quote> {
    const rows = this.data.quotes.filter(
      (q) =>
        (!filter.status || q.status === filter.status) &&
        (!filter.dealId || q.dealId === filter.dealId) &&
        (!filter.customerId || q.customerId === filter.customerId) &&
        (!filter.notFollowedUp || ((q.status === "sent" || q.status === "viewed") && q.followUps.length === 0)),
    );
    return paginate(rows.sort(byDesc((q) => q.sentAt ?? q.createdAt)), filter);
  }

  getQuote(quoteId: string): Quote {
    return clone(this.mustFind("quotes", quoteId));
  }

  listJobs(filter: JobFilter = {}): Page<Job> {
    const from = filter.from ? this.boundMs(filter.from, "from") : -Infinity;
    const to = filter.to ? this.boundMs(filter.to, "to") : Infinity;
    const rows = this.data.jobs.filter((j) => {
      const start = Date.parse(j.scheduledStart);
      return (
        (!filter.status || j.status === filter.status) &&
        (!filter.customerId || j.customerId === filter.customerId) &&
        (!filter.assigneeId || j.assigneeIds.includes(filter.assigneeId)) &&
        start >= from &&
        start < to
      );
    });
    return paginate(rows.sort(byDesc((j) => j.scheduledStart)), filter);
  }

  getJob(jobId: string): Job {
    return clone(this.mustFind("jobs", jobId));
  }

  listInvoices(filter: InvoiceFilter = {}): Page<Invoice> {
    const today = this.today();
    const rows = this.data.invoices.filter(
      (i) =>
        (!filter.status || i.status === filter.status) &&
        (!filter.customerId || i.customerId === filter.customerId) &&
        (!filter.jobId || i.jobId === filter.jobId) &&
        (!filter.overdue || this.isOverdue(i, today)),
    );
    return paginate(rows.sort(byDesc((i) => i.issuedOn)), filter);
  }

  getInvoice(invoiceId: string): Invoice {
    return clone(this.mustFind("invoices", invoiceId));
  }

  listPayments(filter: PaymentFilter = {}): Page<Payment> {
    const rows = this.data.payments.filter(
      (p) =>
        (!filter.invoiceId || p.invoiceId === filter.invoiceId) &&
        (!filter.customerId || p.customerId === filter.customerId) &&
        (!filter.unmatched || p.invoiceId === null),
    );
    return paginate(rows.sort(byDesc((p) => p.receivedAt)), filter);
  }

  listThreads(filter: ThreadFilter = {}): Page<ThreadSummary> {
    const q = filter.query?.trim().toLowerCase();
    const threads = new Map<string, Message[]>();
    for (const m of this.data.messages) {
      const list = threads.get(m.threadId);
      if (list) list.push(m);
      else threads.set(m.threadId, [m]);
    }
    const rows: ThreadSummary[] = [];
    for (const [threadId, msgs] of threads) {
      const summary = this.summarize(threadId, msgs);
      if (filter.channel && summary.channel !== filter.channel) continue;
      if (filter.contactId && !msgs.some((m) => m.contactId === filter.contactId)) continue;
      if (filter.unreadOnly && summary.unreadCount === 0) continue;
      if (q && !msgs.some((m) => `${m.subject ?? ""} ${m.body} ${m.from} ${m.to.join(" ")}`.toLowerCase().includes(q))) continue;
      rows.push(summary);
    }
    return paginate(rows.sort(byDesc((t) => t.lastMessageAt)), filter);
  }

  /** All messages in a thread, oldest first. */
  getThread(threadId: string): { threadId: string; messages: Message[] } {
    const messages = this.threadMessages(threadId);
    if (messages.length === 0) fail("not_found", `Thread ${threadId} not found. Use inbox_list_threads to find thread ids.`);
    return { threadId, messages: clone(messages) };
  }

  listCalls(filter: CallFilter = {}): Page<Call> {
    const since = filter.since ? this.boundMs(filter.since, "since") : -Infinity;
    const rows = this.data.calls.filter(
      (c) =>
        (!filter.direction || c.direction === filter.direction) &&
        (!filter.outcome || c.outcome === filter.outcome) &&
        (!filter.contactId || c.contactId === filter.contactId) &&
        Date.parse(c.startedAt) >= since,
    );
    return paginate(rows.sort(byDesc((c) => c.startedAt)), filter);
  }

  listTasks(filter: TaskFilter = {}): Page<Task> {
    const rows = this.data.tasks.filter(
      (t) =>
        (!filter.status || t.status === filter.status) &&
        (!filter.assigneeId || t.assigneeId === filter.assigneeId) &&
        (!filter.relatedId || t.relatedIds.includes(filter.relatedId)),
    );
    return paginate(rows.sort(byDesc((t) => t.createdAt)), filter);
  }

  // ------------------------------------------------------------------- writes: CRM

  /** Creates a contact. Email (if given) must be well-formed; customer must exist. Emits `ContactCreated`. */
  createContact(input: CreateContactInput): Contact {
    return this.mutate("crm_create_contact", input, (ctx) => {
      const firstName = requireText(input.firstName, "firstName");
      const lastName = requireText(input.lastName, "lastName");
      const customerId = input.customerId ?? null;
      if (customerId !== null) this.mustFind("customers", customerId);
      this.checkContactInfo(input.email, input.phone);
      const contact: Contact = {
        id: this.newId("con"),
        customerId,
        firstName,
        lastName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        title: input.title ?? null,
        createdAt: ctx.at,
      };
      this.data.contacts.push(contact);
      ctx.changed.add(contact.id);
      ctx.emit("ContactCreated", contact.id, { customerId });
      return contact;
    });
  }

  /** Updates contact fields. Omitted fields are unchanged; null clears. Emits `ContactUpdated`. */
  updateContact(input: UpdateContactInput): Contact {
    return this.mutate("crm_update_contact", input, (ctx) => {
      const contact = this.mustFind("contacts", input.contactId);
      if (input.customerId != null) this.mustFind("customers", input.customerId);
      if (input.firstName !== undefined) requireText(input.firstName, "firstName");
      if (input.lastName !== undefined) requireText(input.lastName, "lastName");
      this.checkContactInfo(input.email, input.phone);
      const fields = ["customerId", "firstName", "lastName", "email", "phone", "title"] as const;
      const changes: Record<string, unknown> = {};
      for (const f of fields) {
        if (input[f] === undefined) continue;
        const value = typeof input[f] === "string" ? (input[f] as string).trim() : input[f];
        if (contact[f] !== value) {
          changes[f] = { from: contact[f], to: value };
          (contact as unknown as Record<string, unknown>)[f] = value;
        }
      }
      if (Object.keys(changes).length === 0) fail("invalid_argument", "No changes: provide at least one field that differs from the current value.");
      ctx.changed.add(contact.id);
      ctx.emit("ContactUpdated", contact.id, { changes });
      return contact;
    });
  }

  /**
   * Folds duplicate `mergeId` into `keepId`: fills keep's empty fields from the
   * duplicate, re-points leads, deals, messages, calls and related ids, then
   * deletes the duplicate. Emits `ContactsMerged`.
   */
  mergeContacts(input: MergeContactsInput): Contact {
    return this.mutate("crm_merge_contacts", input, (ctx) => {
      if (input.keepId === input.mergeId) fail("invalid_argument", "keepId and mergeId must be different contacts.");
      const keep = this.mustFind("contacts", input.keepId);
      const dup = this.mustFind("contacts", input.mergeId);
      if (keep.customerId && dup.customerId && keep.customerId !== dup.customerId) {
        fail("failed_precondition", `Contacts belong to different customers (${keep.customerId} vs ${dup.customerId}); they are probably not duplicates.`);
      }
      const filled: string[] = [];
      for (const f of ["customerId", "email", "phone", "title"] as const) {
        const keepVal = keep[f];
        const dupVal = dup[f];
        const keepBad = keepVal === null || (f === "email" && !isValidEmail(keepVal)) || (f === "phone" && !isValidPhone(keepVal));
        const dupGood = dupVal !== null && (f !== "email" || isValidEmail(dupVal)) && (f !== "phone" || isValidPhone(dupVal));
        if (keepBad && dupGood) {
          keep[f] = dupVal;
          filled.push(f);
        }
      }
      const repoint = <T extends { id: string }>(rows: T[], key: keyof T & string): void => {
        for (const r of rows) {
          const row = r as unknown as Record<string, unknown>;
          if (row[key] === dup.id) {
            row[key] = keep.id;
            ctx.changed.add(r.id);
          }
        }
      };
      repoint(this.data.leads, "contactId");
      repoint(this.data.deals, "contactId");
      repoint(this.data.messages, "contactId");
      repoint(this.data.calls, "contactId");
      for (const row of [...this.data.messages, ...this.data.tasks]) {
        const idx = row.relatedIds.indexOf(dup.id);
        if (idx >= 0) {
          row.relatedIds = [...new Set(row.relatedIds.map((id) => (id === dup.id ? keep.id : id)))];
          ctx.changed.add(row.id);
        }
      }
      this.data.contacts = this.data.contacts.filter((c) => c.id !== dup.id);
      ctx.changed.add(keep.id);
      ctx.changed.add(dup.id);
      ctx.emit("ContactsMerged", keep.id, { mergedId: dup.id, filledFields: filled });
      return keep;
    });
  }

  /** Updates a lead's status or owner. Emits `LeadContacted` (status→contacted) or `LeadUpdated`. */
  updateLead(input: UpdateLeadInput): Lead {
    return this.mutate("crm_update_lead", input, (ctx) => {
      const lead = this.mustFind("leads", input.leadId);
      if (input.ownerId != null) this.mustActiveEmployee(input.ownerId);
      if (input.status !== undefined && !LEAD_STATUSES.includes(input.status)) fail("invalid_argument", `status must be one of ${LEAD_STATUSES.join(", ")}.`);
      if (input.status === undefined && input.ownerId === undefined) fail("invalid_argument", "Provide status and/or ownerId.");
      const from = lead.status;
      if (input.status !== undefined) {
        lead.status = input.status;
        if ((input.status === "contacted" || input.status === "qualified") && lead.firstResponseAt === null) lead.firstResponseAt = ctx.at;
      }
      if (input.ownerId !== undefined) lead.ownerId = input.ownerId;
      ctx.changed.add(lead.id);
      ctx.emit(input.status === "contacted" && from !== "contacted" ? "LeadContacted" : "LeadUpdated", lead.id, { from, to: lead.status, ownerId: lead.ownerId });
      return lead;
    });
  }

  /**
   * Changes a deal's stage (validated against {@link DEAL_STAGE_TRANSITIONS}),
   * next action, amount or owner. Moving to `lost` requires `lostReason`.
   * Emits `DealStageChanged` when the stage changes, otherwise `DealUpdated`.
   */
  updateDeal(input: UpdateDealInput): Deal {
    return this.mutate("crm_update_deal", input, (ctx) => {
      const deal = this.mustFind("deals", input.dealId);
      const { stage, nextAction, amountCents, ownerId } = input;
      if (stage === undefined && nextAction === undefined && amountCents === undefined && ownerId === undefined) {
        fail("invalid_argument", "Provide at least one of stage, nextAction, amountCents, ownerId.");
      }
      const stageChanges = stage !== undefined && stage !== deal.stage;
      if (stageChanges && !DEAL_STAGE_TRANSITIONS[deal.stage].includes(stage)) {
        const allowed = DEAL_STAGE_TRANSITIONS[deal.stage];
        fail("failed_precondition", `Cannot move deal from "${deal.stage}" to "${stage}". Allowed: ${allowed.length ? allowed.join(", ") : "none (won is final)"}.`);
      }
      if (stage === "lost" && stageChanges && !input.lostReason?.trim()) fail("invalid_argument", 'lostReason is required when moving a deal to "lost".');
      if (nextAction) {
        requireText(nextAction.summary, "nextAction.summary");
        requireDate(nextAction.dueOn, "nextAction.dueOn");
      }
      if (amountCents !== undefined) requireCents(amountCents, "amountCents", { allowZero: true });
      if (ownerId != null) this.mustActiveEmployee(ownerId);
      const finalStage = stageChanges ? stage : deal.stage;
      if (nextAction && (finalStage === "won" || finalStage === "lost")) fail("invalid_argument", `A ${finalStage} deal cannot have a nextAction; create a task instead.`);

      const from = deal.stage;
      if (stageChanges) {
        deal.stage = stage;
        if (stage === "won" || stage === "lost") {
          deal.closedAt = ctx.at;
          deal.nextAction = null;
        } else {
          deal.closedAt = null;
        }
        deal.lostReason = stage === "lost" ? input.lostReason!.trim() : null;
      }
      if (nextAction !== undefined) deal.nextAction = nextAction ? { summary: nextAction.summary.trim(), dueOn: nextAction.dueOn } : null;
      if (amountCents !== undefined) deal.amountCents = amountCents;
      if (ownerId !== undefined) deal.ownerId = ownerId;
      deal.updatedAt = ctx.at;
      ctx.changed.add(deal.id);
      if (stageChanges) ctx.emit("DealStageChanged", deal.id, { from, to: deal.stage, lostReason: deal.lostReason });
      else ctx.emit("DealUpdated", deal.id, { nextAction: deal.nextAction, amountCents: deal.amountCents, ownerId: deal.ownerId });
      return deal;
    });
  }

  /** Sends a draft quote (status→sent). Emits `QuoteSent`. */
  sendQuote(input: SendQuoteInput): Quote {
    return this.mutate("crm_send_quote", input, (ctx) => {
      const quote = this.mustFind("quotes", input.quoteId);
      if (quote.status !== "draft") fail("failed_precondition", `Quote ${quote.number} is "${quote.status}"; only draft quotes can be sent. Use crm_follow_up_quote for sent quotes.`);
      const expiresOn = input.expiresOn ? requireDate(input.expiresOn, "expiresOn") : addDays(this.today(), 30);
      if (expiresOn < this.today()) fail("invalid_argument", "expiresOn must not be in the past.");
      quote.status = "sent";
      quote.sentAt = ctx.at;
      quote.expiresOn = expiresOn;
      ctx.changed.add(quote.id);
      ctx.emit("QuoteSent", quote.id, { dealId: quote.dealId, totalCents: quote.totalCents });
      return quote;
    });
  }

  /**
   * Follows up on a sent/viewed quote by messaging the deal's contact (outbox
   * only) and recording the follow-up. Emits `QuoteFollowedUp` and `MessageSent`.
   */
  followUpQuote(input: FollowUpQuoteInput): { quote: Quote; message: Message } {
    return this.mutate("crm_follow_up_quote", input, (ctx) => {
      const quote = this.mustFind("quotes", input.quoteId);
      if (quote.status !== "sent" && quote.status !== "viewed") {
        fail("failed_precondition", `Quote ${quote.number} is "${quote.status}"; only sent or viewed quotes can be followed up.`);
      }
      const deal = this.mustFind("deals", quote.dealId);
      const channel = input.channel ?? "email";
      const message = this.buildOutbound(ctx, {
        channel,
        contactId: input.contactId ?? deal.contactId,
        subject: `Following up on quote ${quote.number}`,
        body: requireText(input.body, "body"),
        employeeId: input.employeeId,
        relatedIds: [quote.id, deal.id],
      });
      quote.followUps.push(ctx.at);
      ctx.changed.add(quote.id);
      ctx.emit("QuoteFollowedUp", quote.id, { messageId: message.id, channel, followUpCount: quote.followUps.length });
      return { quote, message };
    });
  }

  // ------------------------------------------------------------------- writes: calendar

  /** Schedules a new job. Checks customer, quote, active assignees and double-booking. Emits `JobScheduled`. */
  scheduleJob(input: ScheduleJobInput): Job {
    return this.mutate("calendar_schedule_job", input, (ctx) => {
      this.mustFind("customers", input.customerId);
      const title = requireText(input.title, "title");
      const [start, end] = this.checkWindow(input.scheduledStart, input.scheduledEnd);
      if (input.quoteId) {
        const quote = this.mustFind("quotes", input.quoteId);
        if (quote.customerId !== input.customerId) fail("invalid_argument", `Quote ${quote.id} belongs to customer ${quote.customerId}, not ${input.customerId}.`);
      }
      const assigneeIds = [...new Set(input.assigneeIds ?? [])];
      assigneeIds.forEach((id) => this.mustActiveEmployee(id));
      if (!input.allowOverlap) this.checkOverlap(assigneeIds, start, end, null);
      const job: Job = {
        id: this.newId("job"),
        customerId: input.customerId,
        quoteId: input.quoteId ?? null,
        title,
        status: "scheduled",
        scheduledStart: new Date(start).toISOString(),
        scheduledEnd: new Date(end).toISOString(),
        assigneeIds,
        completedAt: null,
        notes: input.notes ?? null,
      };
      this.data.jobs.push(job);
      ctx.changed.add(job.id);
      ctx.emit("JobScheduled", job.id, { customerId: job.customerId, scheduledStart: job.scheduledStart, assigneeIds });
      return job;
    });
  }

  /** Moves a scheduled (or no-show) job to a new window; status becomes `scheduled`. Emits `JobRescheduled`. */
  rescheduleJob(input: RescheduleJobInput): Job {
    return this.mutate("calendar_reschedule_job", input, (ctx) => {
      const job = this.mustFind("jobs", input.jobId);
      if (job.status !== "scheduled" && job.status !== "no-show") {
        fail("failed_precondition", `Job ${job.id} is "${job.status}"; only scheduled or no-show jobs can be rescheduled.`);
      }
      const [start, end] = this.checkWindow(input.scheduledStart, input.scheduledEnd);
      const assigneeIds = input.assigneeIds ? [...new Set(input.assigneeIds)] : job.assigneeIds;
      if (input.assigneeIds) assigneeIds.forEach((id) => this.mustActiveEmployee(id));
      if (!input.allowOverlap) this.checkOverlap(assigneeIds, start, end, job.id);
      const previous = { scheduledStart: job.scheduledStart, scheduledEnd: job.scheduledEnd };
      job.scheduledStart = new Date(start).toISOString();
      job.scheduledEnd = new Date(end).toISOString();
      job.assigneeIds = assigneeIds;
      job.status = "scheduled";
      if (input.reason?.trim()) job.notes = [job.notes, `Rescheduled: ${input.reason.trim()}`].filter(Boolean).join("\n");
      ctx.changed.add(job.id);
      ctx.emit("JobRescheduled", job.id, { previous, scheduledStart: job.scheduledStart, scheduledEnd: job.scheduledEnd, reason: input.reason ?? null });
      return job;
    });
  }

  /** Cancels a scheduled or in-progress job with a reason. Emits `JobCanceled`. */
  cancelJob(input: CancelJobInput): Job {
    return this.mutate("calendar_cancel_job", input, (ctx) => {
      const job = this.mustFind("jobs", input.jobId);
      const reason = requireText(input.reason, "reason");
      if (job.status !== "scheduled" && job.status !== "in-progress") fail("failed_precondition", `Job ${job.id} is "${job.status}" and cannot be canceled.`);
      job.status = "canceled";
      job.notes = [job.notes, `Canceled: ${reason}`].filter(Boolean).join("\n");
      ctx.changed.add(job.id);
      ctx.emit("JobCanceled", job.id, { reason });
      return job;
    });
  }

  /** Marks a scheduled or in-progress job completed now. Emits `JobCompleted`. */
  completeJob(input: CompleteJobInput): Job {
    return this.mutate("calendar_complete_job", input, (ctx) => {
      const job = this.mustFind("jobs", input.jobId);
      if (job.status !== "scheduled" && job.status !== "in-progress") fail("failed_precondition", `Job ${job.id} is "${job.status}" and cannot be completed.`);
      job.status = "completed";
      job.completedAt = ctx.at;
      if (input.notes?.trim()) job.notes = [job.notes, input.notes.trim()].filter(Boolean).join("\n");
      ctx.changed.add(job.id);
      ctx.emit("JobCompleted", job.id, { customerId: job.customerId });
      return job;
    });
  }

  // ------------------------------------------------------------------- writes: tasks

  /** Creates an open task. `relatedIds` must reference existing records. Emits `TaskCreated`. */
  createTask(input: CreateTaskInput): Task {
    return this.mutate("crm_create_task", input, (ctx) => {
      const title = requireText(input.title, "title");
      if (input.assigneeId != null) this.mustActiveEmployee(input.assigneeId);
      if (input.dueOn) requireDate(input.dueOn, "dueOn");
      const relatedIds = [...new Set(input.relatedIds ?? [])];
      this.checkRelated(relatedIds);
      const task: Task = {
        id: this.newId("task"),
        title,
        assigneeId: input.assigneeId ?? null,
        dueOn: input.dueOn ?? null,
        status: "open",
        createdAt: ctx.at,
        completedAt: null,
        relatedIds,
      };
      this.data.tasks.push(task);
      ctx.changed.add(task.id);
      ctx.emit("TaskCreated", task.id, { assigneeId: task.assigneeId, dueOn: task.dueOn, relatedIds });
      return task;
    });
  }

  /** Marks an open task done. Emits `TaskCompleted`. */
  completeTask(taskId: string): Task {
    return this.mutate("crm_complete_task", { taskId }, (ctx) => {
      const task = this.mustFind("tasks", taskId);
      if (task.status !== "open") fail("failed_precondition", `Task ${task.id} is already "${task.status}".`);
      task.status = "done";
      task.completedAt = ctx.at;
      ctx.changed.add(task.id);
      ctx.emit("TaskCompleted", task.id, {});
      return task;
    });
  }

  // ------------------------------------------------------------------- writes: invoicing

  /** Issues a new invoice (status `open`). Totals are computed from line items. Emits `InvoiceIssued`. */
  createInvoice(input: CreateInvoiceInput): Invoice {
    return this.mutate("invoicing_create_invoice", input, (ctx) => {
      this.mustFind("customers", input.customerId);
      if (input.jobId) {
        const job = this.mustFind("jobs", input.jobId);
        if (job.customerId !== input.customerId) fail("invalid_argument", `Job ${job.id} belongs to customer ${job.customerId}, not ${input.customerId}.`);
      }
      if (!Array.isArray(input.lineItems) || input.lineItems.length === 0) fail("invalid_argument", "lineItems must contain at least one item.");
      const lineItems: LineItem[] = input.lineItems.map((li, i) => {
        if (typeof li.quantity !== "number" || !(li.quantity > 0)) fail("invalid_argument", `lineItems[${i}].quantity must be a positive number.`);
        requireCents(li.unitPriceCents, `lineItems[${i}].unitPriceCents`, { allowZero: true });
        return { sku: requireText(li.sku, `lineItems[${i}].sku`), description: requireText(li.description, `lineItems[${i}].description`), quantity: li.quantity, unitPriceCents: li.unitPriceCents };
      });
      const issuedOn = input.issuedOn ? requireDate(input.issuedOn, "issuedOn") : this.today();
      const dueOn = input.dueOn ? requireDate(input.dueOn, "dueOn") : addDays(issuedOn, this.data.company.paymentTermsDays);
      if (dueOn < issuedOn) fail("invalid_argument", "dueOn must be on or after issuedOn.");
      const invoice: Invoice = {
        id: this.newId("inv"),
        customerId: input.customerId,
        jobId: input.jobId ?? null,
        number: this.nextNumber(this.data.invoices.map((i) => i.number), "INV-"),
        status: "open",
        lineItems,
        totalCents: lineTotal(lineItems),
        issuedOn,
        dueOn,
        paidCents: 0,
      };
      this.data.invoices.push(invoice);
      ctx.changed.add(invoice.id);
      ctx.emit("InvoiceIssued", invoice.id, { customerId: invoice.customerId, totalCents: invoice.totalCents, dueOn });
      return invoice;
    });
  }

  /** Sends a payment reminder for an unpaid invoice (outbox only). Emits `InvoiceReminderSent` and `MessageSent`. */
  sendInvoiceReminder(input: SendInvoiceReminderInput): { invoice: Invoice; message: Message } {
    return this.mutate("invoicing_send_reminder", input, (ctx) => {
      const invoice = this.mustFind("invoices", input.invoiceId);
      if (invoice.status !== "open" && invoice.status !== "partially-paid") {
        fail("failed_precondition", `Invoice ${invoice.number} is "${invoice.status}"; reminders only apply to open or partially-paid invoices.`);
      }
      const channel = input.channel ?? "email";
      const contactId = input.contactId ?? this.defaultContactFor(invoice.customerId, channel);
      const balance = invoice.totalCents - invoice.paidCents;
      const body =
        input.body?.trim() ||
        `Hi, this is a friendly reminder from ${this.data.company.name} that invoice ${invoice.number} has a balance of ${money(balance)}, due ${invoice.dueOn}. Thank you!`;
      const message = this.buildOutbound(ctx, {
        channel,
        contactId,
        subject: `Reminder: invoice ${invoice.number}`,
        body,
        employeeId: input.employeeId,
        relatedIds: [invoice.id],
      });
      ctx.emit("InvoiceReminderSent", invoice.id, { messageId: message.id, channel, balanceCents: balance });
      return { invoice, message };
    });
  }

  /** Voids an invoice with no payments applied. Emits `InvoiceVoided`. */
  voidInvoice(input: VoidInvoiceInput): Invoice {
    return this.mutate("invoicing_void_invoice", input, (ctx) => {
      const invoice = this.mustFind("invoices", input.invoiceId);
      const reason = requireText(input.reason, "reason");
      if (invoice.status === "void") fail("failed_precondition", `Invoice ${invoice.number} is already void.`);
      if (invoice.paidCents > 0) fail("failed_precondition", `Invoice ${invoice.number} has ${money(invoice.paidCents)} applied; payments must be refunded before voiding.`);
      invoice.status = "void";
      ctx.changed.add(invoice.id);
      ctx.emit("InvoiceVoided", invoice.id, { reason, totalCents: invoice.totalCents });
      return invoice;
    });
  }

  /** Records a payment against an invoice. Rejects void/draft/paid invoices and overpayment. Emits `PaymentReceived`. */
  recordPayment(input: RecordPaymentInput): { payment: Payment; invoice: Invoice } {
    return this.mutate("invoicing_record_payment", input, (ctx) => {
      const invoice = this.mustFind("invoices", input.invoiceId);
      const amount = requireCents(input.amountCents, "amountCents");
      if (!["card", "ach", "check", "cash"].includes(input.method)) fail("invalid_argument", "method must be one of card, ach, check, cash.");
      this.checkPayable(invoice, amount);
      const payment: Payment = {
        id: this.newId("pay"),
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amountCents: amount,
        method: input.method,
        receivedAt: ctx.at,
        reference: input.reference?.trim() || `SBX-${this.idCounter.toString().padStart(5, "0")}`,
      };
      this.data.payments.push(payment);
      this.applyPayment(invoice, amount);
      ctx.changed.add(payment.id).add(invoice.id);
      ctx.emit("PaymentReceived", payment.id, { invoiceId: invoice.id, amountCents: amount, method: payment.method, invoiceStatus: invoice.status });
      return { payment, invoice };
    });
  }

  /** Applies an unmatched payment to an invoice of the same customer. Emits `PaymentMatched`. */
  matchPayment(input: MatchPaymentInput): { payment: Payment; invoice: Invoice } {
    return this.mutate("invoicing_match_payment", input, (ctx) => {
      const payment = this.mustFind("payments", input.paymentId);
      const invoice = this.mustFind("invoices", input.invoiceId);
      if (payment.invoiceId !== null) fail("failed_precondition", `Payment ${payment.id} is already matched to ${payment.invoiceId}.`);
      if (payment.customerId && payment.customerId !== invoice.customerId) {
        fail("failed_precondition", `Payment ${payment.id} is from customer ${payment.customerId} but invoice ${invoice.number} belongs to ${invoice.customerId}.`);
      }
      this.checkPayable(invoice, payment.amountCents);
      payment.invoiceId = invoice.id;
      payment.customerId = invoice.customerId;
      this.applyPayment(invoice, payment.amountCents);
      ctx.changed.add(payment.id).add(invoice.id);
      ctx.emit("PaymentMatched", payment.id, { invoiceId: invoice.id, amountCents: payment.amountCents, invoiceStatus: invoice.status });
      return { payment, invoice };
    });
  }

  // ------------------------------------------------------------------- writes: inbox & phone

  /** "Sends" an email: appends an outbound message (new thread or reply) and adds it to the outbox. Emits `MessageSent`. */
  sendEmail(input: SendEmailInput): Message {
    return this.mutate("inbox_send_email", input, (ctx) =>
      this.buildOutbound(ctx, {
        channel: "email",
        contactId: input.contactId,
        to: input.to,
        threadId: input.threadId,
        subject: input.subject,
        body: requireText(input.body, "body"),
        employeeId: input.employeeId,
        relatedIds: input.relatedIds,
      }),
    );
  }

  /** "Sends" an SMS (outbox only). Emits `MessageSent`. */
  sendSms(input: SendSmsInput): Message {
    return this.mutate("inbox_send_sms", input, (ctx) => {
      const body = requireText(input.body, "body");
      if (body.length > 1600) fail("invalid_argument", "SMS body must be at most 1600 characters.");
      return this.buildOutbound(ctx, {
        channel: "sms",
        contactId: input.contactId,
        to: input.to === undefined ? undefined : [input.to],
        threadId: input.threadId,
        body,
        employeeId: input.employeeId,
        relatedIds: input.relatedIds,
      });
    });
  }

  /** Marks every message in a thread read. Emits `ThreadRead`. */
  markThreadRead(threadId: string): { threadId: string; updated: number } {
    return this.mutate("inbox_mark_thread_read", { threadId }, (ctx) => {
      const msgs = this.threadMessages(threadId);
      if (msgs.length === 0) fail("not_found", `Thread ${threadId} not found.`);
      let updated = 0;
      for (const m of msgs) {
        if (!m.read) {
          m.read = true;
          updated++;
          ctx.changed.add(m.id);
        }
      }
      ctx.emit("ThreadRead", threadId, { updated });
      return { threadId, updated };
    });
  }

  /**
   * Logs a phone call (e.g. a callback). An outbound answered/voicemail call to
   * a contact counts as first response on their uncontacted leads.
   * Emits `CallLogged` (plus `LeadContacted` where applicable).
   */
  logCall(input: LogCallInput): Call {
    return this.mutate("phone_log_call", input, (ctx) => {
      const direction = input.direction ?? "outbound";
      if (!["answered", "missed", "voicemail"].includes(input.outcome)) fail("invalid_argument", "outcome must be answered, missed or voicemail.");
      const contact = input.contactId ? this.mustFind("contacts", input.contactId) : null;
      const employee = input.employeeId ? this.mustActiveEmployee(input.employeeId) : null;
      const other = input.phone ?? contact?.phone ?? null;
      if (!isValidPhone(other)) fail("failed_precondition", contact ? `Contact ${contact.id} has no valid phone number; pass phone or update the contact first.` : "Provide contactId or phone.");
      const durationSec = input.durationSec ?? (input.outcome === "answered" ? 180 : input.outcome === "voicemail" ? 30 : 0);
      if (!Number.isInteger(durationSec) || durationSec < 0) fail("invalid_argument", "durationSec must be a non-negative integer.");
      const ours = employee?.phone ?? this.data.company.phone;
      const call: Call = {
        id: this.newId("call"),
        direction,
        from: direction === "outbound" ? ours : other,
        to: direction === "outbound" ? other : ours,
        startedAt: ctx.at,
        durationSec,
        outcome: input.outcome,
        contactId: contact?.id ?? null,
        employeeId: employee?.id ?? null,
        summary: input.summary ?? null,
      };
      this.data.calls.push(call);
      ctx.changed.add(call.id);
      ctx.emit("CallLogged", call.id, { direction, outcome: call.outcome, contactId: call.contactId }, call.employeeId);
      if (contact && direction === "outbound" && call.outcome !== "missed") this.markLeadsContacted(ctx, contact.id, call.employeeId);
      return call;
    });
  }

  // ----------------------------------------------------------------- internals

  private mutate<T>(tool: string, input: unknown, fn: (ctx: MutationCtx) => T): T {
    const at = this.now();
    const seq = this.auditLog.length + 1;
    const ctx: MutationCtx = {
      at,
      changed: new Set(),
      emit: (type, subjectId, data = {}, actorId = null) => {
        const event: BusinessEvent = { id: this.newId("evt"), type, at, subjectId, actorId, data: { ...data, source: "sandbox" } };
        this.data.events.push(event as BusinessEvent);
        this.emitted.push(event);
      },
    };
    // Rollback point: validation runs before any change, but restore anyway so a
    // failed write can never leave partial state behind.
    const rollback = { data: clone(this.data), emitted: this.emitted.length, outbox: this.outboxIds.length, idCounter: this.idCounter };
    try {
      const result = clone(fn(ctx));
      this.auditLog.push({ seq, at, tool, input: safeClone(input), result: "ok", changedIds: [...ctx.changed] });
      this.clockMs += MINUTE_MS;
      return result;
    } catch (err) {
      const error = err instanceof SandboxError ? err : new SandboxError("internal", err instanceof Error ? err.message : String(err));
      this.data = rollback.data;
      this.emitted.length = rollback.emitted;
      this.outboxIds.length = rollback.outbox;
      this.idCounter = rollback.idCounter;
      this.auditLog.push({ seq, at, tool, input: safeClone(input), result: "error", error: error.message, changedIds: [] });
      throw error;
    }
  }

  private collectionFor(id: string): CollectionKey | null {
    const prefix = id.slice(0, id.indexOf("_"));
    return (PREFIX_COLLECTION as Record<string, CollectionKey>)[prefix] ?? null;
  }

  private mustFind<K extends CollectionKey>(coll: K, id: string): Dataset[K][number] {
    if (typeof id !== "string" || id === "") fail("invalid_argument", `A ${coll.replace(/s$/, "")} id is required.`);
    const rec = (this.data[coll] as Array<{ id: string }>).find((r) => r.id === id);
    if (!rec) fail("not_found", `No ${coll.replace(/s$/, "")} with id ${id}. Use the matching list/search tool to find valid ids.`);
    return rec as Dataset[K][number];
  }

  private mustActiveEmployee(id: string): Employee {
    const emp = this.mustFind("employees", id);
    if (!emp.active) fail("failed_precondition", `Employee ${emp.name} (${id}) is inactive; pick an active employee.`);
    return emp;
  }

  private newId(prefix: string): string {
    for (;;) {
      this.idCounter++;
      const id = `${prefix}_x${this.idCounter.toString(36).padStart(5, "0")}`;
      if (this.getRecord(id) === null) return id;
    }
  }

  private nextNumber(existing: string[], prefix: string): string {
    const max = existing.reduce((m, n) => Math.max(m, Number(/(\d+)$/.exec(n)?.[1] ?? 0)), 1000);
    return `${prefix}${max + 1}`;
  }

  private checkContactInfo(email: string | null | undefined, phone: string | null | undefined): void {
    if (email !== undefined && email !== null && !isValidEmail(email)) fail("invalid_argument", `email "${email}" is not a valid address.`);
    if (phone !== undefined && phone !== null && !isValidPhone(phone)) fail("invalid_argument", `phone "${phone}" must contain 10–15 digits.`);
  }

  private checkWindow(startIso: string, endIso: string): [number, number] {
    const start = requireInstant(startIso, "scheduledStart");
    const end = requireInstant(endIso, "scheduledEnd");
    if (end <= start) fail("invalid_argument", "scheduledEnd must be after scheduledStart.");
    if (end - start > 14 * 86_400_000) fail("invalid_argument", "A job window cannot exceed 14 days.");
    return [start, end];
  }

  private checkOverlap(assigneeIds: string[], start: number, end: number, ignoreJobId: string | null): void {
    for (const j of this.data.jobs) {
      if (j.id === ignoreJobId || (j.status !== "scheduled" && j.status !== "in-progress")) continue;
      const shared = j.assigneeIds.filter((id) => assigneeIds.includes(id));
      if (shared.length === 0) continue;
      if (Date.parse(j.scheduledStart) < end && Date.parse(j.scheduledEnd) > start) {
        fail("conflict", `Assignee ${shared.join(", ")} is already booked on job ${j.id} (${j.scheduledStart}–${j.scheduledEnd}). Pick another time or assignee, or pass allowOverlap: true.`);
      }
    }
  }

  /** Date-only bounds are midnight in company time; datetimes need an offset. */
  private boundMs(value: string, field: string): number {
    if (isIsoDate(value)) return zonedTimeToUtcMs(value, 0, 0, this.data.company.timezone);
    return requireInstant(value, field);
  }

  /** relatedIds may reference business records, not events or ground-truth anomalies. */
  private checkRelated(ids: string[]): void {
    for (const id of ids) {
      if (typeof id !== "string" || id.startsWith("anm_") || id.startsWith("evt_") || this.getRecord(id) === null) {
        fail("not_found", `relatedIds: record ${String(id)} does not exist.`);
      }
    }
  }

  private isOverdue(i: Invoice, today: string): boolean {
    return (i.status === "open" || i.status === "partially-paid") && i.dueOn < today;
  }

  private checkPayable(invoice: Invoice, amount: number): void {
    if (invoice.status === "void") fail("failed_precondition", `Invoice ${invoice.number} is void and cannot accept payments.`);
    if (invoice.status === "draft") fail("failed_precondition", `Invoice ${invoice.number} is a draft; issue it before taking payment.`);
    if (invoice.status === "paid") fail("failed_precondition", `Invoice ${invoice.number} is already paid in full.`);
    const balance = invoice.totalCents - invoice.paidCents;
    if (amount > balance) fail("failed_precondition", `Payment ${money(amount)} exceeds the ${money(balance)} balance on invoice ${invoice.number}.`);
  }

  private applyPayment(invoice: Invoice, amount: number): void {
    invoice.paidCents += amount;
    invoice.status = invoice.paidCents >= invoice.totalCents ? "paid" : "partially-paid";
  }

  private defaultContactFor(customerId: string, channel: "email" | "sms"): string {
    const contact = this.data.contacts.find((c) => c.customerId === customerId && (channel === "email" ? isValidEmail(c.email) : isValidPhone(c.phone)));
    if (!contact) fail("failed_precondition", `Customer ${customerId} has no contact with a valid ${channel === "email" ? "email" : "phone"}; pass contactId or fix the contact first.`);
    return contact.id;
  }

  private threadMessages(threadId: string): Message[] {
    return this.data.messages.filter((m) => m.threadId === threadId).sort((a, b) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : 0));
  }

  private summarize(threadId: string, msgs: Message[]): ThreadSummary {
    const sorted = [...msgs].sort((a, b) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : 0));
    const last = sorted[sorted.length - 1]!;
    const first = sorted[0]!;
    return {
      threadId,
      channel: first.channel,
      subject: first.subject,
      contactId: sorted.find((m) => m.contactId)?.contactId ?? null,
      participants: [...new Set(sorted.flatMap((m) => [m.from, ...m.to]))],
      messageCount: sorted.length,
      unreadCount: sorted.filter((m) => !m.read).length,
      lastMessageAt: last.sentAt,
      lastDirection: last.direction,
      lastSnippet: last.body.length > 140 ? `${last.body.slice(0, 137)}...` : last.body,
    };
  }

  private buildOutbound(
    ctx: MutationCtx,
    opts: {
      channel: "email" | "sms";
      contactId?: string;
      to?: string[];
      threadId?: string;
      subject?: string;
      body: string;
      employeeId?: string;
      relatedIds?: string[];
    },
  ): Message {
    const employee = opts.employeeId ? this.mustActiveEmployee(opts.employeeId) : null;
    const thread = opts.threadId ? this.threadMessages(opts.threadId) : [];
    if (opts.threadId && thread.length === 0) fail("not_found", `Thread ${opts.threadId} not found. Use inbox_list_threads to find thread ids.`);
    if (thread.length && thread[0]!.channel !== opts.channel) fail("invalid_argument", `Thread ${opts.threadId} is an ${thread[0]!.channel} thread; use the matching send tool.`);

    let contactId = opts.contactId ?? thread.find((m) => m.contactId)?.contactId ?? null;
    const contact = contactId ? this.mustFind("contacts", contactId) : null;
    const addressOf = (c: Contact | null): string | null => (c ? (opts.channel === "email" ? c.email : c.phone) : null);
    let to = opts.to?.map((t) => t.trim()).filter(Boolean);
    if (!to?.length) {
      const inboundPeer = [...thread].reverse().find((m) => m.direction === "inbound")?.from;
      const addr = (opts.contactId ? addressOf(contact) : null) ?? inboundPeer ?? addressOf(contact);
      to = addr ? [addr] : [];
    }
    if (to.length === 0) fail(contact ? "failed_precondition" : "invalid_argument", contact ? `Contact ${contact.id} has no ${opts.channel === "email" ? "email address" : "phone number"}; update the contact or pass "to".` : "Provide contactId, to, or threadId.");
    const valid = opts.channel === "email" ? isValidEmail : isValidPhone;
    const bad = to.find((t) => !valid(t));
    if (bad) fail("failed_precondition", `"${bad}" is not a valid ${opts.channel === "email" ? "email address" : "phone number"}${contact ? ` (contact ${contact.id} may need fixing)` : ""}.`);
    if (!contactId) contactId = this.data.contacts.find((c) => to!.some((t) => (opts.channel === "email" ? c.email === t : digits(c.phone) === digits(t) && digits(t) !== "")))?.id ?? null;

    let subject: string | null = null;
    if (opts.channel === "email") {
      const base = thread[0]?.subject ?? null;
      subject = opts.subject?.trim() || (base ? (base.startsWith("Re:") ? base : `Re: ${base}`) : null);
      if (!subject) fail("invalid_argument", "subject is required when starting a new email thread.");
    }
    const relatedIds = [...new Set(opts.relatedIds ?? [])];
    this.checkRelated(relatedIds);

    const from = opts.channel === "email" ? (employee?.email ?? this.data.company.email) : (employee?.phone ?? this.data.company.phone);
    const message: Message = {
      id: this.newId("msg"),
      channel: opts.channel,
      direction: "outbound",
      threadId: opts.threadId ?? this.newId("thr"),
      from,
      to,
      subject,
      body: opts.body,
      sentAt: ctx.at,
      contactId,
      employeeId: employee?.id ?? null,
      relatedIds,
      read: true,
    };
    this.data.messages.push(message);
    this.outboxIds.push(message.id);
    ctx.changed.add(message.id);
    ctx.emit("MessageSent", message.id, { channel: message.channel, threadId: message.threadId, to, contactId }, message.employeeId);
    if (contactId) this.markLeadsContacted(ctx, contactId, message.employeeId);
    return message;
  }

  private markLeadsContacted(ctx: MutationCtx, contactId: string, actorId: string | null): void {
    for (const lead of this.data.leads) {
      if (lead.contactId !== contactId || lead.firstResponseAt !== null) continue;
      lead.firstResponseAt = ctx.at;
      if (lead.status === "new") lead.status = "contacted";
      ctx.changed.add(lead.id);
      ctx.emit("LeadContacted", lead.id, { contactId }, actorId);
    }
  }
}

function safeClone(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value ?? null));
  }
}
