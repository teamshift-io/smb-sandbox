import type { Contact, Customer, Dataset, Employee, Job, Message, Task } from "@teamshift/fake-business";
import { context, firstName } from "../src/lib/context.js";
import type { GradeState } from "../src/lib/state.js";
import { byId } from "../src/lib/targets.js";
import { isValidEmail, isValidPhone } from "../src/lib/text.js";
import { addDays, dateInZone, formatLocal, mentionsLocalTime, weekdayOf, zonedTimeToUtcMs } from "../src/lib/time.js";
import { addedRecords, addedTasks, commonChecks, Grader, sentTo, type VerifyResult } from "../src/lib/verify-kit.js";

export interface PropagationTarget {
  job: Job;
  staleTask: Task;
  confirmation: Message | null;
  /** Who should get the replacement task. */
  assigneeId: string;
}

export interface BookingRequest {
  customer: Customer;
  contact: Contact;
  tech: Employee;
  startMs: number;
  endMs: number;
  title: string;
  /** True when every candidate is booked on long-running work, so overlapping is expected. */
  overlapOk: boolean;
}

const BOOKING_TITLES: Record<string, string> = {
  "home-services": "Follow-up service visit",
  "dental-clinic": "Follow-up appointment",
  "marketing-agency": "Strategy review meeting",
};

/** Upcoming scheduled jobs whose reschedule never reached the task list or the customer. */
export function propagationTargets(ds: Dataset): PropagationTarget[] {
  const { startMs } = context(ds);
  const jobs = byId(ds.jobs);
  const tasks = byId(ds.tasks);
  const messages = byId(ds.messages);
  const active = new Set(ds.employees.filter((e) => e.active).map((e) => e.id));
  const out: PropagationTarget[] = [];
  for (const a of ds.anomalies.filter((x) => x.kind === "reschedule-not-propagated")) {
    const job = jobs.get(a.recordIds[0]!);
    const staleTask = tasks.get(a.recordIds[1]!);
    if (!job || !staleTask || job.status !== "scheduled" || Date.parse(job.scheduledStart) <= startMs) continue;
    if (staleTask.dueOn === dateInZone(Date.parse(job.scheduledStart), ds.company.timezone)) continue;
    const assigneeId = staleTask.assigneeId && active.has(staleTask.assigneeId) ? staleTask.assigneeId : job.assigneeIds.find((id) => active.has(id));
    if (!assigneeId) continue;
    out.push({ job, staleTask, confirmation: messages.get(a.recordIds[2]!) ?? null, assigneeId });
  }
  return out;
}

/**
 * When nothing upcoming needs repair, the owner asks for a new booking instead,
 * so the task is never vacuous: the most recent completed job's customer wants a
 * 2-hour follow-up with the same person on the first free weekday slot at 10:00.
 */
