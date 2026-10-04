import type { Dataset } from "@teamshift/fake-business";
import type { SandboxStore } from "@teamshift/sandbox-mcp";
import { context } from "../src/lib/context.js";
import { reachableContact } from "../src/lib/solve-kit.js";
import { balance, overdueBuckets, paymentCandidates } from "../src/lib/targets.js";
import { money } from "../src/lib/text.js";
import { MIN_DAYS_PAST_DUE } from "./verify.js";

export function solve(store: SandboxStore, initial: Dataset): void {
  const { bookkeeper, today } = context(initial);
  const { chase, covered } = overdueBuckets(initial, MIN_DAYS_PAST_DUE);
  for (const inv of chase) {
    const reach = reachableContact(store, inv.customerId);
    if (!reach) continue;
    store.sendInvoiceReminder({
      invoiceId: inv.id,
      channel: reach.channel,
      contactId: reach.contact.id,
      body: `Hi ${reach.contact.firstName}, a friendly reminder from ${store.getCompany().name}: invoice ${inv.number} has a balance of ${money(balance(inv))}, which was due ${inv.dueOn}. If you've already paid, thank you and please disregard.`,
      employeeId: bookkeeper.id,
    });
  }
  const unmatched = initial.payments.filter((p) => p.invoiceId === null);
  for (const inv of covered) {
    const payments = unmatched.filter((p) => paymentCandidates(initial, p).some((c) => c.id === inv.id)).map((p) => p.id);
    store.createTask({
      title: `Unapplied payment may cover ${inv.number} (${money(balance(inv))}); please confirm and apply it`,
      assigneeId: bookkeeper.id,
      dueOn: today,
      relatedIds: [inv.id, ...payments],
    });
  }
}
