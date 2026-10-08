/**
 * @teamshift/fake-business — a realistic, fully fictional small business for
 * testing AI agents, integrations, demos and CRMs.
 */
export * from "./schema.js";
export { generate } from "./generate.js";
export { INDUSTRIES } from "./industries/index.js";
export type { IndustryInfo } from "./industries/index.js";
export {
  toJSON,
  toNDJSONEvents,
  toCSVFiles,
  toSQL,
  toHubSpotImportCSVs,
  toQuickBooksImportCSVs,
} from "./exporters/index.js";
export { COMPANY_LIBRARY, generateCompany } from "./library.js";
export type { CompanyLibraryEntry } from "./library.js";
export { checkInvariants } from "./invariants.js";
export type { InvariantViolation, InvariantReport } from "./invariants.js";
export { buildLedger, checkLedger } from "./ledger.js";
export type { LedgerAccount, LedgerLine, LedgerEntry, LedgerViolation } from "./ledger.js";
export { buildInventory, checkInventory } from "./inventory.js";
export type { InventoryMovement, InventoryViolation } from "./inventory.js";
export { checkFictionalNames } from "./names.js";
export type { NameMatch } from "./names.js";
export { CALIBRATION } from "./calibration.js";
export type { Calibration } from "./calibration.js";
