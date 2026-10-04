import type { Dataset } from "@teamshift/fake-business";
import type { SandboxStore } from "@teamshift/sandbox-mcp";
import { cap, context } from "../src/lib/context.js";
import { balance, byId } from "../src/lib/targets.js";
import { money } from "../src/lib/text.js";
import { dateInZone } from "../src/lib/time.js";
import { briefFacts } from "./verify.js";

export function solve(store: SandboxStore, initial: Dataset): void {
  const { owner, today, tz, terms } = context(initial);
  const f = briefFacts(initial);
  const customers = byId(initial.customers);
  const lines = [
    `Good morning! Here's what needs attention today (${today}).`,
    "",
    `Overdue invoices: ${f.overdue.length}, ${money(f.overdueTotal)} total`,
    ...f.overdue.map((i) => `- ${i.number} (${customers.get(i.customerId)?.name ?? i.customerId}): ${money(balance(i))}, due ${i.dueOn}`),
    "",
    `Missed calls not returned: ${f.missed.length}`,
    ...f.missed.map(({ call, contact }) => `- ${contact ? `${contact.firstName} ${contact.lastName} ` : ""}${call.from}, ${call.outcome} on ${dateInZone(Date.parse(call.startedAt), tz)}`),
    "",
    `${cap(terms.quote)}s at risk: ${f.quotes.length}, ${money(f.quotesTotal)} total`,
    ...f.quotes.map(({ quote }) => `- ${quote.number} (${customers.get(quote.customerId)?.name ?? quote.customerId}): ${money(quote.totalCents)}, ${quote.status}`),
  ];
  store.sendEmail({ to: [owner.email], subject: `Daily brief for ${today}`, body: lines.join("\n") });
}
