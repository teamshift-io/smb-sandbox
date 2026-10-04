#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { generate, type Dataset, type GenerateOptions, type IndustryId } from "@teamshift/fake-business";
import { getWorkflow, WORKFLOWS } from "./index.js";
import { ALL_INDUSTRIES, DEFAULT_SEEDS, runSelftest } from "./lib/selftest.js";
import { parseDataset, parseStateFile } from "./lib/state.js";
import type { VerifyResult } from "./lib/verify-kit.js";

const HELP = `smb-workflows — verified small-business tasks for AI agents, graded on end state.

Usage:
  smb-workflows list [--json]
  smb-workflows show <id> [--industry <id>] [--seed <n>] [--size <s>] [--messiness <x>] [--data <dataset.json>] [--full]
  smb-workflows grade <id> --state <state.json> [--initial <dataset.json> | --industry <id> --seed <n> [--size <s>] [--messiness <x>]] [--json]
  smb-workflows selftest [--industries a,b] [--seeds 1,7,42] [--size <s>] [--json]

  list       Workflows with difficulty and the sandbox-mcp toolsets each needs.
  show       Prints the task prompt for one dataset (default home-services, seed 42, medium, messiness 1).
             --full prints the whole task.md, including "What a good result looks like".
  grade      Grades a state file written by \`sandbox-mcp --state-out\` against the initial dataset.
             Without --initial/--industry, the dataset is regenerated from the state's meta (size medium, messiness 1).
             Exit code 0 = pass, 1 = fail, 2 = usage error.
  selftest   Runs every reference solution: untouched data must fail, solved data must pass with score 1.

Industries: ${ALL_INDUSTRIES.join(", ")}`;

class UsageError extends Error {}

