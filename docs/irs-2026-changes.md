# IRS 2026 changes — what landed, what's still ahead

Reference for the tax-year-2026 update. Sources:

- **IRS Rev. Proc. 2025-32** — annual inflation adjustments for TY 2026 (the canonical numbers).
- **One Big Beautiful Bill Act** (OBBBA, Pub. L. 119-21, enacted July 4 2025) — statutory amendments threaded into Rev. Proc. 2025-32 wherever the law overrode the standard inflation indexing.
- IRS newsroom summary: <https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill>

---

## What's wired in this PR

The forecast engine is now **tax-year-aware**. `forecast(input)` reads `input.taxYear`, resolves the right per-year bundle via `lib/tax/constants.ts`, and uses the matching brackets / standard deduction / SE-tax wage base / QBI thresholds / NIIT thresholds / CTC amounts / safe-harbor share. A future-year request (say, 2027 before the IRS publishes 2027 numbers) falls back to the most recent published bundle with an `isFallback` flag surfaced as an in-forecast hint.

| Constant | 2025 | 2026 | OBBBA? |
|---|---:|---:|---|
| Top federal bracket (single) starts at | $626,350 | **$640,600** | TCJA rates made permanent (§ 70101) |
| Standard deduction — single / MFS | $15,000 | **$16,100** | Increased base permanent (§ 70102) |
| Standard deduction — HoH | $22,500 | **$24,150** | § 70102 |
| Standard deduction — MFJ / surviving spouse | $30,000 | **$32,200** | § 70102 |
| Additional standard deduction (aged/blind) — single | $2,000 | **$2,050** | indexing |
| Additional standard deduction (aged/blind) — married | $1,600 | **$1,650** | indexing |
| Child Tax Credit max per child | $2,000 | **$2,200** | § 70104 raised cap |
| CTC refundable portion | $1,700 | **$1,700** | unchanged |
| QBI threshold (single) | $197,300 | **$201,750** | indexing |
| QBI threshold (MFJ) | $394,600 | **$403,500** | indexing |
| Social Security wage base | $176,100 | **$184,500** | SSA-published |
| § 179 expensing cap | $1,250,000 | **$2,560,000** | § 70306 raised both cap and phase-out |
| § 179 phase-out start | $3,130,000 | **$4,090,000** | § 70306 |
| AMT exemption — single | (varies) | **$90,100** | § 70107 made TCJA increases permanent |
| AMT exemption — MFJ | (varies) | **$140,200** | § 70107 |
| LTCG 0% rate top (MFJ) | $96,700 | **$98,900** | indexing |
| LTCG 15% rate top (MFJ) | $600,050 | **$613,700** | indexing |
| Foreign earned income exclusion | $130,000 | **$132,900** | indexing |
| Estate basic exclusion | $13,990,000 | **$15,000,000** | § 70106 raised |
| FSA salary-reduction max | $3,300 | **$3,400** | indexing |
| Educator expense deduction | $300 | **$350** | indexing |

Additional sanity in the engine:
- Each forecast now stamps the actual constant year (`k.year`) and surfaces a hint if the user requested a year we don't have yet.
- The forecast-page disclaimers ("…apply the IRS-published brackets for tax year YYYY") now name the year and the source (Rev. Proc. 2025-32 + OBBBA) instead of hard-coding "2025."

---

## OBBBA changes NOT yet wired into the forecast engine

Tracked here so they don't fall through the cracks. Each is a feature-level decision (do we surface this in the UI? auto-categorize differently? gate by something?) rather than a one-line constant update.

### § 6041(a) — 1099 reporting threshold raised from $600 → $2,000
**Effect**: Sole props and small businesses no longer need to send 1099-NEC / 1099-MISC for vendor payments under $2,000 (for payments made after Dec 31 2025). Inflation-adjusted from 2027 forward.
**Where to surface**: deductions guidance ("you owe the vendor a 1099 if you've paid them more than $2,000 this year"); reminders for Q1 of the following year.
**Implementation**: probably a constant + a check on aggregated vendor totals from `account_transactions`/`monthly_expenses`. Low complexity, high value for compliance UX.

