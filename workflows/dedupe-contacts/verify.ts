import type { Contact, Dataset } from "@teamshift/fake-business";
import type { GradeState } from "../src/lib/state.js";
import { byId } from "../src/lib/targets.js";
import { isValidEmail, isValidPhone } from "../src/lib/text.js";
import { commonChecks, Grader, type VerifyResult } from "../src/lib/verify-kit.js";

export interface DuplicatePair {
  dup: Contact;
  orig: Contact;
}

export function duplicatePairs(ds: Dataset): DuplicatePair[] {
  const contacts = byId(ds.contacts);
  return ds.anomalies
    .filter((a) => a.kind === "duplicate-contact")
    .map((a) => ({ dup: contacts.get(a.recordIds[0]!), orig: contacts.get(a.recordIds[1]!) }))
    .filter((p): p is DuplicatePair => !!p.dup && !!p.orig);
}

/** Contacts that share a first or last name with a duplicate pair but are different people. */
export function lookalikes(ds: Dataset, pairs: DuplicatePair[]): Contact[] {
  const pairIds = new Set(pairs.flatMap((p) => [p.dup.id, p.orig.id]));
  const lasts = new Set(pairs.flatMap((p) => [p.dup.lastName.toLowerCase(), p.orig.lastName.toLowerCase()]));
  const firsts = new Set(pairs.flatMap((p) => [p.dup.firstName.toLowerCase(), p.orig.firstName.toLowerCase()]));
  return ds.contacts.filter((c) => !pairIds.has(c.id) && (lasts.has(c.lastName.toLowerCase()) || firsts.has(c.firstName.toLowerCase())));
}

export function verify(initial: Dataset, state: GradeState): VerifyResult {
  const g = new Grader();
  const pairs = duplicatePairs(initial);
  const pairIds = new Set(pairs.flatMap((p) => [p.dup.id, p.orig.id]));
  const final = byId(state.dataset.contacts);

  for (const { dup, orig } of pairs) {
    const label = `${orig.firstName} ${orig.lastName}`;
    const left = [dup, orig].filter((c) => final.has(c.id));
    g.check(`merged:${label}`, left.length === 1, `${left.length} of the 2 records remain ("${dup.firstName} ${dup.lastName}" and "${orig.firstName} ${orig.lastName}"); expected 1`);
    const survivor = left.length === 1 ? final.get(left[0]!.id)! : null;
    g.check(`survivor-linked-to-account:${label}`, !!survivor && survivor.customerId === orig.customerId, survivor ? `survivor ${survivor.id} customer ${survivor.customerId}; expected ${orig.customerId}` : "not merged");
    g.check(`survivor-reachable:${label}`, !!survivor && isValidEmail(survivor.email) && isValidPhone(survivor.phone), survivor ? `email ${survivor.email}, phone ${survivor.phone}` : "not merged");
  }

  const looks = lookalikes(initial, pairs);
  const lost = looks.filter((c) => !final.has(c.id));
  g.check("lookalikes-kept", lost.length === 0, lost.length ? `different people merged away: ${lost.map((c) => `${c.firstName} ${c.lastName}`).join(", ")}` : `${looks.length} look-alike contact(s) left alone`);

  const dangling: string[] = [];
  const ds = state.dataset;
  for (const r of [...ds.leads, ...ds.deals]) if (!final.has(r.contactId)) dangling.push(r.id);
  for (const r of [...ds.messages, ...ds.calls]) if (r.contactId && !final.has(r.contactId)) dangling.push(r.id);
  for (const r of [...ds.messages, ...ds.tasks]) if (r.relatedIds.some((id) => id.startsWith("con_") && !final.has(id))) dangling.push(r.id);
  g.check("no-dangling-references", dangling.length === 0, dangling.length ? `${dangling.length} record(s) point at a removed contact: ${dangling.slice(0, 5).join(", ")}` : "every reference resolves");

  const touchesPair = (_after: unknown, before?: { contactId?: string | null; relatedIds?: string[] }) =>
    !!before && ((!!before.contactId && pairIds.has(before.contactId)) || (before.relatedIds ?? []).some((id) => pairIds.has(id)));
  commonChecks(g, initial, state, {
    scope: {
      contacts: { remove: (c: Contact) => pairIds.has(c.id), change: (c: Contact) => pairIds.has(c.id) },
      leads: { change: touchesPair },
      deals: { change: touchesPair },
      messages: { change: touchesPair },
      calls: { change: touchesPair },
      tasks: { change: touchesPair },
    },
  });
  return g.result();
}
