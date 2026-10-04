# smb-sandbox

**smb-sandbox is an open-source, fully fictional small business for testing AI agents: a realistic dataset generator, mock CRM, inbox, calendar, invoicing and phone systems exposed as MCP servers, and verified business tasks graded on the end state of the business, not on what the agent says it did.**

Agents that look great in a demo often fall apart on a real company's messy data: a duplicate contact, a quote nobody followed up on, a payment that doesn't match any invoice. You can't safely test against real customers, and random fake rows don't have those problems. smb-sandbox gives you a believable company that does, with every problem labeled so you can measure whether your agent fixed it.

![license](https://img.shields.io/badge/license-Apache--2.0-blue) ![node](https://img.shields.io/badge/node-%3E%3D20-green) ![data](https://img.shields.io/badge/data-100%25%20fictional-brightgreen)

## What's inside

| Package | What it does | Start here |
|---|---|---|
| [`@teamshift/fake-business`](packages/fake-business) | Generates a coherent fictional business (customers, leads, deals, quotes, jobs, invoices, payments, emails, SMS, calls, tasks and an event timeline) with 11 kinds of labeled operational mess. Deterministic, zero dependencies. Exports JSON, CSV, SQL, HubSpot- and QuickBooks-shaped CSVs. | `npx @teamshift/fake-business --industry dental-clinic --summary` |
| [`@teamshift/sandbox-mcp`](packages/sandbox-mcp) | 46 MCP tools over that business (CRM, inbox, calendar, invoicing, phone). Writes are validated, audited, and never leave the process. Sending email only writes to an outbox. | `claude mcp add sandbox -- npx -y @teamshift/sandbox-mcp` |
| [`@teamshift/smb-workflows`](workflows) | 10 real small-business tasks (quote follow-up, missed-call callbacks, invoice reminders, duplicate cleanup and more), each with a deterministic verifier and a reference solution. | `npx @teamshift/smb-workflows list` |

Three starter industries: **home services** (HVAC and plumbing), **dental clinic**, and **marketing agency**. Each seed is a different company with the same kinds of problems.

## Evaluate an agent in three commands

```bash
# 1. Start the sandbox business and record everything the agent does
npx @teamshift/sandbox-mcp --industry home-services --seed 42 --toolsets crm,inbox,calendar,invoicing,phone --state-out run.json

# 2. Give your agent the task prompt (Claude Code, Cursor, or your own agent connected to the server above)
npx @teamshift/smb-workflows show quote-follow-up --industry home-services --seed 42

# 3. Grade the end state
npx @teamshift/smb-workflows grade quote-follow-up --industry home-services --seed 42 --state run.json
```

The grade checks what actually changed: the right records were updated, the right people got exactly one message each, nothing outside the task was touched, and no money moved unless the task allowed it. See [docs/run-with-claude-code.md](workflows/docs/run-with-claude-code.md) for a full walkthrough.

## Use the data on its own

```bash
npx @teamshift/fake-business --industry marketing-agency --seed 7 --format csv --out ./agency
npx @teamshift/fake-business --industry home-services --format sql-sqlite --out business.sql
```

```js
import { generate } from "@teamshift/fake-business";

const biz = generate({ industry: "dental-clinic", seed: 7 });
const overdue = biz.invoices.filter((i) => i.status === "open" && i.dueOn < biz.meta.asOf);
console.log(biz.company.name, overdue.length, "overdue invoices");
console.log(biz.anomalies.map((a) => a.kind)); // ground truth for grading
```

## FAQ

### How do I test an AI agent without real customer data?

Generate a fictional company with `fake-business`, connect your agent to it through `sandbox-mcp`, and grade the result with `smb-workflows`. Every name, email, phone number and address is invented (`.example` domains, 555-01xx numbers), so you can run tests, record demos and publish results without exposing anyone.

### Is this a benchmark?

It's the material for one. The 10 workflows are a starting set of verified tasks with deterministic graders, so you can compare agents, models or prompts on the same company. We don't publish a leaderboard yet.

### Why grade the end state instead of the agent's answer?

Agents regularly report success they didn't achieve. A verifier that diffs the records, the audit log and the outbox against ground truth catches hallucinated completions, duplicate emails, and changes to records the task never mentioned.

### Does it work with Claude, Cursor or my own agent?

Yes. `sandbox-mcp` is a standard Model Context Protocol server over stdio (or Streamable HTTP), so any MCP client works. The [sandbox-mcp README](packages/sandbox-mcp) has config snippets for Claude Code, Claude Desktop, Cursor and VS Code.

### Can I add an industry or a task?

Yes, and it's the most useful contribution. An industry is one file; a task is a prompt, a verifier and a reference solution. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

```bash
corepack enable
pnpm install
pnpm build && pnpm test && pnpm typecheck
```

## Citing

If you use smb-sandbox in research, please cite it using [CITATION.cff](CITATION.cff).

## License

Apache-2.0. All generated data is fictional and free to use, modify and publish.

---

Built by [TeamShift](https://teamshift.io/open-source/smb-sandbox?utm_source=github&utm_medium=readme) — AI workers for small-business operations.