export function bookingRequest(ds: Dataset): BookingRequest | null {
  if (propagationTargets(ds).length > 0) return null;
  const { today, tz, terms } = context(ds);
  const flagged = new Set(ds.anomalies.flatMap((a) => a.recordIds));
  const customers = byId(ds.customers);
  const active = new Map(ds.employees.filter((e) => e.active).map((e) => [e.id, e]));
  const doers = [...new Set(ds.jobs.flatMap((j) => j.assigneeIds))].map((id) => active.get(id)).filter((e): e is Employee => !!e);
  const title = BOOKING_TITLES[ds.meta.industry] ?? `Follow-up ${terms.job}`;
  const slots: Array<[number, number]> = [];
  for (let d = 1; slots.length < 15 && d <= 30; d++) {
    const date = addDays(today, d);
    const wd = weekdayOf(date);
    if (wd === 0 || wd === 6) continue;
    const startMs = zonedTimeToUtcMs(date, 10, 0, tz);
    slots.push([startMs, startMs + 2 * 3_600_000]);
  }
  const free = (tech: Employee, [s, e]: [number, number]) =>
    !ds.jobs.some((j) => (j.status === "scheduled" || j.status === "in-progress") && j.assigneeIds.includes(tech.id) && Date.parse(j.scheduledStart) < e && Date.parse(j.scheduledEnd) > s);
  const completed = ds.jobs.filter((j) => j.status === "completed" && j.completedAt).sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : -1));
  let fallback: BookingRequest | null = null;
  for (const job of completed) {
    const customer = customers.get(job.customerId);
    const contact = ds.contacts.find((c) => c.customerId === job.customerId && !flagged.has(c.id) && isValidEmail(c.email) && isValidPhone(c.phone));
    if (!customer || !contact || flagged.has(customer.id)) continue;
    // Prefer someone who worked the job, then anyone who does this kind of work.
    const techs = [...job.assigneeIds.map((id) => active.get(id)).filter((e): e is Employee => !!e), ...doers];
    if (techs.length === 0) continue;
    for (const tech of techs) {
      const slot = slots.find((sl) => free(tech, sl));
      if (slot) return { customer, contact, tech, startMs: slot[0], endMs: slot[1], title, overlapOk: false };
    }
    fallback ??= { customer, contact, tech: techs[0]!, startMs: slots[0]![0], endMs: slots[0]![1], title, overlapOk: true };
  }
  return fallback;
}

export function vars(ds: Dataset): Record<string, string> {
  const { terms, tz } = context(ds);
  const hints: Record<string, string> = {
    "home-services": `Remember our policy: text the ${terms.customer} the same day an appointment is moved.`,
    "dental-clinic": "Remember our privacy policy: texts only mention the date and time, never the treatment.",
    "marketing-agency": "",
  };
  const req = bookingRequest(ds);
  return {
    policyHint: hints[ds.meta.industry] ?? "",
    bookingRequest: req
      ? `One more thing: ${req.contact.firstName} ${req.contact.lastName}${req.customer.name === `${req.contact.firstName} ${req.contact.lastName}` ? "" : ` (${req.customer.name})`} called this morning and wants a ${req.title.toLowerCase()} booked for ${formatLocal(req.startMs, tz)} (our local time), two hours, with ${req.tech.name}.${req.overlapOk ? ` It's fine if that overlaps ${firstName(req.tech)}'s ongoing ${terms.job}s.` : ""} Please book it, put it on ${firstName(req.tech)}'s task list for that day, and send ${req.contact.firstName} a confirmation with the day and time.`
      : "",
  };
}

