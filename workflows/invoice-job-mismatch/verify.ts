import type { Dataset, Invoice, Job, Task } from "@teamshift/fake-business";
import { context } from "../src/lib/context.js";
import type { GradeState } from "../src/lib/state.js";
import { byId } from "../src/lib/targets.js";
import { addedRecords, addedTasks, commonChecks, Grader, type VerifyResult } from "../src/lib/verify-kit.js";

export interface MismatchTarget {
  invoice: Invoice;
  wrongJob: Job;
  /** Ground truth: the job the invoice should point at. */
  rightJob: Job;
  /** No payments applied, so the store lets it be voided. */
  canVoid: boolean;
  /**
   * Voidable and every line item is one `invoicing_create_invoice` accepts
   * (credit lines with negative prices are not), so void + reissue works.
   */
  canReissue: boolean;
}

export function mismatchTargets(ds: Dataset): MismatchTarget[] {
  const invoices = byId(ds.invoices);
  const jobs = byId(ds.jobs);
  const out: MismatchTarget[] = [];
  for (const a of ds.anomalies.filter((x) => x.kind === "invoice-wrong-job")) {
    const invoice = invoices.get(a.recordIds[0]!);
    const wrongJob = jobs.get(a.recordIds[1]!);
    const rightJob = jobs.get(a.recordIds[2]!);
    if (!invoice || !wrongJob || !rightJob || invoice.jobId !== wrongJob.id || wrongJob.customerId === invoice.customerId) continue;
    const canVoid = invoice.paidCents === 0 && invoice.status === "open";
    const validLines = invoice.lineItems.every((li) => Number.isSafeInteger(li.unitPriceCents) && li.unitPriceCents >= 0 && li.quantity > 0);
    out.push({ invoice, wrongJob, rightJob, canVoid, canReissue: canVoid && validLines });
  }
  return out;
}

export function verify(initial: Dataset, state: GradeState): VerifyResult {
  const g = new Grader();
  const { bookkeeper } = context(initial);
  const targets = mismatchTargets(initial);
  const jobs = byId(initial.jobs);
  const finalInvoices = byId(state.dataset.invoices);
  const newTasks = addedTasks(initial, state);
  const newInvoices = addedRecords(initial, state, "invoices");
  const ownJob = (inv: Invoice, jobId: string | null | undefined) => !!jobId && jobs.get(jobId)?.customerId === inv.customerId;

  for (const { invoice: inv, rightJob } of targets) {
    const n = inv.number;
    const tasks = newTasks.filter((t) => t.status === "open" && t.relatedIds.includes(inv.id));
    const voided = finalInvoices.get(inv.id)?.status === "void";
    const reissued = newInvoices.filter((i) => i.customerId === inv.customerId && i.totalCents === inv.totalCents && i.status !== "void");
    const viaReissue = voided && reissued.length > 0;
    const viaTask = tasks.length > 0;
    g.check(`fixed:${n}`, viaReissue || viaTask, viaReissue ? `voided and reissued as ${reissued[0]!.number}` : viaTask ? `correction task ${tasks[0]!.id}` : `${n} still points at another ${context(initial).terms.customer}'s ${context(initial).terms.job}`);
    const linkedJobs = viaReissue ? reissued.map((i) => i.jobId) : tasks.flatMap((t) => t.relatedIds.filter((id) => id.startsWith("job_")));
    const own = linkedJobs.filter((id) => ownJob(inv, id));
    g.check(`points-at-own-job:${n}`, own.length > 0, own.length ? `linked to ${own.join(", ")}${own.includes(rightJob.id) ? " (exact)" : ` (expected ${rightJob.id}, same customer)`}` : `no ${context(initial).terms.job} of the invoice's own customer referenced (got ${linkedJobs.join(", ") || "none"})`);
    if (!viaReissue) g.check(`assigned-to-bookkeeper:${n}`, tasks.some((t) => t.assigneeId === bookkeeper.id), tasks.length ? `assigned to ${tasks.map((t) => t.assigneeId).join(", ")}; expected ${bookkeeper.name}` : "no correction task");
    g.check(`no-orphaned-void:${n}`, !voided || reissued.length > 0, voided ? (reissued.length ? `replaced by ${reissued[0]!.number}` : `${n} was voided but never reissued`) : `${n} not voided`);
  }

  const targetIds = new Set(targets.map((t) => t.invoice.id));
  const voidable = new Set(targets.filter((t) => t.canVoid).map((t) => t.invoice.id));
  const targetCustomers = new Set(targets.filter((t) => t.canVoid).map((t) => t.invoice.customerId));
  commonChecks(g, initial, state, {
    scope: {
      invoices: {
        change: (i: Invoice) => voidable.has(i.id),
        add: (i: Invoice) => targetCustomers.has(i.customerId),
      },
      tasks: { add: (t: Task) => t.relatedIds.some((id) => targetIds.has(id)) && !t.relatedIds.some((id) => id.startsWith("inv_") && !targetIds.has(id)) },
    },
    moneyTools: ["invoicing_void_invoice", "invoicing_create_invoice"],
  });
  return g.result();
}
