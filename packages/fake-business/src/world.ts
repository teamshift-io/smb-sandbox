/**
 * The mutable simulation state for one run, plus the per-chain helpers that
 * write records. A chain is one causal storyline (a lead, a recall cycle, a
 * customer question); every write goes through a time guard so nothing ever
 * happens after `asOf`.
 */
import type { IndustryProfile, LinePick, Offering } from "./industries/types.js";
import type { Person, Plan } from "./plan.js";
import { Rng, fmix32, hash32 } from "./rng.js";
import type {
  Anomaly,
  AnomalyKind,
  BusinessEvent,
  BusinessEventType,
  Call,
  Company,
  Contact,
  Customer,
  Dataset,
  Employee,
  EmployeeRole,
  Invoice,
  Job,
  LineItem,
  Message,
  Task,
} from "./schema.js";
import { DAY, MIN, dayStart, fmtDate as fmtDateLocal, fmtWhen as fmtWhenLocal, toDate, type Clock } from "./time.js";

export const STOP = Symbol("stop");

export type Collections = Omit<Dataset, "meta" | "company">;

export interface Flags {
  ghostQuote?: boolean;
  staleDeal?: boolean;
  unpaidInvoice?: boolean;
  /** Index (within the chain) of the job whose reschedule is not propagated. */
  brokenReschedule?: number;
}

export interface Trace {
  isNewLead?: boolean;
  quoteSentAt?: number;
  dealAt?: number;
  firstInvoiceDue?: number;
  jobs?: Array<{ reschedAt: number; start: number }>;
}

export class Ids {
  private counts = new Map<string, number>();
  constructor(private readonly salt: number) {}

  next(prefix: string): string {
    const k = (this.counts.get(prefix) ?? 0) + 1;
    this.counts.set(prefix, k);
    const v = fmix32((k + hash32(this.salt, prefix)) >>> 0);
    return `${prefix}_${v.toString(36).padStart(7, "0")}`;
  }
}

