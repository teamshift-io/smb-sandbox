import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect,it } from "vitest";
import { loadCase,PUBLIC_CASES } from "../src/corpus.js";
import { loadHeldout } from "../src/heldout.js";

it("rejects corrupted fixture bytes, false categories and public seeds before provider requests",async()=>{
  const out=await mkdtemp(join(tmpdir(),"smb-bench-owned-heldout-test-"));
  try {
    const task=PUBLIC_CASES.find(c=>c.category==="purchasing")!;
    const {dataset}=loadCase(task);const raw=JSON.stringify(dataset);const sha256=createHash("sha256").update(raw).digest("hex");
    await writeFile(join(out,"fixture.json"),raw);
    const manifest={split:"held-out",cases:Array.from({length:100},(_,i)=>({id:`private-${i}`,workflow:task.workflow,category:task.category,fixture:"fixture.json",sha256}))};
    const path=join(out,"manifest.json");await writeFile(path,JSON.stringify(manifest));
    await expect(loadHeldout(path)).rejects.toThrow("Public company seeds");
    manifest.cases[0]!.category="scheduling";await writeFile(path,JSON.stringify(manifest));
    await expect(loadHeldout(path)).rejects.toThrow("Category does not match");
    manifest.cases[0]!.category=task.category;await writeFile(path,JSON.stringify(manifest));await writeFile(join(out,"fixture.json"),raw+" ");
    await expect(loadHeldout(path)).rejects.toThrow("checksum mismatch");
  } finally {await rm(out,{recursive:true});}
});
