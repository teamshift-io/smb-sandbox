import type { Dataset, Deal } from "@teamshift/fake-business";
import { context } from "../src/lib/context.js";
import type { GradeState } from "../src/lib/state.js";
import { byId } from "../src/lib/targets.js";
import { addDays, dateInZone, daysBetween } from "../src/lib/time.js";
import { commonChecks, Grader, type VerifyResult } from "../src/lib/verify-kit.js";

export const STALE_DAYS = 14;
export const DUE_WITHIN_DAYS = 7;

const isOpen = (d: Deal) => d.stage !== "won" && d.stage !== "lost";
const GENERIC = /^(follow[\s-]?up|check[\s-]?in|todo|to do|tbd|next steps?|call|email|reach out)[.!]?$/i;

/** Open deals with no next step, an overdue one, or no update in STALE_DAYS days. */
export function staleDeals(ds: Dataset): Deal[] {
  const { today, tz } = context(ds);
  return ds.deals.filter(
    (d) => isOpen(d) && (!d.nextAction || d.nextAction.dueOn < today || daysBetween(dateInZone(Date.parse(d.updatedAt), tz), today) >= STALE_DAYS),
  );
}

export function isConcrete(summary: string): boolean {
  const s = summary.trim();
  return s.split(/\s+/).length >= 3 && s.length >= 12 && !GENERIC.test(s) && !/\b(undefined|null|NaN|TBD)\b|\{\{|\[object/i.test(s);
}

export function verify(initial: Dataset, state: GradeState): VerifyResult {
  const g = new Grader();
  const { today } = context(initial);
  const last = addDays(today, DUE_WITHIN_DAYS);
  const final = byId(state.dataset.deals);

  for (const deal of staleDeals(initial)) {
    const label = deal.title;
    const f = final.get(deal.id);
    const na = f?.nextAction ?? null;
    g.check(`has-next-action:${label}`, !!f && isOpen(f) && !!na, f ? `stage ${f.stage}, nextAction ${na ? `"${na.summary}" due ${na.dueOn}` : "none"}` : "deal missing");
    g.check(`due-within-${DUE_WITHIN_DAYS}-days:${label}`, !!na && na.dueOn >= today && na.dueOn <= last, na ? `due ${na.dueOn}; expected ${today}..${last}` : "no next action");
    g.check(`concrete:${label}`, !!na && isConcrete(na.summary), na ? `"${na.summary}"` : "no next action");
  }

  commonChecks(g, initial, state, {
    scope: {
      deals: { change: (after: Deal, before?: Deal) => !!before && isOpen(before) && after.stage === before.stage && after.amountCents === before.amountCents },
      tasks: { add: true },
    },
  });
  return g.result();
}
