# State × entity-type tax coverage matrix

This is the authoritative map of what the forecast engine models for
each combination of state and entity type. Source files:

- `lib/tax/state-brackets.ts` — personal-side bracket math
- `lib/tax/state-entity-taxes.ts` — entity-level state taxes
- `lib/tax/forecast.ts` — wires them together

## What "automated" means

✅ = computed and applied to the forecast total
⚠️ = surfaced as a hint or warning; preparer must follow up
❌ = not modeled at all (still preparer-owned)

## Matrix by entity type

### Sole prop / Single-member LLC (default federal tax: Schedule C)

| Tax type | All 50 states + DC |
|---|---|
| Federal income tax | ✅ Full bracket math (constants-2025/2026) |
| SE tax (§1401) | ✅ |
| Federal QBI (§199A) | ✅ Simple 20%; phaseouts ⚠️ |
| State personal income tax | ✅ 10 states with bracket math (CA/NY/NJ/MA/MN/OR/HI/DC/MD/CT); flat-rate fallback for others |
| State LLC franchise/fee | ✅ CA, DE, TN, MA (single_llc only); ❌ others |
| Gross-receipts / margin tax | ✅ TX, OH, WA, OR, NV (above thresholds) |
| State QBI conformity | ✅ Flag (CO, ND conform; default no) |
| PTET election eligibility | ⚠️ Hint surfaced for 36 PTET states |

### Multi-member LLC / Partnership (default federal tax: Form 1065)

Same as Sole prop, plus:

| Tax type | All states |
|---|---|
| K-1 distribution | ✅ Per-partner via K-1 generator |
| Partnership entity-level tax | ❌ Not modeled (most states pass through) |
| Composite return for nonresident partners | ❌ |

### S-Corp

| Tax type | Coverage |
|---|---|
| Federal pass-through | ✅ |
| Federal SE tax | ❌ Correct — S-Corp owners take W-2 wages instead |
| Federal QBI | ✅ |
| **State S-Corp tax** | ✅ CA 1.5%, IL 1.5%, MA 8%, TN 2.5% |
| **State minimum franchise** | ✅ CA $800, MA $456, NY $25 (low tier), TN $100 |
| **NY S-Corp tiered fixed-dollar minimum** | ⚠️ Floor only; full tiered table (up to $4,500) ❌ |
| **MA S-Corp sting tax** | ⚠️ Approximation only when receipts trigger |
| **TX S-Corp** | ✅ Federal S election ignored — entity files margin tax |
| State personal pass-through tax | ✅ Same as sole prop |
| Reasonable compensation enforcement | ⚠️ Assumption surfaced; not enforced |

### C-Corp

| Tax type | Coverage |
|---|---|
| Federal corporate income tax (21% TCJA) | ✅ |
| **State C-Corp income tax** | ✅ All 50 states + DC (replaced the previous personal-rate placeholder) |
| **State C-Corp tax brackets** | ⚠️ We use the headline rate. States with bracketed corp tax (NY 6.5%/7.25%, NJ 6.5–9%, AK 0–9.4%, IL 9.5% combined) use the top bracket |
| **Gross-receipts taxes (instead of income tax)** | ✅ TX margin, WA B&O, OH CAT, OR CAT, NV Commerce |
| **State minimum corp tax** | ❌ Not modeled (CT $250 base, NJ $375, etc.) |
| **Capital-stock / franchise tax** | ❌ Not modeled (DE, IL, MA, NY all have variants) |
| **Combined / unitary reporting** | ❌ |
| Personal tax on dividends | ✅ On owner's separate 1040 (different engine path) |

## Gross-receipts / margin tax thresholds + rates

| State | Tax | Rate | Threshold | Entity types |
|---|---|---|---|---|
| TX | Franchise (Margin) Tax | 0.375% (retail/wholesale) – 0.75% (other) | $1.23M no-tax-due | All non-individual filers |
| WA | B&O Tax | 0.471% retail – 1.5% service | $125K (small-biz credit) | All entities with WA nexus |
| OH | CAT | 0.26% | $3M (raised 2024) | All entities |
| OR | CAT | 0.57% + $250 flat | $1M | All entities |
| NV | Commerce Tax | 0.051% – 0.331% (tiered by industry) | $4M | All entities |

The forecast engine applies a **rough estimate** at the floor rate;
the result includes a `hasGrossReceiptsTax: true` flag and a
`hints[]` entry asking the preparer to verify nexus + sourcing.

## What still requires CPA partnership

These are deliberately not modeled. The engine surfaces hints where
applicable but does not auto-compute:

1. **PTET (pass-through entity tax) elections.** 36+ states offer
   PTET as a federal SALT-cap workaround. The election is annual,
   entity-by-entity, and the math depends on the federal SALT
   headroom remaining for each owner. We DETECT the option and
   surface a hint; the preparer evaluates and elects.
2. **Composite returns** for nonresident partners.
3. **Multi-state apportionment beyond sales-factor weights.** Most
   states allow single-sales-factor (our current model); some still
   use three-factor (sales / property / payroll). Throwback / throw-
   out rules vary.
4. **Sourcing rules** for service businesses: cost-of-performance vs
   market-based varies by state.
5. **State NOL carryforward + bonus-depreciation conformity.**
   States differ on §168(k) bonus depreciation conformity.
6. **State-level R&D, jobs, and historic-rehab credits.**
7. **County / local income taxes** (MD county tax is hinted but not
   computed; NYC unincorporated business tax, etc., not modeled).
8. **Sales / use tax.** Separate module (`lib/sales-tax/*`) handles
   this for clients with multi-state nexus; not part of the income
   tax forecast.

## Refresh cadence

State rates are revisited annually in late Q4 when departments of
revenue publish next year's bulletins. Each rate constant has an
`as_of_year` comment marking the source year so reviewers can spot
stale entries.

When you update a rate:

1. Update the rate + the note string.
2. Bump the `as_of_year` comment.
3. Add a regression test if the new rate makes a previously-passing
   test fail (it shouldn't, since tests use specific input values
   tied to the rate at write time).
4. Surface the change in the firm-side `/help` page if the impact
   on common forecasts exceeds $100.

## Refusing the temptation to model everything

We deliberately stop short of a complete state-tax engine. A
freelancer in TX doing $90K of revenue does not need composite
return math; a CPA-firm-of-50 client in CA running a multi-state
S-Corp does need it but should have a CPA on staff. The forecast
gives both groups *directionally correct* numbers with explicit
notes about what's left to a preparer.
