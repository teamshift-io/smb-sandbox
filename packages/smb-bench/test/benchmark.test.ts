import { describe,it,expect } from "vitest";
import { SandboxStore } from "@teamshift/sandbox-mcp";
import { stateOf,untouchedState } from "@teamshift/smb-workflows";
import { PUBLIC_CASES,loadCase } from "../src/corpus.js";
import { RequestBudget,runTask,taskSucceeded } from "../src/runner.js";

const model={id:"offline-fixture",model:"offline-fixture",baseUrl:"https://provider.example.invalid/v1",apiKey:"synthetic-test-only"};
function budget(maxRequests=3) {return new RequestBudget({authority:"offline-test-no-provider",models:[model.id],maxRequests,maxCompletionTokens:2048*maxRequests});}
function response(message:unknown) {return new Response(JSON.stringify({choices:[{message}],usage:{completion_tokens:1}}),{status:200});}

describe("public corpus",()=>{
  it("has exactly 100 unique reproducible instances across six categories, without held-out fixtures",()=>{
    expect(PUBLIC_CASES).toHaveLength(100);expect(new Set(PUBLIC_CASES.map(t=>t.id)).size).toBe(100);
    expect(new Set(PUBLIC_CASES.map(t=>t.category)).size).toBe(6);
    expect(PUBLIC_CASES.every(t=>t.split==="public")).toBe(true);
    expect(loadCase(PUBLIC_CASES[0]!).checksum).toBe(loadCase(PUBLIC_CASES[0]!).checksum);
  });
  for (const task of PUBLIC_CASES) it(`${task.id} ${task.workflow}: untouched fails, reference passes`,()=>{
    const {dataset,workflow}=loadCase(task);
    expect(workflow.prompt(dataset).length).toBeGreaterThan(50);
    expect(workflow.verify(dataset,untouchedState(dataset)).pass).toBe(false);
    const store=new SandboxStore(dataset);workflow.solve(store,dataset);
    const grade=workflow.verify(dataset,stateOf(store));expect(grade.checks.filter(c=>!c.pass)).toEqual([]);expect(grade.score).toBe(1);
  });
  for (const category of ["purchasing","warranty","dispatch"]) it(`${category} handoff rejects wrong target, duplicate and unsupported promises`,()=>{
    const task=PUBLIC_CASES.find(t=>t.workflow===`${category}-review-handoff`)!;
    const {dataset,workflow}=loadCase(task);
    const store=new SandboxStore(dataset);workflow.solve(store,dataset);
    const state=stateOf(store);const added=state.dataset.tasks.at(-1)!;
    added.title+="; order placed, coverage approved";expect(workflow.verify(dataset,state).pass).toBe(false);
    const store2=new SandboxStore(dataset);workflow.solve(store2,dataset);workflow.solve(store2,dataset);
    expect(workflow.verify(dataset,stateOf(store2)).pass).toBe(false);
  });
});
describe("native MCP scaffold",()=>{
  it("executes actual MCP writes from a simulated provider response and grades final state",async()=>{
    const task=PUBLIC_CASES.find(t=>t.category==="purchasing")!;
    const {dataset,workflow}=loadCase(task);
    const reference=new SandboxStore(dataset);workflow.solve(reference,dataset);
    const newTask=reference.snapshot().tasks.at(-1)!;
    let requests=0;
    const trace=await runTask(model,workflow,dataset,budget(),async(_url,init)=>{
      requests++;
      const payload=JSON.parse(init!.body as string);
      expect(payload.tools.some((t:any)=>t.function.name==="admin_reset")).toBe(false);
      return requests===1?response({role:"assistant",tool_calls:[{id:"1",type:"function",function:{name:"crm_create_task",arguments:JSON.stringify({title:newTask.title,assigneeId:newTask.assigneeId,dueOn:newTask.dueOn,relatedIds:newTask.relatedIds})}}]}):response({role:"assistant",content:"Done"});
    });
    expect(trace.modelPin).toBe(model.model);expect(trace.provider).toBe(model.baseUrl);
    expect(taskSucceeded(trace)).toBe(true);
    expect(taskSucceeded({...trace,status:"failed"})).toBe(false);
    expect(taskSucceeded({...trace,status:"step_limit"})).toBe(false);
    expect(trace.status).toBe("completed");expect(trace.grade.pass).toBe(true);expect(requests).toBe(2);expect(trace.messages.filter(m=>m.role==="tool")).toHaveLength(1);
  });
  it("does not retry failures or persist an error containing a key",async()=>{
    const {dataset,workflow}=loadCase(PUBLIC_CASES[0]!);let requests=0;
    const trace=await runTask(model,workflow,dataset,budget(),async()=>{requests++;throw new Error(model.apiKey);});
    expect(requests).toBe(1);expect(trace.status).toBe("failed");expect(JSON.stringify(trace)).not.toContain(model.apiKey);
  });
  it("stops before a request outside admission",async()=>{
    const {dataset,workflow}=loadCase(PUBLIC_CASES[0]!);let requests=0;
    const b=budget(1);b.take(model.id);
    const trace=await runTask(model,workflow,dataset,b,async()=>{requests++;return response({role:"assistant",content:"Done"});});
    expect(requests).toBe(0);expect(trace.error).toBe("Provider admission exhausted");
  });
});
