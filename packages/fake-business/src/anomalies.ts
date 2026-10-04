/**
 * Anomalies injected after the clean simulation. Each injector mutates the
 * world so the labeled condition really holds, and never touches a record
 * already involved in another anomaly.
 */
import type { Plan } from "./plan.js";
import type { Rng } from "./rng.js";
import type { AnomalyKind, Contact, Invoice, LeadSource } from "./schema.js";
import { DAY, MIN, dayStart, toDate } from "./time.js";
import { NICKNAMES, MAIL_DOMAINS } from "./words.js";
import { ref, usd, type World } from "./world.js";

export type Quotas = Readonly<Record<AnomalyKind, number>>;

function day(iso: string): number {
  return dayStart(Date.parse(iso));
}

function typo(name: string): string {
  if (name.length < 4) return `${name}e`;
  const i = Math.floor(name.length / 2);
  return name.slice(0, i) + name.charAt(i + 1) + name.charAt(i) + name.slice(i + 2);
}

function altPhone(phone: string): string {
  // "(312) 555-0147" → "312-555-0147": same number, different formatting.
  return phone.replace(/^\((\d{3})\) /, "$1-");
}

export function injectPostAnomalies(w: World, plan: Plan, rng: Rng, quotas: Quotas, used: Set<string>): void {
  const P = w.P;
  const endDay = dayStart(w.endMs);
  const take = (ids: string[]): void => ids.forEach((id) => used.add(id));
  const free = (...ids: Array<string | null>): boolean => ids.every((id) => id === null || !used.has(id));
  let spare = 0;
  const nextSpare = () => plan.spares[spare++ % Math.max(1, plan.spares.length)];
  const count = (kind: AnomalyKind): number => w.d.anomalies.filter((a) => a.kind === kind).length;

  // duplicate-contact
  const duplicateContact = (quotas: Quotas): void => {
    const pool = rng.shuffle(w.d.contacts.filter((c) => c.customerId && c.email && c.phone && free(c.id, c.customerId)));
    let placed = 0;
    for (const orig of pool) {
      if (placed >= quotas["duplicate-contact"]) break;
      const nick = NICKNAMES[orig.firstName] ?? typo(orig.firstName);
      const fromDay = Math.max(w.startMs, day(orig.createdAt) + 20 * DAY);
      if (fromDay > endDay - 3 * DAY) continue;
      const t = w.clock.staffMoment(w.clock.nextOpenDay(fromDay + rng.int(0, Math.floor((endDay - 3 * DAY - fromDay) / DAY)) * DAY), rng);
      if (t > w.endMs) continue;
      const domain = P.customerKind === "business" ? (orig.email as string).split("@")[1] : rng.pick(MAIL_DOMAINS.filter((d) => !orig.email?.endsWith(d)));
      const dup = w.addContact(
        {
          first: nick,
          last: rng.chance(0.3) ? orig.lastName.toLowerCase() : orig.lastName,
          email: `${nick.toLowerCase().replace(/[^a-z]/g, "")}.${orig.lastName.toLowerCase().replace(/[^a-z]/g, "")}@${domain}`,
          phone: altPhone(orig.phone as string),
          address: { line1: "", city: "", region: "", postalCode: "", country: "US" },
          title: orig.title,
        },
        t,
        rng.chance(0.5) ? orig.customerId : null,
      );
      w.message({
        channel: "email",
        direction: "inbound",
        threadId: w.ids.next("thr"),
        t,
        contact: dup,
        employee: null,
        subject: "Question",
        body: `Hi, it's ${nick} ${orig.lastName}. ${rng.pick(P.customerQuestions)}`,
        relatedIds: [],
      });
      take([dup.id, orig.id]);
      placed++;
      w.anomaly(
        "duplicate-contact",
        [dup.id, orig.id],
        `Contact "${dup.firstName} ${dup.lastName}" (${dup.email}) created ${toDate(t)} duplicates existing contact "${orig.firstName} ${orig.lastName}" (${orig.email}) — same phone number ${orig.phone}.`,
        null,
      );
    }
  };

  // missed-call-no-callback: a new caller nobody ever calls back.
  const missedCall = (quotas: Quotas): void => {
    for (let i = 0; i < quotas["missed-call-no-callback"]; i++) {
    const p = nextSpare();
    if (!p) break;
    const t = w.clock.staffMoment(w.clock.nextOpenDay(endDay - rng.int(3, 16) * DAY), rng);
    if (t > w.endMs) continue;
    const contact = w.addContact(p, t, null);
    const vm = rng.chance(0.7);
    const transcript = rng.pick(P.voicemails);
    const call = w.call({
      direction: "inbound",
      t,
      contact,
      employee: null,
      durationSec: vm ? rng.int(18, 55) : 0,
      outcome: vm ? "voicemail" : "missed",
      summary: vm ? `Voicemail: "${transcript}"` : null,
    });
    take([call.id, contact.id]);
    w.anomaly(
      "missed-call-no-callback",
      [call.id, contact.id],
      `${vm ? "Voicemail" : "Missed call"} from ${contact.firstName} ${contact.lastName} (${contact.phone}) on ${toDate(t)} was never returned — no call or message back.`,
      null,
    );
    }
  };

  // lead-never-contacted
  const neverContacted = (quotas: Quotas): void => {
    for (let i = 0; i < quotas["lead-never-contacted"]; i++) {
    const p = nextSpare();
    if (!p) break;
    const t = w.clock.customerMoment(endDay - rng.int(3, 21) * DAY, rng);
    const offering = rng.weighted(
      P.offerings.filter((o) => o.weight > 0),
      (o) => o.weight,
    );
    const source: LeadSource = rng.pick(["web-form", "google-ads", "email"] as const);
    const contact = w.addContact(p, t, null);
    const request = rng.pick(offering.requests);
    const owner = rng.chance(0.5) ? rng.pick(w.active(P.salesRoles)) : null;
    const lead = {
      id: w.ids.next("lead"),
      contactId: contact.id,
      source,
      createdAt: w.iso(t),
      request,
      status: "new" as const,
      firstResponseAt: null,
      ownerId: owner?.id ?? null,
      dealId: null,
    };
    w.d.leads.push(lead);
    w.event("LeadCreated", t, lead.id, contact.id, { source, offering: offering.title });
    const msg = w.message({
      channel: "email",
      direction: "inbound",
      threadId: w.ids.next("thr"),
      t,
      contact,
      employee: null,
      subject: source === "web-form" ? `Website inquiry: ${offering.title}` : offering.title,
      body: `Hi,\n\n${request}\n\nThanks,\n${contact.firstName} ${contact.lastName}\n${contact.phone}`,
      relatedIds: [lead.id],
    });
    take([lead.id, contact.id, msg.id]);
    w.anomaly(
      "lead-never-contacted",
      [lead.id, contact.id, msg.id],
      `${source === "web-form" ? "Web-form" : source === "google-ads" ? "Google Ads" : "Email"} lead from ${contact.firstName} ${contact.lastName} on ${toDate(t)} about ${offering.title.charAt(0).toLowerCase() + offering.title.slice(1)} has never been contacted${owner ? "" : " and has no owner"}.`,
      null,
    );
    }
  };

  // invoice-wrong-job
  const wrongJob = (quotas: Quotas): void => {
    const jobs = new Map(w.d.jobs.map((j) => [j.id, j]));
    const customers = new Map(w.d.customers.map((c) => [c.id, c]));
    const pool = rng.shuffle(w.d.invoices.filter((i) => i.jobId && free(i.id, i.jobId)));
    let n = 0;
    for (const inv of pool) {
      if (n >= quotas["invoice-wrong-job"]) break;
      const right = jobs.get(inv.jobId as string);
      if (!right || !free(inv.id, right.id)) continue;
      const wrongPool = w.d.jobs.filter((j) => j.customerId !== inv.customerId && j.status === "completed" && free(j.id));
      if (wrongPool.length === 0) break;
      const wrong = rng.pick(wrongPool);
      inv.jobId = wrong.id;
      take([inv.id, wrong.id, right.id]);
      n++;
      w.anomaly(
        "invoice-wrong-job",
        [inv.id, wrong.id, right.id],
        `Invoice ${ref(inv.id)} for ${customers.get(inv.customerId)?.name} is linked to job "${wrong.title}" for ${customers.get(wrong.customerId)?.name} instead of their own job "${right.title}".`,
        inv.totalCents,
      );
    }
  };

  // unmatched-payment: a payment that lost its link to the invoice it pays.
  const unmatched = (quotas: Quotas): void => {
    const byInvoice = new Map<string, number>();
    for (const p of w.d.payments) if (p.invoiceId) byInvoice.set(p.invoiceId, (byInvoice.get(p.invoiceId) ?? 0) + 1);
    const invoices = new Map(w.d.invoices.map((i) => [i.id, i]));
    const customers = new Map(w.d.customers.map((c) => [c.id, c]));
    // Prefer a payment that settled its invoice alone; fall back to one installment of a split payment.
    const pool = rng
      .shuffle(w.d.payments.filter((p) => p.invoiceId && invoices.get(p.invoiceId)?.status === "paid" && free(p.id, p.invoiceId)))
      .sort((a, b) => Number(byInvoice.get(a.invoiceId as string) !== 1) - Number(byInvoice.get(b.invoiceId as string) !== 1));
    let n = 0;
    for (const pay of pool) {
      if (n >= quotas["unmatched-payment"]) break;
      if (!free(pay.id, pay.invoiceId)) continue;
      n++;
      const inv = invoices.get(pay.invoiceId as string) as Invoice;
      pay.invoiceId = null;
      if (rng.chance(0.7)) pay.customerId = null;
      inv.paidCents -= pay.amountCents;
      inv.status = inv.paidCents > 0 ? "partially-paid" : "open";
      const evt = w.d.events.find((e) => e.type === "PaymentReceived" && e.subjectId === pay.id);
      if (evt) evt.data = { ...evt.data, invoiceId: null };
      // The business never matched it, so it never sent a receipt either.
      const receipts = new Set(w.d.messages.filter((m) => m.relatedIds.includes(pay.id)).map((m) => m.id));
      w.d.messages = w.d.messages.filter((m) => !receipts.has(m.id));
      w.d.events = w.d.events.filter((e) => !receipts.has(e.subjectId));
      take([pay.id, inv.id]);
      w.anomaly(
        "unmatched-payment",
        [pay.id, inv.id],
        `A ${pay.method} payment of ${usd(pay.amountCents)} received ${pay.receivedAt.slice(0, 10)} (ref "${pay.reference}") is not linked to any invoice; it most likely pays ${ref(inv.id)} for ${customers.get(inv.customerId)?.name}, which still shows ${usd(inv.totalCents - inv.paidCents)} unpaid.`,
        pay.amountCents,
      );
    }
  };

  // conflicting-status
  const conflicting = (quotas: Quotas): void => {
    const quotesByDeal = new Map<string, string[]>();
    for (const q of w.d.quotes) if (q.status === "accepted") quotesByDeal.set(q.dealId, [...(quotesByDeal.get(q.dealId) ?? []), q.id]);
    const dealPool = rng.shuffle(w.d.deals.filter((d) => d.stage === "won" && quotesByDeal.has(d.id) && free(d.id, ...(quotesByDeal.get(d.id) ?? []))));
    const invPool = rng.shuffle(w.d.invoices.filter((i) => i.status === "open" && i.paidCents === 0 && free(i.id)));
    const paidInvoiceByJob = new Map(w.d.invoices.filter((i) => i.jobId && i.status === "paid").map((i) => [i.jobId as string, i]));
    const jobPool = rng.shuffle(w.d.jobs.filter((j) => j.status === "completed" && paidInvoiceByJob.has(j.id) && free(j.id, paidInvoiceByJob.get(j.id)?.id ?? null)));
    let placed = 0;
    while (placed < quotas["conflicting-status"] && (dealPool.length > 0 || invPool.length > 0 || jobPool.length > 0)) {
      // Rotate variants: deal lost despite acceptance → invoice paid with no payment → job canceled after being paid.
      const order = [dealPool, invPool, jobPool];
      const pool = [0, 1, 2].map((k) => order[(placed + k) % 3] as unknown[]).find((p) => p.length > 0);
      if (pool === jobPool) {
        const job = jobPool.shift();
        const inv = job ? paidInvoiceByJob.get(job.id) : undefined;
        if (!job || !inv || !free(job.id, inv.id)) continue;
        const t = w.clock.staffMoment(w.clock.nextOpenDay(dayStart(w.endMs) - rng.int(3, 30) * DAY), rng);
        if (t > w.endMs || w.iso(t) <= (job.completedAt as string)) continue;
        job.status = "canceled";
        w.event("JobCanceled", t, job.id, job.assigneeIds[0] ?? null, { reason: "canceled in error" });
        take([job.id, inv.id]);
        w.anomaly(
          "conflicting-status",
          [job.id, inv.id],
          `Job "${job.title}" is marked canceled, yet it was completed on ${(job.completedAt as string).slice(0, 10)} and invoice ${ref(inv.id)} for it was paid in full.`,
          null,
        );
        placed++;
      } else if (pool === dealPool) {
        const deal = dealPool.shift();
        if (!deal) break;
        const quoteId = (quotesByDeal.get(deal.id) ?? [])[0] as string;
        const quote = w.d.quotes.find((q) => q.id === quoteId);
        const jobIds = w.d.jobs.filter((j) => j.quoteId === quoteId).map((j) => j.id);
        const t = w.clock.staffAfter(Math.max(day(deal.closedAt as string) + DAY + 9 * 60 * MIN, dayStart(w.endMs) - rng.int(5, 60) * DAY), 0, 60 * 24 * 3, rng);
        if (t > w.endMs) continue;
        deal.stage = "lost";
        deal.lostReason = "Chose another provider";
        deal.updatedAt = w.iso(t);
        w.event("DealStageChanged", t, deal.id, deal.ownerId, { from: "won", to: "lost", reason: deal.lostReason });
        take([deal.id, quoteId, ...jobIds]);
        w.anomaly(
          "conflicting-status",
          [deal.id, quoteId, ...jobIds],
          `Deal "${deal.title}" is marked lost ("Chose another provider") even though ${P.nouns.quote} ${ref(quoteId)} was accepted and work was booked.`,
          quote?.totalCents ?? deal.amountCents,
        );
        placed++;
      } else {
        if (pool !== invPool) break;
        const inv = invPool.shift();
        if (!inv) break;
        inv.status = "paid";
        take([inv.id]);
        w.anomaly(
          "conflicting-status",
          [inv.id, inv.customerId],
          `Invoice ${ref(inv.id)} is marked paid but has no payments recorded; ${usd(inv.totalCents)} is actually outstanding.`,
          inv.totalCents,
        );
        placed++;
      }
    }
  };

  // missing-contact-info: prefer contacts the business needs to reach soon.
  const missingInfo = (quotas: Quotas): void => {
    const needsReach = new Set<string>();
    for (const i of w.d.invoices) if (i.status === "open" || i.status === "partially-paid") needsReach.add(i.customerId);
    for (const j of w.d.jobs) if (j.status === "scheduled") needsReach.add(j.customerId);
    const pool = rng
      .shuffle(w.d.contacts.filter((c) => c.customerId && c.email && c.phone && free(c.id)))
      .sort((a, b) => Number(needsReach.has(b.customerId as string)) - Number(needsReach.has(a.customerId as string)));
    const customers = new Map(w.d.customers.map((c) => [c.id, c]));
    const already = count("missing-contact-info");
    pool.slice(0, quotas["missing-contact-info"]).forEach((c: Contact, i) => {
      const variant = (already + i) % 3;
      let what: string;
      if (variant === 0) {
        c.email = null;
        what = "no email address on file";
      } else if (variant === 1) {
        c.email = (c.email as string).replace("@", "");
        what = `a malformed email address ("${c.email}")`;
      } else {
        c.phone = null;
        what = "no phone number on file";
      }
      take([c.id]);
      w.anomaly(
        "missing-contact-info",
        [c.id, c.customerId as string],
        `Contact ${c.firstName} ${c.lastName}${P.customerKind === "business" ? ` (${customers.get(c.customerId as string)?.name})` : ""} has ${what}, so reminders and invoices can't reach them.`,
        null,
      );
    });
  };

  // Two passes: one of each kind first, so a scarce record type (small runs) is
  // never used up by another kind's larger quota; then the rest of each quota.
  const injectors: Array<[AnomalyKind, (q: Quotas) => void]> = [
    ["duplicate-contact", duplicateContact],
    ["missed-call-no-callback", missedCall],
    ["lead-never-contacted", neverContacted],
    ["invoice-wrong-job", wrongJob],
    ["unmatched-payment", unmatched],
    ["conflicting-status", conflicting],
    ["missing-contact-info", missingInfo],
  ];
  const firstPass = Object.fromEntries(Object.entries(quotas).map(([k, v]) => [k, Math.min(1, v)])) as unknown as Quotas;
  for (const [, inject] of injectors) inject(firstPass);
  for (const [kind, inject] of injectors) {
    const left = quotas[kind] - count(kind);
    if (left > 0) inject({ ...quotas, [kind]: left });
  }
}
