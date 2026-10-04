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
