import { INDUSTRIES, type Dataset, type Employee, type EmployeeRole } from "@teamshift/fake-business";
import { zonedTimeToUtcMs } from "./time.js";

/** Facts about the business every prompt, verifier and solution agrees on. */
export interface BizContext {
  ds: Dataset;
  tz: string;
  /** Simulated "today" (YYYY-MM-DD, company time). */
  today: string;
  /** When the sandbox clock starts: 09:00 company time on `today` (same as SandboxStore). */
  startMs: number;
  terms: { quote: string; job: string; customer: string };
  owner: Employee;
  /** Who returns phone calls. */
  phoneHandler: Employee;
  /** Who handles payments and invoice corrections. */
  bookkeeper: Employee;
  /** Who owns new leads. */
  salesperson: Employee;
}

function pick(ds: Dataset, roles: EmployeeRole[]): Employee {
  for (const role of roles) {
    const e = ds.employees.find((x) => x.active && x.role === role);
    if (e) return e;
  }
  const any = ds.employees.find((x) => x.active);
  if (!any) throw new Error("Dataset has no active employees.");
  return any;
}

export function context(ds: Dataset): BizContext {
  const info = INDUSTRIES.find((i) => i.id === ds.meta.industry);
  return {
    ds,
    tz: ds.company.timezone,
    today: ds.meta.asOf,
    startMs: zonedTimeToUtcMs(ds.meta.asOf, 9, 0, ds.company.timezone),
    terms: info ? { ...info.terms } : { quote: "quote", job: "job", customer: "customer" },
    owner: pick(ds, ["owner"]),
    phoneHandler: pick(ds, ["front-desk", "dispatcher", "office-manager", "account-manager", "owner"]),
    bookkeeper: pick(ds, ["bookkeeper", "office-manager", "owner"]),
    salesperson: pick(ds, ["sales", "account-manager", "front-desk", "office-manager", "owner"]),
  };
}

export function firstName(e: { name: string }): string {
  return e.name.split(" ")[0] ?? e.name;
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
