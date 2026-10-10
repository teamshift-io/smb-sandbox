# Sample episodes

`episodes.jsonl` holds 26 scored episodes: one public case for each of the 13 task templates,
each run by two scripted policies. `noop` does nothing and `reference` runs the template's
reference solution. No model produced these. They show the episode format and the reward signal.

Regenerate and check the file:

```bash
pnpm build
node scripts/export-episodes.mjs /tmp/episodes && diff /tmp/episodes/episodes.jsonl samples/episodes/episodes.jsonl
cd samples/episodes && sha256sum -c SHA256SUMS
```

Fields: `episode_id`, `case_id`, `split`, `workflow`, `industry`, `category`, `seeded_injection`,
`initial_checksum`, `policy`, `prompt`, `actions` (`seq`, `at`, `tool`, `input`, `result`),
`outbox_messages`, `reward` (1 only when every check passes), `shaped_reward` (fraction of checks
passed), `success`, and `checks` (`id`, `pass`, `detail`).

Every company, person, email and phone number is fictional. See
[docs/rl-environment.md](../../docs/rl-environment.md).
