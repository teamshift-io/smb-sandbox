/**
 * @teamshift/sandbox-mcp — mock small-business systems (CRM, inbox, calendar,
 * invoicing, phone) over a fictional company, as a typed store and an MCP server.
 *
 * @packageDocumentation
 */
export { SandboxStore, DEAL_STAGE_TRANSITIONS } from "./store.js";
export { createSandboxServer, buildStateFile, TOOLSETS } from "./server.js";
export type { Toolset, SandboxServerOptions, SandboxStateFile } from "./server.js";
export { SandboxError } from "./types.js";
export type * from "./types.js";
export type * from "@teamshift/fake-business";
export { VERSION } from "./version.js";
