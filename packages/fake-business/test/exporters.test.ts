import { describe, expect, it } from "vitest";
import {
  generate,
  toCSVFiles,
  toHubSpotImportCSVs,
  toJSON,
  toNDJSONEvents,
  toQuickBooksImportCSVs,
  toSQL,
  type Dataset,
} from "../src/index.js";
import { formatSummary } from "../src/summary.js";

const COLLECTIONS = [
  "employees", "customers", "contacts", "leads", "deals", "quotes", "jobs",
  "invoices", "payments", "messages", "calls", "tasks", "events", "anomalies",
] as const;

const messy = generate({ industry: "marketing-agency", seed: 11 });
const clean = generate({ industry: "dental-clinic", seed: 11, messiness: 0 });

/** Minimal RFC 4180 parser for round-trip checks. */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  return rows;
}

describe.each([
  ["messy agency", messy],
  ["clean dental", clean],
] as Array<[string, Dataset]>)("exporters (%s)", (_, d) => {
  it("toJSON round-trips", () => {
    expect(JSON.parse(toJSON(d))).toEqual(d);
  });

  it("toNDJSONEvents writes one event per line", () => {
    const lines = toNDJSONEvents(d).trimEnd().split("\n");
    expect(lines).toHaveLength(d.events.length);
    expect(JSON.parse(lines[0]!)).toEqual(d.events[0]);
  });

  it("toCSVFiles writes one parseable CSV per collection", () => {
    const files = toCSVFiles(d);
    for (const c of COLLECTIONS) {
      const rows = parseCSV(files[`${c}.csv`]!);
      expect(rows.length - 1, c).toBe(d[c].length);
      expect(rows[0]![0]).toBe("id");
      for (const r of rows) expect(r.length, c).toBe(rows[0]!.length);
    }
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["company.csv", "policies.csv", "quote_line_items.csv", "invoice_line_items.csv"]));
    const lineRows = parseCSV(files["invoice_line_items.csv"]!).length - 1;
    expect(lineRows).toBe(d.invoices.reduce((s, i) => s + i.lineItems.length, 0));
  });

  it.each(["sqlite", "postgres"] as const)("toSQL (%s) has a CREATE TABLE per collection and an INSERT per row", (dialect) => {
    const sql = toSQL(d, dialect);
    for (const c of COLLECTIONS) expect(sql, c).toContain(`CREATE TABLE "${c}" (`);
    expect(sql).toContain(`CREATE TABLE "company" (`);
    for (const c of COLLECTIONS) {
      const inserts = sql.split("\n").filter((l) => l.startsWith(`INSERT INTO "${c}" `)).length;
      expect(inserts, c).toBe(d[c].length);
    }
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    if (dialect === "postgres") expect(sql).toContain("JSONB");
  });

  it("toSQL (sqlite) executes and preserves totals", async () => {
    let sqlite: typeof import("node:sqlite") | undefined;
    try {
      sqlite = await import("node:sqlite");
    } catch {
      return; // node:sqlite unavailable on this Node version
    }
    const db = new sqlite.DatabaseSync(":memory:");
    db.exec(toSQL(d, "sqlite"));
    for (const c of COLLECTIONS) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM "${c}"`).get() as { n: number };
      expect(Number(row.n), c).toBe(d[c].length);
    }
    const mismatched = db
      .prepare(`SELECT i.id FROM invoices i JOIN invoice_line_items l ON l.invoice_id = i.id GROUP BY i.id HAVING SUM(l.amount_cents) <> MAX(i.total_cents)`)
      .all();
    expect(mismatched).toEqual([]);
    db.close();
  });

  it("toHubSpotImportCSVs shapes contacts, companies and deals", () => {
    const files = toHubSpotImportCSVs(d);
    expect(Object.keys(files).sort()).toEqual(["companies.csv", "contacts.csv", "deals.csv"]);
    const contacts = parseCSV(files["contacts.csv"]!);
    expect(contacts[0]).toEqual(expect.arrayContaining(["First Name", "Last Name", "Email", "Phone Number", "Lifecycle Stage"]));
    expect(contacts.length - 1).toBe(d.contacts.length);
    const deals = parseCSV(files["deals.csv"]!);
    expect(deals[0]).toEqual(expect.arrayContaining(["Deal Name", "Pipeline", "Deal Stage", "Amount", "Close Date"]));
    expect(deals.length - 1).toBe(d.deals.length);
    const companies = parseCSV(files["companies.csv"]!);
    expect(companies[0]).toEqual(expect.arrayContaining(["Company Name", "Company Domain Name"]));
    expect(companies.length - 1).toBe(d.company.industry === "marketing-agency" ? d.customers.length : 0);
  });

  it("toQuickBooksImportCSVs shapes customers and invoice lines", () => {
    const files = toQuickBooksImportCSVs(d);
    const customers = parseCSV(files["customers.csv"]!);
    expect(customers.length - 1).toBe(d.customers.length);
    const invoices = parseCSV(files["invoices.csv"]!);
    expect(invoices[0]).toEqual(expect.arrayContaining(["InvoiceNo", "Customer", "InvoiceDate", "DueDate", "ItemAmount"]));
    expect(invoices.length - 1).toBe(d.invoices.reduce((s, i) => s + i.lineItems.length, 0));
  });
});

describe("summary", () => {
  it("is stable for a fixed seed", () => {
    const a = formatSummary(generate({ industry: "home-services", seed: 42 }));
    const b = formatSummary(generate({ industry: "home-services", seed: 42 }));
    expect(a).toBe(b);
    expect(a).toMatchSnapshot();
  });

  it("lists every anomaly kind and record count", () => {
    const s = formatSummary(messy);
    for (const c of COLLECTIONS) expect(s).toContain(c);
    expect(s).toContain("reschedule-not-propagated");
    expect(s).toMatch(/invoiced\s+\$[\d,]+\.\d\d/);
  });
});
