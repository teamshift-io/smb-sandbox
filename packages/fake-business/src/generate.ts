import { CALIBRATION, calibratedProfile } from "./calibration.js";
import { injectPostAnomalies, type Quotas } from "./anomalies.js";
import { runChain } from "./chains.js";
import { PROFILES } from "./industries/index.js";
import { SIZES, makePlan, type Plan, type Size } from "./plan.js";
import { Rng, hash32 } from "./rng.js";
import { SCHEMA_VERSION, type AnomalyKind, type Dataset, type GenerateOptions, type IndustryId } from "./schema.js";
import { DAY, dayStart, parseDate } from "./time.js";
import { World, type Flags, type Trace } from "./world.js";

export const GENERATOR_VERSION = "0.1.0";
export const DEFAULT_AS_OF = "2026-09-30";

export const ANOMALY_KINDS: readonly AnomalyKind[] = [
  "duplicate-contact",
  "quote-not-followed-up",
  "missed-call-no-callback",
  "stale-deal",
  "overdue-invoice",
  "invoice-wrong-job",
  "reschedule-not-propagated",
  "missing-contact-info",
  "conflicting-status",
  "unmatched-payment",
  "lead-never-contacted",
];

interface Resolved {
  industry: IndustryId;
  seed: number;
  size: Size;
  asOf: string;
  months: number;
  messiness: number;
  calibrated: boolean;
}

function resolve(opts: GenerateOptions): Resolved {
  if (!opts || typeof opts !== "object") throw new TypeError("generate() needs an options object");
  if (!(opts.industry in PROFILES)) {
    throw new RangeError(`Unknown industry "${String(opts.industry)}". Use one of: ${Object.keys(PROFILES).join(", ")}`);
  }
  if (!Number.isSafeInteger(opts.seed)) throw new RangeError(`seed must be an integer, got ${String(opts.seed)}`);
  const size = opts.size ?? "medium";
  if (!(size in SIZES)) throw new RangeError(`size must be small, medium or large, got "${String(size)}"`);
  const asOf = opts.asOf ?? DEFAULT_AS_OF;
  parseDate(asOf);
  const months = opts.months ?? 12;
  if (!Number.isInteger(months) || months < 1 || months > 120) throw new RangeError(`months must be an integer from 1 to 120, got ${String(months)}`);
  const messiness = opts.messiness ?? 1;
  if (!Number.isFinite(messiness) || messiness < 0 || messiness > 10) throw new RangeError(`messiness must be between 0 and 10, got ${String(messiness)}`);
  if (opts.calibrated !== undefined && typeof opts.calibrated !== "boolean") throw new TypeError("calibrated must be boolean");
  return { industry: opts.industry, seed: opts.seed, size, asOf, months, messiness, calibrated: opts.calibrated ?? false };
}

function quotasFor(r: Resolved): Quotas {
  const n = SIZES[r.size];
  const q = r.messiness <= 0 ? 0 : Math.max(1, Math.round(0.05 * n * r.messiness));
  return Object.fromEntries(ANOMALY_KINDS.map((k) => [k, q])) as unknown as Quotas;
}

function chainRng(plan: Plan, i: number): Rng {
  return new Rng(hash32(plan.seed, plan.P.id, "chain", i));
}

