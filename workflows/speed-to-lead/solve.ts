import type { Dataset } from "@teamshift/fake-business";
import type { SandboxStore } from "@teamshift/sandbox-mcp";
import { context, firstName } from "../src/lib/context.js";
import { activeEmployeeId } from "../src/lib/solve-kit.js";
import { leadTargets } from "./verify.js";

export function solve(store: SandboxStore, initial: Dataset): void {
  const { salesperson } = context(initial);
  const company = store.getCompany();
  for (const { lead, contact, inquiry, topic } of leadTargets(initial)) {
    const ownerId = activeEmployeeId(store, lead.ownerId) ?? salesperson.id;
    const owner = store.listEmployees().find((e) => e.id === ownerId)!;
    const body =
      `Hi ${contact.firstName},\n\n` +
      `Thanks for reaching out to ${company.name}${topic ? ` about ${topic.toLowerCase()}` : ""}. You wrote: "${lead.request}"\n\n` +
      `We can definitely help with that. Could you share a couple of times that work for a quick call this week, so we can go over the details?\n\n` +
      `${firstName(owner)}\n${company.name} · ${company.phone}`;
    store.sendEmail({ contactId: contact.id, threadId: inquiry?.threadId, subject: inquiry ? undefined : "Thanks for reaching out", body, employeeId: ownerId, relatedIds: [lead.id] });
    if (!lead.ownerId) store.updateLead({ leadId: lead.id, ownerId: salesperson.id });
  }
}
