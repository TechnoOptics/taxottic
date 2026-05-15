# CPA review notes

This document is the working ground for a CPA reviewer. Half a day
sitting with these questions + the codebase is the missing piece
between "well-tested tax engine" and "tax engine a CPA has signed
off on."

## Reviewer instructions

1. Read the three top-level scope docs first (they enumerate
   everything we model + everything we don't):
   - `docs/STATE_ENTITY_TAX_MATRIX.md`
   - `docs/TAX_FORM_GENERATOR_LIMITATIONS.md`
   - `docs/REVIEW_GUIDE_TIER_1_TO_4.md`

2. Walk the test cases in these files — they encode the math we
   believe in:
   - `lib/tax/forecast.test.ts` (95 cases, federal forecast core)
   - `lib/tax/state-brackets.test.ts` (16 cases, progressive states)
   - `lib/tax/state-entity-taxes.test.ts` (39 cases, entity tax)
   - `lib/tax/state-rates-audit.test.ts` (17 cases, rate audit)
   - `lib/tax/service-sales-tax.test.ts` (36 cases, Wayfair)
   - `lib/firm/documents/generate-1040.test.ts` (8 cases)
   - `lib/firm/documents/generate-entity-return.test.ts` (6 cases)

3. Run a sanity scenario or two against staging:
   - $100k sole prop in CA, single filer, owner age 35 → expect
     SE tax ~$14k, federal ~$13k, CA ~$5k
   - $1M C-Corp in TX, no nexus elsewhere → expect 21% federal
     tax + TX margin tax above $1.23M
   - $500k S-Corp in CA, single shareholder, $80k owner W-2 →
     expect 1.5% CA tax + $800 CA franchise + personal-side
     pass-through math

4. Capture findings as commits or PR comments. Tag each finding
   with one of:
   - `[blocker]` — we must fix before customers rely on it
   - `[warn]` — should fix before promoting to "CPA-grade" copy
   - `[note]` — informational; doesn't block launch

## Questions to answer

### Federal income tax

1. Are the 2025 federal brackets in `lib/tax/constants-2025.ts`
   aligned with Rev. Proc. 2024-40 and the One Big Beautiful Bill
   amendments? We currently note the Rev. Proc. in the surface
   copy.

2. Standard deduction amounts ($15k single / $30k MFJ / $22.5k HoH)
   + age-65 + blindness add-ons: correct for 2025?

3. SE tax: 15.3% × 92.35% of net earnings, with the SS wage-base
   cap shared between W-2 + SE earnings. Code is in
   `lib/tax/forecast.ts` `computeSelfEmploymentTax()`. The 2026
   constants file has the next year's wage base; do we have the
   correct number?

4. QBI § 199A: We apply a simple 20% with a 20% × (AGI − deduction)
   cap. We do NOT apply the wage / unadjusted-basis cap or the
   SSTB phaseout. Is the simple model acceptable for forecasting,
   or do we need the full math even at the forecast level?

5. NIIT § 1411: 3.8% on the lesser of investment income or AGI
   above threshold. Thresholds in `NIIT_2025`. Correct?

6. Additional Medicare § 1401: 0.9% on the SE/wages base above
   threshold. Sum of W-2 wages + SE earnings + spouse wages all
   stacked correctly?

7. AMT: do we model it? (Spoiler: yes, in `forecast.ts` —
   `computeAmt()`. Review the exemption phase-out and the
   bracket-2 transition.)

### State income tax — personal side

8. Bracket tables for CA, NY, NJ, MA, MN, OR, HI, DC, MD, CT:
   correct for 2025? Each table in `lib/tax/state-brackets.ts`
   has a comment with the statutory reference.

9. State standard deductions (CA $5,540 single, NY $8,000, etc.):
   correct for 2025? See `STATE_STD_DEDUCTION_BY_STATE`.

10. Filing-status-doubled brackets (CA, NY MFJ): correct?

11. MA Millionaire's Tax (4% surtax on income > $1M): we model
    it as `onExcess: true`. Correct?

12. CA Mental Health Services surcharge (§ 17043): 1% on
    taxable income > $1M. Correct?

### State entity tax

13. C-Corp state rates (`C_CORP_STATE_RATE`): the table has 51
    rows. Walk a sample (CA 8.84%, NY 7.25%, TX 0%, MN 9.8%,
    LA 5.5% post-2025-reform). Any rate that looks wrong?

14. S-Corp state-level tax (`S_CORP_STATE_TAX`): CA 1.5% + $800
    min, IL 1.5% replacement, MA 8%, NY $25 floor minimum, TN
    2.5%. Did we miss a state with a meaningful entity-level
    S-Corp tax?

15. LLC fees: CA tiered ($800 + $0/$900/$2,500/$6,000/$11,790),
    DE $300, MA $500, TN $100. Did we miss DC LLC tax, IL LLC
    fee, NY LLC publication requirement (fee)?

16. Gross-receipts taxes: TX margin (0.375%), WA B&O, OH CAT,
    OR CAT, NV Commerce. Rates + thresholds correct?

17. State QBI conformity: we list CO + ND as conforming and
    everyone else as non-conforming. Is that current?

18. PTET state list: we use a 36-state set. Correct as of 2025?

### Multi-state apportionment

19. We extended `forecast.ts` with a `stateNexus[]` input
    (sales-factor weights normalized to 10000 bps). Resident-
    state credit is capped at `residentGrossTax ×
    nonResidentWeightSum`. Is the credit math directionally
    right? It's an approximation — Schedule M1CR-equivalent for
    each state — and we explicitly don't compute the actual
    state-by-state apportionment formula (single vs three-factor,
    cost-of-performance vs market-based).

20. We don't model combined / unitary reporting. For most firm
    clients (sole props, single LLC, small S-Corp) this is fine.
    For larger C-Corp groups it's a gap. Is the gap surface in
    the right place?

### Sales tax (Wayfair)

21. Economic-nexus thresholds (`ECONOMIC_NEXUS` in
    `service-sales-tax.ts`): walk a few — SD $100K (Wayfair home
    state), CA $500K no transactions, NY $500K AND 100 txns,
    DE/NH/OR/MT = no statewide tax. Correct?

22. NY uses an AND gate (both $500K + 100 txns), but our model
    returns OR semantics for simplicity. Acceptable
    approximation, or should we fix it?

23. Service taxability (`SERVICE_TAXABILITY`): we classify by
    category — professional, saas, digital_goods, installation,
    repair, personal, landscaping. Walk a state-by-state pick
    (CA exempts SaaS; NY taxes SaaS; HI/NM/SD/WV tax services
    broadly). Anything wrong?

24. SaaS taxability is the most-changing area. Our list:
    `AL, AZ, CT, DC, HI, IA, KY, MA, MD, MS, NE, NM, NY, OH, PA,
    RI, SD, TN, TX, UT, VT, WA, WI, WV`. Any missing or
    over-included?

### Form generators

25. **Form 1040** (`generate-1040.ts`):
    - Filing-status-appropriate AGI, std-vs-itemized, QBI cap
    - Federal tax via 2025 bracket math
    - SE tax stacked correctly
    - Refund / owed direction
    Sanity-check the math end-to-end.

26. **Schedule C** (`generate-schedule-c.ts`):
    - Lines 8-26 via category mapping
    - Meals 50% limit (Line 24b)
    - Net profit (Line 31)
    Is anything missing for the median sole-prop client?

27. **K-1** (`generate-k1.ts`):
    - Ordinary BI, §179, SE earnings (partnership only)
    - Capital account analysis (Item L) is preparer-fill
    Acceptable for v1?

28. **1065/1120/1120-S** (`generate-entity-return.ts`):
    - 1120 applies flat 21%; 1065 + 1120-S emit pass-through note
    - Deductions ordered by amount
    Schedule L (balance sheet) is explicitly NOT modeled — is
    that acceptable as a v1 limitation?

29. **1099-NEC / 1099-MISC** (`generate-1099.ts`):
    - $600 threshold filter
    - Backup-withholding NOT applied (we don't propagate the W-9
      flag yet)
    Is the backup-withholding gap a blocker?

### Process + governance

30. Rate-refresh cadence: how do you want to be notified when
    states publish new rate bulletins (annual Q4 in most states)?
    Currently we have `STATE_RATES_AS_OF_YEAR = 2025` + a
    phase-down hint for NC, PA, IN, NE, GA, AR. Is that the
    right signaling?

31. Disclaimer placement: the legal/forecast distinction is
    enforced in `/legal/terms#forecast-vs-advice` and a
    `<ForecastDisclaimer variant="card" />` is rendered at the
    foot of every forecast page (consumer + firm). Is the
    placement + copy strong enough?

32. Generated documents are watermarked DRAFT in big amber type
    + the "review starters, not file-ready" banner above the
    generator buttons. Sufficient?

### Items the engineer should track even before review

These are real known gaps that we know about but haven't gated
behind a CPA call. Listing them so the reviewer doesn't
re-discover them and the engineer can pick them up:

- **Schedule A itemization** detail (SALT cap, mortgage,
  charity) — not in 1040 draft
- **Schedule D** capital gains per-lot — not modeled
- **QBI phaseouts** above the 2025 threshold ($197,300 single /
  $394,600 MFJ) — we apply simple 20% only
- **SSTB qualification** — not applied
- **Foreign accounts** (Schedule B Part III + FBAR + Form 8938)
  — not in 1040 draft
- **Premium Tax Credit / ACA** (Form 8962) — not modeled
- **W-9 backup withholding** indicator → 1099 adjustment — not
  propagated
- **MeF e-filing** — submission ID stub only; real wiring waits
  on IRS EFIN approval
- **State NOL conformity + bonus-depreciation conformity**
- **State-level R&D, jobs, historic-rehab credits**
- **County / local income taxes** (MD county tax is hinted;
  NYC UBT, Philadelphia BIRT, etc. not modeled)

## Sign-off

When the reviewer is done:

1. They add their initials + date below.
2. They list any [blocker] findings the engineer must address
   before customer rollout.
3. They list [warn] findings that should be addressed in the
   next sprint.
4. They list [note] findings as future enhancement candidates.

---

**Reviewed by:** _____________________
**Date:** _____________________

### Findings

[blocker] —

[warn] —

[note] —

---

**Re-review on:** _____________________ (annual rate refresh)
