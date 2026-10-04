import type { Dataset } from "@teamshift/fake-business";
import type { SandboxStore, Toolset } from "@teamshift/sandbox-mcp";
import { cap, context, firstName } from "./context.js";
import type { GradeState } from "./state.js";
import type { VerifyResult } from "./verify-kit.js";

export type Difficulty = "easy" | "medium" | "hard";

export interface WorkflowMeta {
  id: string;
  title: string;
  difficulty: Difficulty;
  /** Business systems involved, e.g. ["crm", "inbox"]. */
  systems: string[];
  /** sandbox-mcp toolsets the agent needs (never `admin`). */
  toolsets: Toolset[];
  /** Rough number of tool calls a competent agent needs. */
  estSteps: number;
}

export interface Workflow extends WorkflowMeta {
  /** Raw task.md (frontmatter + prompt template + "What a good result looks like"). */
  taskMarkdown: string;
  /** The task prompt for this dataset, written the way an owner would hand it over. */
  prompt(dataset: Dataset): string;
  /** Grades the end state of a run against the initial dataset. */
  verify(initial: Dataset, state: GradeState): VerifyResult;
  /** Reference solution: performs the task on a store built from `initial`. */
  solve(store: SandboxStore, initial: Dataset): void;
}

export interface WorkflowParts {
  /** Workflow-specific template variables, merged over the common ones. */
  vars?: (dataset: Dataset) => Record<string, string>;
  verify: Workflow["verify"];
  solve: Workflow["solve"];
}

/** Minimal frontmatter parser: `key: value` and `key: [a, b]` lines. */
export function parseFrontmatter(md: string): { data: Record<string, string | string[]>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) throw new Error("task.md must start with a --- frontmatter block.");
  const data: Record<string, string | string[]> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const raw = kv[2]!.trim();
    data[kv[1]!] = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean) : raw.replace(/^["']|["']$/g, "");
  }
  return { data, body: m[2]! };
}

/** The text under `## <heading>` up to the next `## ` heading. */
export function section(body: string, heading: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) throw new Error(`task.md has no "## ${heading}" section.`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

export function render(template: string, vars: Record<string, string>): string {
  const out = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined) throw new Error(`Unknown template variable {{${key}}}.`);
    return v;
  });
  // Collapse blank lines left by empty optional blocks.
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function longDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Variables every prompt may use. */
export function commonVars(ds: Dataset): Record<string, string> {
  const c = context(ds);
  return {
    company: ds.company.name,
    today: `${longDate(c.today)} (${c.today})`,
    quote: c.terms.quote,
    Quote: cap(c.terms.quote),
    job: c.terms.job,
    customer: c.terms.customer,
    Customer: cap(c.terms.customer),
    owner: c.owner.name,
    ownerFirst: firstName(c.owner),
    ownerEmail: c.owner.email,
    phoneHandler: c.phoneHandler.name,
    bookkeeper: c.bookkeeper.name,
    salesperson: c.salesperson.name,
  };
}

export function defineWorkflow(taskMarkdown: string, parts: WorkflowParts): Workflow {
  const { data, body } = parseFrontmatter(taskMarkdown);
  const str = (k: string): string => {
    const v = data[k];
    if (typeof v !== "string" || !v) throw new Error(`task.md frontmatter needs "${k}".`);
    return v;
  };
  const list = (k: string): string[] => {
    const v = data[k];
    if (!Array.isArray(v)) throw new Error(`task.md frontmatter "${k}" must be a [list].`);
    return v;
  };
  const toolsets = list("toolsets") as Toolset[];
  if (toolsets.includes("admin")) throw new Error("Workflows must not require the admin toolset.");
  const template = section(body, "Prompt");
  return {
    id: str("id"),
    title: str("title"),
    difficulty: str("difficulty") as Difficulty,
    systems: list("systems"),
    toolsets,
    estSteps: Number(str("est_steps")),
    taskMarkdown,
    prompt: (ds) => render(template, { ...commonVars(ds), ...(parts.vars?.(ds) ?? {}) }),
    verify: parts.verify,
    solve: parts.solve,
  };
}
