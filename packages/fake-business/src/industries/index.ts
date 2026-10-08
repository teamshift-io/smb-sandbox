import type { IndustryId } from "../schema.js";
import { dentalClinic } from "./dental-clinic.js";
import { homeServices } from "./home-services.js";
import { marketingAgency } from "./marketing-agency.js";
import { trailerDealer } from "./trailer-dealer.js";
import type { IndustryProfile } from "./types.js";

/** Every industry is one profile file; add yours here. */
export const PROFILES: Readonly<Record<IndustryId, IndustryProfile>> = {
  "home-services": homeServices,
  "dental-clinic": dentalClinic,
  "marketing-agency": marketingAgency,
  "trailer-dealer": trailerDealer,
};

export interface IndustryInfo {
  id: IndustryId;
  name: string;
  description: string;
  customerKind: "household" | "business";
  /** What this industry calls a quote, a job and a customer. */
  terms: { quote: string; job: string; customer: string };
  offerings: string[];
}

export const INDUSTRIES: readonly IndustryInfo[] = Object.values(PROFILES).map((p) => ({
  id: p.id,
  name: p.name,
  description: p.summary,
  customerKind: p.customerKind,
  terms: { ...p.nouns },
  offerings: p.offerings.filter((o) => o.weight > 0).map((o) => o.title),
}));
