import { describe, expect, it } from "vitest";
import { INDUSTRIES, SCHEMA_VERSION, generate, toJSON, type AnomalyKind, type Dataset, type IndustryId } from "../src/index.js";
import { CHECKERS, indexById, integrityProblems } from "./checkers.js";
import { PROFILES } from "../src/industries/index.js";

const IDS = INDUSTRIES.map((i) => i.id) as IndustryId[];
const KINDS = Object.keys(CHECKERS) as AnomalyKind[];

const cache = new Map<string, Dataset>();
function gen(industry: IndustryId, seed: number, messiness = 1, size: "small" | "medium" | "large" = "medium"): Dataset {
  const key = `${industry}|${seed}|${messiness}|${size}`;
  let d = cache.get(key);
  if (!d) {
    d = generate({ industry, seed, messiness, size });
    cache.set(key, d);
  }
  return d;
}

describe("determinism", () => {
  it.each(IDS)("%s: same options give byte-identical JSON", (industry) => {
    const a = toJSON(generate({ industry, seed: 42 }));
    const b = toJSON(generate({ industry, seed: 42 }));
    expect(a).toBe(b);
  });

  it.each(IDS)("%s: different seeds give different data", (industry) => {
    expect(toJSON(generate({ industry, seed: 1 }))).not.toBe(toJSON(generate({ industry, seed: 2 })));
  });

  it("defaults are applied and recorded in meta", () => {
    const d = generate({ industry: "home-services", seed: 3 });
    expect(d.meta).toMatchObject({ asOf: "2026-09-30", startDate: "2025-10-01", seed: 3, synthetic: true, schemaVersion: SCHEMA_VERSION });
    expect(toJSON(d)).toBe(toJSON(generate({ industry: "home-services", seed: 3, size: "medium", asOf: "2026-09-30", months: 12, messiness: 1 })));
  });

  it("rejects invalid options", () => {
    expect(() => generate({ industry: "bakery" as IndustryId, seed: 1 })).toThrow(/Unknown industry/);
    expect(() => generate({ industry: "home-services", seed: 1.5 })).toThrow(/seed/);
    expect(() => generate({ industry: "home-services", seed: 1, asOf: "2026-02-30" })).toThrow(/date/i);
    expect(() => generate({ industry: "home-services", seed: 1, messiness: -1 })).toThrow(/messiness/);
  });

  it("medium generation takes under a second", () => {
    for (const industry of IDS) {
      const t0 = performance.now();
      generate({ industry, seed: 99 });
      expect(performance.now() - t0).toBeLessThan(1000);
    }
  });
});

