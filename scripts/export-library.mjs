#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { COMPANY_LIBRARY, generateCompany, buildLedger, checkLedger, buildInventory, checkInventory, checkInvariants } from "../packages/fake-business/dist/index.js";

const output = resolve(process.argv[2] ?? "artifacts/library-v1");
mkdirSync(output, { recursive: true });
const companies = [];
for (const entry of COMPANY_LIBRARY) {
  const dataset = generateCompany(entry.id);
  const ledger = buildLedger(dataset);
  const inventory = buildInventory(dataset);
  const report = checkInvariants(dataset);
  const ledgerViolations = checkLedger(ledger);
  const inventoryViolations = checkInventory(inventory);
  if (ledgerViolations.length || inventoryViolations.length) throw new Error(`Invalid mock accounting/stock for ${entry.id}`);
  const payload = JSON.stringify({ id: entry.id, dataset, ledger, inventory, invariants: {
    ...report, notChecked: report.notChecked.filter((rule) => rule !== "double-entry-ledger" && (rule !== "inventory" || inventory.length === 0)), ledgerViolations, inventoryViolations,
    inventoryScope: "completed trailer-sale SKUs only; other industries have no modeled inventory",
  } }) + "\n";
  const compressed = gzipSync(payload);
  const file = `${entry.id}.json.gz`;
  writeFileSync(join(output, file), compressed);
  companies.push({ id: entry.id, name: dataset.company.name, industry: entry.options.industry,
    options: entry.options, file, sha256: createHash("sha256").update(compressed).digest("hex"),
    labeledAnomalies: dataset.anomalies.length, invariantViolations: report.violations.length });
}
writeFileSync(join(output, "manifest.json"), JSON.stringify({ formatVersion: 1, synthetic: true, companies }, null, 2) + "\n");
writeFileSync(join(output, "fictional-names.json"), JSON.stringify({
  synthetic: true, purpose: "Generated company-name registry, not trademark or real-business clearance",
  names: [...new Set(companies.map((company) => company.name))].sort(),
}, null, 2) + "\n");
console.log(`Exported ${companies.length} three-year companies to ${output}`);
