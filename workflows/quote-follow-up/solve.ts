import type { Dataset } from "@teamshift/fake-business";
import type { SandboxStore } from "@teamshift/sandbox-mcp";
import { context } from "../src/lib/context.js";
import { activeEmployeeId } from "../src/lib/solve-kit.js";
import { quoteFollowUpTargets } from "../src/lib/targets.js";
import { money } from "../src/lib/text.js";
import { dateInZone } from "../src/lib/time.js";

export function solve(store: SandboxStore, initial: Dataset): void {
  const { terms, tz } = context(initial);
  for (const { quote, deal, contact } of quoteFollowUpTargets(initial)) {
    const sent = dateInZone(Date.parse(quote.sentAt!), tz);
    const lapsed = quote.status === "expired";
    const body =
      `Hi ${contact.firstName},\n\n` +
      `I wanted to check in on ${terms.quote} ${quote.number} (${money(quote.totalCents)}) that we sent on ${sent}. ` +
      (lapsed ? "It has lapsed, but I'd be glad to refresh it for you. " : "") +
      `Do you have any questions, or anything you'd like us to adjust?\n\nThanks,\n${store.getCompany().name}`;
    const employeeId = activeEmployeeId(store, deal.ownerId);
    if (lapsed) {
      store.sendEmail({ contactId: contact.id, subject: `Following up on ${terms.quote} ${quote.number}`, body, relatedIds: [quote.id, deal.id], employeeId });
    } else {
      store.followUpQuote({ quoteId: quote.id, body, contactId: contact.id, employeeId });
    }
  }
}
