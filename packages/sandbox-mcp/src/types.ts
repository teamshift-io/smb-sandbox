import type {
  BusinessEvent,
  BusinessEventType,
  DealStage,
  Iso,
  IsoDate,
  LineItem,
  Message,
} from "@teamshift/fake-business";

/**
 * Every event type a {@link SandboxStore} can emit. Since schema 1.0.0 the
 * shared {@link BusinessEventType} covers them all; this alias is kept for
 * existing imports.
 * @deprecated Use `BusinessEventType` from `@teamshift/fake-business`.
 */
export type SandboxEventType = BusinessEventType;

/**
 * An event emitted by the sandbox: a {@link BusinessEvent} whose `data.source`
 * is `"sandbox"`.
 * @deprecated Use `BusinessEvent` from `@teamshift/fake-business`.
 */
export type SandboxEvent = BusinessEvent;

/** One entry in the append-only audit log; one per mutation attempt. */
export interface AuditEntry {
  /** 1-based sequence number, gapless. */
  seq: number;
  /** Simulated time of the attempt (ISO-8601 UTC). */
  at: Iso;
  /** Canonical tool name, identical to the MCP tool name (e.g. `crm_update_deal`). */
  tool: string;
  /** The input as received (deep copy). */
  input: unknown;
  result: "ok" | "error";
  /** Error message when `result` is `"error"`. */
  error?: string;
  /** Ids of every record created, changed or deleted by the mutation. */
  changedIds: string[];
}

/** Machine-readable failure class of a {@link SandboxError}. */
export type SandboxErrorCode =
  | "not_found"
  | "invalid_argument"
  | "failed_precondition"
  | "conflict"
  | "internal";

/** Thrown by every {@link SandboxStore} method on invalid input or a broken invariant. */
export class SandboxError extends Error {
  readonly code: SandboxErrorCode;
  constructor(code: SandboxErrorCode, message: string) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
  }
}

/** Offset pagination. `limit` defaults to 25 and is capped at 100. */
export interface PageOptions {
  offset?: number;
  limit?: number;
}

/** A page of results. `nextOffset` is null on the last page. */
export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
}

/** Options for constructing a {@link SandboxStore}. */
export interface SandboxStoreOptions {
  /**
   * Override the simulated start time (ISO-8601). Defaults to 09:00 on
   * `dataset.meta.asOf` in the company's timezone.
   */
  startAt?: Iso;
}

/** Summary row for an inbox thread. */
export interface ThreadSummary {
  threadId: string;
  channel: Message["channel"];
  subject: string | null;
  contactId: string | null;
  participants: string[];
  messageCount: number;
  unreadCount: number;
  lastMessageAt: Iso;
  lastDirection: Message["direction"];
  lastSnippet: string;
}

/** Input line item; `unitPriceCents` must be an integer, `quantity` positive. */
export type LineItemInput = LineItem;

// ---- read filters ----------------------------------------------------------

export interface ContactSearch extends PageOptions {
  /** Case-insensitive match on name, email, phone digits or title. */
  query?: string;
  customerId?: string;
  /** Only contacts missing an email or phone, or with a malformed email. */
  missingInfo?: boolean;
}

export interface CustomerSearch extends PageOptions {
  query?: string;
  status?: "active" | "inactive" | "churned";
  ownerId?: string;
}

export interface LeadFilter extends PageOptions {
  contactId?: string;
  status?: "new" | "contacted" | "qualified" | "disqualified" | "converted";
  ownerId?: string;
  /** true: only leads with no first response yet. */
  uncontacted?: boolean;
}

export interface DealFilter extends PageOptions {
  contactId?: string;
  stage?: DealStage;
  ownerId?: string;
  customerId?: string;
  /** Only open deals (not won/lost). */
  openOnly?: boolean;
  /** Only open deals whose `updatedAt` is at least this many days before now. */
  staleDays?: number;
}

export interface QuoteFilter extends PageOptions {
  status?: "draft" | "sent" | "viewed" | "accepted" | "declined" | "expired";
  dealId?: string;
  customerId?: string;
  /** Only sent/viewed quotes with zero follow-ups. */
  notFollowedUp?: boolean;
}

export interface JobFilter extends PageOptions {
  status?: "scheduled" | "in-progress" | "completed" | "canceled" | "no-show";
  customerId?: string;
  assigneeId?: string;
  /** Inclusive lower bound on `scheduledStart` (ISO date or datetime). */
  from?: string;
  /** Exclusive upper bound on `scheduledStart` (ISO date or datetime). */
  to?: string;
}

export interface InvoiceFilter extends PageOptions {
  status?: "draft" | "open" | "paid" | "partially-paid" | "void";
  customerId?: string;
  jobId?: string;
  /** Only unpaid invoices past their due date. */
  overdue?: boolean;
}

