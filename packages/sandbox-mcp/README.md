# sandbox-mcp

**sandbox-mcp is an open-source set of mock small-business MCP servers — CRM, inbox, calendar, invoicing and phone — backed by a realistic fictional company, so you can test AI agents end-to-end without touching real customer accounts.**

Point Claude, Cursor, VS Code or any [Model Context Protocol](https://modelcontextprotocol.io) client at it and your agent gets a believable business to operate: leads waiting for a reply, quotes nobody followed up on, a duplicate contact, an overdue invoice, an unmatched check. Every change is validated like a real system would, recorded in an audit log, and stays inside the process. "Sending" an email or SMS only writes to an outbox.

[![npm](https://img.shields.io/npm/v/@teamshift/sandbox-mcp)](https://www.npmjs.com/package/@teamshift/sandbox-mcp) ![license](https://img.shields.io/badge/license-Apache--2.0-blue) ![node](https://img.shields.io/badge/node-%3E%3D20-green)

## Quickstart

```bash
npx @teamshift/sandbox-mcp --industry home-services
```

That starts an MCP server over stdio with a generated home-services company (seed 42, so it is the same company every time). Other industries: `dental-clinic`, `marketing-agency`.

```bash
npx @teamshift/sandbox-mcp --industry dental-clinic --seed 7 --toolsets crm,inbox --state-out run.json
```

## Connect your MCP client

### Claude Code

```bash
claude mcp add sandbox -- npx -y @teamshift/sandbox-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sandbox": {
      "command": "npx",
      "args": ["-y", "@teamshift/sandbox-mcp", "--industry", "home-services"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sandbox": {
      "command": "npx",
      "args": ["-y", "@teamshift/sandbox-mcp", "--industry", "home-services"]
    }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "sandbox": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@teamshift/sandbox-mcp", "--industry", "home-services"]
    }
  }
}
```

Then try a prompt like: *"Check the inbox and the call log, reply to anything urgent, and make sure every open deal has a next step."*

## CLI options

| Option | Default | Description |
| --- | --- | --- |
| `--industry <id>` | `home-services` | `home-services`, `dental-clinic` or `marketing-agency` |
| `--seed <n>` | `42` | Same seed, same company, byte for byte |
| `--size <s>` | `medium` | `small`, `medium` or `large` |
| `--messiness <x>` | `1` | Multiplier for injected data problems; `0` gives clean data |
| `--data <file>` | | Load a dataset JSON (e.g. from `@teamshift/fake-business`) instead of generating |
| `--toolsets <list>` | all | Comma list of `crm,inbox,calendar,invoicing,phone,admin` |
| `--expose-answers` | off | Expose ground-truth anomalies as the `sandbox://anomalies` resource |
| `--state-out <file>` | | Write final dataset + audit log + outbox JSON on exit and on `admin_save_state` |
| `--http <port>` | | Serve Streamable HTTP at `http://127.0.0.1:<port>/mcp` instead of stdio |

Logs go to stderr only, so stdout stays a clean MCP channel.

## Tools

All tools are prefixed by system, take zod-validated input, return compact JSON, and carry MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: false`). Failures come back as tool errors with an actionable message (for example `failed_precondition: Cannot move deal from "new" to "won". Allowed: qualified, quote-sent, lost.`), never as a crash.

| Toolset | Tools |
| --- | --- |
| `crm` | `crm_search_contacts`, `crm_get_contact`, `crm_create_contact`, `crm_update_contact`, `crm_merge_contacts`, `crm_list_customers`, `crm_get_customer`, `crm_list_employees`, `crm_list_leads`, `crm_update_lead`, `crm_list_deals`, `crm_get_deal`, `crm_update_deal`, `crm_list_quotes`, `crm_send_quote`, `crm_follow_up_quote`, `crm_list_tasks`, `crm_create_task`, `crm_complete_task` |
| `inbox` | `inbox_list_threads`, `inbox_get_thread`, `inbox_send_email`, `inbox_send_sms`, `inbox_mark_thread_read` |
| `calendar` | `calendar_list_jobs`, `calendar_get_job`, `calendar_schedule_job`, `calendar_reschedule_job`, `calendar_cancel_job`, `calendar_complete_job` |
| `invoicing` | `invoicing_list_invoices`, `invoicing_get_invoice`, `invoicing_create_invoice`, `invoicing_send_reminder`, `invoicing_void_invoice`, `invoicing_record_payment`, `invoicing_list_payments`, `invoicing_match_payment` |
| `phone` | `phone_list_calls`, `phone_log_call` |
| `admin` | `admin_get_company_policies`, `admin_get_company`, `admin_get_audit_log`, `admin_reset`, `admin_save_state`, `admin_advance_clock` |

**Resources:** `sandbox://company`, `sandbox://policies`, and `sandbox://anomalies` (only with `--expose-answers`, so the answers never leak to an agent under test).

### Business rules it enforces

- Foreign keys must exist; money is integer cents; dates are `YYYY-MM-DD`.
- Deal stages follow the pipeline (`new → qualified → quote-sent → negotiation → won/lost`); `won` is final, `lost` needs a reason and can be reopened.
- No payments on void, draft or fully paid invoices, and no overpayment. Invoices with payments cannot be voided.
- Unmatched payments can only be matched to an invoice of the same customer.
- Jobs cannot double-book a technician (unless `allowOverlap`), and rescheduling updates the job's times.
- Email and SMS need a valid address or number, so missing contact info surfaces as a real error.
- Messaging or calling a lead's contact records the first response on the lead.
- A simulated clock starts at 09:00 company time on the dataset's "today" and advances one minute per change, so timestamps are deterministic.

## Grading an agent

Run your agent against the sandbox with `--state-out`, then score the end state, not the transcript:

```bash
npx @teamshift/sandbox-mcp --industry home-services --seed 42 --toolsets crm,inbox,calendar,invoicing,phone --state-out run.json
```

`run.json` contains:

- `dataset`: the final state of every record (same schema as `@teamshift/fake-business`), including new `events`.
- `audit`: every attempted change in order: `{ seq, at, tool, input, result: "ok" | "error", error?, changedIds }`.
- `outbox`: every email and SMS the agent "sent".

Compare `dataset` against the ground-truth `anomalies` from the original dataset (for example: was the duplicate contact merged, was the unmatched payment applied, did every stale deal get a `nextAction`?), and use `audit` to penalize errors, destructive actions or policy violations. Leave out the `admin` toolset so the agent cannot reset its own run.

### Use the store directly in code

The same engine is exported as a typed library, which is how reference solutions and verifiers run:

```ts
import { generate } from "@teamshift/fake-business";
import { SandboxStore } from "@teamshift/sandbox-mcp";

const store = new SandboxStore(generate({ industry: "home-services", seed: 42 }));
for (const quote of store.listQuotes({ notFollowedUp: true, limit: 100 }).items) {
  store.followUpQuote({ quoteId: quote.id, body: "Just checking in on your quote. Any questions?" });
}
console.log(store.audit().length, store.outbox().length);
const finalState = store.snapshot();
```

You can also embed the MCP server in your own process with `createSandboxServer(store, { toolsets, exposeAnswers })` and any SDK transport.

## FAQ

### How do I test an MCP agent safely?

Give it a sandbox instead of production credentials. sandbox-mcp exposes the same kinds of tools a real CRM, inbox, calendar, invoicing and phone system would, over a fictional company, with no network access and no real accounts. Run the agent, save the state with `--state-out`, and check what it changed.

### Does it send real emails?

No. Nothing leaves the process. `inbox_send_email`, `inbox_send_sms`, `crm_follow_up_quote` and `invoicing_send_reminder` append an outbound message to the thread and to the outbox, and all addresses use the reserved `.example` domain and `555-01xx` numbers.

### How do I reset the sandbox?

Call the `admin_reset` tool (the audit log is kept and records the reset, so graders can see it), or restart the server. The same `--industry` and `--seed` always regenerate the identical company. In code, call `store.reset()`.

### Where does the data come from?

From [`@teamshift/fake-business`](../fake-business), a deterministic generator for realistic fictional small businesses, with labeled anomalies for scoring. You can also pass your own dataset with `--data`.

### Can the agent see the answers?

Not by default. The ground-truth `anomalies` are only exposed as a resource with `--expose-answers`; they are always included in `--state-out` files for graders.

### Does it support Streamable HTTP?

Yes: `--http 8787` serves stateless Streamable HTTP at `http://127.0.0.1:8787/mcp`. All requests share one sandbox state.

## License

Apache-2.0

---

Built by [TeamShift](https://teamshift.io/open-source/smb-sandbox?utm_source=github&utm_medium=readme) — AI workers for small-business operations.
