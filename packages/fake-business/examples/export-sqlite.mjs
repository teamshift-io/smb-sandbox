// Export a dataset as a SQLite script, then (on Node 22.13+) load it and run a query.
// Run after `pnpm build`:  node examples/export-sqlite.mjs [out.sql]
import { writeFileSync } from "node:fs";
import { generate, toSQL } from "../dist/index.js";

const out = process.argv[2] ?? "dental-clinic.sql";
const data = generate({ industry: "dental-clinic", seed: 7 });
const sql = toSQL(data, "sqlite");
writeFileSync(out, sql);
console.log(`Wrote ${out} (${sql.split("\n").length} lines). Load it with: sqlite3 dental.db < ${out}`);

try {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec(sql);
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS n, SUM(total_cents) / 100.0 AS total FROM invoices GROUP BY status ORDER BY n DESC`)
    .all();
  console.table(rows);
} catch {
  console.log("(node:sqlite not available on this Node version; skipping the query)");
}
