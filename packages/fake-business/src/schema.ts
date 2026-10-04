/**
 * The data contract shared by every package in smb-sandbox.
 *
 * A Dataset is one coherent fictional small business: its people, customers,
 * sales pipeline, work, billing, communications, and an append-only event
 * timeline. Records reference each other by id. Realistic mess is injected on
 * purpose and labeled in `anomalies`, so tools and agents can be scored
 * against ground truth.
 *
 * Conventions:
 * - Money is integer cents (`amountCents`), currency in `company.currency`.
 * - Timestamps are ISO-8601 UTC strings; dates without time are `YYYY-MM-DD`.
 * - Ids are `<prefix>_<6+ base36 chars>`, stable for a given (industry, seed).
 */

export const SCHEMA_VERSION = "1.0.0";

export type IndustryId = "home-services" | "dental-clinic" | "marketing-agency";

export type Iso = string;
export type IsoDate = string;

export interface Dataset {
  meta: DatasetMeta;
  company: Company;
  employees: Employee[];
  customers: Customer[];
  contacts: Contact[];
  leads: Lead[];
  deals: Deal[];
  quotes: Quote[];
  jobs: Job[];
  invoices: Invoice[];
  payments: Payment[];
  messages: Message[];
  calls: Call[];
  tasks: Task[];
  events: BusinessEvent[];
  anomalies: Anomaly[];
}

export interface DatasetMeta {
  generator: "@teamshift/fake-business";
  generatorVersion: string;
  schemaVersion: string;
  industry: IndustryId;
  seed: number;
  /** First day of simulated history. */
  startDate: IsoDate;
  /** "Today" inside the simulation; nothing happens after this. */
  asOf: IsoDate;
  /** Always true. Every name, email, phone and address is fictional. */
  synthetic: true;
}

export interface Company {
  id: string; // co_
  name: string;
  industry: IndustryId;
  /** Free-text, e.g. "Residential HVAC and plumbing". */
  description: string;
  timezone: string; // IANA, e.g. "America/Chicago"
  currency: "USD";
  phone: string;
  email: string;
  website: string; // always under the reserved .example TLD
  address: Address;
  /** Default payment terms in days, e.g. 30. */
  paymentTermsDays: number;
  /** Plain-language operating rules agents should respect. */
  policies: Policy[];
}

export interface Policy {
  id: string; // pol_
  title: string;
  rule: string;
}

export interface Address {
  line1: string;
  city: string;
  region: string; // state code
  postalCode: string;
  country: "US";
}

export type EmployeeRole =
  | "owner"
  | "office-manager"
  | "sales"
  | "technician"
  | "dispatcher"
  | "bookkeeper"
  | "hygienist"
  | "dentist"
  | "front-desk"
  | "account-manager"
  | "designer"
  | "strategist";

export interface Employee {
  id: string; // emp_
  name: string;
  email: string;
  phone: string;
  role: EmployeeRole;
  hiredOn: IsoDate;
  active: boolean;
}

export interface Customer {
  id: string; // cus_
  kind: "household" | "business";
  name: string;
  address: Address;
  createdAt: Iso;
  source: LeadSource;
  status: "active" | "inactive" | "churned";
  /** Employee who owns the relationship. */
  ownerId: string | null;
  tags: string[];
}

export interface Contact {
  id: string; // con_
  customerId: string | null;
  firstName: string;
  lastName: string;
  /** May be null or malformed when an anomaly says so. */
  email: string | null;
  phone: string | null;
  title: string | null;
  createdAt: Iso;
}

export type LeadSource =
  | "web-form"
  | "phone"
  | "referral"
  | "google-ads"
  | "walk-in"
  | "email"
  | "repeat";

export interface Lead {
  id: string; // lead_
  contactId: string;
  source: LeadSource;
  createdAt: Iso;
  /** Free-text request in the customer's own words. */
  request: string;
  status: "new" | "contacted" | "qualified" | "disqualified" | "converted";
  firstResponseAt: Iso | null;
  ownerId: string | null;
  dealId: string | null;
}

export type DealStage =
  | "new"
  | "qualified"
  | "quote-sent"
  | "negotiation"
  | "won"
  | "lost";

export interface Deal {
  id: string; // deal_
  customerId: string;
  contactId: string;
  title: string;
  stage: DealStage;
  amountCents: number;
  ownerId: string | null;
  createdAt: Iso;
  updatedAt: Iso;
  closedAt: Iso | null;
  lostReason: string | null;
  /** Next planned step, null when nobody has set one. */
  nextAction: { summary: string; dueOn: IsoDate } | null;
}

