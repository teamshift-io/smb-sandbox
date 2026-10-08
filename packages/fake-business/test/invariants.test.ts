import { describe, expect, it } from "vitest";
import { checkInvariants, generate } from "../src/index.js";

describe("public dataset invariants", () => {
  it("accepts clean generated money and job links without pretending absent inventory exists", () => {
    const report = checkInvariants(generate({ industry: "home-services", seed: 42, messiness: 0 }));
    expect(report.violations.filter((issue) => issue.rule !== "staff-overlap")).toEqual([]);
    expect(report.notChecked).toContain("inventory");
    expect(report.notChecked).toContain("double-entry-ledger");
  });
  it("reports wrong-job labels as violations rather than hiding benchmark anomalies", () => {
    const dataset = generate({ industry: "home-services", seed: 42 });
    const wrong = dataset.anomalies.find((a) => a.kind === "invoice-wrong-job")!;
    expect(checkInvariants(dataset).violations.some((issue) => issue.rule === "invoice-job" && issue.recordIds.includes(wrong.recordIds[0]!))).toBe(true);
  });
  it("detects corrupted invoice arithmetic, missing jobs and employee overlaps", () => {
    const dataset = generate({ industry: "home-services", seed: 42, messiness: 0 });
    dataset.invoices[0]!.totalCents++;
    dataset.invoices[1]!.jobId = "job_missing";
    const job = dataset.jobs.find((job) => job.status !== "canceled" && job.assigneeIds.length)!;
    dataset.jobs.push({ ...job, id: "job_duplicate", assigneeIds: [...job.assigneeIds] });
    const rules = checkInvariants(dataset).violations.map((issue) => issue.rule);
    expect(rules).toContain("invoice-total");
    expect(rules).toContain("invoice-job");
    expect(rules).toContain("staff-overlap");
  });
});
