# Run an end-to-end eval with Claude Code

This guide runs one smb-workflows task against Claude Code and grades the result. Each run takes three steps:

1. Start `sandbox-mcp` with `--state-out`, so it writes the final state when the session ends.
2. Give Claude Code the prompt from `smb-workflows show`.
3. Grade the state file with `smb-workflows grade`.

Each run starts a fresh sandbox process, so every attempt begins from the same untouched business.

## Prerequisites

- Node.js 20 or newer.
- Claude Code installed and signed in (`claude --version`).
- An empty working directory for the run, so the agent can't read grader code or earlier results.

```bash
mkdir smb-eval && cd smb-eval
```

## 1. Pick a workflow and a business

```bash
npx -y @teamshift/smb-workflows list
```

The third column lists the toolsets the workflow needs. Use exactly those toolsets and **never include `admin`**. The admin tools can reset the sandbox, move the clock or read the audit log, and the grader fails any run that resets or moves the clock.

```bash
WF=overdue-invoice-reminders
INDUSTRY=home-services
SEED=42
TOOLSETS=invoicing,crm,inbox
```

## 2. Write the prompt

```bash
npx -y @teamshift/smb-workflows show $WF --industry $INDUSTRY --seed $SEED > prompt.md
cat prompt.md
```

The prompt names the company, today's simulated date, and the people involved. It never mentions the hidden ground truth.

## 3. Point Claude Code at the sandbox

Create an MCP config for this run only. Use an absolute path for `--state-out`, because the server's working directory may differ from yours.

```bash
cat > sandbox.mcp.json <<EOF
{
  "mcpServers": {
    "sandbox": {
      "command": "npx",
      "args": ["-y", "@teamshift/sandbox-mcp",
               "--industry", "$INDUSTRY", "--seed", "$SEED",
               "--toolsets", "$TOOLSETS",
               "--state-out", "$PWD/run.json"]
    }
  }
}
EOF
```

Do not add `--expose-answers`. That flag publishes the ground truth as a resource.

## 4. Run the agent

Run headless, with only the sandbox's tools allowed:

```bash
claude -p "$(cat prompt.md)" \
  --mcp-config sandbox.mcp.json --strict-mcp-config \
  --allowedTools "mcp__sandbox" \
  > transcript.txt
```

When the session ends, Claude Code closes the server's stdio and the sandbox writes `run.json`. The file is exactly what `buildStateFile` produces: `savedAt`, `simulatedNow`, the final `dataset`, the `audit` log, and the `outbox`.

To watch an interactive run instead, start `claude --mcp-config sandbox.mcp.json --strict-mcp-config`, paste the prompt, and exit with `/exit` when the agent is done.

## 5. Grade

```bash
npx -y @teamshift/smb-workflows grade $WF --industry $INDUSTRY --seed $SEED --state run.json
echo "exit code: $?"   # 0 = pass, 1 = fail, 2 = usage error
```

The output lists every check with its result and a short explanation, for example `states-number-and-balance:INV-2714` or `no-out-of-scope-changes`. Add `--json` to get a machine-readable result: `{ workflow, pass, score, checks }`.

## Run the whole suite

```bash
#!/usr/bin/env bash
set -u
npx -y @teamshift/smb-workflows list --json > workflows.json
for SEED in 1 7 42; do
  for INDUSTRY in home-services dental-clinic marketing-agency; do
    for WF in $(node -e 'for (const w of require("./workflows.json")) console.log(w.id)'); do
      TOOLSETS=$(node -e "console.log(require('./workflows.json').find(w => w.id === '$WF').toolsets.join(','))")
      DIR="runs/$WF/$INDUSTRY-$SEED"; mkdir -p "$DIR"
      npx -y @teamshift/smb-workflows show $WF --industry $INDUSTRY --seed $SEED > "$DIR/prompt.md"
      cat > "$DIR/mcp.json" <<EOF
{ "mcpServers": { "sandbox": { "command": "npx", "args": ["-y", "@teamshift/sandbox-mcp",
  "--industry", "$INDUSTRY", "--seed", "$SEED", "--toolsets", "$TOOLSETS", "--state-out", "$PWD/$DIR/run.json"] } } }
EOF
      claude -p "$(cat "$DIR/prompt.md")" --mcp-config "$DIR/mcp.json" --strict-mcp-config \
        --allowedTools "mcp__sandbox" > "$DIR/transcript.txt" 2>&1
      npx -y @teamshift/smb-workflows grade $WF --industry $INDUSTRY --seed $SEED \
        --state "$DIR/run.json" --json > "$DIR/grade.json"
      node -e "const r=require('./$DIR/grade.json'); console.log('$WF $INDUSTRY $SEED', r.pass ? 'PASS' : 'FAIL', r.score)"
    done
  done
done
```

The grade is deterministic: the same state file always gets the same score, so differences between runs come from the agent alone.

## Tips

- **Other agents.** The loop is the same for Cursor, VS Code or a custom agent. Start the sandbox with the same flags, give the agent `prompt.md`, end the session so the state is written, and grade.
- **No cheating channels.** Run in an empty directory, don't install smb-workflows where the agent can read it, and keep `--expose-answers` and `admin` off.
- **Partial credit.** `score` is the fraction of checks passed, which is useful for comparing prompts or models even when neither passes outright.
- **Reproduce a failure.** Rerun with the same industry and seed and you get the identical business. `smb-workflows show <id> --full` prints the task's "What a good result looks like" section for humans.
- **Check the harness itself.** `npx @teamshift/smb-workflows selftest` runs every reference solution and confirms each verifier fails on untouched data and passes on the solution.
