# Contributing to smb-sandbox

Thanks for helping make agent testing more realistic. Most contributions fit one of these:

| You want to… | Where | What a good PR includes |
|---|---|---|
| Add an industry | `packages/fake-business/src/industries/` | One file: services/SKUs, pricing, roles, policies, request text. Tests must still pass for the new industry. |
| Add a kind of realistic mess | `packages/fake-business` anomalies | The injection, a checker proving the condition holds, and a one-sentence description. |
| Add an export format | `packages/fake-business` exporters | Exporter + a test that it runs on every industry. Don't claim official vendor compatibility. |
| Add or improve a mock tool | `packages/sandbox-mcp` | Store method with invariants + audit entry, MCP tool, test. |
| Add a workflow task | `workflows/` | Task prompt, verifier that **fails** on the untouched dataset and **passes** on the reference solution. |

## Ground rules

- **Everything stays fictional.** No real company, person, email, phone number or address. Use `.example` domains and 555-01xx numbers.
- **Determinism matters.** Same seed ⇒ same bytes. Don't add dependencies that make output drift.
- **Verifiers check end state, not agent claims.** A task passes because the data changed correctly, never because an agent said it did.

## Development

```bash
corepack enable
pnpm install
pnpm build && pnpm test && pnpm typecheck
```

Open an issue first for large changes. By contributing you agree your work is licensed under Apache-2.0.
