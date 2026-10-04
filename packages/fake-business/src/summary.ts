import { ANOMALY_KINDS } from "./generate.js";
import type { Dataset } from "./schema.js";
import { usd } from "./world.js";

const COLLECTIONS = [
  "employees", "customers", "contacts", "leads", "deals", "quotes", "jobs",
  "invoices", "payments", "messages", "calls", "tasks", "events", "anomalies",
] as const;

/** A short human-readable overview of a dataset (used by `--summary`). */
export function formatSummary(d: Dataset): string {
  const pad = (s: string, n: number) => s.padEnd(n);
  const num = (v: number | string, n = 12) => String(v).padStart(n);
  const invoiced = d.invoices.filter((i) => i.status !== "void").reduce((s, i) => s + i.totalCents, 0);
  const collected = d.payments.reduce((s, p) => s + p.amountCents, 0);
  const applied = d.invoices.reduce((s, i) => s + i.paidCents, 0);
  const won = d.deals.filter((x) => x.stage === "won").length;
  const lost = d.deals.filter((x) => x.stage === "lost").length;
  const open = d.deals.filter((x) => x.stage !== "won" && x.stage !== "lost");
  const out: string[] = [];
  out.push(`${d.company.name} — ${d.meta.industry}, seed ${d.meta.seed}`);
  out.push(`${d.meta.startDate} → ${d.meta.asOf} · ${d.company.timezone} · ${d.company.address.city}, ${d.company.address.region}`);
  out.push("");
  out.push("Records");
  for (const k of COLLECTIONS) out.push(`  ${pad(k, 22)}${num(d[k].length)}`);
  out.push("");
  out.push("Money");
  out.push(`  ${pad("invoiced", 22)}${num(usd(invoiced), 14)}`);
  out.push(`  ${pad("payments received", 22)}${num(usd(collected), 14)}`);
  out.push(`  ${pad("outstanding (A/R)", 22)}${num(usd(invoiced - applied), 14)}`);
  out.push(`  ${pad("open pipeline", 22)}${num(usd(open.reduce((s, x) => s + x.amountCents, 0)), 14)}`);
  out.push(`  ${pad("deals won / lost / open", 22)}${num(`${won} / ${lost} / ${open.length}`, 14)}`);
  out.push("");
  const asOfEnd = Date.parse(`${d.meta.asOf}T23:59:59Z`);
  const ahead = d.jobs.filter((j) => j.status === "scheduled" && Date.parse(j.scheduledStart) > asOfEnd);
  const soon = ahead.filter((j) => Date.parse(j.scheduledStart) <= asOfEnd + 14 * 86_400_000).length;
  out.push("Schedule");
  out.push(`  ${pad("jobs in progress", 22)}${num(d.jobs.filter((j) => j.status === "in-progress").length)}`);
  out.push(`  ${pad("upcoming, next 14 days", 22)}${num(soon)}`);
  out.push(`  ${pad("upcoming, later", 22)}${num(ahead.length - soon)}`);
  out.push("");
  const atRisk = d.anomalies.reduce((s, a) => s + (a.amountAtRiskCents ?? 0), 0);
  out.push(`Anomalies (${d.anomalies.length}, ${usd(atRisk)} at risk)`);
  for (const k of ANOMALY_KINDS) {
    const n = d.anomalies.filter((a) => a.kind === k).length;
    out.push(`  ${pad(k, 28)}${num(n, 6)}`);
  }
  return `${out.join("\n")}\n`;
}
