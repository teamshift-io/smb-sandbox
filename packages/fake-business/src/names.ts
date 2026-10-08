import type { Dataset } from "./schema.js";

export interface NameMatch { recordId: string; name: string; registryName: string; similarity: number }

function normalize(name: string): string {
  return name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((word) => word && !["llc", "inc", "incorporated", "ltd", "limited", "co", "company", "corp", "corporation"].includes(word)).join(" ");
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return 1 - previous[b.length]! / Math.max(a.length, b.length);
}

/** Screen against an explicit caller-supplied registry; this is not trademark clearance. */
export function checkFictionalNames(dataset: Dataset, registry: readonly string[], threshold = 0.85): NameMatch[] {
  if (!registry.length || registry.some((name) => !normalize(name))) throw new RangeError("A non-empty name registry is required");
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new RangeError("Name similarity threshold must be between 0 and 1");
  const names = [{ id: dataset.company.id, name: dataset.company.name },
    ...dataset.customers.filter((customer) => customer.kind === "business").map((customer) => ({ id: customer.id, name: customer.name }))];
  const normalized = registry.map((name) => ({ name, normalized: normalize(name) }));
  return names.flatMap((record) => normalized.flatMap((entry) => {
    const score = similarity(normalize(record.name), entry.normalized);
    return score >= threshold ? [{ recordId: record.id, name: record.name, registryName: entry.name, similarity: score }] : [];
  }));
}
