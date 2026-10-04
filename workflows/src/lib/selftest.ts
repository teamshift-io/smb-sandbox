import { generate, type Dataset, type GenerateOptions, type IndustryId } from "@teamshift/fake-business";
import { SandboxStore } from "@teamshift/sandbox-mcp";
import { stateOf, untouchedState } from "./state.js";
import type { Workflow } from "./workflow.js";

export const ALL_INDUSTRIES: readonly IndustryId[] = ["home-services", "dental-clinic", "marketing-agency"];
export const DEFAULT_SEEDS: readonly number[] = [1, 7, 42];

export interface SelftestOptions {
  workflows: readonly Workflow[];
  industries?: readonly IndustryId[];
  seeds?: readonly number[];
  size?: GenerateOptions["size"];
  messiness?: number;
}

export interface SelftestRow {
  workflow: string;
  industry: IndustryId;
  seed: number;
  /** Must be false: the untouched dataset fails. */
  untouchedPass: boolean;
  untouchedScore: number;
  /** Must be true with score 1: the reference solution passes. */
  solvedPass: boolean;
  solvedScore: number;
  ok: boolean;
  /** Failing check ids of the reference solution, or the error it threw. */
  problems: string[];
}

/** Runs every workflow's reference solution and verifier across industries and seeds. */
export function runSelftest(opts: SelftestOptions): SelftestRow[] {
  const rows: SelftestRow[] = [];
  for (const industry of opts.industries ?? ALL_INDUSTRIES) {
    for (const seed of opts.seeds ?? DEFAULT_SEEDS) {
      const ds: Dataset = generate({ industry, seed, size: opts.size ?? "medium", messiness: opts.messiness ?? 1 });
      for (const wf of opts.workflows) {
        const untouched = wf.verify(ds, untouchedState(ds));
        let solvedPass = false;
        let solvedScore = 0;
        const problems: string[] = [];
        try {
          const store = new SandboxStore(ds);
          wf.solve(store, ds);
          const solved = wf.verify(ds, stateOf(store));
          solvedPass = solved.pass;
          solvedScore = solved.score;
          problems.push(...solved.checks.filter((c) => !c.pass).map((c) => `${c.id}: ${c.detail}`));
        } catch (err) {
          problems.push(`solve threw: ${err instanceof Error ? err.message : String(err)}`);
        }
        rows.push({
          workflow: wf.id,
          industry,
          seed,
          untouchedPass: untouched.pass,
          untouchedScore: untouched.score,
          solvedPass,
          solvedScore,
          ok: !untouched.pass && solvedPass && solvedScore === 1,
          problems,
        });
      }
    }
  }
  return rows;
}
