import type { Dataset } from "@teamshift/fake-business";
import type { GradeState } from "../src/lib/state.js";
import { byId, quoteFollowUpTargets } from "../src/lib/targets.js";
import { includesCI, includesToken, mentionsMoney, money } from "../src/lib/text.js";
import { about, commonChecks, Grader, sentTo, type VerifyResult } from "../src/lib/verify-kit.js";

export function verify(initial: Dataset, state: GradeState): VerifyResult {
  const g = new Grader();
  const targets = quoteFollowUpTargets(initial);
  const targetIds = new Set(targets.map((t) => t.quote.id));
  const dealIds = new Set(targets.map((t) => t.deal.id));
  const finalQuotes = byId(state.dataset.quotes);

  for (const { quote, contact } of targets) {
    const n = quote.number;
    const msgs = state.outbox.filter((m) => about(m, quote.id, n));
    const m = msgs[0];
    g.check(`followed-up:${n}`, msgs.length >= 1, msgs.length ? `${msgs.length} message(s) about ${n}` : `no follow-up sent for ${n} (${quote.status}, ${money(quote.totalCents)})`);
    g.check(`no-duplicate:${n}`, msgs.length <= 1, `${msgs.length} message(s) about ${n} (at most one allowed)`);
    g.check(`right-recipient:${n}`, !!m && m.channel === "email" && sentTo(m, contact), m ? `${m.channel} to ${m.to.join(",")}; expected email to ${contact.firstName} ${contact.lastName} <${contact.email}>` : "no message");
    g.check(
      `states-number-and-total:${n}`,
      !!m && includesToken(m.body, n) && mentionsMoney(m.body, quote.totalCents),
      m ? `body ${includesToken(m.body, n) ? "has" : "lacks"} ${n} and ${mentionsMoney(m.body, quote.totalCents) ? "has" : "lacks"} ${money(quote.totalCents)}` : "no message",
    );
    g.check(`personal:${n}`, !!m && includesCI(m.body, contact.firstName), m ? `greets ${contact.firstName}: ${includesCI(m.body, contact.firstName)}` : "no message");
    if (quote.status !== "expired") {
      const fu = finalQuotes.get(quote.id)?.followUps.length ?? 0;
      g.check(`logged:${n}`, fu === 1, `${n} has ${fu} recorded follow-up(s); expected 1`);
    }
  }

  commonChecks(g, initial, state, {
    scope: {
      quotes: { change: (q: { id: string }) => targetIds.has(q.id) },
      deals: { change: (d: { id: string }) => dealIds.has(d.id) },
      tasks: { add: true },
    },
    outboxAllowed: (m) => targets.some((t) => about(m, t.quote.id, t.quote.number) && sentTo(m, t.contact)),
    outboxRule: "only follow-ups to the contacts of the slipped quotes",
  });
  return g.result();
}
