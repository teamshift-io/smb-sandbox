import { DEFAULT_AS_OF, generate } from "./generate.js";
import type { Dataset, GenerateOptions, IndustryId } from "./schema.js";

export interface CompanyLibraryEntry {
  readonly id: string;
  readonly options: Readonly<GenerateOptions>;
}

const LIBRARY_INDUSTRIES: readonly IndustryId[] = ["home-services", "dental-clinic", "marketing-agency", "trailer-dealer"];

/** Stable, ready-to-load companies; generate lazily to avoid retaining 100 datasets. */
export const COMPANY_LIBRARY: readonly CompanyLibraryEntry[] = Object.freeze(
  Array.from({ length: 100 }, (_, index) => Object.freeze({
    id: `company-${String(index + 1).padStart(3, "0")}`,
    options: Object.freeze({
      industry: LIBRARY_INDUSTRIES[index % LIBRARY_INDUSTRIES.length]!,
      seed: 4941000 + index,
      size: "medium" as const,
      asOf: DEFAULT_AS_OF,
      months: 36,
      messiness: 1,
      calibrated: true,
    }),
  })),
);

/** Returns fresh data, so one caller's repairs never alter another caller's fixture. */
export function generateCompany(id: string): Dataset {
  const entry = COMPANY_LIBRARY.find((entry) => entry.id === id);
  if (!entry) throw new RangeError(`Unknown company "${id}"`);
  return generate(entry.options);
}
