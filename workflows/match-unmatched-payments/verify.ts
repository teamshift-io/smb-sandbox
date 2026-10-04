import type { Dataset, Task } from "@teamshift/fake-business";
import type { GradeState } from "../src/lib/state.js";
import { byId, unmatchedPaymentTargets } from "../src/lib/targets.js";
import { money } from "../src/lib/text.js";
import { addedTasks, commonChecks, Grader, type VerifyResult } from "../src/lib/verify-kit.js";

export function verify(initial: Dataset, state: GradeState): VerifyResult {
  const g = new Grader();
  const targets = unmatchedPaymentTargets(initial);
  const finalPayments = byId(state.dataset.payments);
  const invoiceNumbers = byId(initial.invoices);
  const newTasks = addedTasks(initial, state);
  const flags = (payId: string) => (t: Task) => t.status === "open" && t.relatedIds.includes(payId);

  for (const t of targets) {
    const p = t.payment;
    const label = `${p.reference} (${money(p.amountCents)})`;
    const matchedTo = finalPayments.get(p.id)?.invoiceId ?? null;
    const shown = matchedTo ? (invoiceNumbers.get(matchedTo)?.number ?? matchedTo) : "nothing";
    if (!t.ambiguous) {
      g.check(`matched:${label}`, matchedTo === t.invoice.id, `applied to ${shown}; expected ${t.invoice.number}`);
    } else {
      const flagged = newTasks.some(flags(p.id));
      g.check(
        `matched-or-flagged:${label}`,
        matchedTo === t.invoice.id || (matchedTo === null && flagged),
        `${t.candidates.length} plausible invoices (${t.candidates.map((i) => i.number).join(", ")}); applied to ${shown}, flagged: ${flagged}`,
      );
    }
    g.check(`not-forced:${label}`, matchedTo === null || matchedTo === t.invoice.id, matchedTo && matchedTo !== t.invoice.id ? `wrongly applied to ${shown}` : "no wrong match");
  }

  const targetIds = new Set(targets.map((t) => t.payment.id));
  const invoiceIds = new Set(targets.flatMap((t) => [t.invoice.id, ...t.candidates.map((i) => i.id)]));
  commonChecks(g, initial, state, {
    scope: {
      payments: { change: (p: { id: string }) => targetIds.has(p.id) },
      invoices: { change: (i: { id: string }) => invoiceIds.has(i.id) },
      tasks: { add: (t: Task) => [...targetIds].some((id) => flags(id)(t)) },
    },
    moneyTools: ["invoicing_match_payment"],
  });
  return g.result();
}
