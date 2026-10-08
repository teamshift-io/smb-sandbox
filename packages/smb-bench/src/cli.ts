import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PUBLIC_CASES, loadCase } from "./corpus.js";
import { loadHeldout } from "./heldout.js";
import { RequestBudget, runTask, taskSucceeded, type Admission } from "./runner.js";

// Each invocation runs one admitted matrix; no provider retries or automatic resumption.
async function main() {
  const [configPath,outPath]=process.argv.slice(2);
  if (!configPath || !outPath) throw new Error("Usage: node dist/cli.js <private-config.json> <new-output-directory>");
  const config=JSON.parse(await readFile(configPath,"utf8")) as {admission:Admission;heldoutManifest?:string;models:{id:string;model:string;baseUrl:string;keyEnv:string}[]};
  if (!Array.isArray(config.models)||config.models.length<4||config.models.length>6||new Set(config.models.map(m=>m.id)).size!==config.models.length) throw new Error("Configure 4–6 distinct admitted models");
  if (new Set(config.models.map(m=>`${new URL(m.baseUrl).href.replace(/\/$/,"")}:${m.model}`)).size!==config.models.length) throw new Error("Use distinct provider/model pins, not aliases of one configuration");
  const cases=config.heldoutManifest?await loadHeldout(config.heldoutManifest):PUBLIC_CASES.map(task=>({task,...loadCase(task)}));
  const split=config.heldoutManifest?"held-out":"public";
  const budget=new RequestBudget(config.admission);
  for (const m of config.models) if (!config.admission.models.includes(m.id)||!process.env[m.keyEnv]) throw new Error("Missing admitted model or private environment key");
  // Never overwrite earlier traces or replay an uncertain run.
  const out=resolve(outPath);await mkdir(out,{recursive:false});
  const results=[];
  for (const {task,dataset,workflow,checksum} of cases) {
    for (const m of config.models) {
      const trace=await runTask({...m,apiKey:process.env[m.keyEnv]!},workflow,dataset,budget);
      await writeFile(join(out,`${task.id}-${config.models.indexOf(m)}.json`),JSON.stringify({...trace,case:task,split,initialChecksum:checksum},null,2),{flag:"wx"});
      results.push({case:task.id,category:task.category,model:m.id,status:trace.status,pass:taskSucceeded(trace),rawGradePass:trace.grade.pass,score:trace.grade.score});
      await writeFile(join(out,"results.json"),JSON.stringify({scaffold:trace.scaffold,split,requests:budget.used,results},null,2));
      if (trace.status==="failed") throw new Error("Run stopped after a failed/uncertain request; inspect saved trace, do not replay automatically");
    }
  }
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Benchmark failed");process.exitCode=1;});