export interface PaymentFilter extends PageOptions {
  invoiceId?: string;
  customerId?: string;
  /** Only payments not matched to an invoice. */
  unmatched?: boolean;
}

export interface ThreadFilter extends PageOptions {
  channel?: "email" | "sms";
  contactId?: string;
  unreadOnly?: boolean;
  /** Case-insensitive match on subject, body or addresses. */
  query?: string;
}

export interface CallFilter extends PageOptions {
  direction?: "inbound" | "outbound";
  outcome?: "answered" | "missed" | "voicemail";
  contactId?: string;
  /** Inclusive lower bound on `startedAt`. */
  since?: string;
}

export interface TaskFilter extends PageOptions {
  status?: "open" | "done" | "canceled";
  assigneeId?: string;
  /** Only tasks whose `relatedIds` include this id. */
  relatedId?: string;
}

// ---- write inputs ----------------------------------------------------------

export interface CreateContactInput {
  customerId?: string | null;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
}

export interface UpdateContactInput {
  contactId: string;
  customerId?: string | null;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
}

export interface MergeContactsInput {
  /** Contact that survives. */
  keepId: string;
  /** Duplicate that is folded into `keepId` and removed. */
  mergeId: string;
}

export interface UpdateLeadInput {
  leadId: string;
  status?: "new" | "contacted" | "qualified" | "disqualified" | "converted";
  ownerId?: string | null;
}

export interface UpdateDealInput {
  dealId: string;
  /** Must be a valid transition; see {@link DEAL_STAGE_TRANSITIONS}. */
  stage?: DealStage;
  /** Required when moving to `lost`. */
  lostReason?: string;
  /** Set or clear (null) the next planned step. */
  nextAction?: { summary: string; dueOn: IsoDate } | null;
  amountCents?: number;
  ownerId?: string | null;
}

export interface SendQuoteInput {
  quoteId: string;
  /** Defaults to 30 days after today. */
  expiresOn?: IsoDate;
}

export interface FollowUpQuoteInput {
  quoteId: string;
  channel?: "email" | "sms";
  body: string;
  /** Defaults to the deal's contact. */
  contactId?: string;
  employeeId?: string;
}

export interface ScheduleJobInput {
  customerId: string;
  title: string;
  scheduledStart: Iso;
  scheduledEnd: Iso;
  assigneeIds?: string[];
  quoteId?: string | null;
  notes?: string | null;
  /** Skip the assignee double-booking check. */
  allowOverlap?: boolean;
}

export interface RescheduleJobInput {
  jobId: string;
  scheduledStart: Iso;
  scheduledEnd: Iso;
  /** Replace the assignees; omitted keeps current ones. */
  assigneeIds?: string[];
  reason?: string;
  allowOverlap?: boolean;
}

export interface CancelJobInput {
  jobId: string;
  reason: string;
}

export interface CompleteJobInput {
  jobId: string;
  notes?: string;
}

export interface CreateTaskInput {
  title: string;
  assigneeId?: string | null;
  dueOn?: IsoDate | null;
  relatedIds?: string[];
}

export interface CreateInvoiceInput {
  customerId: string;
  jobId?: string | null;
  lineItems: LineItemInput[];
  /** Defaults to today. */
  issuedOn?: IsoDate;
  /** Defaults to issuedOn + company payment terms. */
  dueOn?: IsoDate;
}

export interface SendInvoiceReminderInput {
  invoiceId: string;
  channel?: "email" | "sms";
  /** Defaults to a polite reminder including number, balance and due date. */
  body?: string;
  /** Defaults to the first contact of the invoice's customer with the needed address. */
  contactId?: string;
  employeeId?: string;
}

export interface VoidInvoiceInput {
  invoiceId: string;
  reason: string;
}

export interface RecordPaymentInput {
  invoiceId: string;
  amountCents: number;
  method: "card" | "ach" | "check" | "cash";
  reference?: string;
}

export interface MatchPaymentInput {
  paymentId: string;
  invoiceId: string;
}

export interface SendEmailInput {
  /** Recipient contact (its email is used). Provide this, `to`, or `threadId`. */
  contactId?: string;
  /** Raw recipient addresses. */
  to?: string[];
  /** Reply in an existing email thread. */
  threadId?: string;
  /** Required for a new thread; defaults to "Re: …" in a reply. */
  subject?: string;
  body: string;
  employeeId?: string;
  relatedIds?: string[];
}

export interface SendSmsInput {
  contactId?: string;
  /** Raw recipient phone number. */
  to?: string;
  threadId?: string;
  body: string;
  employeeId?: string;
  relatedIds?: string[];
}

export interface LogCallInput {
  direction?: "inbound" | "outbound";
  contactId?: string;
  /** Other party's number; defaults to the contact's phone. */
  phone?: string;
  outcome: "answered" | "missed" | "voicemail";
  durationSec?: number;
  summary?: string | null;
  employeeId?: string;
}

