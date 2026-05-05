# Monthly compliance audits

Six audit scripts the Plaid Compliance Center expects us to run on a
recurring basis. Each emits a markdown report that the shared
`scripts/md-to-pdf.mjs` converts to a branded PDF.

## What runs

| # | Script | Covers Plaid attestation |
| --- | --- | --- |
| 01 | `vulnerability-scan.mjs` | "Performs vulnerability scanning" |
| 02 | `access-control-review.mjs` | "Defined and documented access control policy" |
| 03 | `zero-trust-attestation.mjs` | "Implemented a zero trust access architecture" |
| 04 | `secure-tokens-review.mjs` | "Uses secure tokens and certificates for authentication" |
| 05 | `tls-headers-scan.mjs` | (recommended — independent verification of `taxottic.com`) |
| 06 | `dependency-freshness.mjs` | (recommended — early warning before CVEs land) |

## Where the reports go

The runner writes both `.md` and `.pdf` to:

```
C:\Users\abelm\OneDrive - technooptics.org\Group Of Compannies\Taxottic\Documents for Plaid\Compliance\<YYYY>\<MM>\
```

Override the base path with the `TAXOTTIC_COMPLIANCE_BASE` env var.

## Running

```bash
# Current month
npm run audits:monthly

# Specific month
node scripts/audits/run-monthly.mjs 2026-05
```

## Schedule

Designed to run on the last calendar day of each month. Use Windows
Task Scheduler (preferred — runs even if no shell is open) or a
calendar reminder. See `docs/MONTHLY_AUDIT_RUNBOOK.md` for the
scheduling recipe.
