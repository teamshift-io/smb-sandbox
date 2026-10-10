# smb-sandbox as an RL environment: spec sheet

smb-sandbox is a set of scored small-business tasks. An agent works inside a fictional company
through MCP tools, and a deterministic grader scores the end state of the business: records,
audit log and outbox. It does not score what the agent says it did. This page lists what the
environment contains today and what has been checked.

## At a glance

| | |
|---|---|
| Task templates | 13 (10 workflows plus 3 review-handoff tasks) |
| Task instances (public corpus) | 100 across 4 industries; this sheet and the sample cover the 75 in home services, dental clinic and marketing agency |
| Tools | 46 MCP tools across CRM, inbox, calendar, invoicing and phone; writes are validated, audited and never leave the process |
| Grader | Deterministic, end-state; 8 to 19 named checks per template |
| Reward | `reward` 1 only when every check passes, otherwise 0; `shaped_reward` is the fraction of checks passed |
| Adversarial cases | 20 of 100 instances carry a seeded prompt injection in an inbound message |
| Episode limits (native runner) | 30 steps, temperature 0, 2,048 completion tokens per step |
| Runtime | Node 20+, no network and no model needed to generate, solve or grade |
| License (public code and corpus) | Apache-2.0 |

## Task templates and grader coverage

Checks are counted on the first public instance of each template. Every template is validated
the same way: the untouched company fails and the reference solution scores 1.0.

| Template | Category | Checks | No-op shaped reward |
|---|---|---:|---:|
| quote-follow-up | dispatch | 17 | 0.53 |
| missed-call-callback | dispatch | 14 | 0.86 |
| overdue-invoice-reminders | collections | 19 | 0.58 |
| dedupe-contacts | dispatch | 15 | 0.60 |
| match-unmatched-payments | invoicing | 11 | 0.82 |
| reschedule-propagation | scheduling | 16 | 0.63 |
| stale-deal-next-actions | dispatch | 19 | 0.58 |
| speed-to-lead | dispatch | 19 | 0.53 |
| invoice-job-mismatch | invoicing | 15 | 0.60 |
| daily-owner-brief | collections | 16 | 0.50 |
| dispatch-review-handoff | dispatch | 8 | 0.88 |
| purchasing-review-handoff | purchasing | 8 | 0.88 |
| warranty-review-handoff | warranty | 8 | 0.88 |

A no-op already passes the checks that say nothing outside the task was touched, so its shaped
reward is well above zero. Train on `reward`, or subtract the no-op baseline from `shaped_reward`.

Purchasing and warranty test review handoffs only. There are no supplier, purchase-order,
warranty-policy or claim systems. Practitioner review of the task scope is still pending.

## Run it headless

```bash
corepack enable && pnpm install --frozen-lockfile && pnpm build
node scripts/export-episodes.mjs ./episodes          # one case per template
node scripts/export-episodes.mjs ./episodes-all 25   # every in-scope case
```

The script writes `episodes.jsonl` and `SHA256SUMS` into a new directory. Each line holds one
episode: the case and template, industry, prompt, every tool call the policy made, and the reward
with the grader's named checks. The two scripted policies are `noop` and `reference`. Output is
byte-identical across runs. [`samples/episodes/`](../samples/episodes) holds the
one-per-template export.

Model runs go through the native runner in [`packages/smb-bench`](../packages/smb-bench/README.md).
It needs an evaluator's own model admission and budget, and none are included here.

## Data provenance

- Every company comes from the deterministic generator in `packages/fake-business`, from a seed.
  The generator has no runtime dependencies and reads no outside data.
- Names, emails, phone numbers and addresses are invented. Emails use `.example` domains, phone
  numbers are 555-01xx, and the seeded injection target is `attacker@example.invalid`.
- Staffing levels in the three-year library are calibrated to published Census and BLS figures.
  The year, industry vintage and formulas are kept in the metadata. Lead volumes, prices,
  conversion rates and events are illustrative.
- Name screening checks generated names against a registry and reports fuzzy matches. It is not
  real-business or trademark clearance.

## No customer data

No customer or tenant data from TeamShift or anyone else enters the generator, the tasks or the
sample. Checked on the committed sample (`samples/episodes/episodes.jsonl`, 26 episodes):

- all 15 email addresses are on `.example` or `.invalid` domains
- all 13 phone numbers are 555-01xx
- it contains no URLs

The public seeds are published, so they cannot serve as held-out data. A private held-out split
needs fresh, unpublished seeds and evaluator-owned fixtures kept outside this repository. The
runner checks their checksums and split rules before any model call.
