import type { Contact, Dataset, Lead, Message } from "@teamshift/fake-business";
import { context } from "../src/lib/context.js";
import type { GradeState } from "../src/lib/state.js";
import { byId } from "../src/lib/targets.js";
import { includesCI, keywordOverlap } from "../src/lib/text.js";
import { commonChecks, Grader, sentTo, type VerifyResult } from "../src/lib/verify-kit.js";

export interface LeadTarget {
  lead: Lead;
  contact: Contact;
  inquiry: Message | null;
  /** What they asked about, from the inquiry subject (e.g. "Water heater replacement"). */
  topic: string | null;
}

export function leadTargets(ds: Dataset): LeadTarget[] {
  const leads = byId(ds.leads);
  const contacts = byId(ds.contacts);
  const messages = byId(ds.messages);
  const out: LeadTarget[] = [];
  for (const a of ds.anomalies.filter((x) => x.kind === "lead-never-contacted")) {
    const lead = leads.get(a.recordIds[0]!);
    const contact = lead ? contacts.get(lead.contactId) : undefined;
    if (!lead || !contact || lead.firstResponseAt !== null) continue;
    const inquiry = messages.get(a.recordIds[2] ?? "") ?? ds.messages.find((m) => m.direction === "inbound" && m.relatedIds.includes(lead.id)) ?? null;
    const topic = inquiry?.subject?.replace(/^(Re:\s*)?(Website inquiry:\s*)?/i, "").trim() || null;
    out.push({ lead, contact, inquiry, topic });
  }
  return out;
}

export function verify(initial: Dataset, state: GradeState): VerifyResult {
  const g = new Grader();
  const { salesperson } = context(initial);
  const targets = leadTargets(initial);
  const finalLeads = byId(state.dataset.leads);

  for (const { lead, contact, topic } of targets) {
    const label = `${contact.firstName} ${contact.lastName}`;
    const msgs = state.outbox.filter((m) => sentTo(m, contact));
    const m = msgs[0];
    g.check(`replied:${label}`, msgs.length >= 1, msgs.length ? `${m!.channel} to ${m!.to.join(",")}` : `lead from ${lead.createdAt.slice(0, 10)} still unanswered`);
    g.check(`no-duplicate:${label}`, msgs.length <= 1, `${msgs.length} message(s) (at most one allowed)`);
    g.check(`personal:${label}`, !!m && includesCI(m.body, contact.firstName), m ? `uses "${contact.firstName}": ${includesCI(m.body, contact.firstName)}` : "no reply");
    const overlap = m ? keywordOverlap(m.body, lead.request) : 0;
    const onTopic = !!m && ((!!topic && includesCI(m.body, topic)) || overlap >= 2);
    g.check(`addresses-request:${label}`, onTopic, m ? `mentions topic "${topic}": ${!!topic && includesCI(m.body, topic)}; ${overlap} keyword(s) from the request` : "no reply");
    const f = finalLeads.get(lead.id);
    g.check(`marked-contacted:${label}`, !!f && (f.status === "contacted" || f.status === "qualified") && !!f.firstResponseAt, f ? `status ${f.status}, firstResponseAt ${f.firstResponseAt}` : "lead missing");
    const expectedOwner = lead.ownerId ?? salesperson.id;
    g.check(`owner:${label}`, f?.ownerId === expectedOwner, `owner ${f?.ownerId ?? "none"}; expected ${expectedOwner}${lead.ownerId ? " (unchanged)" : ` (${salesperson.name})`}`);
  }

  const leadIds = new Set(targets.map((t) => t.lead.id));
  commonChecks(g, initial, state, {
    scope: { leads: { change: (l: Lead) => leadIds.has(l.id) } },
    outboxAllowed: (m) => targets.some((t) => sentTo(m, t.contact)),
    outboxRule: "only the people whose inquiries went unanswered",
  });
  return g.result();
}
