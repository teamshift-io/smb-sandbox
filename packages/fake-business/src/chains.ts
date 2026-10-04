/**
 * Storylines. Each function advances its own clock strictly forward, so every
 * record it writes is causally ordered: lead → response → deal → quote →
 * follow-ups → decision → job → invoice → payment.
 */
import type { Offering } from "./industries/types.js";
import type { ChainSpec, LeadPlan } from "./plan.js";
import type { Rng } from "./rng.js";
import type { Contact, Customer, Deal, DealStage, Employee, Lead, LineItem, Quote } from "./schema.js";
import { DAY, MIN, addMonths, dayStart, fmtDate, fmtWhen, monthName, toDate } from "./time.js";
import { Chain, STOP, World, ref, total, usd, type Flags, type ScheduledJob, type Trace } from "./world.js";

export function runChain(w: World, spec: ChainSpec, rng: Rng, flags: Flags): Trace {
  const trace: Trace = {};
  const c = new Chain(w, rng, flags, trace);
  try {
    if (spec.kind === "lead") runLead(c, spec.lead);
    else if (spec.kind === "recurring") {
      const ex = w.existing[spec.existing];
      const key = w.P.recurringOffering;
      if (ex && key) runRecurring(c, ex.customer, ex.contacts[0] as Contact, key, everyMonthsFor(w, key), spec.firstDue);
    } else if (spec.kind === "ahead") runAhead(c, spec);
    else runNoise(c, spec);
  } catch (e) {
    if (e !== STOP) throw e;
  }
  for (const sj of c.jobs) {
    if (sj.job.status === "scheduled" && sj.start <= w.endMs) {
      sj.job.status = "in-progress";
      w.event("JobStarted", sj.start, sj.job.id, sj.job.assigneeIds[0] ?? null, { scheduledStart: sj.job.scheduledStart });
    }
  }
  return trace;
}

function everyMonthsFor(w: World, key: string): number {
  return w.P.offerings.find((o) => o.recurring?.offering === key)?.recurring?.everyMonths ?? 6;
}

