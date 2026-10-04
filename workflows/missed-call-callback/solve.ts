import type { Dataset } from "@teamshift/fake-business";
import type { SandboxStore } from "@teamshift/sandbox-mcp";
import { context } from "../src/lib/context.js";
import { missedCallTargets } from "../src/lib/targets.js";
import { dateInZone } from "../src/lib/time.js";

export function solve(store: SandboxStore, initial: Dataset): void {
  const { phoneHandler, today, tz } = context(initial);
  const company = store.getCompany();
  for (const { call, contact } of missedCallTargets(initial)) {
    const day = dateInZone(Date.parse(call.startedAt), tz);
    if (call.outcome === "voicemail") {
      // Text back the number that called.
      store.sendSms({
        to: call.from,
        contactId: contact?.id,
        body: `Hi${contact ? ` ${contact.firstName}` : ""}, this is ${company.name} returning your call from ${day}. Sorry we missed you! Reply here or call ${company.phone} and we'll help right away.`,
        employeeId: phoneHandler.id,
      });
    } else {
      // Missed with no voicemail: a callback task for the person who handles the phones.
      store.createTask({
        title: `Call back ${contact ? `${contact.firstName} ${contact.lastName}` : "caller"} at ${call.from} (missed call ${day})`,
        assigneeId: phoneHandler.id,
        dueOn: today,
        relatedIds: [call.id, ...(contact ? [contact.id] : [])],
      });
    }
  }
}
