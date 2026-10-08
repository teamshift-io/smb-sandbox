import { mkdir, writeFile } from "node:fs/promises";
import { resolve,join } from "node:path";
import { createHash } from "node:crypto";
import { PUBLIC_CASES,loadCase,SCAFFOLD } from "../packages/smb-bench/dist/index.js";
import { SandboxStore } from "../packages/sandbox-mcp/dist/index.js";
import { stateOf,untouchedState } from "../workflows/dist/index.js";
const [outArg,sourceCommit]=process.argv.slice(2);
if (!outArg || !/^[a-f0-9]{40}$/.test(sourceCommit ?? "")) throw new Error("Usage: node scripts/export-benchmark.mjs <new-output-dir> <exact-reviewed-source-commit>");
const out=resolve(outArg);await mkdir(out,{recursive:false});
const cases=[];const categories={};
for (const task of PUBLIC_CASES) {
  const {dataset,workflow,checksum}=loadCase(task);
  const untouched=workflow.verify(dataset,untouchedState(dataset));
  const store=new SandboxStore(dataset);workflow.solve(store,dataset);
  const solved=workflow.verify(dataset,stateOf(store));
  if (untouched.pass || !solved.pass || solved.score!==1) throw new Error(`Invalid grader ${task.id}`);
  cases.push({...task,initialChecksum:checksum,prompt:workflow.prompt(dataset),referenceValidation:{untouchedPass:false,solvedPass:true,score:solved.score}});
  categories[task.category]=(categories[task.category]??0)+1;
}
const manifest=JSON.stringify({version:"smb-bench-v1",sourceCommit,scaffold:SCAFFOLD,taskInstances:100,templates:13,split:"public",categories,
  modelResults:[],practitionerReview:"pending",privateHeldout:"evaluator-required",cases},null,2)+"\n";
await writeFile(join(out,"manifest.json"),manifest,{flag:"wx"});
await writeFile(join(out,"SHA256SUMS"),`${createHash("sha256").update(manifest).digest("hex")}  manifest.json\n`,{flag:"wx"});
console.log(JSON.stringify({taskInstances:cases.length,categories,referenceValidation:"100 untouched fail / 100 reference pass; not model results"}));
