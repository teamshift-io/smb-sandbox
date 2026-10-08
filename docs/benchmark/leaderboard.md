# SMB-Bench leaderboard

**Status: evaluation scaffold published; no admitted live model matrix or practitioner-approved ranking yet.** This page intentionally has no model scores. Reference solutions and simulated providers are grader tests, not leaderboard entrants.

Corpus v1: 100 task instances, 13 templates, six category labels, four fictional industries, 20 seeded inbound-message threats. Purchasing and warranty cover mock review coordination only. Native MCP scaffold v1 fixes tool scope, temperature 0, 2048 completion-token limit and 30 steps. See [runner instructions](../../packages/smb-bench/README.md).

| Model pin | Split | Completed task success | Mean grade | Trace artifact | Review |
| --- | --- | --- | --- | --- | --- |
| No verified submissions | — | — | — | — | Pending actual model runs |

## Submit by pull request

Add `submissions/<unique-run-id>.json` and update this table only after reviewer verification. Required fields:

- `modelPin`, `provider`, `sourceCommit`, `scaffoldVersion`, `split` (`public` or `held-out`), run timestamp and existing admission reference (no credentials).
- Corpus manifest SHA-256, category counts, complete task IDs, completed/failed/step-limited counts, mean grade and exact-pass rate. Failed/step-limited tasks remain in the denominator and cannot count as success.
- Public trace artifact URL and SHA-256; preserve actual usage or mark unavailable. No invented zero cost, token totals or reference-solution rankings.
- Practitioner template-review receipt and evaluator receipt for private held-out provenance. Keep held-out fixtures/seeds private; release only aggregate results and reviewed/redacted traces that do not reveal the split.

A reviewer must fetch the artifact, verify checksums/source ancestry, independently re-grade final states against the appropriate initial fixtures, inspect tool-scope failures, and check that the same scaffold was used. Reject incomplete matrices, cherry-picked tasks, leaked fixture answers or credentials. Do not upload customer data. Publish real provider traces only within their approved authority.

Private held-out seeds, fixtures, actual 4–6 model runs, practitioner review and a verified ranking remain acceptance gates. A source merge does not satisfy these gates.
