import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseDataset, stateOf, untouchedState, type Workflow } from "@teamshift/smb-workflows";
import { COMPANY_LIBRARY, type Dataset } from "@teamshift/fake-business";
import { SandboxStore } from "@teamshift/sandbox-mcp";
import { BENCH_WORKFLOWS, WORKFLOW_CATEGORIES, type Category } from "./corpus.js";
export interface HeldoutCase {id:string;workflow:string;category:Category;fixture:string;sha256:string}
export async function loadHeldout(manifestPath: string): Promise<{task:HeldoutCase;dataset:Dataset;workflow:Workflow;checksum:string}[]> {
  const manifest=JSON.parse(await readFile(manifestPath,"utf8")) as {split:string;cases:HeldoutCase[]};
  if (manifest.split!=="held-out" || !Array.isArray(manifest.cases) || manifest.cases.length!==100 || new Set(manifest.cases.map(t=>t.id)).size!==100) throw new Error("Held-out manifest requires 100 unique evaluator-owned cases");
  const cases=[];
  const identities=new Set<string>();
  for (const task of manifest.cases) {
    const workflow=BENCH_WORKFLOWS.find(w=>w.id===task.workflow);
    if (!workflow || !/^[a-z0-9-]+$/.test(task.id) || !["scheduling","invoicing","collections","dispatch","purchasing","warranty"].includes(task.category) || !/^[a-f0-9]{64}$/.test(task.sha256)) throw new Error("Invalid held-out case metadata");
    const raw=await readFile(resolve(dirname(manifestPath),task.fixture),"utf8");
    const checksum=createHash("sha256").update(raw).digest("hex");
    if (checksum!==task.sha256) throw new Error("Held-out fixture checksum mismatch");
    const dataset=parseDataset(JSON.parse(raw));
    if (WORKFLOW_CATEGORIES[task.workflow]!==task.category) throw new Error("Category does not match the workflow");
    if (COMPANY_LIBRARY.some(c=>c.options.seed===dataset.meta.seed&&c.options.industry===dataset.meta.industry)) throw new Error("Public company seeds cannot be held-out fixtures");
    const identity=`${task.workflow}:${checksum}`;
    if (identities.has(identity)) throw new Error("Duplicate held-out task/fixture");
    identities.add(identity);
    workflow.prompt(dataset); // Validate every grader before any paid request.
    if (workflow.verify(dataset,untouchedState(dataset)).pass) throw new Error("Held-out fixture is already solved");
    const store=new SandboxStore(dataset);workflow.solve(store,dataset);
    const grade=workflow.verify(dataset,stateOf(store));
    if (!grade.pass || grade.score!==1) throw new Error("Held-out reference solution failed");
    cases.push({task,dataset,workflow,checksum});
  }
  return cases;
}
