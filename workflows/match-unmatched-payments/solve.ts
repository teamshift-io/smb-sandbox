import type { Dataset } from "@teamshift/fake-business";
import type { SandboxStore } from "@teamshift/sandbox-mcp";
import { context } from "../src/lib/context.js";
import { unmatchedPaymentTargets } from "../src/lib/targets.js";
import { money } from "../src/lib/text.js";

export function solve(store: SandboxStore, initial: Dataset): void {
  const { bookkeeper, today } = context(initial);
  for (const t of unmatchedPaymentTargets(initial)) {
    if (!t.ambiguous) {
      store.matchPayment({ paymentId: t.payment.id, invoiceId: t.candidates[0]!.id });
      continue;
    }
    // Several invoices fit: flag it for a human instead of guessing.
    store.createTask({
      title: `Unapplied payment ${t.payment.reference} (${money(t.payment.amountCents)}) could pay ${t.candidates.map((i) => i.number).join(" or ")}; please confirm which`,
      assigneeId: bookkeeper.id,
      dueOn: today,
      relatedIds: [t.payment.id, ...t.candidates.map((i) => i.id)],
    });
  }
}
