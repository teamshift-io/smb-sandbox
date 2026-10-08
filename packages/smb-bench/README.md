# SMB-Bench native MCP runner

This is a public evaluation scaffold, not a production worker engine. It uses the existing mock MCP server and end-state workflow graders. All tool side effects stay inside a fictional business.

The v1 corpus contains **100 task instances from 13 templates**, not 100 unique templates. Four industries use the published three-year company library. Six labels cover scheduling, invoicing, collections, dispatch, purchasing and warranty. Purchasing and warranty test precise **review handoffs** only: there are no supplier, purchase-order, warranty-policy or claim systems. Practitioner validation of this scope is pending.

Twenty fixtures append a malicious instruction to an existing inbound message. The pattern was copied from `enckequity/teamshift-monorepo/workflows/recipes/inbox_concierge_v1/demo_scenarios/prompt_injection_adversarial_hold.yaml`. These are seeded untrusted-data threats, not proof that each workflow retrieves that message or a complete injection-resistance benchmark. No runtime dependency on retired AgentOS or recipe execution exists.

## Run

Build dependencies with `pnpm build`; validate locally with `pnpm --filter @teamshift/smb-bench test` and `typecheck`. Tests use simulated provider responses and actual in-memory MCP calls; they do not rank models.

Before a live run, independently verify existing provider authority, budget and admitted model IDs. A configuration file records that authority; the runner cannot confer it. Do not create a new paid commitment or infer budget availability from a configured key.

Keep a private JSON configuration outside the repository:

```json
{
  "admission": {
    "authority": "existing-approved-receipt-reference",
    "models": ["model-a", "model-b", "model-c", "model-d"],
    "maxRequests": 12000,
    "maxCompletionTokens": 24576000
  },
  "models": [
    {"id":"model-a","model":"exact-provider-model-pin","baseUrl":"https://provider.example/v1","keyEnv":"BENCH_MODEL_A_KEY"}
  ]
}
```

The abbreviated models array above must contain **4–6 distinct admitted configurations**. Numeric limits are illustrative ceilings, not an approved spend. Keys are injected privately via the approved secret manager into the named environment variables, never placed in JSON or shell history.

`node packages/smb-bench/dist/cli.js /private/config.json /owned/new-output-directory`

The fixed scaffold uses temperature 0, 2048 maximum completion tokens and 30 steps per task. Providers must support OpenAI-compatible tool calls. Tools are task-scoped; only company/profile policy reads are added from admin. Answers, reset, clock and state-save tools are unavailable. Requests time out after 30 seconds and are never retried. The matrix stops after a failed/uncertain request and retains its trace. Do not replay uncertain calls automatically. Tool failures returned normally by MCP remain visible to the model and grader.

Each trace records the full fictional transcript, actual provider usage (null means unavailable), initial checksum, final dataset/audit/outbox, scaffold, model and deterministic grade. Tool output is untrusted data. No API headers or resolved configuration keys are serialized. Review traces before publication; a provider may echo sensitive input. Scores from failed or step-limited runs are not completed successes. Graders inspect end state, audit and outbox; reviewers must also inspect assistant summaries for unsupported claims (for example, a claimed coverage approval).

## Private held-out evaluation

Set `heldoutManifest` in the private configuration to an evaluator-owned manifest path. It must contain `{"split":"held-out","cases":[...]}` with exactly 100 unique cases, each with `id`, one of the 13 `workflow` IDs, `category`, a relative `fixture` JSON path and its raw-file `sha256`. The runner validates every checksum, category, prompt eligibility, untouched failure and reference-solution success before any provider request. Known public company seeds and duplicate task/fixture pairs are rejected. Relative fixture paths resolve beside the manifest. Keep these files outside the repository; create them with independent, unpublished generator seeds. The evaluator must verify split disjointness and retain the fixtures for reproducible private grading. Never publish held-out full traces without reviewer-approved redaction: they include fixture data.

Public seeds cannot serve as held-out data. Keep evaluator-owned fixture files and seeds outside this repository and outside model prompts. A held-out evaluation is not certified by public-corpus results. Private fixtures and a practitioner-approved template review are still required before a completed benchmark claim. Public submissions must identify their split; do not label public runs held-out.

[Leaderboard and PR submission contract](../../docs/benchmark/leaderboard.md).
