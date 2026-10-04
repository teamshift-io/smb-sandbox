import type { Dataset } from "@teamshift/fake-business";
import type { SandboxStore } from "@teamshift/sandbox-mcp";
import { duplicatePairs } from "./verify.js";

export function solve(store: SandboxStore, initial: Dataset): void {
  for (const { dup, orig } of duplicatePairs(initial)) {
    // Keep the record linked to the customer account; fold the duplicate into it.
    store.mergeContacts({ keepId: orig.customerId ? orig.id : dup.id, mergeId: orig.customerId ? dup.id : orig.id });
  }
}
