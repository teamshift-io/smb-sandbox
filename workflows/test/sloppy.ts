/**
 * "Sloppy agent" runs: plausible-looking work with one realistic mistake each.
 * Every one of these must FAIL its verifier.
 */
import type { Dataset } from "@teamshift/fake-business";
import type { SandboxStore } from "@teamshift/sandbox-mcp";
import { solve as quoteSolve } from "../quote-follow-up/solve.js";
import { solve as missedSolve } from "../missed-call-callback/solve.js";
import { solve as overdueSolve } from "../overdue-invoice-reminders/solve.js";
import { MIN_DAYS_PAST_DUE } from "../overdue-invoice-reminders/verify.js";
import { solve as dedupeSolve } from "../dedupe-contacts/solve.js";
import { duplicatePairs, lookalikes } from "../dedupe-contacts/verify.js";
import { solveWith as rescheduleSolveWith } from "../reschedule-propagation/solve.js";
import { solve as staleSolve } from "../stale-deal-next-actions/solve.js";
import { leadTargets } from "../speed-to-lead/verify.js";
import { solve as mismatchSolve } from "../invoice-job-mismatch/solve.js";
import { solve as briefSolve } from "../daily-owner-brief/solve.js";
import { reachableContact } from "../src/lib/solve-kit.js";
import { overdueBuckets, quoteFollowUpTargets, unmatchedPaymentTargets } from "../src/lib/targets.js";

export interface SloppyRun {
  mistake: string;
  run: (store: SandboxStore, ds: Dataset) => void;
}

export const SLOPPY: Record<string, SloppyRun> = {
  "quote-follow-up": {
    mistake: "emails the same customer twice about one quote",
    run: (store, ds) => {
      quoteSolve(store, ds);
      const t = quoteFollowUpTargets(ds)[0]!;
      store.sendEmail({ contactId: t.contact.id, subject: `Checking in on ${t.quote.number}`, body: `Hi ${t.contact.firstName}, just checking in again on ${t.quote.number}.`, relatedIds: [t.quote.id] });
    },
  },
  "missed-call-callback": {
    mistake: "texts a number that is not in the call log",
    run: (store, ds) => {
      missedSolve(store, ds);
      store.sendSms({ to: "(999) 555-0100", body: "Hi, returning your call!" });
    },
  },
  "overdue-invoice-reminders": {
    mistake: "chases an invoice the customer already paid (unapplied payment)",
    run: (store, ds) => {
      overdueSolve(store, ds);
      const { chase, covered } = overdueBuckets(ds, MIN_DAYS_PAST_DUE);
      const inv = covered[0] ?? chase[0]!;
      const reach = reachableContact(store, inv.customerId)!;
      store.sendInvoiceReminder({ invoiceId: inv.id, channel: reach.channel, contactId: reach.contact.id });
    },
  },
  "dedupe-contacts": {
    mistake: "also merges a different person who just shares a name",
    run: (store, ds) => {
      dedupeSolve(store, ds);
      const pairs = duplicatePairs(ds);
      const pairIds = new Set(pairs.flatMap((p) => [p.dup.id, p.orig.id]));
      const others = ds.contacts.filter((c) => !pairIds.has(c.id));
      const compatible = (a: { customerId: string | null }, b: { customerId: string | null }) => !a.customerId || !b.customerId || a.customerId === b.customerId;
      for (const look of [...lookalikes(ds, pairs), ...others]) {
        const keep =
          others.find((c) => c.id !== look.id && compatible(c, look) && c.lastName.toLowerCase() === look.lastName.toLowerCase()) ??
          others.find((c) => c.id !== look.id && compatible(c, look));
        if (keep) {
          store.mergeContacts({ keepId: keep.id, mergeId: look.id });
          return;
        }
      }
      throw new Error("no mergeable look-alike found");
    },
  },
  "match-unmatched-payments": {
    mistake: "records new payments instead of applying the existing ones",
    run: (store, ds) => {
      for (const t of unmatchedPaymentTargets(ds)) {
        try {
          store.recordPayment({ invoiceId: t.invoice.id, amountCents: t.payment.amountCents, method: t.payment.method, reference: t.payment.reference });
        } catch {
          // An agent would see the tool error and move on.
        }
      }
    },
  },
  "reschedule-propagation": {
    mistake: "fixes the task list but never tells the customer",
    run: (store, ds) => rescheduleSolveWith(store, ds, { skipConfirmation: true }),
  },
  "stale-deal-next-actions": {
    mistake: "sets next actions a month out",
    run: (store, ds) => staleSolve(store, ds, 30),
  },
  "speed-to-lead": {
    mistake: "sends a generic canned reply",
    run: (store, ds) => {
      for (const t of leadTargets(ds)) {
        store.sendEmail({ contactId: t.contact.id, threadId: t.inquiry?.threadId, subject: t.inquiry ? undefined : "Thanks", body: "Hello, thanks for your message. We will get back to you soon." });
      }
    },
  },
  "invoice-job-mismatch": {
    mistake: "points the correction at the other customer's job",
    run: (store, ds) => mismatchSolve(store, ds, { linkWrongJob: true }),
  },
  "daily-owner-brief": {
    mistake: "also emails a customer",
    run: (store, ds) => {
      briefSolve(store, ds);
      const t = quoteFollowUpTargets(ds)[0]!;
      store.sendEmail({ contactId: t.contact.id, subject: "Quick update", body: `Hi ${t.contact.firstName}, just a heads-up from the office.` });
    },
  },
};
