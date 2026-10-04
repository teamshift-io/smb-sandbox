import type { Contact } from "@teamshift/fake-business";
import type { SandboxStore } from "@teamshift/sandbox-mcp";
import { isValidEmail, isValidPhone } from "./text.js";

/** The id when that employee is active (so the store accepts it as sender/assignee), else undefined. */
export function activeEmployeeId(store: SandboxStore, id: string | null | undefined): string | undefined {
  return id && store.listEmployees().some((e) => e.id === id) ? id : undefined;
}

/** The first contact of a customer reachable by email, else by SMS. */
export function reachableContact(store: SandboxStore, customerId: string): { contact: Contact; channel: "email" | "sms" } | null {
  const contacts = store.searchContacts({ customerId, limit: 100 }).items.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const byEmail = contacts.find((c) => isValidEmail(c.email));
  if (byEmail) return { contact: byEmail, channel: "email" };
  const byPhone = contacts.find((c) => isValidPhone(c.phone));
  return byPhone ? { contact: byPhone, channel: "sms" } : null;
}
