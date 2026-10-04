// Generate a business and list invoices that are past due as of the simulated "today".
// Run after `pnpm build`:  node examples/overdue-invoices.mjs
import { generate } from "../dist/index.js";

const data = generate({ industry: "home-services", seed: 42 });
const customers = new Map(data.customers.map((c) => [c.id, c]));
const usd = (cents) => `$${(cents / 100).toFixed(2)}`;

const overdue = data.invoices.filter(
  (inv) => (inv.status === "open" || inv.status === "partially-paid") && inv.dueOn < data.meta.asOf,
);

console.log(`${data.company.name}: ${overdue.length} overdue invoice(s) as of ${data.meta.asOf}\n`);
for (const inv of overdue) {
  const balance = inv.totalCents - inv.paidCents;
  console.log(`${inv.number}  ${customers.get(inv.customerId)?.name.padEnd(28)} due ${inv.dueOn}  balance ${usd(balance)}`);
}
