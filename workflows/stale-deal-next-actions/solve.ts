import type { Dataset } from "@teamshift/fake-business";
import type { SandboxStore } from "@teamshift/sandbox-mcp";
import { context } from "../src/lib/context.js";
import { addDays } from "../src/lib/time.js";
import { staleDeals } from "./verify.js";

export function solve(store: SandboxStore, initial: Dataset, dueInDays = 2): void {
  const { today, terms } = context(initial);
  for (const deal of staleDeals(initial)) {
    const contact = store.getContact(deal.contactId);
    const quote = store.listQuotes({ dealId: deal.id, limit: 1 }).items[0];
    const what = quote ? `get a decision on ${terms.quote} ${quote.number}` : `agree next steps on ${deal.title.split(" — ")[0]!.toLowerCase()}`;
    store.updateDeal({ dealId: deal.id, nextAction: { summary: `Call ${contact.firstName} ${contact.lastName} to ${what}`, dueOn: addDays(today, dueInDays) } });
  }
}
