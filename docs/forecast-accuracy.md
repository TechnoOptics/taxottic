# Forecast accuracy — how we verify the tax math

Tax math is the only thing in Taxottic where an error directly costs the user money. This doc explains the layers we use to verify the engine and how to add a new layer when one is missing.

---

## Running the tests

```bash
npm test          # one-off run
npm run test:watch  # re-runs on every file change
```

All tests live next to the code they verify (`*.test.ts` siblings). 125 tests as of the latest commit; each runs in under 50ms.

## The test layers (and what each catches)

### Layer 1 — IRS-published worked examples

For each credit module we ship, we encode the IRS's own published example as a test fixture. The expected dollar amounts come straight from the IRS publication (linked in the module's header comment).

- `lib/tax/credits/eitc.test.ts` — 16 tests against Rev. Proc. 2025-32 § 4.06 (2026 EITC parameters) + Pub 596 examples. Covers plateau / phase-in / phase-out / disqualifiers / back-year 2025 figures.
- `lib/tax/credits/savers.test.ts` — 12 tests against Form 8880 instructions. Covers all three rate brackets (10/20/50%), the contribution cap, age-18 disqualifier, back-year 2025.
- `lib/tax/credits/education.test.ts` — 17 tests against Pub 970. Covers AOTC tier math (100% of first $2k + 25% of next $2k), the 40% refundable split, LLC's 20%-of-up-to-$10k cap, MAGI phase-out at $80-90k single / $160-180k MFJ, MFS disqualifier.
- `lib/tax/state-brackets.test.ts` — 16 tests against the published state bracket tables. Covers CA mental-health surcharge over $1M, MA Fair Share surtax at $1,083,150, NJ separate MFJ tables (not just doubled), monotonicity across income.

### Layer 2 — End-to-end fixture scenarios

`lib/tax/forecast.test.ts` runs realistic filer scenarios through the whole engine and verifies the engine-level outputs against hand-computed expected values:

- W-2 only filer ($80k wages → ~$8,800 fed tax, small refund)
- Sole prop ($100k income, $20k expenses → ~$11,300 SE tax + $16k QBI deduction)
- W-2 + side hustle (the OBBBA "both" case)
- Retirement contributions trigger correct savings + recommendation
- AMT trigger (high income + heavy itemized deductions)
- Capital gains separate brackets ($100k LTCG single → $4-9k LTCG tax)
- EITC for a $13k-earned-income filer

Each fixture is a concrete scenario where we've computed the expected outputs by hand. When the engine changes, the fixtures catch any regression in the integration between modules.

### Layer 3 — Property-based invariants

Same file, `Invariants` block at the bottom. For a spread of 6 realistic scenarios (empty / modest W-2 / high-income sole prop / MFJ with kids + retirement / retiree on LTCG / CA high earner), we assert properties that **must hold for any input**:

- `stillOwed` and `refund` are never both positive — they're mutually exclusive.
- `alreadyPaid + stillOwed - refund === totalTax` (the balance reconciles).
- `marginalRate` is one of the valid bracket rates.
- `CTC + ODC <= dependents × $2,200` (the 2026 max per child).
- `QBI deduction <= 20% × taxable-income-before-QBI`.
- `amtAddOnCents >= 0`.
- No `NaN` or `Infinity` in any reported cents field.
- Higher income → higher (or equal) total tax (monotonicity).
- More deductible retirement contribution → more (or equal) tax savings.

Property tests catch the subtle bugs integration tests miss: sign flips, off-by-one boundary errors, clamping breaks. The first time we ran them, the layer immediately surfaced **a real bug**: long-term capital gains weren't being added to AGI, which made every AGI-driven phase-out (NIIT, credit thresholds, AMT exemption) see too-low an AGI for filers with investment income. Caught and fixed before any user noticed.

---

## How to add a new fixture

When you wire a new credit, deduction, or rule, before the change is "done":

### 1. Find the IRS-published worked example

Look in Pub 17, Pub 970, Pub 596, the Form's instructions PDF, or the Rev. Proc. Most IRS pubs ship worked examples for the credit; copy the inputs and the expected output as a fixture.

### 2. Write a test next to the code

```ts
// lib/tax/credits/your-credit.test.ts
import { describe, expect, it } from "vitest";
import { computeYourCredit } from "./your-credit";

describe("Your credit — IRS Pub XXX example 3", () => {
  it("single, $X earned, $Y AGI → exactly $Z credit", () => {
    const res = computeYourCredit({ /* IRS example inputs */ });
    expect(res.creditCents).toBe(Z * 100);
  });
});
```