/** Pick which storylines carry an embedded anomaly, using a dry run's timings. */
function chooseFlags(plan: Plan, traces: Trace[], quotas: Quotas, rng: Rng): Flags[] {
  const flags: Flags[] = traces.map(() => ({}));
  const taken = new Set<number>();
  const end = plan.endMs;
  const endDay = dayStart(end);
  const placed = { ghostQuote: 0, staleDeal: 0, unpaidInvoice: 0, brokenReschedule: 0 };
  const assign = (count: number, eligible: number[], key: "ghostQuote" | "staleDeal" | "unpaidInvoice"): void => {
    for (const i of eligible) {
      if (placed[key] >= count) break;
      if (taken.has(i)) continue;
      taken.add(i);
      flags[i] = { [key]: true };
      placed[key]++;
    }
  };
  const idx = traces.map((_, i) => i);

  // Reschedules: prefer upcoming jobs (still actionable), then the most recent.
  const resched = traces
    .flatMap((t, chain) => (t.jobs ?? []).map((j, job) => ({ chain, job, ...j })))
    .filter((j) => j.reschedAt <= end && j.reschedAt < j.start - 2 * 3_600_000)
    .sort((a, b) => Number(b.start > end) - Number(a.start > end) || b.reschedAt - a.reschedAt || a.chain - b.chain);
  const ghostPool = rng.shuffle(idx.filter((i) => (traces[i]?.quoteSentAt ?? Infinity) <= end - 12 * DAY));
  const stalePool = rng.shuffle(idx.filter((i) => (traces[i]?.dealAt ?? Infinity) <= end - 40 * DAY));
  const unpaidPool = rng.shuffle(idx.filter((i) => (traces[i]?.firstInvoiceDue ?? Infinity) + 3 * DAY <= endDay));
  // Two passes: one of each kind first so a scarce storyline type is never used up by another kind.
  for (const cap of [1, Infinity]) {
    for (const j of resched) {
      if (placed.brokenReschedule >= Math.min(cap, quotas["reschedule-not-propagated"])) break;
      if (taken.has(j.chain)) continue;
      taken.add(j.chain);
      flags[j.chain] = { brokenReschedule: j.job };
      placed.brokenReschedule++;
    }
    assign(Math.min(cap, quotas["quote-not-followed-up"]), ghostPool, "ghostQuote");
    assign(Math.min(cap, quotas["stale-deal"]), stalePool, "staleDeal");
    assign(Math.min(cap, quotas["overdue-invoice"]), unpaidPool, "unpaidInvoice");
  }
  return flags;
}

function deriveCustomerStatus(w: World, plan: Plan): void {
  const recent = Date.parse(`${plan.asOf}T00:00:00Z`) - 365 * DAY;
  const churnable = new Set(w.existing.filter((_, i) => plan.existing[i]?.churnIfIdle).map((e) => e.customer.id));
  const busy = new Set<string>();
  for (const j of w.d.jobs) {
    if (j.status === "scheduled" || j.status === "in-progress" || Date.parse(j.scheduledStart) >= recent) busy.add(j.customerId);
  }
  for (const d of w.d.deals) if (d.stage !== "won" && d.stage !== "lost") busy.add(d.customerId);
  for (const c of w.d.customers) {
    c.status = busy.has(c.id) ? "active" : churnable.has(c.id) ? "churned" : "inactive";
  }
}