### § 199A QBI — $400 minimum deduction + $1,000 minimum QBI floor
**Effect**: Effective TY 2026, taxpayers with at least $1,000 of QBI get a minimum $400 deduction (even if the 20% formula would yield less); below $1,000 QBI, no deduction.
**Where to surface**: forecast engine's QBI block.
**Implementation**: two-line change in `lib/tax/forecast.ts` to apply `max(0.20 * QBI, $400)` floor when QBI ≥ $1,000.
Constants are already in `lib/tax/constants-2026.ts` as `QBI_2026.obbbaMinimumDeductionCents` and `obbbaMinimumQbiToQualifyCents`.

### § 179D — Energy Efficient Commercial Buildings Deduction sunsets
**Effect**: Deduction terminates for property whose construction begins after June 30, 2026 (§ 70507).
**Where to surface**: only matters if Taxottic surfaces § 179D specifically. Currently we don't, so this is a "do not later mistakenly add it as a deduction option without checking start date" note.

### Adoption credit refundability + employer childcare credit increases
**§ 70402**: First $5,000 of adoption credit is now refundable (was non-refundable), inflation-adjusted from 2026.
**§ 70401**: Employer-provided childcare credit raised to $500,000 ($600,000 for eligible small businesses).
**Where to surface**: business-credit surfaces if/when added; not currently in the forecast.

### Estate exclusion → $15M
Raised by § 70106. We don't currently surface estate-tax planning in the forecaster. Worth flagging on the marketing side ("we don't do estate tax — talk to a CPA") but no engine change.

### TCJA bracket / std-deduction permanence
The forecaster previously had no time-bomb logic for 2026; now that OBBBA made the TCJA rates permanent there is no scheduled bracket cliff to plan for. We can confidently drop any future "rates may change in 2026" disclaimer copy.

### § 127 employer student-loan reimbursements made permanent
$5,250 exclusion for employer-paid student loan principal/interest, indexed from 2026. Worth a future tile for users entering W-2 income with employer-paid loan benefits.

---

## Things outside this PR that need manual refresh

### Standard mileage rate (TY 2026)
The IRS publishes the 2026 mileage rate in a separate **Notice** (typically late December 2025). At the time of this writing it has not been released; `MILEAGE_RATE_2026_PER_MILE_CENTS` defaults to the 2025 rate of $0.70. **Action**: once the IRS Notice drops, update the constant to the 2026 cents-per-mile figure and the forecast assumption text will pick it up automatically.

### Social Security wage base verification
The SSA Cost-of-Living-Adjustment release (mid-October each year) sets the next year's wage base. The 2026 value of **$184,500** in `constants-2026.ts` is the figure announced in October 2025; verify against <https://www.ssa.gov/oact/cola/cbb.html> before production deploy.

### State tax tables
Most state brackets follow the federal calendar but a handful (CA, NY, MA) shift on their own legislative cadence. The `STATE_FLAT_RATES_2025` flat-rate placeholders are unchanged for 2026 — still rough averages, still labeled as estimates in the UI. **Action**: revisit when we wire a real bracket-lookup or a tax-data API.

---

## Maintenance cadence

Refresh annually around late October once the IRS publishes Rev. Proc. for the next tax year:

1. Add `lib/tax/constants-<year>.ts` mirroring the prior year's shape with the new values.
2. Wire it into `lib/tax/constants.ts` (`getTaxYearConstants` switch + bundle).
3. Bump `LATEST_PUBLISHED_YEAR` so future-year requests fall back to the new year.
4. Update or extend this doc with the diff vs prior year and any new statutory amendments.
5. Verify SSA wage base + IRS mileage notice in late December and patch the new constants file.