export interface LineItem {
  sku: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Quote {
  id: string; // quo_
  dealId: string;
  customerId: string;
  number: string; // human-facing, e.g. "Q-1042"
  status: "draft" | "sent" | "viewed" | "accepted" | "declined" | "expired";
  lineItems: LineItem[];
  totalCents: number;
  createdAt: Iso;
  sentAt: Iso | null;
  expiresOn: IsoDate | null;
  /** Timestamps of follow-ups actually made after sending. */
  followUps: Iso[];
}

export interface Job {
  id: string; // job_  (work order / appointment / project)
  customerId: string;
  quoteId: string | null;
  title: string;
  status: "scheduled" | "in-progress" | "completed" | "canceled" | "no-show";
  scheduledStart: Iso;
  scheduledEnd: Iso;
  assigneeIds: string[];
  completedAt: Iso | null;
  notes: string | null;
}

export interface Invoice {
  id: string; // inv_
  customerId: string;
  jobId: string | null;
  number: string; // e.g. "INV-2210"
  status: "draft" | "open" | "paid" | "partially-paid" | "void";
  lineItems: LineItem[];
  totalCents: number;
  issuedOn: IsoDate;
  dueOn: IsoDate;
  paidCents: number;
}

export interface Payment {
  id: string; // pay_
  /** Null when the payment could not be matched (an anomaly). */
  invoiceId: string | null;
  customerId: string | null;
  amountCents: number;
  method: "card" | "ach" | "check" | "cash";
  receivedAt: Iso;
  reference: string;
}

export interface Message {
  id: string; // msg_
  channel: "email" | "sms";
  direction: "inbound" | "outbound";
  threadId: string; // thr_
  from: string;
  to: string[];
  subject: string | null;
  body: string;
  sentAt: Iso;
  contactId: string | null;
  employeeId: string | null;
  /** Records this message is about, if known. */
  relatedIds: string[];
  read: boolean;
}

export interface Call {
  id: string; // call_
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  startedAt: Iso;
  durationSec: number;
  outcome: "answered" | "missed" | "voicemail";
  contactId: string | null;
  employeeId: string | null;
  /** Short summary or voicemail transcript; null when missed with no voicemail. */
  summary: string | null;
}

export interface Task {
  id: string; // task_
  title: string;
  assigneeId: string | null;
  dueOn: IsoDate | null;
  status: "open" | "done" | "canceled";
  createdAt: Iso;
  completedAt: Iso | null;
  relatedIds: string[];
}

/**
 * Every event type in the timeline. The generator emits the core lifecycle
 * types; `@teamshift/sandbox-mcp` emits the same set, including the record-
 * maintenance types (contacts, merges, reminders, matching) that only happen
 * when an agent acts on the data.
 */
export type BusinessEventType =
  | "LeadCreated"
  | "LeadContacted"
  | "LeadDisqualified"
  | "LeadUpdated"
  | "ContactCreated"
  | "ContactUpdated"
  | "ContactsMerged"
  | "DealCreated"
  | "DealStageChanged"
  | "DealUpdated"
  | "QuoteSent"
  | "QuoteFollowedUp"
  | "QuoteAccepted"
  | "QuoteDeclined"
  | "QuoteExpired"
  | "JobScheduled"
  | "JobRescheduled"
  | "JobStarted"
  | "JobCompleted"
  | "JobCanceled"
  | "InvoiceIssued"
  | "InvoiceOverdue"
  | "InvoiceReminderSent"
  | "InvoiceVoided"
  | "PaymentReceived"
  | "PaymentMatched"
  | "CallMissed"
  | "CallLogged"
  | "MessageReceived"
  | "MessageSent"
  | "ThreadRead"
  | "TaskCreated"
  | "TaskCompleted";

export interface BusinessEvent {
  id: string; // evt_
  type: BusinessEventType;
  at: Iso;
  /** Primary record the event is about. */
  subjectId: string;
  actorId: string | null; // emp_ or con_ or null for system
  data: Record<string, unknown>;
}

export type AnomalyKind =
  | "duplicate-contact"
  | "quote-not-followed-up"
  | "missed-call-no-callback"
  | "stale-deal"
  | "overdue-invoice"
  | "invoice-wrong-job"
  | "reschedule-not-propagated"
  | "missing-contact-info"
  | "conflicting-status"
  | "unmatched-payment"
  | "lead-never-contacted";

export interface Anomaly {
  id: string; // anm_
  kind: AnomalyKind;
  /** Records involved; the first is the primary record to act on. */
  recordIds: string[];
  /** One-sentence ground-truth explanation. */
  description: string;
  /** Money at stake, when meaningful. */
  amountAtRiskCents: number | null;
}

export interface GenerateOptions {
  industry: IndustryId;
  seed: number;
  /** Scale factor; 1 ≈ 40 customers and ~12 months of history. */
  size?: "small" | "medium" | "large";
  /** Simulated "today". Defaults to 2026-09-30 so output is reproducible. */
  asOf?: IsoDate;
  /** Months of history before asOf. Default 12. */
  months?: number;
  /** Probability multiplier for injected anomalies; 0 disables. Default 1. */
  messiness?: number;
}
