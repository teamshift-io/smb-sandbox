/**
 * Flat, typed table definitions shared by the CSV and SQL exporters. Static
 * column lists mean empty collections still export a header / CREATE TABLE.
 */
import type { Dataset } from "../schema.js";

export type ColumnType = "text" | "int" | "bool" | "json";

export interface Column {
  name: string;
  type: ColumnType;
  get: (row: any) => unknown;
}

export interface Table {
  name: string;
  primaryKey: string[];
  columns: Column[];
  rows: (d: Dataset) => readonly unknown[];
}

function snake(path: string): string {
  return path.replace(/\./g, "_").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function col(path: string, type: ColumnType = "text"): Column {
  const parts = path.split(".");
  return {
    name: snake(path),
    type,
    get: (row) => parts.reduce<any>((v, k) => (v === null || v === undefined ? null : v[k]), row) ?? null,
  };
}

const address = (prefix = "address"): Column[] =>
  ["line1", "city", "region", "postalCode", "country"].map((k) => col(`${prefix}.${k}`));

function lineItemTable(name: string, parent: "quotes" | "invoices", fk: string): Table {
  return {
    name,
    primaryKey: [fk, "position"],
    columns: [
      { name: fk, type: "text", get: (r) => r.parentId },
      { name: "position", type: "int", get: (r) => r.position },
      col("sku"),
      col("description"),
      col("quantity", "int"),
      col("unitPriceCents", "int"),
      { name: "amount_cents", type: "int", get: (r) => r.quantity * r.unitPriceCents },
    ],
    rows: (d) => d[parent].flatMap((p) => p.lineItems.map((l, i) => ({ ...l, parentId: p.id, position: i + 1 }))),
  };
}

export const TABLES: readonly Table[] = [
  {
    name: "company",
    primaryKey: ["id"],
    columns: [
      col("id"), col("name"), col("industry"), col("description"), col("timezone"), col("currency"),
      col("phone"), col("email"), col("website"), ...address(), col("paymentTermsDays", "int"),
    ],
    rows: (d) => [d.company],
  },
  {
    name: "policies",
    primaryKey: ["id"],
    columns: [col("id"), { name: "company_id", type: "text", get: (r) => r.companyId }, col("title"), col("rule")],
    rows: (d) => d.company.policies.map((p) => ({ ...p, companyId: d.company.id })),
  },
  {
    name: "employees",
    primaryKey: ["id"],
    columns: [col("id"), col("name"), col("email"), col("phone"), col("role"), col("hiredOn"), col("active", "bool")],
    rows: (d) => d.employees,
  },
  {
    name: "customers",
    primaryKey: ["id"],
    columns: [col("id"), col("kind"), col("name"), ...address(), col("createdAt"), col("source"), col("status"), col("ownerId"), col("tags", "json")],
    rows: (d) => d.customers,
  },
  {
    name: "contacts",
    primaryKey: ["id"],
    columns: [col("id"), col("customerId"), col("firstName"), col("lastName"), col("email"), col("phone"), col("title"), col("createdAt")],
    rows: (d) => d.contacts,
  },
  {
    name: "leads",
    primaryKey: ["id"],
    columns: [col("id"), col("contactId"), col("source"), col("createdAt"), col("request"), col("status"), col("firstResponseAt"), col("ownerId"), col("dealId")],
    rows: (d) => d.leads,
  },
  {
    name: "deals",
    primaryKey: ["id"],
    columns: [
      col("id"), col("customerId"), col("contactId"), col("title"), col("stage"), col("amountCents", "int"), col("ownerId"),
      col("createdAt"), col("updatedAt"), col("closedAt"), col("lostReason"), col("nextAction.summary"), col("nextAction.dueOn"),
    ],
    rows: (d) => d.deals,
  },
  {
    name: "quotes",
    primaryKey: ["id"],
    columns: [
      col("id"), col("dealId"), col("customerId"), col("number"), col("status"), col("totalCents", "int"),
      col("createdAt"), col("sentAt"), col("expiresOn"), col("followUps", "json"),
    ],
    rows: (d) => d.quotes,
  },
  lineItemTable("quote_line_items", "quotes", "quote_id"),
  {
    name: "jobs",
    primaryKey: ["id"],
    columns: [
      col("id"), col("customerId"), col("quoteId"), col("title"), col("status"), col("scheduledStart"), col("scheduledEnd"),
      col("assigneeIds", "json"), col("completedAt"), col("notes"),
    ],
    rows: (d) => d.jobs,
  },
  {
    name: "invoices",
    primaryKey: ["id"],
    columns: [
      col("id"), col("customerId"), col("jobId"), col("number"), col("status"), col("totalCents", "int"),
      col("issuedOn"), col("dueOn"), col("paidCents", "int"),
    ],
    rows: (d) => d.invoices,
  },
  lineItemTable("invoice_line_items", "invoices", "invoice_id"),
  {
    name: "payments",
    primaryKey: ["id"],
    columns: [col("id"), col("invoiceId"), col("customerId"), col("amountCents", "int"), col("method"), col("receivedAt"), col("reference")],
    rows: (d) => d.payments,
  },
  {
    name: "messages",
    primaryKey: ["id"],
    columns: [
      col("id"), col("channel"), col("direction"), col("threadId"), col("from"), col("to", "json"), col("subject"), col("body"),
      col("sentAt"), col("contactId"), col("employeeId"), col("relatedIds", "json"), col("read", "bool"),
    ],
    rows: (d) => d.messages,
  },
  {
    name: "calls",
    primaryKey: ["id"],
    columns: [col("id"), col("direction"), col("from"), col("to"), col("startedAt"), col("durationSec", "int"), col("outcome"), col("contactId"), col("employeeId"), col("summary")],
    rows: (d) => d.calls,
  },
  {
    name: "tasks",
    primaryKey: ["id"],
    columns: [col("id"), col("title"), col("assigneeId"), col("dueOn"), col("status"), col("createdAt"), col("completedAt"), col("relatedIds", "json")],
    rows: (d) => d.tasks,
  },
  {
    name: "events",
    primaryKey: ["id"],
    columns: [col("id"), col("type"), col("at"), col("subjectId"), col("actorId"), col("data", "json")],
    rows: (d) => d.events,
  },
  {
    name: "anomalies",
    primaryKey: ["id"],
    columns: [col("id"), col("kind"), col("recordIds", "json"), col("description"), col("amountAtRiskCents", "int")],
    rows: (d) => d.anomalies,
  },
];
