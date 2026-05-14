# Tax-form generator — what's automated, what isn't

The firm-side document generators (`/firm/clients/[id]/documents`)
produce **review-starter drafts**, not file-ready returns. Every
output is watermarked **DRAFT** and is intended for a licensed
preparer to compare line-by-line against the IRS-issued form
before signing or e-filing.

This document is the operator-facing source of truth for what each
generator does and does not compute. It complements the inline
amber-banner warning in the UI.

---

## Form 1040 — `generate-1040.ts`

### Automated
- Filing status, age, blindness, dependent count
- W-2 wages (Line 1a) from `tax_profiles.owner_w2_wages_cents` +
  `tax_profiles.spouse_w2_wages_cents`
- Schedule C net profit (Line 1h via Schedule 1) re-derived from
  `monthly_income` + `monthly_expenses` (50% meal limitation
  applied; categories mapped via `deduction_categories.schedule_c_line`)
- Interest and dividends from income rows tagged `interest` /
  `dividends`
- Adjustments (Schedule 1 Part II): half of SE tax, self-employed
  retirement contributions (solo 401k + SEP-IRA + Trad IRA),
  self-employed health insurance, HSA, student loan interest
- AGI (Line 11) = Total income − Adjustments
- Standard deduction (Line 12) using 2025 amounts +
  age-65/blindness add-ons
- Itemized deduction is honored when `tax_profiles.itemize = true`
  AND the itemized total exceeds the standard deduction
- QBI deduction (Line 13) — simple 20% of Schedule C net, capped
  at 20% of (AGI − Deduction)
- Federal income tax (Line 16) using 2025 bracket tables
- SE tax (Line 23) at 15.3% × 92.35% of Schedule C net
- Total payments (Line 33) = withholding + estimated payments
- Refund (Line 34) / Amount owed (Line 37)

### NOT automated — preparer fills in
- **Schedule A** — itemized deduction breakouts (SALT cap, mortgage
  interest, charity)
- **Schedule B** — interest/dividend payer detail when total ≥ $1,500
- **Schedule D** — capital gains with per-lot holding-period detail
- **Schedule E** — partnership / S-Corp K-1 flow-throughs beyond
  what we surface via the K-1 generator
- **QBI phaseouts** above the 2025 threshold ($197,300 single /
  $394,600 MFJ) — we apply the simple 20%, not the W-2 wages /
  unadjusted-basis-in-qualified-property cap
- **SSTB qualification** — we don't apply the SSTB phaseout for
  service-trade-or-business income
- **Foreign accounts** (Schedule B Part III + FBAR + Form 8938)
- **Premium Tax Credit / ACA reconciliation** (Form 8962)
- **Estimated tax penalty** (Form 2210)
- **Form 1040-SR** (seniors) layout — we always emit the standard
  1040
- **Signature blocks** are left unsigned; the preparer signs after
  review

---

## Form 1065 / 1120 / 1120-S — `generate-entity-return.ts`

### Automated (all three forms)
- Entity identification (name, EIN, entity_type)
- Gross receipts (Line 1a) from `monthly_income`
- Cost of goods sold left at 0 (until books capture it separately)
- Other income (interest, dividends, royalties, rentals) tagged
  via income source field
- Total deductions aggregated from `monthly_expenses` keyed to
  Schedule-C-mapped categories
- Deduction breakdown by category, descending by amount
- Ordinary business income / loss = total income − deductions
- For **Form 1120 only**: 21% flat federal tax (TCJA)
- For **Forms 1065 and 1120-S**: pass-through note (no entity-
  level federal tax)
- Owner count (partners / shareholders) from
  `business_profiles.k1_partners` JSONB, fallback 1

### NOT automated
- **Schedule L** (Balance Sheet) — assets, liabilities, equity at
  beginning + end of year
- **Schedule M-1** (Reconciliation of Income/Loss per Books With
  Income per Return)
- **Schedule M-2** (Analysis of Partners' / Shareholders' Capital
  Accounts)
- **Form 4562** depreciation detail beyond Section 179
- **Schedule K** (entity-level distributive share of income +
  deductions) — partial (we surface §179 on the K-1 generator
  but not the full K-line breakdown here)
- **Form 1125-A** (Cost of Goods Sold) when inventories apply
- **Form 1125-E** (Compensation of Officers) breakdown when
  receipts ≥ $500,000
- **Form 8990** (Limitation on Business Interest Expense) §163(j)
- **Form 4797** (Sales of Business Property)
- **State entity-level returns** — we draft federal only

---

## K-1 — `generate-k1.ts`

### Automated
- Ordinary business income share (Line 1)
- Rental real estate, interest, dividend, royalty shares
- §179 deduction share (Line 12)
- For partnerships only: SE earnings share (Line 14a) at the
  92.35% SE-base haircut

### NOT automated
- **Item L** (Partner's capital account analysis) — beginning
  capital, contributions, current-year increase, withdrawals,
  ending capital
- **Partner's share of liabilities** (recourse, qualified
  nonrecourse, nonrecourse)
- **Special allocations** (built-in gain/loss, §704(c))
- **Foreign transactions** (Schedule K-2 / K-3)
- **Multi-class S-Corp shareholder vote rights**

---

## 1099-NEC / 1099-MISC — `generate-1099.ts`

### Automated
- Recipient aggregation across `monthly_expenses` (matched by
  `paid_to_name` and the contract-labor / rents / royalties
  category mappings)
- $600 threshold filter
- Box 1 amount (Non-employee compensation / Rents / Royalties)
- Filer info from the engagement's company row

### NOT automated
- **Backup withholding** (Box 4) — would need a per-recipient
  W-9 with backup-withholding indicator
- **Federal income tax withheld** (Box 4)
- **State income tax** (Box 5-7) — state-specific forms
- **Correction-flag handling** when amending a prior 1099
- **FIRE / IRIS submission** — paper / e-file dispatch is manual

---

## Schedule C — `generate-schedule-c.ts`

### Automated
- Lines 8–26 by category mapping
- Line 24b (50% meal limitation)
- Net profit (Line 31) = gross income − total expenses

### NOT automated
- **Part III** (Cost of Goods Sold) — most service-business clients
  don't need it
- **Part IV** (Vehicle expense breakout) — standard mileage vs
  actual-expense choice not surfaced
- **Form 8829** (Home office) — Line 30 surfaces the category but
  doesn't compute the allocated portion

---

## How we decide what to add next

Generators ship in this priority order:

1. **Surfaces the firm has to compute every quarter anyway.** Save
   them the typing.
2. **Surfaces where the math is mechanical from existing books.**
   No new data capture needed.
3. **Surfaces where the IRS form layout is stable across years.**
   So we don't have to chase annual rewrites.

Things that intentionally stay manual:

- Forms with significant preparer judgment (Form 4562
  depreciation method choice; §179 vs bonus vs MACRS)
- Forms that require data we don't capture in books (Schedule L
  balance sheet)
- Edge-case schedules used by < 5% of clients (Schedule D-1,
  Form 8889 HSA contribution limits at multiple plan types)

If a generator feels like it should exist but doesn't, file it as
a follow-up against the engagement issue tracker and tag it
`tax-form-generator-candidate`.
