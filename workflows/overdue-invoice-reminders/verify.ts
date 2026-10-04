import type { Dataset, Invoice, Message, Task } from "@teamshift/fake-business";
import { context } from "../src/lib/context.js";
import type { GradeState } from "../src/lib/state.js";
import { balance, overdueBuckets } from "../src/lib/targets.js";
import { includesToken, mentionsMoney, money } from "../src/lib/text.js";
import { about, addedTasks, commonChecks, Grader, sentTo, type VerifyResult } from "../src/lib/verify-kit.js";

export const MIN_DAYS_PAST_DUE = 7;

export function verify(initial: Dataset, state: GradeState): VerifyResult {
  const g = new Grader();
  const { bookkeeper } = context(initial);
  const { chase, covered } = overdueBuckets(initial, MIN_DAYS_PAST_DUE);
  const newTasks = addedTasks(initial, state);
  const customerContacts = (inv: Invoice) => initial.contacts.filter((c) => c.customerId === inv.customerId);
  const toCustomer = (m: Message, inv: Invoice) => customerContacts(inv).some((c) => sentTo(m, c));

  for (const inv of chase) {
    const n = inv.number;
    const msgs = state.outbox.filter((m) => about(m, inv.id, n));
    const m = msgs[0];
    g.check(`reminded:${n}`, msgs.length >= 1, msgs.length ? `${msgs.length} reminder(s)` : `${n} (${money(balance(inv))}, due ${inv.dueOn}) got no reminder`);
    g.check(`no-duplicate:${n}`, msgs.length <= 1, `${msgs.length} reminder(s) (at most one allowed)`);
    g.check(`right-recipient:${n}`, !!m && toCustomer(m, inv), m ? `${m.channel} to ${m.to.join(",")}` : "no reminder");
    g.check(
      `states-number-and-balance:${n}`,
      !!m && includesToken(m.body, n) && mentionsMoney(m.body, balance(inv)),
      m ? `body ${includesToken(m.body, n) ? "has" : "lacks"} ${n}, ${mentionsMoney(m.body, balance(inv)) ? "has" : "lacks"} ${money(balance(inv))}` : "no reminder",
    );
  }

  const flagFor = (inv: Invoice) => (t: Task) => t.status === "open" && t.relatedIds.includes(inv.id);
  for (const inv of covered) {
    const n = inv.number;
    const msgs = state.outbox.filter((m) => about(m, inv.id, n));
    g.check(`not-chased-already-paid:${n}`, msgs.length === 0, msgs.length ? `${n} looks paid by an unapplied payment but ${msgs.length} reminder(s) went out` : `no reminder for ${n}`);
    const tasks = newTasks.filter(flagFor(inv));
    g.check(
      `flagged-to-bookkeeper:${n}`,
      tasks.some((t) => t.assigneeId === bookkeeper.id),
      tasks.length ? `task(s) assigned to ${tasks.map((t) => t.assigneeId).join(",")}; expected ${bookkeeper.name}` : `no open task linked to ${n} for ${bookkeeper.name}`,
    );
  }

  commonChecks(g, initial, state, {
    scope: { tasks: { add: (t: Task) => covered.some((inv) => flagFor(inv)(t)) } },
    outboxAllowed: (m) => chase.some((inv) => about(m, inv.id, inv.number) && toCustomer(m, inv)),
    outboxRule: "only reminders for invoices the policy says to chase",
  });
  return g.result();
}
