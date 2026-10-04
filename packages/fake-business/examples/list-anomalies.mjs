// List the labeled "mess" in a dataset: the ground truth an agent should find.
// Run after `pnpm build`:  node examples/list-anomalies.mjs [industry] [seed]
import { generate } from "../dist/index.js";

const industry = process.argv[2] ?? "marketing-agency";
const seed = Number(process.argv[3] ?? 42);
const data = generate({ industry, seed });

const byKind = {};
for (const a of data.anomalies) (byKind[a.kind] ??= []).push(a);
for (const [kind, items] of Object.entries(byKind)) {
  console.log(`\n${kind} (${items.length})`);
  for (const a of items) {
    const risk = a.amountAtRiskCents ? `  [$${(a.amountAtRiskCents / 100).toFixed(2)} at risk]` : "";
    console.log(`  - ${a.description}${risk}`);
    console.log(`    records: ${a.recordIds.join(", ")}`);
  }
}