export function usd(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** Placeholder for a human-facing number (quote/invoice) resolved at the end. */
export function ref(id: string): string {
  return `{{#${id}}}`;
}

export function total(lines: readonly LineItem[]): number {
  return lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
}

export function fullName(c: { firstName: string; lastName: string }): string {
  return `${c.firstName} ${c.lastName}`;
}

export interface ExistingRecord {
  customer: Customer;
  contacts: Contact[];
  owner: Employee;
}

export class World {
  readonly d: Collections = {
    employees: [],
    customers: [],
    contacts: [],
    leads: [],
    deals: [],
    quotes: [],
    jobs: [],
    invoices: [],
    payments: [],
    messages: [],
    calls: [],
    tasks: [],
    events: [],
    anomalies: [],
  };
  readonly ids: Ids;
  readonly evSeq = new Map<string, number>();
  /** Local creation time of quotes/invoices, for human numbering. */
  readonly created = new Map<string, number>();
  readonly company: Company;
  readonly existing: ExistingRecord[] = [];
  /** Customers already given a forward-schedule booking. */
  readonly bookedAhead = new Set<string>();
  readonly P: IndustryProfile;
  readonly clock: Clock;
  readonly endMs: number;
  readonly startMs: number;
  private seq = 0;

  constructor(readonly plan: Plan) {
    this.P = plan.P;
    this.clock = plan.clock;
    this.endMs = plan.endMs;
    this.startMs = plan.startMs;
    this.ids = new Ids(hash32(plan.seed, plan.P.id, "ids"));
    const domain = `${plan.slug}.example`;
    this.company = {
      id: this.ids.next("co"),
      name: plan.companyName,
      industry: plan.P.id,
      description: plan.P.companyDescription,
      timezone: plan.clock.tz,
      currency: "USD",
      phone: plan.companyPhone,
      email: `${plan.P.customerKind === "business" ? "hello" : "office"}@${domain}`,
      website: `https://www.${domain}`,
      address: plan.companyAddress,
      paymentTermsDays: plan.P.paymentTermsDays,
      policies: plan.P.policies.map((p) => ({ id: this.ids.next("pol"), title: p.title, rule: p.rule })),
    };
    for (const e of plan.employees) {
      this.d.employees.push({
        id: this.ids.next("emp"),
        name: `${e.first} ${e.last}`,
        email: e.email,
        phone: e.phone,
        role: e.role,
        hiredOn: e.hiredOn,
        active: e.active,
      });
    }
    const salesPool = this.active(plan.P.salesRoles);
    const rng = new Rng(hash32(plan.seed, plan.P.id, "existing"));
    for (const ex of plan.existing) {
      const owner = rng.pick(salesPool);
      const customer: Customer = {
        id: this.ids.next("cus"),
        kind: plan.P.customerKind,
        name: ex.businessName ?? `${ex.person.first} ${ex.person.last}`,
        address: ex.person.address,
        createdAt: this.clock.iso(ex.createdAt),
        source: ex.source,
        status: "active",
        ownerId: owner.id,
        tags: ex.recurringDue !== null ? [...ex.tags, this.planTag()].sort() : ex.tags,
      };
      this.d.customers.push(customer);
      const contacts = [ex.person, ex.second]
        .filter((p): p is Person => p !== null)
        .map((p, i) => this.addContact(p, ex.createdAt + i * 37 * DAY, customer.id));
      this.existing.push({ customer, contacts, owner });
    }
  }

  planTag(): string {
    return this.P.id === "dental-clinic" ? "recall-6mo" : "maintenance-plan";
  }

  active(roles: readonly EmployeeRole[]): Employee[] {
    const pool = this.d.employees.filter((e) => e.active && roles.includes(e.role));
    if (pool.length > 0) return pool;
    return this.d.employees.filter((e) => e.active && e.role === "owner");
  }

  iso(t: number): string {
    return this.clock.iso(t);
  }

  addContact(p: Person, t: number, customerId: string | null): Contact {
    const c: Contact = {
      id: this.ids.next("con"),
      customerId,
      firstName: p.first,
      lastName: p.last,
      email: p.email,
      phone: p.phone,
      title: p.title,
      createdAt: this.iso(Math.min(t, this.endMs)),
    };
    this.d.contacts.push(c);
    return c;
  }

  event(type: BusinessEventType, t: number, subjectId: string, actorId: string | null, data: Record<string, unknown>): BusinessEvent {
    const e: BusinessEvent = { id: this.ids.next("evt"), type, at: this.iso(t), subjectId, actorId, data };
    this.evSeq.set(e.id, this.seq++);
    this.d.events.push(e);
    return e;
  }

  anomaly(kind: AnomalyKind, recordIds: string[], description: string, amountAtRiskCents: number | null): void {
    this.d.anomalies.push({ id: this.ids.next("anm"), kind, recordIds, description, amountAtRiskCents } satisfies Anomaly);
  }

  message(o: {
    channel: Message["channel"];
    direction: Message["direction"];
    threadId: string;
    t: number;
    contact: Contact;
    employee: Employee | null;
    subject: string | null;
    body: string;
    relatedIds: string[];
  }): Message {
    const companySide = o.channel === "email" ? (o.employee?.email ?? this.company.email) : this.company.phone;
    const contactSide = (o.channel === "email" ? o.contact.email : o.contact.phone) ?? o.contact.phone ?? "";
    const outbound = o.direction === "outbound";
    const m: Message = {
      id: this.ids.next("msg"),
      channel: o.channel,
      direction: o.direction,
      threadId: o.threadId,
      from: outbound ? companySide : contactSide,
      to: [outbound ? contactSide : companySide],
      subject: o.channel === "email" ? o.subject : null,
      body: o.body,
      sentAt: this.iso(o.t),
      contactId: o.contact.id,
      employeeId: o.employee?.id ?? null,
      relatedIds: o.relatedIds,
      read: outbound || o.t < this.endMs - DAY,
    };
    this.d.messages.push(m);
    this.event(outbound ? "MessageSent" : "MessageReceived", o.t, m.id, outbound ? (o.employee?.id ?? null) : o.contact.id, {
      channel: m.channel,
      threadId: m.threadId,
      relatedIds: m.relatedIds,
    });
    return m;
  }

  call(o: {
    direction: Call["direction"];
    t: number;
    contact: Contact;
    employee: Employee | null;
    durationSec: number;
    outcome: Call["outcome"];
    summary: string | null;
  }): Call {
    const contactPhone = o.contact.phone ?? "unknown";
    const companyPhone = this.company.phone;
    const c: Call = {
      id: this.ids.next("call"),
      direction: o.direction,
      from: o.direction === "inbound" ? contactPhone : companyPhone,
      to: o.direction === "inbound" ? companyPhone : contactPhone,
      startedAt: this.iso(o.t),
      durationSec: o.durationSec,
      outcome: o.outcome,
      contactId: o.contact.id,
      employeeId: o.employee?.id ?? null,
      summary: o.summary,
    };
    this.d.calls.push(c);
    if (o.direction === "inbound" && o.outcome !== "answered") {
      this.event("CallMissed", o.t, c.id, o.contact.id, { outcome: o.outcome, from: c.from });
    }
    return c;
  }

  task(o: { t: number; title: string; assignee: Employee | null; dueOn: string | null; relatedIds: string[] }): Task {
    const task: Task = {
      id: this.ids.next("task"),
      title: o.title,
      assigneeId: o.assignee?.id ?? null,
      dueOn: o.dueOn,
      status: "open",
      createdAt: this.iso(o.t),
      completedAt: null,
      relatedIds: o.relatedIds,
    };
    this.d.tasks.push(task);
    this.event("TaskCreated", o.t, task.id, o.assignee?.id ?? null, { title: o.title, dueOn: o.dueOn });
    return task;
  }

  closeTask(task: Task, t: number, status: "done" | "canceled" = "done"): void {
    task.status = status;
    task.completedAt = status === "done" ? this.iso(t) : null;
    this.event("TaskCompleted", t, task.id, task.assigneeId, { status });
  }
}

export interface ScheduledJob {
  job: Job;
  task: Task;
  confirmation: Message;
  start: number;
  end: number;
}

/** One causal storyline with its own random stream. */
export class Chain {
  readonly jobs: ScheduledJob[] = [];
  private invoices = 0;
  private jobCount = 0;

  constructor(
    readonly w: World,
    readonly rng: Rng,
    readonly flags: Flags,
    readonly trace: Trace,
  ) {}

  get clock(): Clock {
    return this.w.clock;
  }

  /** Main-line guard: stops the chain if `t` is after asOf. */
  step(t: number): number {
    if (t > this.w.endMs) throw STOP;
    return t;
  }

  /** Side-branch guard: true if `t` can still happen. */
  ok(t: number): boolean {
    return t <= this.w.endMs;
  }

  pick(roles: readonly EmployeeRole[]): Employee {
    return this.rng.pick(this.w.active(roles));
  }

  crew(roles: readonly EmployeeRole[]): Employee[] {
    const chosen: Employee[] = [];
    for (const role of roles) {
      const pool = this.w.active([role]).filter((e) => !chosen.includes(e));
      if (pool.length > 0) chosen.push(this.rng.pick(pool));
    }
    if (chosen.length === 0) chosen.push(this.pick(["owner"]));
    return chosen;
  }

  lines(o: Offering): LineItem[] {
    const P = this.w.P;
    const groups = new Map<string, LinePick>();
    const groupNames = [...new Set(o.lines.filter((l) => l.group).map((l) => l.group as string))];
    for (const g of groupNames) {
      const choice = this.rng.weighted(
        o.lines.filter((l) => l.group === g),
        (l) => l.p ?? 1,
      );
      groups.set(g, choice);
    }
    const out: LineItem[] = [];
    for (const l of o.lines) {
      const include = l.group ? groups.get(l.group) === l : this.rng.chance(l.p ?? 1);
      if (!include) continue;
      const item = P.catalog.find((c) => c.sku === l.sku);
      if (!item) throw new Error(`Unknown SKU ${l.sku} in ${P.id}`);
      out.push({ sku: item.sku, description: item.description, quantity: this.rng.range(l.qty), unitPriceCents: item.unitPriceCents });
    }
    return out;
  }

  sms(contact: Contact): boolean {
    return this.w.P.customerKind === "household" && contact.phone !== null;
  }

  /** Preserve legacy fixtures; calibrated libraries require an available crew. */
  private availableStart(start: number, duration: number, crewIds: readonly string[], ignoreId?: string): number {
    if (!this.w.plan.enforceStaffAvailability) return start;
    for (let attempts = 0; attempts < 3650; attempts++) {
      const begin = this.w.iso(start);
      const end = this.w.iso(start + duration);
      const busy = this.w.d.jobs.some((job) => job.id !== ignoreId && job.status !== "canceled" && job.status !== "no-show" &&
        job.scheduledStart < end && job.scheduledEnd > begin && job.assigneeIds.some((id) => crewIds.includes(id)));
      if (!busy) return start;
      start = this.clock.nextOpenDay(dayStart(start) + DAY) + (start - dayStart(start));
    }
    throw new RangeError("No available crew slot within ten years");
  }

  /** Book a job: creates the job, the assignee's task and a confirmation. */
  scheduleJob(o: {
    t: number;
    customer: Customer;
    contact: Contact;
    title: string;
    start: number;
    end: number;
    crew: Employee[];
    quoteId: string | null;
    threadId: string;
    actor: Employee;
  }): ScheduledJob {
    const { w, rng } = this;
    const P = w.P;
    const duration = o.end - o.start;
    const start = this.availableStart(o.start, duration, o.crew.map((employee) => employee.id));
    o = { ...o, start, end: start + duration };
    const job: Job = {
      id: w.ids.next("job"),
      customerId: o.customer.id,
      quoteId: o.quoteId,
      title: o.title,
      status: "scheduled",
      scheduledStart: w.iso(o.start),
      scheduledEnd: w.iso(o.end),
      assigneeIds: o.crew.map((e) => e.id),
      completedAt: null,
      notes: rng.chance(0.45) ? rng.pick(P.jobNotes) : null,
    };
    w.d.jobs.push(job);
    w.event("JobScheduled", o.t, job.id, o.actor.id, { scheduledStart: job.scheduledStart, assigneeIds: job.assigneeIds, quoteId: o.quoteId });
    const when = fmtWhenLocal(o.start);
    const lead = o.crew[0] as Employee;
    const task = w.task({
      t: o.t,
      title: `${P.customerKind === "business" ? "Meeting" : "Visit"}: ${o.title} — ${o.customer.name}, ${when}`,
      assignee: lead,
      dueOn: toDate(o.start),
      relatedIds: [job.id, o.customer.id],
    });
    const useSms = this.sms(o.contact);
    const confirmation = w.message({
      channel: useSms ? "sms" : "email",
      direction: "outbound",
      threadId: useSms ? w.ids.next("thr") : o.threadId,
      t: o.t + 2 * MIN,
      contact: o.contact,
      employee: o.actor,
      subject: `Confirmed: ${o.title}, ${when}`,
      body: useSms
        ? `${w.company.name}: your ${P.nouns.job} is confirmed for ${when}. ${P.confirmNote} Reply C to confirm or call ${w.company.phone} to change.`
        : `Hi ${o.contact.firstName},\n\nYou're confirmed: ${o.title} starts ${when} with ${o.crew.map((e) => e.name).join(", ")}. ${P.confirmNote}\n\nTalk soon,\n${o.actor.name}\n${w.company.name}`,
      relatedIds: [job.id],
    });
    const sj: ScheduledJob = { job, task, confirmation, start: o.start, end: o.end };
    this.jobs.push(sj);

    // Reschedule decision: always drawn so the random stream stays aligned.
    const index = this.jobCount++;
    const cleanReschedule = rng.chance(0.08);
    const reschedAt = this.clock.addBusinessDays(o.t, 1, rng);
    const shiftDays = rng.int(1, 3);
    (this.trace.jobs ??= []).push({ reschedAt, start: o.start });
    const broken = this.flags.brokenReschedule === index;
    if ((broken || cleanReschedule) && reschedAt < o.start - 2 * 60 * MIN && this.ok(reschedAt)) {
      this.reschedule(sj, reschedAt, shiftDays, broken, o.contact, o.actor);
    }
    return sj;
  }

  private reschedule(sj: ScheduledJob, t: number, shiftDays: number, broken: boolean, contact: Contact, actor: Employee): void {
    const { w } = this;
    const oldStart = sj.start;
    const newDay = this.clock.addBusinessDays(oldStart, shiftDays, this.rng);
    const requestedStart = dayStart(newDay) + (oldStart - dayStart(oldStart));
    const newStart = this.availableStart(requestedStart, sj.end - sj.start, sj.job.assigneeIds, sj.job.id);
    const newEnd = newStart + (sj.end - sj.start);
    const from = sj.job.scheduledStart;
    sj.start = newStart;
    sj.end = newEnd;
    sj.job.scheduledStart = w.iso(newStart);
    sj.job.scheduledEnd = w.iso(newEnd);
    w.event("JobRescheduled", t, sj.job.id, actor.id, { from, to: sj.job.scheduledStart, reason: this.rng.pick(["customer request", "crew availability", "parts delay"]) });
    if (broken) {
      w.anomaly(
        "reschedule-not-propagated",
        [sj.job.id, sj.task.id, sj.confirmation.id],
        `Job "${sj.job.title}" was moved from ${fmtWhenLocal(oldStart)} to ${fmtWhenLocal(newStart)}, but the assignee's task and the ${w.P.nouns.customer}'s confirmation still show the old time.`,
        null,
      );
      return;
    }
    const when = fmtWhenLocal(newStart);
    sj.task.title = sj.task.title.replace(fmtWhenLocal(oldStart), when);
    sj.task.dueOn = toDate(newStart);
    const useSms = this.sms(contact);
    w.message({
      channel: useSms ? "sms" : "email",
      direction: "outbound",
      threadId: sj.confirmation.threadId,
      t,
      contact,
      employee: actor,
      subject: `Updated time: ${sj.job.title}`,
      body: useSms
        ? `${w.company.name}: your ${w.P.nouns.job} has moved to ${when}. Sorry for the change — reply with any questions.`
        : `Hi ${contact.firstName},

A quick update: ${sj.job.title} now starts ${when} instead of ${fmtWhenLocal(oldStart)}. Sorry for the change — reply with any questions.

${actor.name}
${w.company.name}`,
      relatedIds: [sj.job.id],
    });
  }

  completeJob(sj: ScheduledJob): number {
    const t = this.step(sj.end - this.rng.int(0, 20) * MIN);
    this.w.event("JobStarted", sj.start, sj.job.id, sj.job.assigneeIds[0] ?? null, { scheduledStart: sj.job.scheduledStart });
    sj.job.status = "completed";
    sj.job.completedAt = this.w.iso(t);
    this.w.event("JobCompleted", t, sj.job.id, sj.job.assigneeIds[0] ?? null, { durationMin: Math.round((sj.end - sj.start) / MIN) });
    if (sj.task.status === "open") this.w.closeTask(sj.task, t);
    return t;
  }

  /** Issue an invoice and (on a side branch) collect payment. */
  invoice(o: {
    t: number;
    customer: Customer;
    contact: Contact;
    jobId: string | null;
    lines: LineItem[];
    actor: Employee;
    threadId: string;
  }): Invoice {
    const { w } = this;
    const issued = dayStart(o.t);
    const due = issued + w.P.paymentTermsDays * DAY;
    const inv: Invoice = {
      id: w.ids.next("inv"),
      customerId: o.customer.id,
      jobId: o.jobId,
      number: "",
      status: "open",
      lineItems: o.lines,
      totalCents: total(o.lines),
      issuedOn: toDate(issued),
      dueOn: toDate(due),
      paidCents: 0,
    };
    w.d.invoices.push(inv);
    w.created.set(inv.id, o.t);
    w.event("InvoiceIssued", o.t, inv.id, o.actor.id, { customerId: o.customer.id, jobId: o.jobId, totalCents: inv.totalCents, dueOn: inv.dueOn });
    w.message({
      channel: "email",
      direction: "outbound",
      threadId: o.threadId,
      t: o.t + MIN,
      contact: o.contact,
      employee: o.actor,
      subject: `Invoice ${ref(inv.id)} from ${w.company.name}`,
      body: `Hi ${o.contact.firstName},\n\nThank you for your business. Invoice ${ref(inv.id)} for ${usd(inv.totalCents)} is due ${fmtDateLocal(due)}.\n\n${o.lines.map((l) => `- ${l.description} x${l.quantity}: ${usd(l.quantity * l.unitPriceCents)}`).join("\n")}\n\n${w.P.invoiceNote}\n\n${o.actor.name}\n${w.company.name}`,
      relatedIds: [inv.id, ...(o.jobId ? [o.jobId] : [])],
    });
    this.collect(inv, o, due);
    return inv;
  }

  private collect(inv: Invoice, o: { t: number; contact: Contact; actor: Employee; threadId: string; customer: Customer }, due: number): void {
    const { w, rng } = this;
    const first = this.invoices++ === 0;
    if (first) this.trace.firstInvoiceDue = due;
    const overdueAt = this.clock.nextOpenDay(due + DAY) + (8 * 60 + rng.int(0, 45)) * MIN;
    if (first && this.flags.unpaidInvoice && this.ok(overdueAt)) {
      w.event("InvoiceOverdue", overdueAt, inv.id, null, { dueOn: inv.dueOn, balanceCents: inv.totalCents });
      const remind = this.clock.addBusinessDays(overdueAt, rng.int(2, 6), rng);
      if (rng.chance(0.5) && this.ok(remind)) {
        w.message({
          channel: "email",
          direction: "outbound",
          threadId: o.threadId,
          t: remind,
          contact: o.contact,
          employee: o.actor,
          subject: `Reminder: invoice ${ref(inv.id)} is past due`,
          body: `Hi ${o.contact.firstName},\n\nA friendly reminder that invoice ${ref(inv.id)} for ${usd(inv.totalCents)} was due ${fmtDateLocal(due)}. If you've already sent payment, thank you — please disregard.\n\n${o.actor.name}`,
          relatedIds: [inv.id],
        });
      }
      w.anomaly(
        "overdue-invoice",
        [inv.id, inv.customerId],
        `Invoice ${ref(inv.id)} for ${o.customer.name} (${usd(inv.totalCents)}) was due ${inv.dueOn} and nothing has been paid.`,
        inv.totalCents,
      );
      return;
    }
    const methods = Object.keys(w.P.paymentMethods) as Array<keyof typeof w.P.paymentMethods>;
    const latest = Math.max(0, w.P.paymentTermsDays - 2);
    const installments = rng.chance(0.15) && latest >= 6 ? 2 : 1;
    const amounts = installments === 2 ? [Math.round(inv.totalCents / 200) * 100, 0] : [inv.totalCents];
    if (installments === 2) amounts[1] = inv.totalCents - (amounts[0] as number);
    const offsets = installments === 2 ? [rng.int(0, Math.floor(latest / 2)), 0] : [rng.int(0, latest)];
    if (installments === 2) offsets[1] = rng.int((offsets[0] as number) + 1, latest);
    const method = rng.weighted(methods, (m) => w.P.paymentMethods[m] ?? 0);
    for (let i = 0; i < installments; i++) {
      const day = dayStart(o.t) + (offsets[i] as number) * DAY;
      const t = Math.max(o.t + 30 * MIN, day + rng.int(9 * 60, 16 * 60) * MIN);
      if (!this.ok(t)) return;
      const amount = amounts[i] as number;
      const pay = {
        id: w.ids.next("pay"),
        invoiceId: inv.id,
        customerId: inv.customerId,
        amountCents: amount,
        method,
        receivedAt: w.iso(t),
        reference: paymentReference(method, rng),
      };
      w.d.payments.push(pay);
      inv.paidCents += amount;
      inv.status = inv.paidCents >= inv.totalCents ? "paid" : "partially-paid";
      w.event("PaymentReceived", t, pay.id, o.contact.id, { invoiceId: inv.id, amountCents: amount, method });
      if (rng.chance(0.4)) {
        w.message({
          channel: "email",
          direction: "outbound",
          threadId: o.threadId,
          t: this.clock.staffAfter(t, 5, 90, rng),
          contact: o.contact,
          employee: o.actor,
          subject: `Receipt for ${ref(inv.id)}`,
          body: `Hi ${o.contact.firstName}, we received your ${method === "ach" ? "ACH" : method} payment of ${usd(amount)} for invoice ${ref(inv.id)}. ${inv.status === "paid" ? "Your balance is now $0.00." : `Remaining balance: ${usd(inv.totalCents - inv.paidCents)}.`} Thank you!`,
          relatedIds: [pay.id, inv.id],
        });
      }
    }
  }
}

export function paymentReference(method: string, rng: Rng): string {
  switch (method) {
    case "card":
      return `CARD ****${rng.int(1000, 9999)} AUTH ${rng.int(100000, 999999)}`;
    case "ach":
      return `ACH TRACE ${rng.int(10000000, 99999999)}`;
    case "check":
      return `CHK #${rng.int(1001, 9899)}`;
    default:
      return `CASH RCPT ${String(rng.int(1, 9999)).padStart(4, "0")}`;
  }
}
