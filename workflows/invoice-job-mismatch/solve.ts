import type { Dataset } from "@teamshift/fake-business";
import type { SandboxStore } from "@teamshift/sandbox-mcp";
import { context } from "../src/lib/context.js";
import { mismatchTargets } from "./verify.js";

export function solve(store: SandboxStore, initial: Dataset, opts: { linkWrongJob?: boolean } = {}): void {
  const { bookkeeper, today, terms } = context(initial);
  for (const { invoice, wrongJob, rightJob, canReissue } of mismatchTargets(initial)) {
    if (canReissue && !opts.linkWrongJob) {
      store.voidInvoice({ invoiceId: invoice.id, reason: `Linked to another ${terms.customer}'s ${terms.job}; reissuing against ${rightJob.id}` });
      store.createInvoice({ customerId: invoice.customerId, jobId: rightJob.id, lineItems: invoice.lineItems, issuedOn: invoice.issuedOn, dueOn: invoice.dueOn });
      continue;
    }
    const job = opts.linkWrongJob ? wrongJob : rightJob;
    store.createTask({
      title: `Relink ${invoice.number} to ${terms.job} "${job.title}" (${job.scheduledStart.slice(0, 10)}); it is attached to another ${terms.customer}'s ${terms.job}`,
      assigneeId: bookkeeper.id,
      dueOn: today,
      relatedIds: [invoice.id, job.id],
    });
  }
}
