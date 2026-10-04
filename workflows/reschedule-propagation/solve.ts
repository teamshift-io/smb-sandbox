import type { Dataset } from "@teamshift/fake-business";
import type { SandboxStore } from "@teamshift/sandbox-mcp";
import { context } from "../src/lib/context.js";
import { reachableContact } from "../src/lib/solve-kit.js";
import { isValidEmail, isValidPhone } from "../src/lib/text.js";
import { dateInZone, formatLocal } from "../src/lib/time.js";
import { bookingRequest, propagationTargets } from "./verify.js";

export interface SolveOptions {
  /** Sloppy-agent switch used by tests: fix the records but never tell the customer. */
  skipConfirmation?: boolean;
}

export function solve(store: SandboxStore, initial: Dataset): void {
  solveWith(store, initial, {});
}

export function solveWith(store: SandboxStore, initial: Dataset, opts: SolveOptions): void {
  const { tz, terms } = context(initial);
  const company = store.getCompany();
  const smsFirst = initial.meta.industry === "home-services";
  const confirm = (customerId: string, preferredContactId: string | null, threadId: string | null, startMs: number): void => {
    if (opts.skipConfirmation) return;
    const body = `${company.name}: your ${terms.job} is now ${formatLocal(startMs, tz)}. Reply C to confirm or call ${company.phone} to change.`;
    const contacts = store.searchContacts({ customerId, limit: 100 }).items;
    const preferred = contacts.find((c) => c.id === preferredContactId);
    const textable = [preferred, ...contacts].find((c) => !!c && isValidPhone(c.phone));
    const contact = (smsFirst ? textable : undefined) ?? preferred ?? reachableContact(store, customerId)?.contact;
    if (!contact) return;
    const contactId = contact.id;
    const useSms = smsFirst ? isValidPhone(contact.phone) : !isValidEmail(contact.email);
    const thread = threadId ? store.getThread(threadId) : null;
    const sameChannelThread = thread && thread.messages[0]!.channel === (useSms ? "sms" : "email") ? threadId! : undefined;
    if (useSms) store.sendSms({ contactId, threadId: sameChannelThread, body });
    else store.sendEmail({ contactId, threadId: sameChannelThread, subject: sameChannelThread ? undefined : `Updated time for your ${terms.job}`, body });
  };

  for (const { job, staleTask, confirmation, assigneeId } of propagationTargets(initial)) {
    const startMs = Date.parse(job.scheduledStart);
    const customer = store.getCustomer(job.customerId);
    store.createTask({
      title: `Visit: ${job.title} — ${customer.name}, ${formatLocal(startMs, tz)}`,
      assigneeId,
      dueOn: dateInZone(startMs, tz),
      relatedIds: [job.id, job.customerId],
    });
    if (store.listTasks({ relatedId: job.id, status: "open", limit: 100 }).items.some((t) => t.id === staleTask.id)) store.completeTask(staleTask.id);
    confirm(job.customerId, confirmation?.contactId ?? null, confirmation?.threadId ?? null, startMs);
  }

  const req = bookingRequest(initial);
  if (req) {
    const job = store.scheduleJob({
      customerId: req.customer.id,
      title: req.title,
      scheduledStart: new Date(req.startMs).toISOString(),
      scheduledEnd: new Date(req.endMs).toISOString(),
      assigneeIds: [req.tech.id],
      allowOverlap: req.overlapOk,
    });
    store.createTask({
      title: `Visit: ${req.title} — ${req.customer.name}, ${formatLocal(req.startMs, tz)}`,
      assigneeId: req.tech.id,
      dueOn: dateInZone(req.startMs, tz),
      relatedIds: [job.id, req.customer.id],
    });
    confirm(req.customer.id, req.contact.id, null, req.startMs);
  }
}