/** Lower-case a title's first letter for mid-sentence use, keeping acronyms ("AC system"). */
function lc(title: string): string {
  return /^[A-Z][A-Z]/.test(title) ? title : title.charAt(0).toLowerCase() + title.slice(1);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function leadSubject(source: LeadPlan["source"], title: string): string {
  switch (source) {
    case "web-form":
      return `Website inquiry: ${title}`;
    case "google-ads":
      return `Quote request: ${title}`;
    case "referral":
      return `Referred by a friend — ${title}`;
    default:
      return title;
  }
}

function runLead(c: Chain, plan: LeadPlan): void {
  const { w, rng } = c;
  const P = w.P;
  const o = plan.offering;
  const t0 = c.step(plan.arrival);
  const ex = plan.existing !== null ? (w.existing[plan.existing] ?? null) : null;
  c.trace.isNewLead = ex === null;
  const contact = ex ? rng.pick(ex.contacts) : w.addContact(plan.person!, t0, null);
  const owner = ex ? ex.owner : c.pick(P.salesRoles);
  const lead: Lead = {
    id: w.ids.next("lead"),
    contactId: contact.id,
    source: plan.source,
    createdAt: w.iso(t0),
    request: plan.request,
    status: "new",
    firstResponseAt: null,
    ownerId: owner.id,
    dealId: null,
  };
  w.d.leads.push(lead);
  w.event("LeadCreated", t0, lead.id, contact.id, { source: plan.source, offering: o.title });

  const thread = w.ids.next("thr");
  const subject = leadSubject(plan.source, o.title);
  let tResp: number;
  let channel: "call" | "in-person" | "email" | "sms";
  if (plan.source === "phone") {
    const dur = rng.int(120, 540);
    w.call({
      direction: "inbound",
      t: t0,
      contact,
      employee: owner,
      durationSec: dur,
      outcome: "answered",
      summary: `New ${P.nouns.customer} inquiry about ${lc(o.title)}: "${plan.request}"`,
    });
    tResp = t0 + Math.ceil(dur / 60) * MIN;
    channel = "call";
  } else if (plan.source === "walk-in") {
    tResp = t0 + rng.int(2, 10) * MIN;
    channel = "in-person";
  } else {
    channel = plan.source === "repeat" && c.sms(contact) && rng.chance(0.4) ? "sms" : "email";
    const referral = plan.source === "referral" ? `\n\nA friend of ours recommended you.` : "";
    w.message({
      channel,
      direction: "inbound",
      threadId: thread,
      t: t0,
      contact,
      employee: null,
      subject,
      body: channel === "sms" ? plan.request : `Hi,\n\n${plan.request}${referral}\n\nThanks,\n${contact.firstName} ${contact.lastName}\n${contact.phone ?? ""}`.trimEnd(),
      relatedIds: [lead.id],
    });
    tResp = c.clock.staffAfter(t0, 6, 240, rng);
  }
  c.step(tResp);
  lead.firstResponseAt = w.iso(tResp);
  const reply = (body: string): void => {
    if (channel !== "email" && channel !== "sms") return;
    w.message({
      channel,
      direction: "outbound",
      threadId: thread,
      t: tResp,
      contact,
      employee: owner,
      subject: `Re: ${subject}`,
      body: channel === "sms" ? body.split("\n\n")[1] ?? body : body,
      relatedIds: [lead.id],
    });
  };

  if (plan.fate === "disqualified") {
    const reason = rng.pick(P.disqualifyReasons);
    lead.status = "disqualified";
    w.event("LeadDisqualified", tResp, lead.id, owner.id, { reason, channel });
    reply(`Hi ${contact.firstName},\n\nThanks for reaching out to ${w.company.name}. Unfortunately this isn't something we can help with (${reason.toLowerCase()}), but we appreciate you thinking of us.\n\n${owner.name}`);
    return;
  }
  lead.status = "contacted";
  w.event("LeadContacted", tResp, lead.id, owner.id, { outcome: "contacted", channel });
  reply(`Hi ${contact.firstName},\n\nThanks for reaching out to ${w.company.name}. ${rng.pick(P.replyLines)}\n\n${owner.name}\n${w.company.name} · ${w.company.phone}`);

  // Consultation call, then the deal.
  const t2 = c.step(c.clock.staffAfter(tResp, 45, 60 * 24 * 2, rng));
  const consult = P.customerKind === "business" ? "Discovery call" : P.id === "dental-clinic" ? "Phone consult" : "Phone assessment";
  w.call({
    direction: "outbound",
    t: t2,
    contact,
    employee: owner,
    durationSec: rng.int(240, 1500),
    outcome: "answered",
    summary: `${consult}: discussed ${lc(o.title)}. Next step: ${o.quote ? `send ${P.nouns.quote}` : `book the ${P.nouns.job}`}.`,
  });
  const tDeal = c.step(t2 + MIN);
  let customer: Customer;
  if (ex) customer = ex.customer;
  else {
    const person = plan.person!;
    customer = {
      id: w.ids.next("cus"),
      kind: P.customerKind,
      name: plan.businessName ?? `${person.first} ${person.last}`,
      address: person.address,
      createdAt: w.iso(tDeal),
      source: plan.source,
      status: "active",
      ownerId: owner.id,
      tags: o.recurring ? [...plan.tags, w.planTag()].sort() : plan.tags,
    };
    w.d.customers.push(customer);
    contact.customerId = customer.id;
  }
  const lines = c.lines(o);
  const amount = total(lines);
  const deal: Deal = {
    id: w.ids.next("deal"),
    customerId: customer.id,
    contactId: contact.id,
    title: `${o.title} — ${customer.name}`,
    stage: "qualified",
    amountCents: amount,
    ownerId: owner.id,
    createdAt: w.iso(tDeal),
    updatedAt: w.iso(tDeal),
    closedAt: null,
    lostReason: null,
    nextAction: {
      summary: o.quote ? `Send ${P.nouns.quote} to ${contact.firstName}` : `Book ${P.nouns.job} with ${contact.firstName}`,
      dueOn: toDate(c.clock.addBusinessDays(tDeal, 2, rng)),
    },
  };
  w.d.deals.push(deal);
  lead.status = "converted";
  lead.dealId = deal.id;
  w.event("DealCreated", tDeal, deal.id, owner.id, { leadId: lead.id, customerId: customer.id, stage: "qualified", amountCents: amount });
  c.trace.dealAt = tDeal;

  if (c.flags.staleDeal) {
    w.anomaly(
      "stale-deal",
      [deal.id, contact.id],
      `Deal "${deal.title}" (${usd(amount)}) has sat in stage "qualified" since ${toDate(tDeal)}; its next step was due ${deal.nextAction?.dueOn} and nobody has touched it since.`,
      amount,
    );
    return;
  }

  const setStage = (t: number, stage: DealStage, extra: Record<string, unknown> = {}): void => {
    const from = deal.stage;
    deal.stage = stage;
    deal.updatedAt = w.iso(t);
    if (stage === "won" || stage === "lost") {
      deal.closedAt = w.iso(t);
      deal.nextAction = null;
    }
    w.event("DealStageChanged", t, deal.id, owner.id, { from, to: stage, ...extra });
  };
  const customerEmail = (t: number, body: string, related: string[]): void => {
    w.message({ channel: "email", direction: "inbound", threadId: thread, t, contact, employee: null, subject: `Re: ${subject}`, body, relatedIds: related });
  };

  if (plan.fate === "lost-early") {
    const tl = c.step(c.clock.addBusinessDays(tDeal, rng.int(2, 6), rng));
    customerEmail(tl, `Hi ${owner.name.split(" ")[0]},\n\n${rng.pick(P.declineTexts)}\n\n${contact.firstName}`, [deal.id]);
    const reason = rng.pick(P.lostReasons);
    deal.lostReason = reason;
    setStage(tl + 3 * MIN, "lost", { reason });
    return;
  }

  let tWon: number;
  let quote: Quote | null = null;
  if (o.quote) {
    const tq = c.step(c.clock.addBusinessDays(tDeal, rng.int(1, 3), rng));
    const expires = dayStart(tq) + P.quoteValidDays * DAY;
    const q: Quote = {
      id: w.ids.next("quo"),
      dealId: deal.id,
      customerId: customer.id,
      number: "",
      status: "sent",
      lineItems: lines,
      totalCents: amount,
      createdAt: w.iso(tq - rng.int(5, 25) * MIN),
      sentAt: w.iso(tq),
      expiresOn: toDate(expires),
      followUps: [],
    };
    quote = q;
    w.d.quotes.push(q);
    w.created.set(q.id, tq);
    w.message({
      channel: "email",
      direction: "outbound",
      threadId: thread,
      t: tq,
      contact,
      employee: owner,
      subject: `Your ${P.nouns.quote} ${ref(q.id)} from ${w.company.name}`,
      body: `Hi ${contact.firstName},\n\nAs promised, here is ${P.nouns.quote} ${ref(q.id)} for ${lc(o.title)}.\n\n${lines.map((l) => `- ${l.description} x${l.quantity}: ${usd(l.quantity * l.unitPriceCents)}`).join("\n")}\n\nTotal: ${usd(amount)}. Valid through ${fmtDate(expires)}.\n\n${P.quoteNote}\n\nReply to approve or with any questions.\n\n${owner.name}\n${w.company.name}`,
      relatedIds: [q.id, deal.id],
    });
    w.event("QuoteSent", tq, q.id, owner.id, { dealId: deal.id, totalCents: amount, expiresOn: q.expiresOn });
    const followDue = toDate(c.clock.addBusinessDays(tq, 3, rng));
    setStage(tq, "quote-sent");
    deal.nextAction = { summary: `Follow up on ${P.nouns.quote} ${ref(q.id)}`, dueOn: followDue };
    c.trace.quoteSentAt = tq;

    if (c.flags.ghostQuote) {
      deal.nextAction = null;
      const tExpired = c.clock.nextOpenDay(expires + DAY) + (8 * 60 + rng.int(0, 45)) * MIN;
      if (c.ok(tExpired)) {
        q.status = "expired";
        w.event("QuoteExpired", tExpired, q.id, null, { dealId: deal.id, expiresOn: q.expiresOn });
      }
      w.anomaly(
        "quote-not-followed-up",
        [q.id, deal.id, contact.id],
        `${cap(P.nouns.quote)} ${ref(q.id)} for ${customer.name} (${usd(amount)}) was sent ${toDate(tq)} and never followed up; ${q.status === "expired" ? `it expired ${q.expiresOn}` : `it expires ${q.expiresOn}`} with no decision recorded.`,
        amount,
      );
      return;
    }

    const fuTask = w.task({
      t: tq + MIN,
      title: `Follow up on ${P.nouns.quote} ${ref(q.id)} — ${customer.name}`,
      assignee: owner,
      dueOn: followDue,
      relatedIds: [q.id, deal.id],
    });
    const followUp = (t: number, n: number): void => {
      if (rng.chance(0.5)) {
        w.message({
          channel: "email",
          direction: "outbound",
          threadId: thread,
          t,
          contact,
          employee: owner,
          subject: `Re: Your ${P.nouns.quote} ${ref(q.id)}`,
          body: `Hi ${contact.firstName},\n\nJust checking in on ${P.nouns.quote} ${ref(q.id)} (${usd(amount)}) that I sent on ${fmtDate(tq)}. Any questions I can answer?\n\n${owner.name}`,
          relatedIds: [q.id, deal.id],
        });
      } else {
        const answered = rng.chance(0.55);
        w.call({
          direction: "outbound",
          t,
          contact,
          employee: owner,
          durationSec: answered ? rng.int(120, 600) : rng.int(20, 45),
          outcome: answered ? "answered" : "voicemail",
          summary: answered
            ? `Followed up on ${ref(q.id)}; ${contact.firstName} is still deciding.`
            : `Left voicemail following up on ${ref(q.id)}.`,
        });
      }
      q.followUps.push(w.iso(t));
      deal.updatedAt = w.iso(t);
      w.event("QuoteFollowedUp", t, q.id, owner.id, { followUp: n });
    };

    const tf = c.step(c.clock.addBusinessDays(tq, rng.int(2, 4), rng));
    followUp(tf, 1);
    w.closeTask(fuTask, tf + 2 * MIN);
    deal.nextAction = { summary: `Get a decision on ${ref(q.id)}`, dueOn: toDate(c.clock.addBusinessDays(tf, 4, rng)) };
    let tLast = tf + 2 * MIN;

    if (plan.fate === "won" && rng.chance(0.35)) {
      const tn = c.step(c.clock.customerAfter(tLast, 60, 60 * 24 * 2, rng));
      customerEmail(tn, rng.pick(P.questionTexts), [q.id]);
      const tr = c.step(c.clock.staffAfter(tn, 20, 300, rng));
      w.message({
        channel: "email",
        direction: "outbound",
        threadId: thread,
        t: tr,
        contact,
        employee: owner,
        subject: `Re: ${subject}`,
        body: `Hi ${contact.firstName},\n\nGood question — yes, I've noted that on ${ref(q.id)} and I'm happy to walk through the details on a quick call.\n\n${owner.name}`,
        relatedIds: [q.id],
      });
      setStage(tr, "negotiation");
      tLast = tr;
    }

    if (plan.fate === "won") {
      const ta = c.step(Math.min(c.clock.customerAfter(tLast, 120, 60 * 24 * 5, rng), expires + 10 * 60 * MIN));
      customerEmail(ta, rng.pick(P.acceptTexts), [q.id]);
      q.status = "accepted";
      w.event("QuoteAccepted", ta, q.id, contact.id, { dealId: deal.id });
      tWon = c.step(c.clock.staffAfter(ta, 10, 180, rng));
      setStage(tWon, "won");
    } else if (plan.fate === "decline") {
      const td = c.step(c.clock.customerAfter(tLast, 240, 60 * 24 * 6, rng));
      customerEmail(td, rng.pick(P.declineTexts), [q.id]);
      q.status = "declined";
      w.event("QuoteDeclined", td, q.id, contact.id, { dealId: deal.id });
      const tl = c.step(c.clock.staffAfter(td, 10, 240, rng));
      deal.lostReason = rng.pick(P.lostReasons);
      setStage(tl, "lost", { reason: deal.lostReason });
      return;
    } else {
      const tf2 = c.step(c.clock.addBusinessDays(tf, rng.int(4, 7), rng));
      followUp(tf2, 2);
      const tx = c.step(c.clock.nextOpenDay(expires + DAY) + (8 * 60 + rng.int(0, 60)) * MIN);
      q.status = "expired";
      w.event("QuoteExpired", tx, q.id, null, { dealId: deal.id, expiresOn: q.expiresOn });
      deal.lostReason = `No response before the ${P.nouns.quote} expired`;
      setStage(tx, "lost", { reason: deal.lostReason });
      return;
    }
  } else {
    tWon = c.step(c.clock.staffAfter(tDeal, 5, 120, rng));
    setStage(tWon, "won");
  }

  doWork(c, { o, customer, contact, owner, quote, lines, tBooked: tWon, thread });
}

function splitVisits(lines: LineItem[], visits: number): LineItem[][] {
  if (visits <= 1) return [lines];
  const out: LineItem[][] = Array.from({ length: visits }, () => []);
  if (lines.length >= visits) {
    const per = Math.ceil(lines.length / visits);
    lines.forEach((l, i) => out[Math.min(visits - 1, Math.floor(i / per))]?.push(l));
    return out;
  }
  // Fewer lines than visits: split quantities, or bill everything on the last visit.
  for (const l of lines) {
    if (l.quantity >= visits) {
      let left = l.quantity;
      for (let v = 0; v < visits; v++) {
        const q = v === visits - 1 ? left : Math.floor(l.quantity / visits);
        left -= q;
        out[v]?.push({ ...l, quantity: q });
      }
    } else out[visits - 1]?.push(l);
  }
  return out;
}

function doWork(
  c: Chain,
  a: { o: Offering; customer: Customer; contact: Contact; owner: Employee; quote: Quote | null; lines: LineItem[]; tBooked: number; thread: string },
): void {
  const { w, rng } = c;
  const P = w.P;
  const { o, customer, contact, owner, quote, lines, thread } = a;
  const business = P.customerKind === "business";
  const actor = business ? owner : c.pick(P.schedulerRoles);
  const billing = w.active(["bookkeeper"]).length > 0 && rng.chance(0.7) ? c.pick(["bookkeeper"]) : actor;
  const crew = c.crew(o.crew);
  const ts0 = c.step(c.clock.staffAfter(a.tBooked, 10, 240, rng));

  if (o.billing === "monthly") {
    runRetainer(c, { ...a, crew, actor, billing, ts0 });
    return;
  }
  if (o.durationDays) {
    runProject(c, { ...a, crew, actor, billing, ts0 });
    return;
  }

  const visits = o.visits ?? 1;
  const perVisit = splitVisits(lines, visits);
  let ts = ts0;
  let depositCents = 0;
  let lastDone = ts0;
  for (let v = 0; v < visits; v++) {
    const title = o.visitTitles?.[v] ?? o.title;
    const dur = rng.range(o.durationMin ?? [60, 60]);
    const gap = v === 0 ? rng.range(o.leadTimeDays) : rng.int(10, 20);
    const start = c.clock.jobSlot(dayStart(c.clock.addBusinessDays(ts, gap, rng)), dur, rng);
    const end = start + dur * MIN;
    const sj = c.scheduleJob({ t: ts, customer, contact, title, start, end, crew, quoteId: quote?.id ?? null, threadId: thread, actor });
    if (v === 0 && o.billing === "deposit-and-final") {
      depositCents = Math.round(total(lines) / 200) * 100;
      c.invoice({
        t: ts + 5 * MIN,
        customer,
        contact,
        jobId: sj.job.id,
        lines: [{ sku: "DEPOSIT", description: `50% deposit${quote ? ` on ${P.nouns.quote} ${ref(quote.id)}` : ""}`, quantity: 1, unitPriceCents: depositCents }],
        actor: billing,
        threadId: thread,
      });
    }
    const tc = c.completeJob(sj);
    const ti = c.step(c.clock.staffAfter(tc, 15, 180, rng));
    const invLines =
      o.billing === "deposit-and-final"
        ? [...lines, { sku: "DEPOSIT-CREDIT", description: "Less deposit invoiced", quantity: 1, unitPriceCents: -depositCents }]
        : (perVisit[v] ?? []);
    if (invLines.length > 0) c.invoice({ t: ti, customer, contact, jobId: sj.job.id, lines: invLines, actor: billing, threadId: thread });
    ts = ti;
    lastDone = tc;
  }

  if (o.recurring) {
    const due = addMonths(dayStart(lastDone), o.recurring.everyMonths);
    runRecurring(c, customer, contact, o.recurring.offering, o.recurring.everyMonths, due);
  }
}

interface WorkContext {
  o: Offering;
  customer: Customer;
  contact: Contact;
  owner: Employee;
  quote: Quote | null;
  lines: LineItem[];
  thread: string;
  crew: Employee[];
  actor: Employee;
  billing: Employee;
  ts0: number;
}

/** Book one meeting-length job on `day`, never earlier than the open day after `notBefore`. */
function bookMeeting(c: Chain, a: WorkContext, title: string, t: number, day: number, notBefore: number): ScheduledJob {
  const dur = c.rng.range(a.o.durationMin ?? [60, 60]);
  const d = Math.max(day, c.clock.nextOpenDay(dayStart(notBefore) + DAY));
  const start = c.clock.jobSlot(d, dur, c.rng);
  return c.scheduleJob({
    t,
    customer: a.customer,
    contact: a.contact,
    title,
    start,
    end: start + dur * MIN,
    crew: a.crew,
    quoteId: a.quote?.id ?? null,
    threadId: a.thread,
    actor: a.actor,
  });
}

/**
 * A multi-week project is calendared as milestone meetings (kickoff, review,
 * delivery), not one job that blocks the crew for weeks. Each meeting is booked
 * when the previous one wraps up, so an in-flight project always has its next
 * meeting on the calendar and the crew is free in between.
 */
function runProject(c: Chain, a: WorkContext): void {
  const { w, rng } = c;
  const { o, lines } = a;
  const titles = o.milestones ?? [`${o.title} kickoff`, `${o.title} final review`];
  const sd = c.clock.nextOpenDay(dayStart(c.clock.addBusinessDays(a.ts0, rng.range(o.leadTimeDays), rng)));
  const ed = c.clock.nextOpenDay(sd + rng.range(o.durationDays ?? [30, 30]) * DAY);
  const n = titles.length;
  let tBook = a.ts0;
  let tc = a.ts0;
  let last: ScheduledJob | null = null;
  let depositCents = 0;
  for (let i = 0; i < n; i++) {
    const day = n === 1 ? ed : c.clock.nextOpenDay(sd + Math.round(((ed - sd) / DAY) * (i / (n - 1))) * DAY);
    const sj = bookMeeting(c, a, titles[i] as string, tBook, day, tBook);
    if (i === 0 && o.billing === "deposit-and-final") {
      depositCents = Math.round(total(lines) / 200) * 100;
      c.invoice({
        t: tBook + 5 * MIN,
        customer: a.customer,
        contact: a.contact,
        jobId: sj.job.id,
        lines: [{ sku: "DEPOSIT", description: `50% deposit${a.quote ? ` on ${w.P.nouns.quote} ${ref(a.quote.id)}` : ""}`, quantity: 1, unitPriceCents: depositCents }],
        actor: a.billing,
        threadId: a.thread,
      });
    }
    tc = c.completeJob(sj);
    last = sj;
    if (i < n - 1) tBook = c.step(tc + rng.int(5, 30) * MIN);
  }
  if (!last) return;
  const ti = c.step(c.clock.staffAfter(tc, 15, 180, rng));
  const invLines =
    o.billing === "deposit-and-final"
      ? [...lines, { sku: "DEPOSIT-CREDIT", description: "Less deposit invoiced", quantity: 1, unitPriceCents: -depositCents }]
      : lines;
  c.invoice({ t: ti, customer: a.customer, contact: a.contact, jobId: last.job.id, lines: invLines, actor: a.billing, threadId: a.thread });
}

/**
 * A retainer is a kickoff meeting, then one review meeting a month for the
 * committed term, each booked as the previous one ends. Each month is billed in
 * advance against that month's meeting.
 */
function runRetainer(c: Chain, a: WorkContext): void {
  const { rng } = c;
  const { o, lines } = a;
  const monthly = lines.find((l) => l.sku === o.monthlySku);
  if (!monthly) throw new Error(`Offering ${o.key} is missing its monthly SKU`);
  const term = monthly.quantity;
  const kickoff = o.milestones?.[0] ?? `${o.title} kickoff`;
  const review = o.milestones?.[1] ?? `${o.title} monthly review`;
  const startDay = c.clock.nextOpenDay(dayStart(c.clock.addBusinessDays(a.ts0, rng.range(o.leadTimeDays), rng)));
  const setup = lines.filter((l) => l !== monthly);
  let tBook = a.ts0;
  for (let m = 0; m < term; m++) {
    const day = c.clock.nextOpenDay(addMonths(startDay, m));
    const sj = bookMeeting(c, a, m === 0 ? kickoff : review, tBook, day, tBook);
    const ti = Math.max(tBook + 10 * MIN, c.clock.staffMoment(dayStart(sj.start), rng));
    if (!c.ok(ti)) break;
    const invLines: LineItem[] = [{ ...monthly, quantity: 1, description: `${monthly.description} — ${monthName(sj.start)}` }, ...(m === 0 ? setup : [])];
    c.invoice({ t: ti, customer: a.customer, contact: a.contact, jobId: sj.job.id, lines: invLines, actor: a.billing, threadId: a.thread });
    const tc = c.completeJob(sj);
    if (m < term - 1) tBook = c.step(tc + rng.int(5, 30) * MIN);
  }
}

/**
 * The forward schedule: an existing customer already booked for a visit in the
 * next two weeks. Booked a few days before asOf; the visit has not happened yet.
 */
function runAhead(c: Chain, spec: Extract<ChainSpec, { kind: "ahead" }>): void {
  const { w, rng } = c;
  const P = w.P;
  const asOfDay = dayStart(w.endMs);
  // Skip customers already booked (by this or another storyline). Every other storyline has run by now.
  const now = w.iso(w.endMs);
  const booked = new Set(w.d.jobs.filter((j) => j.status === "scheduled" && j.scheduledStart > now).map((j) => j.customerId));
  const used = w.bookedAhead;
  const open = (cu: Customer) => !used.has(cu.id) && !booked.has(cu.id);
  const established = w.existing.map((e) => e.customer).filter(open);
  const pool = established.length > 0 ? established : w.d.customers.filter(open);
  if (pool.length === 0) return;
  const customer = rng.pick(pool);
  used.add(customer.id);
  const ex = w.existing.find((e) => e.customer.id === customer.id);
  const contacts = ex?.contacts ?? w.d.contacts.filter((x) => x.customerId === customer.id);
  if (contacts.length === 0) return;
  const contact = rng.pick(contacts);
  const forPlan = P.bookedAhead.visits.filter((v) => v.forPlan);
  const kinds = customer.tags.includes(w.planTag()) && forPlan.length > 0 ? forPlan : P.bookedAhead.visits.filter((v) => !v.forPlan);
  const visit = rng.weighted(kinds, (v) => v.weight);
  const scheduler = P.customerKind === "business" ? (ex?.owner ?? c.pick(P.schedulerRoles)) : c.pick(P.schedulerRoles);

  let bookDay = asOfDay - rng.int(2, 12) * DAY;
  while (!c.clock.isOpen(bookDay)) bookDay -= DAY;
  const tBook = c.step(Math.max(w.startMs, c.clock.staffMoment(bookDay, rng)));
  const dur = rng.range(visit.durationMin);
  const day = c.clock.nextOpenDay(asOfDay + spec.dayOffset * DAY);
  // A fixed set of candidates keeps the random stream aligned; take the first one the crew is free for.
  const candidates = [0, 0, 1, 1, 2, 2].map((shift) => ({
    crew: c.crew(visit.crew),
    start: c.clock.jobSlot(c.clock.nextOpenDay(day + shift * DAY), dur, rng),
  }));
  const busy = (crew: Employee[], start: number): boolean => {
    const s = w.iso(start);
    const e = w.iso(start + dur * MIN);
    return w.d.jobs.some(
      (j) =>
        (j.status === "scheduled" || j.status === "in-progress") &&
        j.scheduledStart < e &&
        j.scheduledEnd > s &&
        j.assigneeIds.some((id) => crew.some((x) => x.id === id)),
    );
  };
  const slot = candidates.find((x) => !busy(x.crew, x.start)) ?? (candidates[0] as (typeof candidates)[number]);

  let t = tBook;
  if (P.customerKind === "household") {
    const durationSec = rng.int(90, 300);
    w.call({
      direction: "inbound",
      t,
      contact,
      employee: scheduler,
      durationSec,
      outcome: "answered",
      summary: `${contact.firstName} called to book ${lc(visit.title)}; booked for ${fmtWhen(slot.start)}.`,
    });
    t += Math.ceil(durationSec / 60) * MIN;
  }
  c.scheduleJob({
    t,
    customer,
    contact,
    title: visit.title,
    start: slot.start,
    end: slot.start + dur * MIN,
    crew: slot.crew,
    quoteId: null,
    threadId: w.ids.next("thr"),
    actor: scheduler,
  });
}

const RECALL_REPLIES = [
  "Yes please, mornings work best.",
  "Sure — any afternoon that week is fine.",
  "Can we do a little later in the month?",
  "Book me in, thanks!",
  "That works. Same time as last time if possible.",
];

function runRecurring(c: Chain, customer: Customer, contact: Contact, key: string, everyMonths: number, firstDue: number): void {
  const { w, rng } = c;
  const P = w.P;
  const o = P.offerings.find((x) => x.key === key);
  if (!o) throw new Error(`Unknown recurring offering ${key}`);
  let due = firstDue;
  for (let cycle = 0; cycle < 60; cycle++) {
    const tr = c.step(c.clock.staffMoment(c.clock.nextOpenDay(due - rng.int(14, 24) * DAY), rng));
    const scheduler = c.pick(P.schedulerRoles);
    const recallTask = w.task({
      t: tr,
      title: `Recall: schedule ${lc(o.title)} for ${customer.name}`,
      assignee: scheduler,
      dueOn: toDate(c.clock.addBusinessDays(tr, 3, rng)),
      relatedIds: [customer.id],
    });
    const thread = w.ids.next("thr");
    const useSms = c.sms(contact);
    w.message({
      channel: useSms ? "sms" : "email",
      direction: "outbound",
      threadId: thread,
      t: tr + MIN,
      contact,
      employee: scheduler,
      subject: `Time for your ${lc(o.title)}`,
      body: P.recallText.replace("{first}", contact.firstName).replace("{when}", fmtDate(due)),
      relatedIds: [customer.id],
    });
    if (rng.chance(0.08)) {
      const tx = c.step(c.clock.addBusinessDays(tr, 10, rng));
      w.closeTask(recallTask, tx, "canceled");
      return;
    }
    const replyAt = c.step(c.clock.customerAfter(tr, 30, 60 * 24 * 3, rng));
    w.message({
      channel: useSms ? "sms" : "email",
      direction: "inbound",
      threadId: thread,
      t: replyAt,
      contact,
      employee: null,
      subject: `Re: Time for your ${lc(o.title)}`,
      body: rng.pick(RECALL_REPLIES),
      relatedIds: [customer.id],
    });
    const ts = c.step(c.clock.staffAfter(replyAt, 5, 240, rng));
    const dur = rng.range(o.durationMin ?? [60, 60]);
    const day = dayStart(Math.max(due, c.clock.addBusinessDays(ts, rng.range(o.leadTimeDays), rng)));
    const start = c.clock.jobSlot(day, dur, rng);
    const sj = c.scheduleJob({
      t: ts,
      customer,
      contact,
      title: o.title,
      start,
      end: start + dur * MIN,
      crew: c.crew(o.crew),
      quoteId: null,
      threadId: thread,
      actor: scheduler,
    });
    w.closeTask(recallTask, ts + 3 * MIN);

    if (P.id === "dental-clinic" && rng.chance(0.06)) {
      const tns = c.step(sj.start + 20 * MIN);
      sj.job.status = "no-show";
      w.event("JobCanceled", tns, sj.job.id, scheduler.id, { reason: "no-show" });
      w.closeTask(sj.task, tns, "canceled");
      const rebook = w.task({
        t: tns + MIN,
        title: `Call ${contact.firstName} ${contact.lastName} to rebook missed ${P.nouns.job}`,
        assignee: scheduler,
        dueOn: toDate(c.clock.addBusinessDays(tns, 1, rng)),
        relatedIds: [sj.job.id, customer.id],
      });
      const tcb = c.step(c.clock.addBusinessDays(tns, 1, rng));
      w.call({ direction: "outbound", t: tcb, contact, employee: scheduler, durationSec: rng.int(20, 40), outcome: "voicemail", summary: `Left voicemail to rebook the missed ${P.nouns.job}.` });
      w.closeTask(rebook, tcb + MIN);
      due = dayStart(sj.start) + 30 * DAY;
      continue;
    }

    const tc = c.completeJob(sj);
    const ti = c.step(c.clock.staffAfter(tc, 10, 120, rng));
    const billing = w.active(["bookkeeper"]).length > 0 && rng.chance(0.5) ? c.pick(["bookkeeper"]) : scheduler;
    c.invoice({ t: ti, customer, contact, jobId: sj.job.id, lines: c.lines(o), actor: billing, threadId: thread });
    due = addMonths(dayStart(tc), everyMonths);
  }
}

function runNoise(c: Chain, spec: Extract<ChainSpec, { kind: "noise" }>): void {
  const { w, rng } = c;
  const P = w.P;
  const ex = w.existing[spec.existing];
  if (!ex) return;
  const contact = rng.pick(ex.contacts);
  const t = c.step(spec.start);
  const staff = rng.chance(0.5) ? ex.owner : c.pick(P.schedulerRoles);
  const question = rng.pick(P.customerQuestions);
  if (spec.type === "missed-call") {
    const vm = rng.chance(0.6);
    w.call({
      direction: "inbound",
      t,
      contact,
      employee: null,
      durationSec: vm ? rng.int(15, 50) : 0,
      outcome: vm ? "voicemail" : "missed",
      summary: vm ? `Voicemail: "${question}"` : null,
    });
    const tb = c.step(c.clock.staffAfter(t, 10, 180, rng));
    w.call({
      direction: "outbound",
      t: tb,
      contact,
      employee: staff,
      durationSec: rng.int(60, 400),
      outcome: "answered",
      summary: `Returned missed call from ${contact.firstName}. ${rng.pick(P.questionReplies)}`,
    });
    return;
  }
  const useSms = c.sms(contact) && rng.chance(0.5);
  const thread = w.ids.next("thr");
  w.message({ channel: useSms ? "sms" : "email", direction: "inbound", threadId: thread, t, contact, employee: null, subject: "Quick question", body: question, relatedIds: [ex.customer.id] });
  const ta = c.step(c.clock.staffAfter(t, 15, 300, rng));
  w.message({
    channel: useSms ? "sms" : "email",
    direction: "outbound",
    threadId: thread,
    t: ta,
    contact,
    employee: staff,
    subject: "Re: Quick question",
    body: `Hi ${contact.firstName}, ${rng.pick(P.questionReplies)}`,
    relatedIds: [ex.customer.id],
  });
}
