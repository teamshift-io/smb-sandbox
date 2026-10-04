/**
 * @teamshift/smb-workflows — verified small-business tasks for AI agents.
 * Each workflow has an owner-style prompt, a reference solution, and a
 * deterministic verifier that grades the end state of a sandbox-mcp run.
 *
 * @packageDocumentation
 */
import { defineWorkflow, type Workflow } from "./lib/workflow.js";

import quoteFollowUpMd from "../quote-follow-up/task.md";
import { verify as quoteFollowUpVerify } from "../quote-follow-up/verify.js";
import { solve as quoteFollowUpSolve } from "../quote-follow-up/solve.js";
import missedCallMd from "../missed-call-callback/task.md";
import { verify as missedCallVerify } from "../missed-call-callback/verify.js";
import { solve as missedCallSolve } from "../missed-call-callback/solve.js";
import overdueMd from "../overdue-invoice-reminders/task.md";
import { verify as overdueVerify } from "../overdue-invoice-reminders/verify.js";
import { solve as overdueSolve } from "../overdue-invoice-reminders/solve.js";
import dedupeMd from "../dedupe-contacts/task.md";
import { verify as dedupeVerify } from "../dedupe-contacts/verify.js";
import { solve as dedupeSolve } from "../dedupe-contacts/solve.js";
import paymentsMd from "../match-unmatched-payments/task.md";
import { verify as paymentsVerify } from "../match-unmatched-payments/verify.js";
import { solve as paymentsSolve } from "../match-unmatched-payments/solve.js";
import rescheduleMd from "../reschedule-propagation/task.md";
import { verify as rescheduleVerify, vars as rescheduleVars } from "../reschedule-propagation/verify.js";
import { solve as rescheduleSolve } from "../reschedule-propagation/solve.js";
import staleDealsMd from "../stale-deal-next-actions/task.md";
import { verify as staleDealsVerify } from "../stale-deal-next-actions/verify.js";
import { solve as staleDealsSolve } from "../stale-deal-next-actions/solve.js";
import speedMd from "../speed-to-lead/task.md";
import { verify as speedVerify } from "../speed-to-lead/verify.js";
import { solve as speedSolve } from "../speed-to-lead/solve.js";
import mismatchMd from "../invoice-job-mismatch/task.md";
import { verify as mismatchVerify } from "../invoice-job-mismatch/verify.js";
import { solve as mismatchSolve } from "../invoice-job-mismatch/solve.js";
import briefMd from "../daily-owner-brief/task.md";
import { verify as briefVerify } from "../daily-owner-brief/verify.js";
import { solve as briefSolve } from "../daily-owner-brief/solve.js";

/** Every workflow, in recommended order (easiest first within each system). */
export const WORKFLOWS: readonly Workflow[] = [
  defineWorkflow(quoteFollowUpMd, { verify: quoteFollowUpVerify, solve: (s, d) => quoteFollowUpSolve(s, d) }),
  defineWorkflow(missedCallMd, { verify: missedCallVerify, solve: (s, d) => missedCallSolve(s, d) }),
  defineWorkflow(overdueMd, { verify: overdueVerify, solve: (s, d) => overdueSolve(s, d) }),
  defineWorkflow(dedupeMd, { verify: dedupeVerify, solve: (s, d) => dedupeSolve(s, d) }),
  defineWorkflow(paymentsMd, { verify: paymentsVerify, solve: (s, d) => paymentsSolve(s, d) }),
  defineWorkflow(rescheduleMd, { vars: rescheduleVars, verify: rescheduleVerify, solve: (s, d) => rescheduleSolve(s, d) }),
  defineWorkflow(staleDealsMd, { verify: staleDealsVerify, solve: (s, d) => staleDealsSolve(s, d) }),
  defineWorkflow(speedMd, { verify: speedVerify, solve: (s, d) => speedSolve(s, d) }),
  defineWorkflow(mismatchMd, { verify: mismatchVerify, solve: (s, d) => mismatchSolve(s, d) }),
  defineWorkflow(briefMd, { verify: briefVerify, solve: (s, d) => briefSolve(s, d) }),
];

/** Looks a workflow up by id; throws with the list of valid ids when absent. */
export function getWorkflow(id: string): Workflow {
  const wf = WORKFLOWS.find((w) => w.id === id);
  if (!wf) throw new Error(`Unknown workflow "${id}". Valid ids: ${WORKFLOWS.map((w) => w.id).join(", ")}.`);
  return wf;
}

export { defineWorkflow, parseFrontmatter, render, commonVars } from "./lib/workflow.js";
export type { Workflow, WorkflowMeta, WorkflowParts, Difficulty } from "./lib/workflow.js";
export { Grader, commonChecks, diffDatasets, MONEY_TOOLS } from "./lib/verify-kit.js";
export type { Check, VerifyResult, Scope, CollectionRule, CommonOptions, Rule } from "./lib/verify-kit.js";
export { stateOf, untouchedState, parseStateFile, parseDataset } from "./lib/state.js";
export type { GradeState } from "./lib/state.js";
export { context } from "./lib/context.js";
export type { BizContext } from "./lib/context.js";
export { runSelftest } from "./lib/selftest.js";
export type { SelftestRow, SelftestOptions } from "./lib/selftest.js";
