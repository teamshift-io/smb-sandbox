import type { Dataset, Invoice, Message } from "@teamshift/fake-business";
import { context } from "../src/lib/context.js";
import type { GradeState } from "../src/lib/state.js";
import { balance, missedCallTargets, overdueBuckets, quoteFollowUpTargets, type MissedCallTarget, type QuoteTarget } from "../src/lib/targets.js";
import { digits, includesCI, includesToken, mentionsMoney, money } from "../src/lib/text.js";
import { commonChecks, Grader, type VerifyResult } from "../src/lib/verify-kit.js";

export interface BriefFacts {
  overdue: Invoice[];
  overdueTotal: number;
  /** Past due but covered by an unapplied payment: must not be listed. */
  notReallyOverdue: Invoice[];
  missed: MissedCallTarget[];
  quotes: QuoteTarget[];
  quotesTotal: number;
}

export function briefFacts(ds: Dataset): BriefFacts {
  const { chase, covered } = overdueBuckets(ds, 1);
  const quotes = quoteFollowUpTargets(ds);
  return {
    overdue: chase,
    overdueTotal: chase.reduce((s, i) => s + balance(i), 0),
    notReallyOverdue: covered,
    missed: missedCallTargets(ds),
    quotes,
    quotesTotal: quotes.reduce((s, q) => s + q.quote.totalCents, 0),
  };
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function statesCount(text: string, count: number): boolean {
  const lines = text.split(/\r?\n|(?<=[.;])\s+/).filter((l) => /missed|voicemail|unreturned|call/i.test(l));
  const word = NUMBER_WORDS[count];
  return lines.some((l) => new RegExp(`(^|[^\\d$.,])${count}(?![\\d,.]\\d)`).test(l) || (!!word && new RegExp(`\\b${word}\\b`, "i").test(l)) || (count === 0 && /\bno\b|\bnone\b/i.test(l)));
}

export function verify(initial: Dataset, state: GradeState): VerifyResult {
  const g = new Grader();
  const { owner } = context(initial);
  const f = briefFacts(initial);
  const toOwner = (m: Message) => m.channel === "email" && m.to.length === 1 && m.to[0]!.toLowerCase() === owner.email.toLowerCase();
  const briefs = state.outbox.filter(toOwner);
  const brief = briefs[0];
  const text = brief ? `${brief.subject ?? ""}\n${brief.body}` : "";

  g.check("one-brief-to-owner", briefs.length === 1, `${briefs.length} email(s) to ${owner.name} <${owner.email}>; expected exactly one`);
  g.check("overdue-total", !!brief && mentionsMoney(text, f.overdueTotal, 100), `expected ${money(f.overdueTotal)} across ${f.overdue.length} invoice(s)`);
  const missingInv = f.overdue.filter((i) => !includesToken(text, i.number));
  g.check("overdue-invoices-listed", !!brief && missingInv.length === 0, brief ? (missingInv.length ? `missing ${missingInv.map((i) => i.number).join(", ")}` : `all ${f.overdue.length} listed`) : "no brief");
  const padded = f.notReallyOverdue.filter((i) => includesToken(text, i.number));
  g.check("covered-invoices-left-out", !!brief && padded.length === 0, brief ? (padded.length ? `listed although an unapplied payment covers it: ${padded.map((i) => i.number).join(", ")}` : `${f.notReallyOverdue.length} covered invoice(s) correctly left out`) : "no brief");
  g.check("missed-call-count", !!brief && statesCount(text, f.missed.length), `expected a line about missed calls stating ${f.missed.length}`);
  const missingCallers = f.missed.filter(({ call, contact }) => !(contact && includesCI(text, `${contact.firstName} ${contact.lastName}`)) && !digits(text).includes(digits(call.from)));
  g.check("missed-callers-listed", !!brief && missingCallers.length === 0, brief ? (missingCallers.length ? `missing ${missingCallers.map(({ call, contact }) => (contact ? `${contact.firstName} ${contact.lastName}` : call.from)).join(", ")}` : `all ${f.missed.length} listed`) : "no brief");
  g.check("quotes-at-risk-total", !!brief && mentionsMoney(text, f.quotesTotal, 100), `expected ${money(f.quotesTotal)} across ${f.quotes.length} ${context(initial).terms.quote}(s)`);
  const missingQ = f.quotes.filter((q) => !includesToken(text, q.quote.number));
  g.check("quotes-at-risk-listed", !!brief && missingQ.length === 0, brief ? (missingQ.length ? `missing ${missingQ.map((q) => q.quote.number).join(", ")}` : `all ${f.quotes.length} listed`) : "no brief");

  commonChecks(g, initial, state, {
    scope: {},
    outboxAllowed: toOwner,
    outboxRule: `only the brief to ${owner.name}; no ${context(initial).terms.customer}s`,
  });
  return g.result();
}
