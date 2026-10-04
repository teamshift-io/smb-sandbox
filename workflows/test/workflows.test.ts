import { describe, expect, it } from "vitest";
import { generate, type Dataset, type IndustryId } from "@teamshift/fake-business";
import { SandboxStore } from "@teamshift/sandbox-mcp";
import { getWorkflow, parseStateFile, stateOf, untouchedState, WORKFLOWS } from "../src/index.js";
import { parseFrontmatter, section } from "../src/lib/workflow.js";
import { SLOPPY } from "./sloppy.js";

const INDUSTRIES: IndustryId[] = ["home-services", "dental-clinic", "marketing-agency"];
const SEEDS = [1, 7, 42];

const cache = new Map<string, Dataset>();
function dataset(industry: IndustryId, seed: number): Dataset {
  const key = `${industry}:${seed}`;
  let ds = cache.get(key);
  if (!ds) {
    ds = generate({ industry, seed, size: "medium", messiness: 1 });
    cache.set(key, ds);
  }
  return ds;
}

const failing = (r: { checks: Array<{ id: string; pass: boolean; detail: string }> }) =>
  r.checks.filter((c) => !c.pass).map((c) => `${c.id}: ${c.detail}`);

describe("registry", () => {
  it("has 10 uniquely named workflows that never need the admin toolset", () => {
    expect(WORKFLOWS).toHaveLength(10);
    expect(new Set(WORKFLOWS.map((w) => w.id)).size).toBe(10);
    for (const wf of WORKFLOWS) {
      expect(wf.toolsets).not.toContain("admin");
      expect(wf.toolsets.length).toBeGreaterThan(0);
      expect(["easy", "medium", "hard"]).toContain(wf.difficulty);
      expect(wf.estSteps).toBeGreaterThan(0);
    }
  });

  it("every task.md has frontmatter, a prompt and a good-result section", () => {
    for (const wf of WORKFLOWS) {
      const { data, body } = parseFrontmatter(wf.taskMarkdown);
      expect(data.id).toBe(wf.id);
      expect(section(body, "Prompt").length).toBeGreaterThan(100);
      expect(section(body, "What a good result looks like").length).toBeGreaterThan(50);
    }
  });

  it("getWorkflow rejects unknown ids with the valid list", () => {
    expect(() => getWorkflow("nope")).toThrow(/quote-follow-up/);
  });
});

describe.each(INDUSTRIES)("%s", (industry) => {
  describe.each(SEEDS)("seed %i", (seed) => {
    describe.each(WORKFLOWS.map((w) => [w.id, w] as const))("%s", (_id, wf) => {
      it("prompt renders for this business with no leftover placeholders", () => {
        const ds = dataset(industry, seed);
        const prompt = wf.prompt(ds);
        expect(prompt).not.toMatch(/\{\{|\}\}/);
        expect(prompt).not.toMatch(/admin_|anomal/i);
        expect(prompt.length).toBeGreaterThan(150);
      });

      it("fails on the untouched dataset", () => {
        const ds = dataset(industry, seed);
        const r = wf.verify(ds, untouchedState(ds));
        expect(r.pass).toBe(false);
        expect(r.score).toBeLessThan(1);
      });

      it("passes with score 1 after the reference solution", () => {
        const ds = dataset(industry, seed);
        const store = new SandboxStore(ds);
        wf.solve(store, ds);
        const r = wf.verify(ds, stateOf(store));
        expect(failing(r)).toEqual([]);
        expect(r.pass).toBe(true);
        expect(r.score).toBe(1);
        expect(store.audit().filter((e) => e.result === "error")).toEqual([]);
      });

      it(`fails for a sloppy agent: ${SLOPPY[wf.id]!.mistake}`, () => {
        const ds = dataset(industry, seed);
        const store = new SandboxStore(ds);
        SLOPPY[wf.id]!.run(store, ds);
        const r = wf.verify(ds, stateOf(store));
        expect(r.pass).toBe(false);
        expect(r.score).toBeLessThan(1);
      });
    });
  });
});

describe("state file compatibility", () => {
  it("grades the exact JSON sandbox-mcp --state-out writes", () => {
    const ds = dataset("home-services", 42);
    const wf = getWorkflow("stale-deal-next-actions");
    const store = new SandboxStore(ds);
    wf.solve(store, ds);
    const onDisk = parseStateFile(JSON.parse(JSON.stringify(stateOf(store))));
    expect(Object.keys(onDisk).sort()).toEqual(["audit", "dataset", "outbox", "savedAt", "simulatedNow"]);
    expect(wf.verify(ds, onDisk).pass).toBe(true);
  });

  it("rejects files that are not state files", () => {
    expect(() => parseStateFile({ foo: 1 })).toThrow(/dataset/);
    expect(() => parseStateFile({ dataset: dataset("home-services", 42), audit: [] })).toThrow(/outbox/);
  });

  it("flags a state from a different business", () => {
    const ds = dataset("home-services", 42);
    const other = dataset("dental-clinic", 42);
    const r = getWorkflow("dedupe-contacts").verify(ds, untouchedState(other));
    expect(r.checks.find((c) => c.id === "same-business")?.pass).toBe(false);
  });
});

describe("common rules", () => {
  it("fails a run that resets the sandbox", () => {
    const ds = dataset("dental-clinic", 7);
    const wf = getWorkflow("stale-deal-next-actions");
    const store = new SandboxStore(ds);
    wf.solve(store, ds);
    const state = stateOf(store);
    state.audit.push({ seq: state.audit.length + 1, at: state.simulatedNow, tool: "admin_reset", input: {}, result: "ok", changedIds: [] });
    const r = wf.verify(ds, state);
    expect(r.checks.find((c) => c.id === "no-admin-actions")?.pass).toBe(false);
  });

  it("fails a run with an unrelated side effect", () => {
    const ds = dataset("marketing-agency", 1);
    const wf = getWorkflow("speed-to-lead");
    const store = new SandboxStore(ds);
    wf.solve(store, ds);
    const won = ds.deals.find((d) => d.stage === "lost")!;
    store.updateDeal({ dealId: won.id, stage: "qualified" });
    const r = wf.verify(ds, stateOf(store));
    expect(r.checks.find((c) => c.id === "no-out-of-scope-changes")?.pass).toBe(false);
  });

  it("enforces the dental privacy policy on texts", () => {
    const ds = dataset("dental-clinic", 1);
    const wf = getWorkflow("missed-call-callback");
    const store = new SandboxStore(ds);
    wf.solve(store, ds);
    const caller = ds.calls.find((c) => c.direction === "inbound" && c.outcome === "voicemail" && c.contactId)!;
    store.sendSms({ to: caller.from, body: `About your ${ds.jobs[0]!.title}: please call us.` });
    const r = wf.verify(ds, stateOf(store));
    expect(r.checks.find((c) => c.id === "policy-privacy-in-messages")?.pass).toBe(false);
  });
});
