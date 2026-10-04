import { buildStateFile, type AuditEntry, type SandboxStateFile, type SandboxStore } from "@teamshift/sandbox-mcp";
import type { Dataset, Message } from "@teamshift/fake-business";

/**
 * What a verifier grades: the end state of a sandbox run. This is exactly the
 * document `sandbox-mcp --state-out` / `admin_save_state` writes
 * ({@link SandboxStateFile}); `savedAt` and `simulatedNow` are optional here.
 */
export interface GradeState {
  savedAt?: string;
  simulatedNow?: string;
  dataset: Dataset;
  audit: AuditEntry[];
  outbox: Message[];
}

/** The state file for a store, byte-compatible with `sandbox-mcp --state-out`. */
export function stateOf(store: SandboxStore): SandboxStateFile {
  return buildStateFile(store);
}

/** A state with nothing done: the dataset as generated, empty audit and outbox. */
export function untouchedState(dataset: Dataset): GradeState {
  return { dataset: structuredClone(dataset), audit: [], outbox: [] };
}

/** Validates a parsed `--state-out` JSON document. Throws a descriptive Error when it is not one. */
export function parseStateFile(value: unknown): GradeState {
  const v = value as Partial<SandboxStateFile> | null;
  if (!v || typeof v !== "object") throw new Error("State file must be a JSON object.");
  if (!v.dataset || typeof v.dataset !== "object" || !v.dataset.meta || !Array.isArray(v.dataset.contacts)) {
    throw new Error('State file has no "dataset" — expected the JSON written by sandbox-mcp --state-out.');
  }
  if (!Array.isArray(v.audit)) throw new Error('State file has no "audit" array.');
  if (!Array.isArray(v.outbox)) throw new Error('State file has no "outbox" array.');
  return v as GradeState;
}

/** Validates a parsed dataset JSON (from fake-business). */
export function parseDataset(value: unknown): Dataset {
  const v = value as Partial<Dataset> | null;
  if (!v || typeof v !== "object" || !v.meta || !v.company || !Array.isArray(v.anomalies)) {
    throw new Error("Initial file is not a fake-business Dataset (needs meta, company and anomalies).");
  }
  return v as Dataset;
}
