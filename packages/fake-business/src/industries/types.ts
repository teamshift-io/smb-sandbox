import type { EmployeeRole, IndustryId, LeadSource, Payment } from "../schema.js";

export interface CatalogItem {
  sku: string;
  description: string;
  unitPriceCents: number;
}

export interface LinePick {
  sku: string;
  qty: readonly [number, number];
  /** Probability the line is included (default 1). Within a group: relative weight. */
  p?: number;
  /** Exactly one line of each group is included. */
  group?: string;
}

export interface Offering {
  key: string;
  title: string;
  /** Relative frequency for new leads; 0 = only used as a recurring visit. */
  weight: number;
  /** Requires a written quote / treatment plan / proposal before work. */
  quote: boolean;
  lines: readonly LinePick[];
  /** Number of jobs (visits) the work takes. Default 1. */
  visits?: number;
  visitTitles?: readonly string[];
  /** Per-visit duration in minutes (single-day work; meeting length for long-running work). */
  durationMin?: readonly [number, number];
  /** Multi-day project length in calendar days. */
  durationDays?: readonly [number, number];
  /**
   * Long-running work (multi-day projects, monthly retainers) is calendared as
   * short meetings, not one job that blocks the crew for weeks. Projects book one
   * job per title (first at kickoff, last at delivery); retainers book the first
   * title once and the second every month after.
   */
  milestones?: readonly string[];
  /** One employee per role entry is assigned to each job. */
  crew: readonly EmployeeRole[];
  billing: "on-completion" | "deposit-and-final" | "monthly";
  /** Monthly billing: term length and the SKU billed each month. */
  termMonths?: readonly [number, number];
  monthlySku?: string;
  /** After the work, the customer is recalled for this offering every N months. */
  recurring?: { everyMonths: number; offering: string };
  /** Days from booking to the first visit. */
  leadTimeDays: readonly [number, number];
  /** Only offered to brand-new customers. */
  newOnly?: boolean;
  /** Request text in the customer's own words. */
  requests: readonly string[];
  /** Request text from an existing customer coming back (defaults to `requests`). */
  repeatRequests?: readonly string[];
}

/** One kind of appointment already on the calendar for the next two weeks. */
export interface AheadVisit {
  title: string;
  weight: number;
  durationMin: readonly [number, number];
  crew: readonly EmployeeRole[];
  /** Only for customers on the recurring plan (and preferred for them). */
  forPlan?: boolean;
}

export interface RosterEntry {
  role: EmployeeRole;
  small: number;
  medium: number;
  large: number;
}

export interface IndustryProfile {
  id: IndustryId;
  name: string;
  /** One-line description for INDUSTRIES metadata. */
  summary: string;
  companyNames: readonly string[];
  companyDescription: string;
  customerKind: "household" | "business";
  nouns: { quote: string; job: string; customer: string };
  quotePrefix: string;
  quoteValidDays: number;
  paymentTermsDays: number;
  /** 0 = Sunday … 6 = Saturday. */
  openDays: readonly number[];
  roster: readonly RosterEntry[];
  /** Roles that answer leads and own deals. */
  salesRoles: readonly EmployeeRole[];
  /** Roles that book visits and send reminders. */
  schedulerRoles: readonly EmployeeRole[];
  policies: ReadonlyArray<{ title: string; rule: string }>;
  catalog: readonly CatalogItem[];
  offerings: readonly Offering[];
  sourceWeights: Readonly<Partial<Record<LeadSource, number>>>;
  paymentMethods: Readonly<Partial<Record<Payment["method"], number>>>;
  /** Share of customers that already exist when the history starts. */
  existingShare: number;
  /** Existing customers enrolled in the recurring offering. */
  recurringShare: number;
  recurringOffering: string | null;
  /** Expected repeat leads per existing customer over 12 months. */
  repeatRate: number;
  /**
   * The forward schedule at asOf: about `rate` × customers jobs already booked
   * across the next 14 days, for existing customers.
   */
  bookedAhead: { rate: number; visits: readonly AheadVisit[] };
  contactTitles: readonly string[];
  tags: readonly string[];
  replyLines: readonly string[];
  disqualifyReasons: readonly string[];
  lostReasons: readonly string[];
  acceptTexts: readonly string[];
  declineTexts: readonly string[];
  questionTexts: readonly string[];
  quoteNote: string;
  confirmNote: string;
  invoiceNote: string;
  /** Uses {first} and {when}. */
  recallText: string;
  voicemails: readonly string[];
  /** Questions existing customers send that staff answer (background noise). */
  customerQuestions: readonly string[];
  questionReplies: readonly string[];
  jobNotes: readonly string[];
}