const PLACEHOLDER = /\{\{#([a-z]+_[0-9a-z]+)\}\}/g;

function finalize(w: World, plan: Plan, r: Resolved): Dataset {
  deriveCustomerStatus(w, plan);

  // Human-facing numbers in creation order.
  const numbers = new Map<string, string>();
  const byCreated = (a: { id: string }, b: { id: string }) => (w.created.get(a.id) ?? 0) - (w.created.get(b.id) ?? 0) || (a.id < b.id ? -1 : 1);
  [...w.d.quotes].sort(byCreated).forEach((q, i) => {
    q.number = `${plan.P.quotePrefix}${plan.quoteBase + i}`;
    numbers.set(q.id, q.number);
  });
  [...w.d.invoices].sort(byCreated).forEach((inv, i) => {
    inv.number = `INV-${plan.invoiceBase + i}`;
    numbers.set(inv.id, inv.number);
  });
  const fill = (s: string): string => s.replace(PLACEHOLDER, (_, id: string) => numbers.get(id) ?? id);
  for (const m of w.d.messages) {
    m.body = fill(m.body);
    if (m.subject) m.subject = fill(m.subject);
  }
  for (const t of w.d.tasks) t.title = fill(t.title);
  for (const c of w.d.calls) if (c.summary) c.summary = fill(c.summary);
  for (const d of w.d.deals) if (d.nextAction) d.nextAction = { ...d.nextAction, summary: fill(d.nextAction.summary) };
  for (const inv of w.d.invoices) for (const l of inv.lineItems) l.description = fill(l.description);
  for (const a of w.d.anomalies) a.description = fill(a.description);
  for (const e of w.d.events) {
    for (const [k, v] of Object.entries(e.data)) if (typeof v === "string" && v.includes("{{#")) e.data[k] = fill(v);
  }

  const by = <T extends { id: string }>(key: (x: T) => string) => (a: T, b: T) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  const d = w.d;
  const seq = w.evSeq;
  const kindOrder = new Map<string, number>(ANOMALY_KINDS.map((k, i) => [k, i]));

  return {
    meta: {
      generator: "@teamshift/fake-business",
      generatorVersion: GENERATOR_VERSION,
      schemaVersion: SCHEMA_VERSION,
      industry: r.industry,
      seed: r.seed,
      startDate: plan.startDate,
      asOf: r.asOf,
      synthetic: true,
      ...(r.calibrated ? { calibration: structuredClone(CALIBRATION[r.industry]) } : {}),
    },
    company: w.company,
    employees: d.employees,
    customers: [...d.customers].sort(by((c) => c.createdAt)),
    contacts: [...d.contacts].sort(by((c) => c.createdAt)),
    leads: [...d.leads].sort(by((l) => l.createdAt)),
    deals: [...d.deals].sort(by((x) => x.createdAt)),
    quotes: [...d.quotes].sort(by((q) => q.number.padStart(12, "0"))),
    jobs: [...d.jobs].sort(by((j) => j.scheduledStart)),
    invoices: [...d.invoices].sort(by((i) => i.number.padStart(12, "0"))),
    payments: [...d.payments].sort(by((p) => p.receivedAt)),
    messages: [...d.messages].sort(by((m) => m.sentAt)),
    calls: [...d.calls].sort(by((c) => c.startedAt)),
    tasks: [...d.tasks].sort(by((t) => t.createdAt)),
    events: [...d.events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : (seq.get(a.id) ?? 0) - (seq.get(b.id) ?? 0))),
    anomalies: [...d.anomalies].sort((a, b) => (kindOrder.get(a.kind) ?? 0) - (kindOrder.get(b.kind) ?? 0) || (a.id < b.id ? -1 : 1)),
  };
}

/**
 * Generate one coherent fictional small business. Pure and deterministic:
 * the same options always produce a deep-equal Dataset.
 */
export function generate(opts: GenerateOptions): Dataset {
  const r = resolve(opts);
  const P = r.calibrated ? calibratedProfile(PROFILES[r.industry]) : PROFILES[r.industry];
  const quotas = quotasFor(r);
  const plan = makePlan({
    enforceStaffAvailability: r.calibrated,
    P,
    seed: r.seed,
    size: r.size,
    asOf: r.asOf,
    months: r.months,
    spareCount: quotas["missed-call-no-callback"] + quotas["lead-never-contacted"],
  });

  // Dry run: learn each storyline's timings so embedded anomalies land where they can hold.
  const anomalyRng = new Rng(hash32(r.seed, r.industry, "anomalies"));
  let flags: Flags[] = plan.chains.map(() => ({}));
  if (r.messiness > 0) {
    const dry = new World(plan);
    const traces = plan.chains.map((spec, i) => runChain(dry, spec, chainRng(plan, i), {}));
    flags = chooseFlags(plan, traces, quotas, anomalyRng);
  }

  const w = new World(plan);
  plan.chains.forEach((spec, i) => runChain(w, spec, chainRng(plan, i), flags[i] ?? {}));
  if (r.messiness > 0) {
    const used = new Set<string>(w.d.anomalies.flatMap((a) => a.recordIds));
    injectPostAnomalies(w, plan, anomalyRng, quotas, used);
  }
  return finalize(w, plan, r);
}
