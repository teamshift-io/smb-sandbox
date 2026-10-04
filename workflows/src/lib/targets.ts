/**
 * Target selection shared by several workflows. Targets come from the
 * ground-truth `anomalies` of the INITIAL dataset, cross-checked against
 * record state so a label that no longer holds is never graded.
 */
import type { Call, Contact, Dataset, Deal, Invoice, Payment, Quote } from "@teamshift/fake-business";
import { context } from "./context.js";
import { dateInZone, daysBetween, DAY_MS } from "./time.js";
import { digits } from "./text.js";

export function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

function anomalyIds(ds: Dataset, kind: Dataset["anomalies"][number]["kind"]): string[][] {
  return ds.anomalies.filter((a) => a.kind === kind).map((a) => a.recordIds);
}

// ---------------------------------------------------------------- quotes

export interface QuoteTarget {
  quote: Quote;
  deal: Deal;
  contact: Contact;
}

/** Quotes sent 7+ days ago with no follow-up and no decision (including lapsed ones). */
export function quoteFollowUpTargets(ds: Dataset): QuoteTarget[] {
  const { startMs } = context(ds);
  const quotes = byId(ds.quotes);
  const deals = byId(ds.deals);
  const contacts = byId(ds.contacts);
  const out: QuoteTarget[] = [];
  for (const [quoteId] of anomalyIds(ds, "quote-not-followed-up")) {
    const quote = quotes.get(quoteId!);
    if (!quote || !["sent", "viewed", "expired"].includes(quote.status) || quote.followUps.length > 0) continue;
    if (!quote.sentAt || Date.parse(quote.sentAt) > startMs - 7 * DAY_MS) continue;
    const deal = deals.get(quote.dealId);
    const contact = deal ? contacts.get(deal.contactId) : undefined;
    if (deal && contact) out.push({ quote, deal, contact });
  }
  return out;
}

// ---------------------------------------------------------------- calls

export interface MissedCallTarget {
  call: Call;
  contact: Contact | null;
}

/** True when anyone called or messaged this caller back after the call. */
export function wasReturned(ds: Dataset, call: Call): boolean {
  const num = digits(call.from);
  return (
    ds.calls.some((c) => c.direction === "outbound" && c.startedAt > call.startedAt && ((call.contactId && c.contactId === call.contactId) || digits(c.to) === num)) ||
    ds.messages.some(
      (m) => m.direction === "outbound" && m.sentAt > call.startedAt && ((call.contactId && m.contactId === call.contactId) || m.to.some((t) => digits(t) === num)),
    )
  );
}

/** Missed inbound calls and voicemails nobody ever returned. */
export function missedCallTargets(ds: Dataset): MissedCallTarget[] {
  const calls = byId(ds.calls);
  const contacts = byId(ds.contacts);
  const out: MissedCallTarget[] = [];
  for (const [callId] of anomalyIds(ds, "missed-call-no-callback")) {
    const call = calls.get(callId!);
    if (!call || call.direction !== "inbound" || call.outcome === "answered" || wasReturned(ds, call)) continue;
    out.push({ call, contact: call.contactId ? (contacts.get(call.contactId) ?? null) : null });
  }
  return out;
}

// ---------------------------------------------------------------- invoices & payments

export function balance(i: Invoice): number {
  return i.totalCents - i.paidCents;
}

/**
 * Invoices an unapplied payment could pay: open or partially paid, balance
 * equal to the payment, same customer when the payment has one, and issued on
 * or before the day the payment arrived.
 */
export function paymentCandidates(ds: Dataset, pay: Payment): Invoice[] {
  const received = dateInZone(Date.parse(pay.receivedAt), ds.company.timezone);
  return ds.invoices.filter(
    (i) =>
      (i.status === "open" || i.status === "partially-paid") &&
      balance(i) === pay.amountCents &&
      (!pay.customerId || pay.customerId === i.customerId) &&
      i.issuedOn <= received,
  );
}

export interface OverdueBuckets {
  /** Past due by at least `minDaysPastDue` and not covered by an unapplied payment. */
  chase: Invoice[];
  /** Past due, but an unapplied payment matches the balance: do not chase, flag instead. */
  covered: Invoice[];
}

export function overdueBuckets(ds: Dataset, minDaysPastDue: number): OverdueBuckets {
  const unmatched = ds.payments.filter((p) => p.invoiceId === null);
  const coveredIds = new Set(unmatched.flatMap((p) => paymentCandidates(ds, p).map((i) => i.id)));
  const pastDue = ds.invoices.filter(
    (i) => (i.status === "open" || i.status === "partially-paid") && balance(i) > 0 && daysBetween(i.dueOn, ds.meta.asOf) >= minDaysPastDue,
  );
  return { chase: pastDue.filter((i) => !coveredIds.has(i.id)), covered: pastDue.filter((i) => coveredIds.has(i.id)) };
}

export interface PaymentTarget {
  payment: Payment;
  /** Ground truth: the invoice this payment pays. */
  invoice: Invoice;
  candidates: Invoice[];
  /** True when the records alone don't single out the right invoice. */
  ambiguous: boolean;
}

export function unmatchedPaymentTargets(ds: Dataset): PaymentTarget[] {
  const payments = byId(ds.payments);
  const invoices = byId(ds.invoices);
  const out: PaymentTarget[] = [];
  for (const [payId, invId] of anomalyIds(ds, "unmatched-payment")) {
    const payment = payments.get(payId!);
    const invoice = invoices.get(invId!);
    if (!payment || !invoice || payment.invoiceId !== null) continue;
    const candidates = paymentCandidates(ds, payment);
    out.push({ payment, invoice, candidates, ambiguous: candidates.length !== 1 || candidates[0]!.id !== invoice.id });
  }
  return out;
}