describe.each(IDS)("%s dataset", (industry) => {
  for (const messiness of [0, 1, 3]) {
    describe(`messiness ${messiness}`, () => {
      const d = gen(industry, 42, messiness);
      const byId = indexById(d);
      const wrongJobInvoices = new Set(d.anomalies.filter((a) => a.kind === "invoice-wrong-job").map((a) => a.recordIds[0]));
      const conflicting = new Set(d.anomalies.filter((a) => a.kind === "conflicting-status").map((a) => a.recordIds[0]));

      it("has roughly the requested size and the right flavor", () => {
        expect(d.customers.length).toBeGreaterThanOrEqual(32);
        expect(d.customers.length).toBeLessThanOrEqual(48);
        expect(d.company.industry).toBe(industry);
        expect(d.customers.every((c) => c.kind === (industry === "marketing-agency" ? "business" : "household"))).toBe(true);
        expect(d.quotes.length).toBeGreaterThan(0);
        expect(d.jobs.length).toBeGreaterThan(0);
        expect(d.invoices.length).toBeGreaterThan(0);
      });

      it("ids are unique and well-formed", () => {
        const all = [...byId.keys()];
        const count =
          1 + d.company.policies.length +
          (["employees", "customers", "contacts", "leads", "deals", "quotes", "jobs", "invoices", "payments", "messages", "calls", "tasks", "events", "anomalies"] as const)
            .reduce((s, k) => s + d[k].length, 0);
        expect(all.length).toBe(count);
        for (const id of all) expect(id).toMatch(/^[a-z]+_[0-9a-z]{6,}$/);
        expect(new Set(d.quotes.map((q) => q.number)).size).toBe(d.quotes.length);
        expect(new Set(d.invoices.map((i) => i.number)).size).toBe(d.invoices.length);
      });

      it("every id reference resolves", () => {
        const has = (id: string | null, prefix?: string) => {
          if (id === null) return;
          expect(byId.has(id), `dangling ${id}`).toBe(true);
          if (prefix) expect(id.startsWith(prefix), `${id} should be ${prefix}`).toBe(true);
        };
        for (const c of d.customers) has(c.ownerId, "emp_");
        for (const c of d.contacts) has(c.customerId, "cus_");
        for (const l of d.leads) {
          has(l.contactId, "con_");
          has(l.ownerId, "emp_");
          has(l.dealId, "deal_");
        }
        for (const x of d.deals) {
          has(x.customerId, "cus_");
          has(x.contactId, "con_");
          has(x.ownerId, "emp_");
        }
        for (const q of d.quotes) {
          has(q.dealId, "deal_");
          has(q.customerId, "cus_");
          expect(d.deals.find((x) => x.id === q.dealId)?.customerId).toBe(q.customerId);
        }
        for (const j of d.jobs) {
          has(j.customerId, "cus_");
          has(j.quoteId, "quo_");
          j.assigneeIds.forEach((e) => has(e, "emp_"));
          expect(j.assigneeIds.length).toBeGreaterThan(0);
        }
        for (const i of d.invoices) {
          has(i.customerId, "cus_");
          has(i.jobId, "job_");
          if (i.jobId && !wrongJobInvoices.has(i.id)) {
            expect(d.jobs.find((j) => j.id === i.jobId)?.customerId, `invoice ${i.number} job customer`).toBe(i.customerId);
          }
        }
        for (const p of d.payments) {
          has(p.invoiceId, "inv_");
          has(p.customerId, "cus_");
        }
        for (const m of d.messages) {
          expect(m.threadId).toMatch(/^thr_[0-9a-z]{6,}$/);
          has(m.contactId, "con_");
          has(m.employeeId, "emp_");
          m.relatedIds.forEach((r) => has(r));
        }
        for (const c of d.calls) {
          has(c.contactId, "con_");
          has(c.employeeId, "emp_");
        }
        for (const t of d.tasks) {
          has(t.assigneeId, "emp_");
          t.relatedIds.forEach((r) => has(r));
        }
        for (const e of d.events) {
          has(e.subjectId);
          if (e.actorId) expect(e.actorId).toMatch(/^(emp|con)_/);
          has(e.actorId);
        }
        for (const a of d.anomalies) a.recordIds.forEach((r) => has(r));
      });

      it("quote and invoice totals equal their line items", () => {
        const sum = (ls: Array<{ quantity: number; unitPriceCents: number }>) => ls.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
        for (const q of d.quotes) expect(q.totalCents).toBe(sum(q.lineItems));
        for (const i of d.invoices) expect(i.totalCents).toBe(sum(i.lineItems));
        for (const x of d.deals) {
          const q = d.quotes.find((q) => q.dealId === x.id);
          if (q) expect(x.amountCents).toBe(q.totalCents);
        }
      });

      it("paidCents and status agree with payments", () => {
        for (const i of d.invoices) {
          const paid = d.payments.filter((p) => p.invoiceId === i.id).reduce((s, p) => s + p.amountCents, 0);
          expect(i.paidCents, i.number).toBe(paid);
          if (conflicting.has(i.id)) continue;
          if (i.status === "paid") expect(paid).toBe(i.totalCents);
          if (i.status === "partially-paid") expect(paid > 0 && paid < i.totalCents).toBe(true);
          if (i.status === "open") expect(paid).toBe(0);
        }
        for (const p of d.payments) {
          const inv = d.invoices.find((i) => i.id === p.invoiceId);
          if (inv) {
            expect(p.receivedAt.slice(0, 10) >= inv.issuedOn).toBe(true);
            expect(p.receivedAt.slice(0, 10) <= inv.dueOn).toBe(true);
          }
        }
      });

      it("keeps every timestamp inside the simulated window and business hours", () => {
        const lo = `${d.meta.startDate}T00:00:00Z`;
        const hi = `${d.meta.asOf}T23:59:59Z`;
        for (let k = 0; k < d.events.length; k++) {
          const e = d.events[k]!;
          expect(e.at >= lo && e.at <= hi, `${e.type} at ${e.at}`).toBe(true);
          if (k > 0) expect(e.at >= d.events[k - 1]!.at).toBe(true);
          const hour = Number(e.at.slice(11, 13));
          expect(hour >= 11 && hour <= 23, `${e.type} at ${e.at} outside daytime`).toBe(true);
        }
        const stamps = [
          ...d.leads.map((l) => l.createdAt), ...d.deals.map((x) => x.updatedAt), ...d.quotes.flatMap((q) => [q.createdAt, q.sentAt ?? lo, ...q.followUps]),
          ...d.payments.map((p) => p.receivedAt), ...d.messages.map((m) => m.sentAt), ...d.calls.map((c) => c.startedAt),
          ...d.tasks.map((t) => t.createdAt), ...d.jobs.map((j) => j.completedAt ?? lo), ...d.contacts.map((c) => c.createdAt),
        ];
        for (const s of stamps) expect(s <= hi, s).toBe(true);
        for (const i of d.invoices) expect(i.issuedOn <= d.meta.asOf).toBe(true);
        for (const j of d.jobs) {
          if (j.status === "completed") expect(j.scheduledStart <= hi).toBe(true);
          expect(j.scheduledEnd > j.scheduledStart).toBe(true);
        }
      });

      it("orders each lead → deal → quote → job → invoice chain causally", () => {
        const evAt = (type: string, subjectId: string) => d.events.find((e) => e.type === type && e.subjectId === subjectId)?.at;
        let chains = 0;
        for (const lead of d.leads) {
          if (lead.firstResponseAt) expect(lead.firstResponseAt >= lead.createdAt).toBe(true);
          if (!lead.dealId) continue;
          const deal = d.deals.find((x) => x.id === lead.dealId)!;
          expect(lead.firstResponseAt! <= deal.createdAt).toBe(true);
          expect(evAt("LeadCreated", lead.id)! <= evAt("LeadContacted", lead.id)!).toBe(true);
          expect(evAt("LeadContacted", lead.id)! <= evAt("DealCreated", deal.id)!).toBe(true);
          if (deal.closedAt) expect(deal.closedAt >= deal.createdAt).toBe(true);
          for (const q of d.quotes.filter((q) => q.dealId === deal.id)) {
            chains++;
            expect(q.createdAt >= deal.createdAt).toBe(true);
            expect(q.sentAt! >= q.createdAt).toBe(true);
            expect(evAt("QuoteSent", q.id)! >= evAt("DealCreated", deal.id)!).toBe(true);
            let prev = q.sentAt!;
            for (const f of q.followUps) {
              expect(f >= prev).toBe(true);
              prev = f;
            }
            const decided = evAt("QuoteAccepted", q.id) ?? evAt("QuoteDeclined", q.id);
            if (decided) expect(decided >= prev).toBe(true);
            for (const j of d.jobs.filter((j) => j.quoteId === q.id)) {
              const scheduled = evAt("JobScheduled", j.id)!;
              expect(scheduled >= evAt("QuoteAccepted", q.id)!).toBe(true);
              expect(j.scheduledStart > scheduled).toBe(true);
              if (j.completedAt) expect(j.completedAt >= j.scheduledStart).toBe(true);
              for (const inv of d.invoices.filter((i) => i.jobId === j.id && !wrongJobInvoices.has(i.id))) {
                expect(inv.issuedOn >= scheduled.slice(0, 10)).toBe(true);
              }
            }
          }
        }
        expect(chains).toBeGreaterThan(0);
      });

      it("uses only reserved fictional contact details", () => {
        const phone = /^(\(\d{3}\) |\d{3}-)555-01\d{2}$/;
        const emails = [d.company.email, ...d.employees.map((e) => e.email), ...d.contacts.map((c) => c.email)];
        for (const e of emails) if (e !== null) expect(e.endsWith(".example"), e).toBe(true);
        expect(d.company.website).toMatch(/^https:\/\/www\.[a-z0-9]+\.example$/);
        for (const p of [d.company.phone, ...d.employees.map((e) => e.phone), ...d.contacts.map((c) => c.phone)]) {
          if (p !== null) expect(p, p).toMatch(phone);
        }
        for (const m of d.messages) for (const addr of [m.from, ...m.to]) expect(addr.endsWith(".example") || phone.test(addr), addr).toBe(true);
      });

      it("resolves all number placeholders in text", () => {
        const text = JSON.stringify(d);
        expect(text).not.toMatch(/\{\{#/);
      });

      if (messiness === 0) {
        it("is perfectly clean with messiness 0", () => {
          expect(d.anomalies).toEqual([]);
          expect(d.payments.every((p) => p.invoiceId !== null)).toBe(true);
          expect(d.invoices.filter((i) => i.status !== "paid" && i.dueOn < d.meta.asOf)).toEqual([]);
          expect(d.events.filter((e) => e.type === "InvoiceOverdue")).toEqual([]);
          const asOf = Date.parse(`${d.meta.asOf}T23:59:59Z`);
          expect(d.leads.filter((l) => l.status === "new" && Date.parse(l.createdAt) < asOf - 4 * 86_400_000)).toEqual([]);
          for (const c of d.calls.filter((c) => c.direction === "inbound" && c.outcome !== "answered")) {
            expect(d.calls.some((o) => o.direction === "outbound" && o.contactId === c.contactId && o.startedAt > c.startedAt)).toBe(true);
          }
          for (const ev of d.events.filter((e) => e.type === "JobRescheduled")) {
            const job = d.jobs.find((j) => j.id === ev.subjectId)!;
            const task = d.tasks.find((t) => t.relatedIds.includes(job.id) && t.title.startsWith(industry === "marketing-agency" ? "Meeting" : "Visit"))!;
            expect(task.dueOn).toBe(job.scheduledStart.slice(0, 10));
          }
          for (const c of d.contacts) {
            expect(c.email).not.toBeNull();
            expect(c.phone).not.toBeNull();
          }
        });
      }
    });
  }
});

describe("anomalies", () => {
  const cases: Array<[IndustryId, number]> = IDS.flatMap((i) => [1, 7, 42, 2026].map((s) => [i, s] as [IndustryId, number]));

  it.each(cases)("%s seed %i: every kind appears and its condition holds", (industry, seed) => {
    const d = gen(industry, seed, 1);
    const byId = indexById(d);
    for (const kind of KINDS) expect(d.anomalies.some((a) => a.kind === kind), `${kind} missing`).toBe(true);
    for (const a of d.anomalies) {
      expect(a.recordIds.length).toBeGreaterThan(0);
      for (const id of a.recordIds) expect(byId.has(id), `${a.kind}: ${id}`).toBe(true);
      expect(a.description.length).toBeGreaterThan(20);
      expect(a.description).toMatch(/\.$/);
      if (a.amountAtRiskCents !== null) expect(a.amountAtRiskCents).toBeGreaterThan(0);
      expect(CHECKERS[a.kind](d, a), `${a.kind} ${a.id}: ${a.description}`).toBeNull();
    }
  });

  it("scales with messiness and size", () => {
    const low = gen("home-services", 5, 0.2).anomalies.length;
    const high = gen("home-services", 5, 3).anomalies.length;
    expect(high).toBeGreaterThan(low);
    const large = generate({ industry: "dental-clinic", seed: 5, size: "large" });
    expect(large.customers.length).toBeGreaterThan(110);
    for (const a of large.anomalies) expect(CHECKERS[a.kind](large, a), a.description).toBeNull();
    const small = generate({ industry: "marketing-agency", seed: 5, size: "small" });
    expect(small.customers.length).toBeLessThan(22);
    for (const a of small.anomalies) expect(CHECKERS[a.kind](small, a), a.description).toBeNull();
  });
});

describe("edge configurations", () => {
  const configs = IDS.flatMap((industry) => [
    { industry, seed: 3, size: "small" as const, months: 1 },
    { industry, seed: 4, size: "small" as const, months: 3, messiness: 0.1 },
    { industry, seed: 5, size: "large" as const, months: 24, messiness: 2 },
    { industry, seed: 6, size: "medium" as const, months: 36, asOf: "2024-03-15" },
    { industry, seed: -12345, size: "medium" as const, messiness: 0 },
  ]);
  it.each(configs)("$industry seed $seed $size $months months", (opts) => {
    const d = generate(opts);
    expect(integrityProblems(d)).toEqual([]);
    for (const a of d.anomalies) expect(CHECKERS[a.kind](d, a), a.description).toBeNull();
    if (opts.messiness === 0) expect(d.anomalies).toEqual([]);
  });
});

describe("forward schedule", () => {
  const DAY_MS = 86_400_000;
  const cases = IDS.flatMap((industry) =>
    (["small", "medium"] as const).flatMap((size) => [1, 7, 42, 2026].map((seed) => ({ industry, size, seed }))),
  );

  it.each(cases)("$industry $size seed $seed: jobs are booked across the next two weeks", ({ industry, size, seed }) => {
    const d = gen(industry, seed, 1, size);
    const asOfEnd = Date.parse(`${d.meta.asOf}T23:59:59Z`);
    const upcoming = d.jobs.filter((j) => j.status === "scheduled" && Date.parse(j.scheduledStart) > asOfEnd && Date.parse(j.scheduledStart) <= asOfEnd + 16 * DAY_MS);
    expect(upcoming.length).toBeGreaterThanOrEqual(size === "small" ? 3 : 8);
    expect(new Set(upcoming.map((j) => j.scheduledStart.slice(0, 10))).size).toBeGreaterThanOrEqual(size === "small" ? 2 : 5);
    const active = new Set(d.customers.filter((c) => c.status === "active").map((c) => c.id));
    for (const j of upcoming) {
      expect(active.has(j.customerId), `${j.id} customer active`).toBe(true);
      expect(d.events.some((e) => e.type === "JobScheduled" && e.subjectId === j.id), `${j.id} JobScheduled`).toBe(true);
      expect(d.tasks.some((t) => t.status === "open" && t.relatedIds.includes(j.id)), `${j.id} has an open task`).toBe(true);
    }
  });

  it.each(cases)("$industry $size seed $seed: every job fits in a working day and staff have free slots", ({ industry, size, seed }) => {
    const d = gen(industry, seed, 1, size);
    for (const j of d.jobs) expect(Date.parse(j.scheduledEnd) - Date.parse(j.scheduledStart), j.title).toBeLessThanOrEqual(9 * 3_600_000);
    const asOfEnd = Date.parse(`${d.meta.asOf}T23:59:59Z`);
    const open = d.jobs.filter((j) => j.status === "scheduled" || j.status === "in-progress");
    for (const e of d.employees.filter((x) => x.active)) {
      const mine = open.filter((j) => j.assigneeIds.includes(e.id));
      let freeDays = 0;
      for (let k = 1; k <= 14; k++) {
        const dayStart = asOfEnd + 1000 + (k - 1) * DAY_MS;
        const busy = mine.filter((j) => Date.parse(j.scheduledStart) < dayStart + DAY_MS && Date.parse(j.scheduledEnd) > dayStart);
        const bookedMs = busy.reduce((s, j) => s + Date.parse(j.scheduledEnd) - Date.parse(j.scheduledStart), 0);
        if (bookedMs <= 6 * 3_600_000) freeDays++;
      }
      expect(freeDays, `${e.name} (${e.role}) has room on most days`).toBeGreaterThanOrEqual(10);
    }
  });

  it.each(cases)("$industry $size seed $seed: reschedule anomalies target upcoming jobs", ({ industry, size, seed }) => {
    const d = gen(industry, seed, 1, size);
    const asOfEnd = Date.parse(`${d.meta.asOf}T23:59:59Z`);
    const targets = d.anomalies.filter((a) => a.kind === "reschedule-not-propagated");
    expect(targets.length).toBeGreaterThan(0);
    for (const a of targets) {
      const job = d.jobs.find((j) => j.id === a.recordIds[0])!;
      expect(job.status).toBe("scheduled");
      expect(Date.parse(job.scheduledStart)).toBeGreaterThan(asOfEnd);
    }
  });
});

describe("small datasets", () => {
  it.each(IDS.flatMap((industry) => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((seed) => [industry, seed] as [IndustryId, number])))(
    "%s seed %i: every anomaly kind appears and holds",
    (industry, seed) => {
      const d = gen(industry, seed, 1, "small");
      for (const kind of KINDS) expect(d.anomalies.some((a) => a.kind === kind), `${kind} missing`).toBe(true);
      for (const a of d.anomalies) expect(CHECKERS[a.kind](d, a), a.description).toBeNull();
      expect(integrityProblems(d)).toEqual([]);
    },
  );

  it("low messiness still covers every kind", () => {
    const d = generate({ industry: "home-services", seed: 4, size: "small", messiness: 0.1 });
    for (const kind of KINDS) expect(d.anomalies.some((a) => a.kind === kind), `${kind} missing`).toBe(true);
  });
});

describe("event contract", () => {
  it.each(IDS)("%s: lifecycle transitions have matching events", (industry) => {
    const d = gen(industry, 42, 1);
    const has = (type: string, id: string) => d.events.some((e) => e.type === type && e.subjectId === id);
    for (const l of d.leads.filter((x) => x.status === "disqualified")) {
      expect(has("LeadDisqualified", l.id)).toBe(true);
      expect(has("LeadContacted", l.id)).toBe(false);
    }
    expect(d.events.some((e) => e.type === "LeadContacted" && e.data.outcome === "disqualified")).toBe(false);
    for (const q of d.quotes.filter((x) => x.status === "expired")) expect(has("QuoteExpired", q.id), q.number).toBe(true);
    for (const j of d.jobs) {
      const started = j.status === "in-progress" || j.completedAt !== null;
      expect(has("JobStarted", j.id), j.id).toBe(started);
    }
    expect(d.events.some((e) => e.type === "LeadDisqualified")).toBe(true);
    expect(d.events.some((e) => e.type === "QuoteExpired")).toBe(true);
  });

  it.each(IDS)("%s: repeat leads read like returning customers", (industry) => {
    const d = gen(industry, 42, 1);
    const P = PROFILES[industry];
    const repeatTexts = new Set(P.offerings.flatMap((o) => o.repeatRequests ?? []));
    const newTexts = new Set(P.offerings.flatMap((o) => o.requests));
    const repeats = d.leads.filter((l) => l.source === "repeat");
    expect(repeats.length).toBeGreaterThan(0);
    for (const l of repeats) {
      expect(repeatTexts.has(l.request), l.request).toBe(true);
      expect(newTexts.has(l.request), l.request).toBe(false);
    }
    for (const o of P.offerings.filter((x) => x.weight > 0 && !x.newOnly)) expect(o.repeatRequests?.length, o.key).toBeGreaterThan(0);
  });
});
