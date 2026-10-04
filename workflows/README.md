# smb-workflows

**smb-workflows is an open-source set of verified small-business tasks for AI agents — quote follow-up, missed-call callbacks, invoice reminders, CRM cleanup and more — each graded on the actual end state of a sandboxed business, not on what the agent says it did.**

Each task comes in three parts: a prompt written the way an owner or office manager would hand the job to an assistant, a reference solution that proves the task can be done with the tools available, and a deterministic verifier. The agent works inside [`@teamshift/sandbox-mcp`](https://github.com/teamshift-io/smb-sandbox/tree/main/packages/sandbox-mcp), a mock CRM, inbox, calendar, invoicing and phone system backed by a fictional company from [`@teamshift/fake-business`](https://github.com/teamshift-io/smb-sandbox/tree/main/packages/fake-business). When the run ends, the verifier diffs the final records, the audit log and the outbox against ground truth the agent never saw.

![license](https://img.shields.io/badge/license-Apache--2.0-blue) ![node](https://img.shields.io/badge/node-%3E%3D20-green)

## The 10 workflows

| Workflow | What the agent has to do | Difficulty | Toolsets |
| --- | --- | --- | --- |
| `quote-follow-up` | Email every quote sent 7+ days ago that never got a follow-up (including lapsed ones), with the right number and total. One email each, and log it. | easy | crm, inbox |
| `missed-call-callback` | Text back or create a callback task for every missed call or voicemail nobody returned, without contacting numbers outside the call log. | easy | phone, crm, inbox |
| `overdue-invoice-reminders` | Remind invoices 7+ days overdue with the exact balance. Skip invoices an unapplied payment already covers and flag those to the bookkeeper. | medium | invoicing, crm, inbox |
| `dedupe-contacts` | Merge true duplicate contacts into the record linked to the customer account. Leave look-alikes with the same first or last name untouched. | medium | crm |
| `match-unmatched-payments` | Apply each unapplied payment to the invoice it pays. Ambiguous ones get flagged instead of guessed. | hard | invoicing, crm |
| `reschedule-propagation` | For moved appointments, fix the assignee's task list and send the customer the new day and time, following the company's messaging policy. | hard | calendar, crm, inbox |
| `stale-deal-next-actions` | Give every stalled open deal a concrete next action due within 7 days, and leave closed deals alone. | easy | crm |
| `speed-to-lead` | Send a personal first reply to every unanswered lead, mark it contacted, and assign an owner. | easy | crm, inbox |
| `invoice-job-mismatch` | Find invoices linked to another customer's job and fix them: void and reissue, or file a precise correction task. | hard | invoicing, calendar, crm |
| `daily-owner-brief` | Email the owner one brief with the correct overdue total, unreturned calls and quotes at risk, and contact no customers. | medium | invoicing, phone, crm, inbox |

Every workflow runs against three industries (`home-services`, `dental-clinic`, `marketing-agency`), and the prompt adapts its wording: an estimate, a treatment plan or a proposal; a customer, a patient or a client. Any seed produces a different company with the same kinds of problems.

## Evaluate any agent in 3 commands

```bash
# 1. Get the task prompt for one business
npx @teamshift/smb-workflows show quote-follow-up --industry dental-clinic --seed 7 > prompt.md

# 2. Start the sandbox, connect your agent (Claude Code, Cursor, your own), give it prompt.md, then exit
npx @teamshift/sandbox-mcp --industry dental-clinic --seed 7 --toolsets crm,inbox --state-out run.json

# 3. Grade the end state (exit code 0 = pass, 1 = fail)
npx @teamshift/smb-workflows grade quote-follow-up --industry dental-clinic --seed 7 --state run.json
```

`smb-workflows list` shows which toolsets each workflow needs. Never give the agent the `admin` toolset, which can reset the sandbox or move the clock, and never start the sandbox with `--expose-answers`. For a complete, scriptable loop with Claude Code, see [docs/run-with-claude-code.md](docs/run-with-claude-code.md).

Sample output for an agent that did nothing:

```text
quote-follow-up: FAIL  score 0.529  (9/17 checks)

  FAIL  followed-up:Q-1089              no follow-up sent for Q-1089 (expired, $2,170.00)
  ok    no-duplicate:Q-1089             0 message(s) about Q-1089 (at most one allowed)
  FAIL  right-recipient:Q-1089          no message
  ...
  ok    no-out-of-scope-changes         only in-scope records changed
  ok    no-unapproved-money-actions     no money moved
```

## How grading works

1. **Targets come from ground truth.** `fake-business` injects realistic problems (a quote nobody chased, a duplicate contact, a payment that lost its invoice) and labels each one in `anomalies`. The sandbox hides these from the agent. Verifiers read them from the initial dataset and cross-check them against record state, so a label that no longer applies is never graded.
2. **Only the end state counts.** The verifier reads the state file written by `sandbox-mcp --state-out`: the final dataset, the audit log of every attempted change, and the outbox of every email and SMS. What the agent claims in chat is ignored.
3. **Task checks.** These are specific to each workflow. Did each target get exactly one message to the right person? Does the body state the right number and amount? Does the task show the new date? Was the wrong invoice left alone?
4. **Shared checks.** These apply to every workflow:
   - Nothing outside the task's scope changed (a record-by-record diff against the initial dataset).
   - No messages went to addresses that belong to nobody, or to people outside the task.
   - No more than 5 failed tool calls.
   - No money moved unless the task allows it.
   - No admin resets or clock changes.
   - Industry policies hold. For example, a dental clinic never puts treatment details in texts or subject lines, and a home-services company texts customers about appointment changes.
5. **Result.** `{ pass, score, checks: [{ id, pass, detail }] }`. `pass` means every check passed, and `score` is the fraction of checks passed (0 to 1), which is useful for partial credit across runs.

The verifier fails on the untouched dataset and passes with score 1 on the reference solution for every workflow, industry and seed tested. `smb-workflows selftest` checks this for you.

## Use it as a library

```ts
import { generate } from "@teamshift/fake-business";
import { SandboxStore } from "@teamshift/sandbox-mcp";
import { getWorkflow, stateOf } from "@teamshift/smb-workflows";

const wf = getWorkflow("overdue-invoice-reminders");
const initial = generate({ industry: "home-services", seed: 42 });
console.log(wf.prompt(initial));

const store = new SandboxStore(initial);
// ... let your agent act on `store` (or on sandbox-mcp), then:
const result = wf.verify(initial, stateOf(store));
console.log(result.pass, result.score);
```

`WORKFLOWS` is the full registry (id, title, difficulty, toolsets, prompt, verify, solve). The shared grading kit (`Grader`, `commonChecks`, `diffDatasets`) is exported too.

## CLI

```text
smb-workflows list [--json]
smb-workflows show <id> [--industry <id>] [--seed <n>] [--size <s>] [--messiness <x>] [--data <dataset.json>] [--full]
smb-workflows grade <id> --state <state.json> [--initial <dataset.json> | --industry <id> --seed <n>] [--json]
smb-workflows selftest [--industries a,b] [--seeds 1,7,42] [--size <s>] [--json]
```

If you leave out `--initial` and `--industry`, `grade` regenerates the initial dataset from the state file's metadata (size `medium`, messiness `1`), and refuses to grade if that turns out to be a different business.

## FAQ

### How do I evaluate an AI agent on real business tasks?

Give the agent a realistic business with realistic problems, a task phrased the way a manager would phrase it, and real tools. Then check what changed. smb-workflows covers all of that: `sandbox-mcp` provides the business and the tools over the Model Context Protocol, `smb-workflows show` provides the task, and `smb-workflows grade` checks the end state. Because the data is generated from a seed, you can rerun the same business across agents, models and prompts and compare scores directly.

### Why grade end state instead of agent output?

Agents often report work they didn't do, or did differently. They say they "followed up with everyone" after emailing one person twice, or they claim a payment was matched when the call actually failed. The state file records what really happened: which records changed, every tool call including failures, and every message with its recipient and body. Grading that catches double sends, wrong recipients, wrong amounts and out-of-scope side effects, which a transcript-based judge misses.

### Can I add my own task?

Yes. Create a folder with a `task.md` (frontmatter, a `## Prompt` section with `{{placeholders}}`, and a `## What a good result looks like` section), a `verify.ts` that uses `Grader` and `commonChecks`, and a `solve.ts` reference solution. Register it in `src/index.ts`, add a sloppy-agent negative in `test/sloppy.ts`, and run `pnpm test`. The selftest makes sure the new task fails on untouched data and passes on your solution across industries and seeds. Contributions are welcome.

### Which agents and models does it work with?

Anything that can use MCP tools, including Claude Code, Claude Desktop, Cursor, VS Code, and custom agents built on any model or framework. Agents without MCP can drive the `SandboxStore` class directly in TypeScript.

### Is any of the data real?

No. Every company, person, email address (under the reserved `.example` domain) and phone number (555-01xx) is fictional, and nothing leaves the process. "Sending" an email or SMS only writes to the outbox.

---

Built by [TeamShift](https://teamshift.io/open-source/smb-sandbox?utm_source=github&utm_medium=readme) — AI workers for small-business operations.
