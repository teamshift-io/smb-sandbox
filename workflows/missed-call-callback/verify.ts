import type { Dataset, Message, Task } from "@teamshift/fake-business";
import { context } from "../src/lib/context.js";
import type { GradeState } from "../src/lib/state.js";
import { missedCallTargets } from "../src/lib/targets.js";
import { digits } from "../src/lib/text.js";
import { addDays } from "../src/lib/time.js";
import { addedCalls, addedTasks, commonChecks, Grader, sentTo, type VerifyResult } from "../src/lib/verify-kit.js";

export function verify(initial: Dataset, state: GradeState): VerifyResult {
  const g = new Grader();
  const { phoneHandler, today } = context(initial);
  const targets = missedCallTargets(initial);
  const newTasks = addedTasks(initial, state);
  const newCalls = addedCalls(initial, state);
  const relatedToTarget = (t: Task) => targets.some(({ call, contact }) => t.relatedIds.includes(call.id) || (!!contact && t.relatedIds.includes(contact.id)));

  for (const { call, contact } of targets) {
    const num = digits(call.from);
    const label = contact ? `${contact.firstName} ${contact.lastName}` : call.from;
    const texts = state.outbox.filter((m) => m.channel === "sms" && m.to.some((t) => digits(t) === num));
    const emails = state.outbox.filter((m) => m.channel === "email" && !!contact && sentTo(m, contact));
    const calls = newCalls.filter((c) => c.direction === "outbound" && (digits(c.to) === num || (!!contact && c.contactId === contact.id)));
    const tasks = newTasks.filter((t) => t.status === "open" && (t.relatedIds.includes(call.id) || (!!contact && t.relatedIds.includes(contact.id))));
    const responses = texts.length + emails.length + calls.length + tasks.length;
    g.check(`responded:${label}`, responses >= 1, responses ? `${texts.length} text(s), ${emails.length} email(s), ${calls.length} logged call(s), ${tasks.length} task(s)` : `${call.outcome} call from ${call.from} on ${call.startedAt.slice(0, 10)} still unanswered`);
    g.check(`no-double-up:${label}`, texts.length <= 1 && tasks.length <= 1, `${texts.length} text(s) and ${tasks.length} task(s) for this caller; at most one of each`);
    const wrong = tasks.filter((t) => t.assigneeId !== phoneHandler.id || !t.dueOn || t.dueOn < today || t.dueOn > addDays(today, 1));
    g.check(
      `callback-task-owner-and-due:${label}`,
      wrong.length === 0,
      tasks.length ? (wrong.length ? `task ${wrong[0]!.id} is assigned to ${wrong[0]!.assigneeId} due ${wrong[0]!.dueOn}; expected ${phoneHandler.name} due ${today} or ${addDays(today, 1)}` : `assigned to ${phoneHandler.name}, due on time`) : "no callback task (fine if texted back)",
    );
  }

  const callerNumbers = new Set(initial.calls.filter((c) => c.direction === "inbound").map((c) => digits(c.from)));
  const callerContacts = new Set(initial.calls.filter((c) => c.direction === "inbound" && c.contactId).map((c) => c.contactId!));
  const inCallLog = (m: Message) =>
    m.channel === "sms" ? m.to.every((t) => callerNumbers.has(digits(t))) : !!m.contactId && callerContacts.has(m.contactId);

  commonChecks(g, initial, state, {
    scope: {
      tasks: { add: relatedToTarget },
      calls: { add: (c: { direction: string; to: string; contactId: string | null }) => c.direction === "outbound" && (callerNumbers.has(digits(c.to)) || (!!c.contactId && callerContacts.has(c.contactId))) },
    },
    outboxAllowed: inCallLog,
    outboxRule: "only callers who appear in the call log",
  });
  return g.result();
}