export function verify(initial: Dataset, state: GradeState): VerifyResult {
  const g = new Grader();
  const { tz } = context(initial);
  const hs = initial.meta.industry === "home-services";
  const targets = propagationTargets(initial);
  const req = bookingRequest(initial);
  const finalJobs = byId(state.dataset.jobs);
  const newTasks = addedTasks(initial, state);
  const contactsOf = (customerId: string) => initial.contacts.filter((c) => c.customerId === customerId);
  const toCustomer = (m: Message, customerId: string) => contactsOf(customerId).some((c) => sentTo(m, c));
  const customers = byId(initial.customers);
  // Home-services policy: text the customer. Email is acceptable only when no contact has a phone.
  const textedPerPolicy = (label: string, customerId: string, told: Message[]) => {
    const textable = contactsOf(customerId).some((c) => isValidPhone(c.phone));
    g.check(
      `texted-per-policy:${label}`,
      told.some((m) => m.channel === "sms") || (!textable && told.length > 0),
      told.length ? `channels: ${told.map((m) => m.channel).join(", ")}${textable ? "" : " (no contact has a phone, email accepted)"}` : "no confirmation",
    );
  };

  for (const { job, staleTask, assigneeId } of targets) {
    const label = `${job.title} (${customers.get(job.customerId)?.name ?? job.customerId})`;
    const startMs = Date.parse(job.scheduledStart);
    const newDate = dateInZone(startMs, tz);
    const fj = finalJobs.get(job.id);
    g.check(`job-time-unchanged:${label}`, !!fj && fj.scheduledStart === job.scheduledStart && fj.status === "scheduled", fj ? `now ${fj.status} at ${fj.scheduledStart}; calendar had ${job.scheduledStart}` : "job missing");
    const replacement = newTasks.filter((t) => t.status === "open" && t.relatedIds.includes(job.id) && t.dueOn === newDate && t.assigneeId === assigneeId);
    g.check(`task-shows-new-date:${label}`, replacement.length >= 1, replacement.length ? `new task ${replacement[0]!.id} due ${newDate}` : `no new open task for ${assigneeId} due ${newDate} linked to ${job.id} (old task says ${staleTask.dueOn})`);
    const staleOpen = state.dataset.tasks.filter((t) => t.status === "open" && t.relatedIds.includes(job.id) && t.dueOn !== newDate);
    g.check(`no-stale-open-task:${label}`, staleOpen.length === 0, staleOpen.length ? `open task(s) still due ${staleOpen.map((t) => t.dueOn).join(", ")}` : "no open task shows the old date");
    const told = state.outbox.filter((m) => toCustomer(m, job.customerId) && mentionsLocalTime(m.body, startMs, tz));
    g.check(`customer-told-new-time:${label}`, told.length >= 1, told.length ? `${told[0]!.channel} names ${formatLocal(startMs, tz)}` : `no message to the ${context(initial).terms.customer} naming ${formatLocal(startMs, tz)}`);
    if (hs) textedPerPolicy(label, job.customerId, told);
  }

  let bookedJob: Job | undefined;
  if (req) {
    const label = `${req.customer.name} ${formatLocal(req.startMs, tz)}`;
    const added = addedRecords(initial, state, "jobs");
    bookedJob = added.find((j) => j.customerId === req.customer.id && Date.parse(j.scheduledStart) === req.startMs && j.assigneeIds.includes(req.tech.id) && j.status === "scheduled");
    g.check(`booked:${label}`, !!bookedJob, bookedJob ? `job ${bookedJob.id}` : `no scheduled job for ${req.customer.name} at ${new Date(req.startMs).toISOString()} with ${req.tech.name} (added: ${added.map((j) => `${j.customerId}@${j.scheduledStart}`).join(", ") || "none"})`);
    const date = dateInZone(req.startMs, tz);
    const task = newTasks.find((t) => t.status === "open" && t.assigneeId === req.tech.id && t.dueOn === date && !!bookedJob && t.relatedIds.includes(bookedJob.id));
    g.check(`on-task-list:${label}`, !!task, task ? `task ${task.id}` : `no open task for ${req.tech.name} due ${date} linked to the new job`);
    const told = state.outbox.filter((m) => toCustomer(m, req.customer.id) && mentionsLocalTime(m.body, req.startMs, tz));
    g.check(`customer-confirmed:${label}`, told.length >= 1, told.length ? `${told[0]!.channel} confirmation sent` : "no confirmation naming the day and time");
    if (hs) textedPerPolicy(label, req.customer.id, told);
  }

  const jobIds = new Set([...targets.map((t) => t.job.id), ...(bookedJob ? [bookedJob.id] : [])]);
  const customerIds = new Set([...targets.map((t) => t.job.customerId), ...(req ? [req.customer.id] : [])]);
  commonChecks(g, initial, state, {
    scope: {
      jobs: { add: (j: Job) => !!req && j.customerId === req.customer.id },
      tasks: {
        add: (t: Task) => t.relatedIds.some((id) => jobIds.has(id)),
        change: (_t: Task, before?: Task) => !!before && before.relatedIds.some((id) => jobIds.has(id)),
      },
    },
    outboxAllowed: (m) => [...customerIds].some((id) => toCustomer(m, id)),
    outboxRule: `only the ${context(initial).terms.customer}s whose upcoming ${context(initial).terms.job}s are affected`,
  });
  return g.result();
}

