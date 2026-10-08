---
license: apache-2.0
language:
  - en
pretty_name: TeamShift SMB Sandbox Three-Year Company Library
size_categories:
  - n<1K
---

# TeamShift SMB Sandbox Three-Year Company Library

100 deterministic fictional companies spanning home services, dental clinics, marketing agencies and independent trailer dealers. Each spans 2023-10-01 through the simulated as-of date 2026-09-30, plus explicitly scheduled future appointments. This is synthetic test data, not sampled customer data or a measured business-outcome benchmark.

Build the existing workspace, then run `node scripts/export-library.mjs artifacts/library-v1`. Each gzipped JSON file contains the original linked business dataset, a mock double-entry ledger, modeled trailer stock movements and an invariant report. `manifest.json` supplies generation options and SHA-256 checksums. `fictional-names.json` records generated company names; callers can use `checkFictionalNames` with an explicit registry to screen near matches. Screening is not trademark clearance.

Email domains use reserved `.example` and telephone numbers use fictional 555-01xx ranges. Human-readable names are invented and may coincidentally resemble real entities. Do not contact them, use them for eligibility decisions, or treat them as customer facts.

## Calibration and limitations

Metadata records Census CBP 2023 employment and establishment counts, SUSB 2022 enterprise-size counts and BLS OEWS May 2023 occupational wages. Medium active staffing is rounded from CBP employment divided by establishments. SUSB shares and OEWS wages are contextual references, not a fitted distribution or generated payroll. Other sizes, role mixes, sales prices, appointment volumes, conversion rates and event timings are illustrative synthetic settings.

Sources: [CBP national data](https://www2.census.gov/programs-surveys/cbp/datasets/2023/cbp23us.zip), [SUSB detailed enterprise sizes](https://www2.census.gov/programs-surveys/susb/tables/2022/us_state_naics_detailedsizes_2022.txt), [SUSB methodology](https://www.census.gov/data/datasets/2022/econ/susb/2022-susb.html), and BLS tables linked per profile in metadata. CBP/SUSB use 2017 NAICS. Marketing wages use broader 541800. Utility trailer dealers use 2017 441228 and broader OEWS441200 as proxies; 2022 utility-trailer classification is broader 441227. These employer aggregates include larger firms and exclude self-employed workers; they do not establish SMB-only realism.

## Defects and accounting

Deliberate, labeled anomalies include invoice/job mismatches and conflicting statuses. Invariant reports retain those defects. The illustrative ledger books non-draft/non-void invoices into receivables/sales and received payments into cash/receivables or unapplied cash. It is not tax advice or a production posting system. Trailer opening stock is an explicit synthetic assumption sufficient for generated completed sales, not measured inventory. Other industries have no modeled stock, and inventory remains marked untested there.

## Reproduction and publication

`fake-business --list-companies` lists the stable IDs; `fake-business --company company-001` regenerates an entry. The library configurations opt into 36 months and calibration without changing `generate()` defaults. Do not combine a library ID with generation overrides.

License: the repository's Apache-2.0 license. The reviewed 100-company archive is published on [Zenodo](https://doi.org/10.5281/zenodo.23226098) as `library-v1`; its SHA-256 is `038a982f87ed115ad6e271229c13240cf95e2c576d1280649b4dbecdb23069ad`. Use [the dataset citation](CITATION.cff) for that deposit. The repository-root citation remains the software's `0.1.0` citation. Hugging Face publication remains a separate, unfinished acceptance step.
