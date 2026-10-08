#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  toCSVFiles,
  toHubSpotImportCSVs,
  toJSON,
  toNDJSONEvents,
  toQuickBooksImportCSVs,
  toSQL,
} from "./exporters/index.js";
import { DEFAULT_AS_OF, GENERATOR_VERSION, generate } from "./generate.js";
import { COMPANY_LIBRARY, generateCompany } from "./library.js";
import { INDUSTRIES } from "./industries/index.js";
import type { GenerateOptions, IndustryId } from "./schema.js";
import { formatSummary } from "./summary.js";

const FORMATS = ["json", "ndjson", "csv", "sql-sqlite", "sql-postgres", "hubspot", "quickbooks"] as const;
type Format = (typeof FORMATS)[number];

const HELP = `fake-business ${GENERATOR_VERSION} — generate a realistic, fully fictional small business

Usage
  npx @teamshift/fake-business [options]

Options
  --industry <id>     ${INDUSTRIES.map((i) => i.id).join(" | ")}  (default home-services)
  --seed <n>          integer seed; same options => byte-identical output (default 42)
  --size <s>          small (~15 customers) | medium (~40) | large (~150)  (default medium)
  --as-of <date>      simulated "today", YYYY-MM-DD (default ${DEFAULT_AS_OF})
  --months <n>        months of history before --as-of (default 12)
  --messiness <x>     anomaly multiplier, 0 = perfectly clean (default 1)
  --format <f>        ${FORMATS.join(" | ")}  (default json)
  --out <path>        file for json/ndjson/sql, directory for csv/hubspot/quickbooks
  --summary           print a short human summary instead of data (or as well, with --out)
  --calibrated        opt in to measured aggregate medium staffing with source metadata
  --company <id>      load a ready-made calibrated three-year company (no generation overrides)
  --list-companies    list the 100 ready-made company IDs and industries
  --list-industries   list available industries and exit
  -h, --help          show this help
  -v, --version       print version

Examples
  npx @teamshift/fake-business --industry dental-clinic --seed 7 --summary
  npx @teamshift/fake-business --format sql-sqlite --out business.sql
  npx @teamshift/fake-business --industry marketing-agency --format csv --out ./agency-csv
  npx @teamshift/fake-business --messiness 0 > clean.json

All names, emails (.example), phone numbers (555-01xx) and addresses are fictional.
Docs: https://teamshift.io/open-source/smb-sandbox`;

class UsageError extends Error {}

function int(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  if (!/^-?\d+$/.test(raw)) throw new UsageError(`--${name} must be an integer, got "${raw}"`);
  return Number(raw);
}

function render(format: Format, data: ReturnType<typeof generate>): string | Record<string, string> {
  switch (format) {
    case "json":
      return toJSON(data);
    case "ndjson":
      return toNDJSONEvents(data);
    case "csv":
      return toCSVFiles(data);
    case "sql-sqlite":
      return toSQL(data, "sqlite");
    case "sql-postgres":
      return toSQL(data, "postgres");
    case "hubspot":
      return toHubSpotImportCSVs(data);
    case "quickbooks":
      return toQuickBooksImportCSVs(data);
  }
}

function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      industry: { type: "string" },
      seed: { type: "string" },
      size: { type: "string" },
      "as-of": { type: "string" },
      months: { type: "string" },
      messiness: { type: "string" },
      format: { type: "string" },
      out: { type: "string", short: "o" },
      summary: { type: "boolean" },
      "list-industries": { type: "boolean" },
      calibrated: { type: "boolean" },
      company: { type: "string" },
      "list-companies": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${GENERATOR_VERSION}\n`);
    return 0;
  }
  if (values["list-industries"]) {
    for (const i of INDUSTRIES) {
      process.stdout.write(`${i.id.padEnd(18)} ${i.description}\n${"".padEnd(18)} offerings: ${i.offerings.join(", ")}\n`);
    }
    return 0;
  }

  if (values["list-companies"]) {
    for (const entry of COMPANY_LIBRARY) process.stdout.write(`${entry.id} ${entry.options.industry} ${entry.options.months} months\n`);
    return 0;
  }
  if (values.company && (["industry", "seed", "size", "as-of", "months", "messiness", "calibrated"] as const).some((key) => values[key] !== undefined)) {
    throw new UsageError("--company cannot be combined with generation overrides");
  }

  const industry = (values.industry ?? "home-services") as IndustryId;
  if (!INDUSTRIES.some((i) => i.id === industry)) {
    throw new UsageError(`Unknown --industry "${industry}". Try --list-industries.`);
  }
  const size = values.size ?? "medium";
  if (!["small", "medium", "large"].includes(size)) throw new UsageError(`--size must be small, medium or large, got "${size}"`);
  const format = (values.format ?? "json") as Format;
  if (!FORMATS.includes(format)) throw new UsageError(`--format must be one of ${FORMATS.join(", ")}, got "${format}"`);
  const messinessRaw = values.messiness ?? "1";
  const messiness = Number(messinessRaw);
  if (!/^\d+(\.\d+)?$/.test(messinessRaw) || !Number.isFinite(messiness)) throw new UsageError(`--messiness must be a number >= 0, got "${messinessRaw}"`);

  const opts: GenerateOptions = {
    industry,
    seed: int("seed", values.seed, 42),
    size: size as GenerateOptions["size"],
    asOf: values["as-of"] ?? DEFAULT_AS_OF,
    months: int("months", values.months, 12),
    messiness,
    ...(values.calibrated ? { calibrated: true } : {}),
  };
  let data: ReturnType<typeof generate>;
  try {
    data = values.company ? generateCompany(values.company) : generate(opts);
  } catch (e) {
    throw new UsageError((e as Error).message);
  }

  if (values.summary && !values.out) {
    process.stdout.write(formatSummary(data));
    return 0;
  }

  const output = render(format, data);
  if (typeof output === "string") {
    if (values.out) {
      const file = resolve(values.out);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, output);
      process.stderr.write(`Wrote ${file}\n`);
    } else process.stdout.write(output);
  } else {
    const dir = resolve(values.out ?? `fake-business-${industry}-${opts.seed}-${format}`);
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(output)) writeFileSync(join(dir, name), content);
    process.stderr.write(`Wrote ${Object.keys(output).length} files to ${dir}\n`);
  }
  if (values.summary) process.stdout.write(formatSummary(data));
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`fake-business: ${msg}\nRun with --help for usage.\n`);
  process.exitCode = 2;
}
