# SMB sandbox engineering

This public asset contains fictional test businesses and mock tools, not customer records or a production workflow engine. Preserve native-worker compatibility and existing generator defaults. New optional features must not change historical fixtures unless explicitly versioned.

- No GitHub Actions: build and verify locally.
- `pnpm install --frozen-lockfile`, then `pnpm build`, `pnpm test`, `pnpm typecheck`.
- Focused generator work: `pnpm --filter @teamshift/fake-business build`, then its `test` and `typecheck` scripts. CLI tests exercise built output, so build first.
- Export the public three-year library with `node scripts/export-library.mjs <owned-output-directory>` after building. Outputs are 100 gzipped JSON companies, a checksummed manifest and a fictional-name registry. Never commit generated archives or credentials.
- The library opts into source-bound medium staffing; Census/BLS references carry year, industry vintage, formulas and proxy limitations in metadata. Lead volumes, prices, conversion rates and operational events remain illustrative.
- Invariant reports include deliberately injected defects. Do not suppress them because an anomaly label exists, or claim missing ledger/inventory evidence passed.
- The ledger and trailer stock are illustrative mock accounting, never a live posting adapter. Unmatched payments remain unapplied cash. Inventory scope is completed trailer-sale SKUs.
- Name screening needs an explicit registry and reports fuzzy matches; it is not real-business or trademark clearance.
- Dataset releases need the dataset card, Apache-2.0 license and source provenance. Public GitHub release, package installation, Hugging Face acceptance and Zenodo DOI are separate proofs. Do not claim the latter from source merge alone.
- Native benchmark: `packages/smb-bench/README.md`; build first, then focused `pnpm --filter @teamshift/smb-bench test` and `typecheck`. The corpus is 100 instances / 13 templates; purchasing/warranty are mock review handoffs. Simulated provider tests and reference solves are not model rankings. Live matrices require independently verified existing admission; never retry uncertain requests or commit private held-out fixtures/keys. Leaderboard submissions require reviewed real traces and practitioner/evaluator receipts.
- Export the benchmark public manifest with `node scripts/export-benchmark.mjs <new-owned-output-dir> <reviewed-source-sha>` after building. It verifies 100 untouched/reference pairs and publishes prompts/checksums, never fabricated model scores. Held-out runner manifests remain private and require exactly 100 unique fixtures and checksums.
