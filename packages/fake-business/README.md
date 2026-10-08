# fake-business

fake-business is an open-source generator of realistic, fully fictional small-business datasets — CRM, quotes, jobs, invoices, emails, calls and an event timeline — for testing AI agents and integrations.

Every record links into a believable history (lead → deal → quote → job → invoice → payment), every message references real record numbers, dates and amounts, and realistic mess such as an unanswered lead or an invoice attached to the wrong job is injected on purpose and **labeled**, so you can score an agent against ground truth.

```bash
npx @teamshift/fake-business --industry home-services --seed 42 > business.json
```

[![npm](https://img.shields.io/npm/v/@teamshift/fake-business.svg)](https://www.npmjs.com/package/@teamshift/fake-business)
![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)
![runtime deps](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen.svg)

- **Coherent, not random.** One business, one timeline. Records reference each other by id, every timestamp is causally ordered, and staff activity follows the company's business hours and timezone.
- **Deterministic.** Same `(industry, seed, size, asOf, months, messiness)` → byte-identical output, on any machine, forever. No Faker, no network, zero runtime dependencies.
- **Labeled mess.** 11 kinds of operational problems, each listing the records involved, a one-sentence explanation and the money at risk.
- **Safe to publish.** Every email is under the reserved `.example` domain, every phone number is in the fictional `555-0100`–`555-0199` range, and every company, person and town name is invented.
- **Exports everywhere.** JSON, NDJSON event stream, CSV, SQLite/Postgres SQL, plus HubSpot- and QuickBooks-shaped import CSVs.

## Quickstart

```bash
# Human summary of a dental clinic
npx @teamshift/fake-business --industry dental-clinic --seed 7 --summary

# Full dataset as JSON (stdout)
npx @teamshift/fake-business --industry marketing-agency --seed 1 > agency.json

# A SQLite database in one line
npx @teamshift/fake-business --format sql-sqlite --out business.sql && sqlite3 business.db < business.sql

# A perfectly clean dataset (no injected anomalies)
npx @teamshift/fake-business --messiness 0 > clean.json
```

`--summary` output (real, `--industry home-services --seed 42 --size small`):

```text
Copper Kettle Plumbing & Air — home-services, seed 42
2025-10-01 → 2026-09-30 · America/Chicago · Birchford, MN

Records
  employees                        4
  customers                       15
  contacts                        20
  leads                           14
  deals                           12
  quotes                           7
  jobs                            19
  invoices                        13
  payments                        15
  messages                        87
  calls                           34
  tasks                           32
  events                         303
  anomalies                       11

Money
  invoiced                  $19,010.00
  payments received         $18,861.00
  outstanding (A/R)            $298.00
  open pipeline              $2,507.00
  deals won / lost / open     7 / 3 / 2

Schedule
  jobs in progress                 0
  upcoming, next 14 days           6
  upcoming, later                  0

Anomalies (11, $5,343.00 at risk)
  duplicate-contact                1
  quote-not-followed-up            1
  missed-call-no-callback          1
  stale-deal                       1
  overdue-invoice                  1
  invoice-wrong-job                1
  reschedule-not-propagated        1
  missing-contact-info             1
  conflicting-status               1
  unmatched-payment                1
  lead-never-contacted             1
```

## Sample output

An excerpt from `npx @teamshift/fake-business --industry home-services --seed 42` (unchanged except for trimming):

```json
{
  "meta": { "generator": "@teamshift/fake-business", "schemaVersion": "1.0.0", "industry": "home-services",
            "seed": 42, "startDate": "2025-10-01", "asOf": "2026-09-30", "synthetic": true },
  "company": { "name": "Copper Kettle Plumbing & Air", "timezone": "America/Chicago",
               "phone": "(612) 555-0154", "website": "https://www.copperkettleplumbingair.example" },
  "quotes": [{
    "id": "quo_0ejehqw", "dealId": "deal_0xsewsn", "customerId": "cus_0p0hrlu",
    "number": "Q-1084", "status": "accepted",
    "lineItems": [
      { "sku": "AC-INST-3T", "description": "3-ton 16 SEER2 AC condenser and coil, installed", "quantity": 1, "unitPriceCents": 785000 },
      { "sku": "PERMIT", "description": "Municipal mechanical/plumbing permit", "quantity": 1, "unitPriceCents": 15000 },
      { "sku": "HAUL-AWAY", "description": "Removal and disposal of old equipment", "quantity": 1, "unitPriceCents": 12500 },
      { "sku": "DUCT-SEAL", "description": "Duct sealing (per run)", "quantity": 4, "unitPriceCents": 9500 }
    ],
    "totalCents": 850500, "sentAt": "2025-10-20T13:24:00Z", "expiresOn": "2025-11-19",
    "followUps": ["2025-10-22T15:22:00Z"]
  }],
  "events": [
    { "id": "evt_0t3m6pn", "type": "QuoteAccepted", "at": "2025-10-24T13:40:00Z",
      "subjectId": "quo_0ejehqw", "actorId": "con_1heuwtr", "data": { "dealId": "deal_0xsewsn" } }
  ],
  "anomalies": [{
    "id": "anm_0g90hu5", "kind": "quote-not-followed-up",
    "recordIds": ["quo_12b4hrj", "deal_1cid8yb", "con_1nn89l4"],
    "description": "Estimate Q-1089 for Bianca Lewis ($2,170.00) was sent 2026-03-31 and never followed up; it expired 2026-04-30 with no decision recorded.",
    "amountAtRiskCents": 217000
  }]
}
```

The email that sent that quote, from the same dataset:

```text
Subject: Your estimate Q-1084 from Copper Kettle Plumbing & Air

Hi Jose,

As promised, here is estimate Q-1084 for AC system replacement.

- 3-ton 16 SEER2 AC condenser and coil, installed x1: $7,850.00
- Municipal mechanical/plumbing permit x1: $150.00
- Removal and disposal of old equipment x1: $125.00
- Duct sealing (per run) x4: $380.00

Total: $8,505.00. Valid through Nov 19, 2025.
```

## What's inside

| Collection | What it holds |
| --- | --- |
| `company` | Name, timezone, contact details, payment terms and plain-language **policies** an agent should respect |
| `employees` | Owner, office staff, technicians / hygienists / designers, with roles and hire dates |
| `customers` | Households (home services, dental) or businesses (agency), with owner, source, status and tags |
| `contacts` | People at each customer, plus prospects who never became customers |
| `leads` | Inbound requests in the customer's own words, response time, owner and resulting deal |
| `deals` | Pipeline stage, amount, next action, close date and lost reason |
| `quotes` | Estimates / treatment plans / proposals with line items, expiry and follow-up timestamps |
| `jobs` | Service visits / appointments / project meetings with assignees, schedule and completion; about two weeks of upcoming bookings sit after `asOf` |
| `invoices` | Line items, totals, due dates and amounts paid |
| `payments` | Card, ACH, check and cash payments with references |
| `messages` | Email and SMS threads whose bodies cite real quote/invoice numbers, dates and amounts |
| `calls` | Inbound and outbound calls, missed calls and voicemail transcripts |
| `tasks` | Follow-ups, visit prep and recall tasks with due dates and status |
| `events` | Append-only timeline of every state change (`LeadCreated`, `QuoteSent`, `JobRescheduled`, `PaymentReceived`, …) |
| `anomalies` | Ground truth for the injected mess (see below) |

Three industries ship today, each with its own services, price book, roles, policies and customer language:

| `--industry` | Business | Customers | Flavor |
| --- | --- | --- | --- |
| `home-services` | HVAC & plumbing contractor | households | service calls, equipment installs, maintenance-plan tune-ups |
| `dental-clinic` | General dental practice | patients | new-patient visits, 6-month hygiene recalls, treatment plans, insurance-style notes (no real PHI) |
| `marketing-agency` | Digital marketing agency | businesses | proposals, website and brand projects with deposits, monthly retainers |

Sizes: `small` ≈ 15 customers, `medium` ≈ 40, `large` ≈ 150, over `--months` of history (default 12) ending at `--as-of` (default `2026-09-30`).

## The anomalies

With the default 12 months of history, every kind below appears at least once at every size (small included) for any `--messiness` above 0 and up to 3; much shorter `--months` can be too young for some kinds (a deal cannot sit stale for 40 days in a one-month history); `--messiness 0` produces none, and higher values produce more. Each anomaly lists its record ids (primary record first), a one-sentence description and `amountAtRiskCents` where money is involved. The test suite checks that every labeled condition actually holds in the data.

| Kind | What is wrong in the data |
| --- | --- |
| `duplicate-contact` | A second contact with a nickname or typo of an existing contact's name and a different email, but the same phone number |
| `quote-not-followed-up` | A quote was sent, has no follow-ups and no decision, and is aging or already expired |
| `missed-call-no-callback` | A missed call or voicemail from a new caller that nobody returned by call or message |
| `stale-deal` | An open deal untouched for 30+ days whose next step is overdue |
| `overdue-invoice` | An invoice past its due date with nothing paid (an `InvoiceOverdue` event is in the timeline) |
| `invoice-wrong-job` | An invoice whose `jobId` points at another customer's job; the correct job id is included |
| `reschedule-not-propagated` | A job was moved (`JobRescheduled`), but the assignee's task and the customer's confirmation still show the old time |
| `missing-contact-info` | A customer contact with no email, a malformed email or no phone number |
| `conflicting-status` | Records that contradict each other: a deal marked lost although its quote was accepted, an invoice marked paid with no payments, or a completed and paid job marked canceled |
| `unmatched-payment` | A payment not linked to any invoice, with the invoice it most likely pays still showing a balance |
| `lead-never-contacted` | An inbound lead with no response at all, sometimes with no owner |

## Programmatic API

```ts
import { generate, toSQL, INDUSTRIES, type Dataset } from "@teamshift/fake-business";

const data: Dataset = generate({
  industry: "dental-clinic", // "home-services" | "dental-clinic" | "marketing-agency"
  seed: 7,
  size: "medium",            // "small" | "medium" | "large"
  asOf: "2026-09-30",        // simulated "today"
  months: 12,                // history length
  messiness: 1,              // 0 = clean
});

// Which invoices are overdue right now?
const overdue = data.invoices.filter(
  (i) => (i.status === "open" || i.status === "partially-paid") && i.dueOn < data.meta.asOf,
);

// Score an agent: did it find the ground-truth problems?
const truth = new Set(data.anomalies.map((a) => a.recordIds[0]));

const sql = toSQL(data, "postgres");
```

Exports: `generate`, `INDUSTRIES`, `SCHEMA_VERSION`, every schema type (`Dataset`, `Lead`, `Invoice`, `Anomaly`, …) and the exporters below. Runnable scripts live in [`examples/`](./examples) (`node examples/overdue-invoices.mjs`, `export-sqlite.mjs`, `list-anomalies.mjs`).

## Export formats

| `--format` | Function | Output |
| --- | --- | --- |
| `json` (default) | `toJSON(dataset)` | The whole dataset, pretty-printed |
| `ndjson` | `toNDJSONEvents(dataset)` | The event timeline, one JSON event per line |
| `csv` | `toCSVFiles(dataset)` | One RFC 4180 CSV per collection, plus `company`, `policies` and line-item tables |
| `sql-sqlite` / `sql-postgres` | `toSQL(dataset, dialect)` | `CREATE TABLE` per collection plus `INSERT`s, in one transaction |
| `hubspot` | `toHubSpotImportCSVs(dataset)` | `contacts.csv`, `companies.csv`, `deals.csv` with columns named after HubSpot's default property labels |
| `quickbooks` | `toQuickBooksImportCSVs(dataset)` | `customers.csv` and line-level `invoices.csv` with columns modeled on QuickBooks Online import sheets |

The HubSpot and QuickBooks files are shaped to be easy to map in each product's import wizard. They are not official templates; review the column mapping when you import.

## How is this different from Faker or Mockaroo?

| | fake-business | Faker | Mockaroo |
| --- | --- | --- | --- |
| What it is | Generator of one complete fictional business | Library of random value generators | Web app / API for schema-defined mock rows |
| Records linked across CRM, billing and comms | Yes, out of the box | You write the relationships | Partly, via schema references you define |
| Causally ordered history and event timeline | Yes | No | No |
| Messages that cite real record numbers and amounts | Yes | No | No |
| Labeled anomalies (ground truth for evaluation) | Yes, 11 kinds | No | No |
| Same seed, same output | Yes; no external data, so output only changes with a new generator release | Seedable; generated values can change between Faker releases | Not a documented feature |
| Runs offline | Yes, zero runtime dependencies | Yes | No, hosted service |
| Arbitrary custom schemas | No, a fixed small-business schema | Yes | Yes |

Use Faker or Mockaroo when you need arbitrary tables of plausible values. Use fake-business when you need a believable business whose data has to make sense end to end.

## FAQ

### How do I test an AI agent without real customer data?

Generate a fictional business with `npx @teamshift/fake-business --seed 42`, load it into the tool your agent uses (a database, CRM sandbox or MCP server), give the agent a task such as "follow up on every stale quote", and compare what it did with `anomalies`. Because the dataset is deterministic you can rerun the same scenario after every prompt or model change.

### Is the data safe to publish?

Yes. Every dataset sets `meta.synthetic: true`. Emails use the reserved `.example` top-level domain (RFC 2606), phone numbers are in the `555-0100`–`555-0199` range set aside for fiction, and company, town and street names are invented. People's names come from a curated list of common US names, so any match to a real person is coincidental. Dental records are invented and contain no real health information.

### Can I import it into HubSpot?

Use `--format hubspot --out ./hubspot` to get `contacts.csv`, `companies.csv` and `deals.csv` with HubSpot-style column names and an `External ID` column, then map the columns in HubSpot's import tool. Try it in a sandbox or test portal first.

### Can I import it into QuickBooks?

`--format quickbooks` writes `customers.csv` and an invoice-line CSV with column names modeled on QuickBooks Online import spreadsheets. Import into a sandbox company and check the mapping.

### How do I get a SQL database of fake business data?

`npx @teamshift/fake-business --format sql-sqlite --out business.sql`, then `sqlite3 business.db < business.sql`. Use `--format sql-postgres` for PostgreSQL (`psql -f business.sql`); JSON fields become `JSONB`.

### Is the output really reproducible?

Yes. The generator uses its own seeded PRNG and ships its own word lists, so the same options produce byte-identical JSON on every platform. The default `--as-of` is a fixed date (`2026-09-30`) rather than today for the same reason.

### How do I evaluate an LLM agent with this data?

Treat `anomalies` as the answer key: each entry names the primary record to act on, so you can compute precision and recall of the records your agent flags or fixes. The `events` timeline lets you check that the agent's actions happened in a sensible order.

### Can I get clean data with no anomalies?

Yes: `--messiness 0`. Clean datasets still pass every integrity check (all references resolve, totals match line items, payments match invoices).

## Contributing

Issues and pull requests are welcome at [teamshift-io/smb-sandbox](https://github.com/teamshift-io/smb-sandbox).

**Adding an industry is one file.** Copy `src/industries/home-services.ts`, change the services, price book, roles, policies and customer language, then register it in `src/industries/index.ts` (and add its id to `IndustryId` in `src/schema.ts`). The simulation, anomalies, exporters and tests pick it up automatically. Run `pnpm build && pnpm test` before opening a PR.

## License

Apache-2.0

---

Built by [TeamShift](https://teamshift.io/open-source/smb-sandbox?utm_source=github&utm_medium=readme) — AI workers for small-business operations.

## Three-year company library and validation

The source release includes 100 stable ready-made company configurations across four industries, including `trailer-dealer`. Existing `generate()` defaults stay unchanged. The library opts into source-bound medium staffing and records Census CBP/SUSB and BLS OEWS reference vintage, calculations and proxy limitations in `meta.calibration`.

```ts
import { generateCompany, checkInvariants, buildLedger, checkLedger,
  buildInventory, checkInventory, checkFictionalNames } from "@teamshift/fake-business";

const company = generateCompany("company-004");
const defects = checkInvariants(company); // includes deliberately injected invoice/job defects
const ledger = buildLedger(company);
const ledgerDefects = checkLedger(ledger);
const stock = buildInventory(company); // completed trailer sales only
const stockDefects = checkInventory(stock);
const possibleNameMatches = checkFictionalNames(company, ["A name from your review registry"]);
```

CLI: `fake-business --list-companies`, `fake-business --company company-004`, or `fake-business --calibrated` for opt-in medium staffing. Library IDs reject generation overrides. Calibrated scheduling checks crew availability when booking and rescheduling; legacy default fixtures are retained.

After building this workspace, `node scripts/export-library.mjs <output-directory>` exports all 100 compressed company files plus a SHA-256 manifest and generated-name registry. The [dataset card](../../dataset/README.md) explains modeled accounting/inventory, source limits and permitted uses. Neither fuzzy name screening nor invented names establish real-business or trademark clearance. GitHub artifacts, npm package versions, Hugging Face publication and a Zenodo DOI each require their own publication evidence.