### 3. Add a boundary test

The IRS rules almost always have phase-outs / thresholds. Test EXACTLY at:
- The start of the phase-out (credit at full value).
- The end of the phase-out (credit at zero).
- One dollar over the disqualifier (credit at zero with the correct reason).
- One dollar under (credit allowed).

### 4. Add the credit to the integration fixtures

In `lib/tax/forecast.test.ts`, add the new credit's data to one of the scenarios and update the expected output. Or add a new scenario that specifically targets the credit.

### 5. Run `npm test`. All 125+ tests must pass before merging.

---

## What this DOESN'T catch (and the planned next layers)

The 125 tests covered here are layer 1-3 of a longer pipeline. Layers 4-9 are planned and tracked here so they don't get lost:

### Layer 4 — Cross-validation against commercial software (planned)

For each of the integration fixtures in `forecast.test.ts`, manually run the same inputs through TurboTax Free / a CPA spreadsheet and store the expected outputs alongside the test as `// CONFIRMED via TurboTax 2024-Q4: total tax $X`. This catches errors where we've understood the statute one way but commercial software interprets it differently — usually meaning we're wrong, since these tools were built and audited by tax pros.

Effort: ~1 hour per fixture. Recommend doing this once before a major release, then again whenever the engine changes meaningfully.

### Layer 5 — Production sampling (planned)

Opt-in: when a user files their actual return, ask them to upload their final 1040 PDF. Compare our forecast against the filed numbers and store the deltas. Systematic biases (e.g., "our LTCG tax is always $200 low") become visible across many users where they wouldn't on any single forecast.

Effort: full feature (UI + storage + diff renderer). Adds the strongest possible accuracy signal we can get.

### Layer 6 — CPA review (planned)

Once a year, pay a CPA familiar with the relevant code sections to review the engine math against the actual statute. Particularly important for items where the IRS rule is ambiguous (§ 199A SSTB classification, edge-case credit interactions).

Effort: $$ but high signal-to-noise.

### Layer 7 — CI gate (planned)

Wire `npm test` into the Vercel build / a GitHub Actions check so a PR that breaks any tax test can't merge. Currently tests are local-only.

### Layer 8 — Annual regression (planned)

When constants for a new tax year land, replay all integration fixtures with both years and diff the outputs. The deltas should match the IRS's published inflation adjustments. If a constant got off by a digit, the year-over-year delta in a fixture will be wildly wrong.

### Layer 9 — Mutation testing (lower priority)

Use a tool like Stryker to verify that the test suite actually FAILS when we deliberately mutate the engine (e.g., flip `>` to `>=` or change `0.22` to `0.23`). This measures whether the suite has the coverage we think it has, or whether tests pass trivially because they don't exercise the right paths.

---

## Provenance — what each constant traces back to

When a number lands in a constants file, the file header should name the IRS publication / Rev. Proc. / SSA notice / state DOR document it came from, plus the section number. If a number is "approximated" (e.g., 2026 Saver's Credit AGI brackets haven't been officially published yet), call that out so the next maintainer knows to verify before tax season.

Constants files in scope:

- `lib/tax/constants-2025.ts` — federal 2025 brackets, std deduction, SE tax, QBI, CTC, NIIT, safe-harbor.
- `lib/tax/constants-2026.ts` — federal 2026 brackets + OBBBA amendments.
- `lib/tax/constants.ts` — tax-year-aware selector.
- `lib/tax/credits/eitc.ts` — EITC 2025/2026 by qualifying-children + investment-income disqualifier.
- `lib/tax/credits/savers.ts` — Saver's Credit AGI brackets.
- `lib/tax/credits/education.ts` — AOTC + LLC tier rules + phase-out range.
- `lib/tax/state-brackets.ts` — bracket tables for CA, NY, NJ, MA, MN, OR, HI, DC, MD, CT.

Each file's header comment lists its sources. If you update a constant, update the citation.

---

## TL;DR

- 125 tests today. `npm test` to verify.
- Layers 1-3 (worked examples, integration fixtures, property invariants) catch bugs the engine introduces.
- Layers 4-9 catch bugs the IRS / statute / commercial-software-interpretation introduces — planned, not yet built.
- The test layer has already caught one real bug (LTCG-not-in-AGI). Keep writing tests when adding credits and you'll catch more.
