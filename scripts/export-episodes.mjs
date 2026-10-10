// Export scored sample episodes (JSONL, one episode per line) from the public SMB-Bench corpus.
// Two scripted policies per case: "noop" (does nothing) and "reference" (the workflow's reference
// solution). reward is 1 only when every check passes; shaped_reward is the fraction of checks
// passed (a no-op already passes the "touched nothing else" checks). No model is called.
// Every record comes from a fictional company; nothing here is customer data. Usage, after `pnpm build`:
//   node scripts/export-episodes.mjs <new-output-dir> [cases-per-template]
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { PUBLIC_CASES, loadCase } from "../packages/smb-bench/dist/index.js";
import { SandboxStore } from "../packages/sandbox-mcp/dist/index.js";
import { stateOf, untouchedState } from "../workflows/dist/index.js";

const [outArg, perTemplateArg = "1"] = process.argv.slice(2);
const perTemplate = Number(perTemplateArg);
if (!outArg || !Number.isInteger(perTemplate) || perTemplate < 1) {
  throw new Error("Usage: node scripts/export-episodes.mjs <new-output-dir> [cases-per-template]");
}
const out = resolve(outArg);
await mkdir(out, { recursive: false });

// The licensed scope covers three industries; trailer-dealer companies stay out of the sample.
const EXCLUDED_INDUSTRIES = new Set(["trailer-dealer"]);
const taken = {};
const cases = [];
for (const task of PUBLIC_CASES) {
  const loaded = loadCase(task);
  if (EXCLUDED_INDUSTRIES.has(loaded.dataset.meta.industry)) continue;
  if ((taken[task.workflow] = (taken[task.workflow] ?? 0) + 1) <= perTemplate) cases.push({ task, ...loaded });
}
const episodes = [];
for (const { task, dataset, workflow, checksum } of cases) {
  const store = new SandboxStore(dataset);
  workflow.solve(store, dataset);
  const runs = [
    ["noop", untouchedState(dataset)],
    ["reference", stateOf(store)],
  ];
  for (const [policy, state] of runs) {
    const grade = workflow.verify(dataset, state);
    if (policy === "noop" ? grade.pass : !grade.pass) throw new Error(`Unexpected ${policy} grade for ${task.id}`);
    episodes.push({
      episode_id: `${task.id}:${policy}`,
      case_id: task.id,
      split: task.split,
      workflow: task.workflow,
      industry: dataset.meta.industry,
      category: task.category,
      seeded_injection: task.injection,
      initial_checksum: checksum,
      policy,
      prompt: workflow.prompt(dataset),
      actions: state.audit.map(({ seq, at, tool, input, result }) => ({ seq, at, tool, input, result })),
      outbox_messages: state.outbox.length,
      reward: grade.pass ? 1 : 0,
      shaped_reward: grade.score,
      success: grade.pass,
      checks: grade.checks,
    });
  }
}
const body = episodes.map((e) => JSON.stringify(e)).join("\n") + "\n";
await writeFile(join(out, "episodes.jsonl"), body, { flag: "wx" });
await writeFile(join(out, "SHA256SUMS"), `${createHash("sha256").update(body).digest("hex")}  episodes.jsonl\n`, { flag: "wx" });
console.log(JSON.stringify({ cases: cases.length, episodes: episodes.length, policies: ["noop", "reference"], models: "none" }));