function readJson(file: string): unknown {
  const path = resolve(file);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new UsageError(`could not read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function genOptions(values: Record<string, unknown>, fallback?: Dataset["meta"]): GenerateOptions {
  const industry = (values.industry as string | undefined) ?? fallback?.industry ?? "home-services";
  if (!ALL_INDUSTRIES.includes(industry as IndustryId)) throw new UsageError(`unknown --industry "${industry}" (valid: ${ALL_INDUSTRIES.join(", ")})`);
  const seed = Number(values.seed ?? fallback?.seed ?? 42);
  if (!Number.isInteger(seed)) throw new UsageError("--seed must be an integer");
  const size = (values.size as string | undefined) ?? "medium";
  if (!["small", "medium", "large"].includes(size)) throw new UsageError("--size must be small, medium or large");
  const messiness = Number(values.messiness ?? 1);
  if (!Number.isFinite(messiness) || messiness < 0) throw new UsageError("--messiness must be a non-negative number");
  return { industry: industry as IndustryId, seed, size: size as GenerateOptions["size"], messiness };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function printResult(id: string, r: VerifyResult): void {
  const width = Math.min(48, Math.max(...r.checks.map((c) => c.id.length)));
  process.stdout.write(`\n${id}: ${r.pass ? "PASS" : "FAIL"}  score ${r.score.toFixed(3)}  (${r.checks.filter((c) => c.pass).length}/${r.checks.length} checks)\n\n`);
  for (const c of r.checks) process.stdout.write(`  ${c.pass ? "ok  " : "FAIL"}  ${pad(c.id, width)}  ${c.detail}\n`);
  process.stdout.write("\n");
}

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      industry: { type: "string" },
      industries: { type: "string" },
      seed: { type: "string" },
      seeds: { type: "string" },
      size: { type: "string" },
      messiness: { type: "string" },
      data: { type: "string" },
      initial: { type: "string" },
      state: { type: "string" },
      full: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [cmd, id] = positionals;
  if (values.help || !cmd) {
    process.stdout.write(`${HELP}\n`);
    return cmd || values.help ? 0 : 2;
  }

  if (cmd === "list") {
    if (values.json) {
      process.stdout.write(`${JSON.stringify(WORKFLOWS.map(({ id: wid, title, difficulty, systems, toolsets, estSteps }) => ({ id: wid, title, difficulty, systems, toolsets, estSteps })), null, 2)}\n`);
      return 0;
    }
    const w = Math.max(...WORKFLOWS.map((x) => x.id.length));
    for (const wf of WORKFLOWS) process.stdout.write(`${pad(wf.id, w)}  ${pad(wf.difficulty, 6)}  ${pad(wf.toolsets.join(","), 30)}  ${wf.title}\n`);
    return 0;
  }

  if (cmd === "show") {
    if (!id) throw new UsageError("show needs a workflow id (see `smb-workflows list`)");
    const wf = getWorkflow(id);
    if (values.full) {
      process.stdout.write(`${wf.taskMarkdown.trim()}\n`);
      return 0;
    }
    const ds = values.data ? parseDataset(readJson(values.data)) : generate(genOptions(values));
    process.stdout.write(`${wf.prompt(ds)}\n`);
    return 0;
  }

  if (cmd === "grade") {
    if (!id) throw new UsageError("grade needs a workflow id");
    if (!values.state) throw new UsageError("grade needs --state <file> (written by sandbox-mcp --state-out)");
    const wf = getWorkflow(id);
    const state = parseStateFile(readJson(values.state));
    let initial: Dataset;
    if (values.initial) initial = parseDataset(readJson(values.initial));
    else {
      initial = generate(genOptions(values, state.dataset.meta));
      if (initial.company.id !== state.dataset.company.id) {
        throw new UsageError("the regenerated dataset is a different business than the state file; pass --initial <dataset.json> or the --size/--messiness the sandbox used");
      }
    }
    const result = wf.verify(initial, state);
    if (values.json) process.stdout.write(`${JSON.stringify({ workflow: wf.id, ...result }, null, 2)}\n`);
    else printResult(wf.id, result);
    return result.pass ? 0 : 1;
  }

  if (cmd === "selftest") {
    const industries = values.industries ? (values.industries.split(",").map((s) => s.trim()) as IndustryId[]) : ALL_INDUSTRIES;
    for (const i of industries) if (!ALL_INDUSTRIES.includes(i)) throw new UsageError(`unknown industry "${i}"`);
    const seeds = values.seeds ? values.seeds.split(",").map((s) => Number(s.trim())) : DEFAULT_SEEDS;
    if (seeds.some((s) => !Number.isInteger(s))) throw new UsageError("--seeds must be integers");
    const size = genOptions(values).size;
    const rows = runSelftest({ workflows: WORKFLOWS, industries, seeds, size, messiness: values.messiness ? Number(values.messiness) : 1 });
    if (values.json) process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    else {
      const w = Math.max(...rows.map((r) => r.workflow.length));
      for (const r of rows) {
        process.stdout.write(
          `${r.ok ? "ok  " : "FAIL"}  ${pad(r.workflow, w)}  ${pad(r.industry, 16)}  seed ${pad(String(r.seed), 4)}  untouched ${r.untouchedPass ? "PASS" : "fail"} (${r.untouchedScore.toFixed(2)})  solved ${r.solvedPass ? "pass" : "FAIL"} (${r.solvedScore.toFixed(2)})\n`,
        );
        for (const p of r.ok ? [] : r.problems.slice(0, 5)) process.stdout.write(`        ${p}\n`);
      }
      const bad = rows.filter((r) => !r.ok).length;
      process.stdout.write(`\n${rows.length - bad}/${rows.length} ok (${WORKFLOWS.length} workflows x ${industries.length} industries x ${seeds.length} seeds)\n`);
    }
    return rows.every((r) => r.ok) ? 0 : 1;
  }

  throw new UsageError(`unknown command "${cmd}"`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`smb-workflows: ${err instanceof Error ? err.message : String(err)}\n`);
  if (!(err instanceof UsageError)) process.stderr.write("Run `smb-workflows --help` for usage.\n");
  process.exitCode = 2;
}
