import { describe, expect, it } from "vitest";
import {
  computeNetBusinessIncome,
  deductibleAmountForCategory,
  expensesByCategory,
  MEALS_CATEGORY_CODE,
} from "./net-business-income";
import { forecast, type ForecastInput } from "./forecast";

/**
 * Audit regression tests (`docs/audits/2026-05-13-company-creation-
 * income-expenses.md`).
 *
 * Critical #1: The forecast and export showed two different "Net
 * Business Income" numbers for the same dataset ($21,498 vs $21,398).
 * Root cause: meals 50% rule was applied on the forecast but not the
 * export. The fix unified both surfaces behind
 * `computeNetBusinessIncome`. These tests pin that they cannot drift.
 *
 * Critical #2: Schedule C Line 24b on the export was showing the
 * gross meals amount instead of the post-50% deductible figure. This
 * is enforced via `deductibleAmountForCategory("meals", ...)` always
 * returning half, so the export's category table can never again
 * mislabel Line 24b.
 */

const cents = (dollars: number) => Math.round(dollars * 100);

describe("deductibleAmountForCategory", () => {
  it("halves meals (IRC §274(n))", () => {
    expect(deductibleAmountForCategory(MEALS_CATEGORY_CODE, cents(200))).toBe(
      cents(100),
    );
    expect(deductibleAmountForCategory(MEALS_CATEGORY_CODE, cents(1234.56))).toBe(
      // half of $1,234.56 = $617.28
      cents(617.28),
    );
  });

  it("returns gross for ordinary Schedule C categories", () => {
    expect(deductibleAmountForCategory("office", cents(1234.56))).toBe(
      cents(1234.56),
    );
    expect(deductibleAmountForCategory("travel", cents(500))).toBe(cents(500));
    expect(deductibleAmountForCategory("software", cents(99.99))).toBe(
      cents(99.99),
    );
  });

  it("returns 0 for above-the-line codes (Schedule 1 adjustments)", () => {
    // These are deducted via the engine as AGI adjustments, not on
    // Schedule C. The export should not double-count them.
    expect(deductibleAmountForCategory("retirement_self", cents(5_000))).toBe(0);
    expect(deductibleAmountForCategory("self_employed_health", cents(3_000))).toBe(0);
    expect(deductibleAmountForCategory("hsa_contribution", cents(2_000))).toBe(0);
  });
});

describe("expensesByCategory", () => {
  it("rolls up monthly rows by category and computes both gross + deductible", () => {
    // The exact data from the audit.
    const rows = [
      { category_code: "office", amount_cents: cents(1234.56), month: 2 },
      { category_code: MEALS_CATEGORY_CODE, amount_cents: cents(200), month: 4 },
      { category_code: "software", amount_cents: cents(99.99), month: 5 },
    ];
    const totals = expensesByCategory(rows);

    const byCode = Object.fromEntries(totals.map((t) => [t.code, t]));

    expect(byCode["office"]).toMatchObject({
      grossCents: cents(1234.56),
      deductibleCents: cents(1234.56),
      count: 1,
    });
    expect(byCode[MEALS_CATEGORY_CODE]).toMatchObject({
      grossCents: cents(200),
      deductibleCents: cents(100),
      count: 1,
    });
    expect(byCode["software"]).toMatchObject({
      grossCents: cents(99.99),
      deductibleCents: cents(99.99),
      count: 1,
    });
  });
});

describe("computeNetBusinessIncome", () => {
  // The exact dataset from the audit ("Audit Test Co"):
  //   Income: $10,000 (Jan) + $5,432.10 (Mar) + $7,500.50 (May) = $22,932.60
  //   Expenses: $1,234.56 office + $200 meals + $99.99 software
  //     - gross sum                  = $1,534.55
  //     - deductible (meals halved)  = $1,434.55
  //   Net business income            = $22,932.60 − $1,434.55 = $21,498.05
  const auditIncomeCents = cents(10_000) + cents(5_432.1) + cents(7_500.5);
  const auditExpenseRows = [
    { category_code: "office", amount_cents: cents(1_234.56), month: 2 },
    { category_code: MEALS_CATEGORY_CODE, amount_cents: cents(200), month: 4 },
    { category_code: "software", amount_cents: cents(99.99), month: 5 },
  ];

  it("matches the audit's expected $21,498.05 net business income", () => {
    const r = computeNetBusinessIncome({
      incomeCents: auditIncomeCents,
      byCategory: expensesByCategory(auditExpenseRows),
    });
    expect(r.grossIncomeCents).toBe(cents(22_932.6));
    expect(r.grossExpensesCents).toBe(cents(1_534.55));
    expect(r.deductibleExpensesCents).toBe(cents(1_434.55));
    expect(r.netBusinessIncomeCents).toBe(cents(21_498.05));
  });

  it("matches the forecast engine's net business income for the same dataset (Critical #1)", () => {
    // The cross-surface invariant the audit asked us to pin: forecast
    // and export MUST agree on net business income. The forecast
    // engine's input shape splits meals into a separate bucket and
    // applies 50% internally; we replicate that here and compare.
    const nbi = computeNetBusinessIncome({
      incomeCents: auditIncomeCents,
      byCategory: expensesByCategory(auditExpenseRows),
    });

    const fc = forecast(forecastInputFromAudit({
      ytdIncomeCents: auditIncomeCents,
      ytdMealsCents: cents(200),
      ytdBusinessExpensesCents: cents(1_234.56) + cents(99.99),
    }));

    // The forecast result's `ytdNetBusinessIncomeCents` is the engine's
    // own "if you closed books today" number, it MUST equal our
    // standalone helper's result to within rounding.
    expect(fc.ytdNetBusinessIncomeCents).toBe(nbi.netBusinessIncomeCents);
  });
});

function forecastInputFromAudit(args: {
  ytdIncomeCents: number;
  ytdMealsCents: number;
  ytdBusinessExpensesCents: number;
}): ForecastInput {
  return {
    taxYear: 2026,
    filingStatus: "single",
    stateCode: "TX", // audit test company state; no income tax in TX
    age: 40,
    isBlind: false,
    itemize: false,
    dependents: 0,
    dependentsUnder17: 0,
    spouseIncomeCents: 0,
    estimatedPaymentsCents: 0,
    ownerW2WagesCents: 0,
    ownerW2WithheldCents: 0,
    ownerW2SsWagesCents: 0,
    spouseW2WagesCents: 0,
    spouseW2WithheldCents: 0,
    spouseW2SsWagesCents: 0,
    entityType: "sole_prop",
    ytdIncomeCents: args.ytdIncomeCents,
    ytdBusinessExpensesCents: args.ytdBusinessExpensesCents,
    ytdMealsCents: args.ytdMealsCents,
    ytdAboveTheLineCents: 0,
    ytdItemizedCents: 0,
    autoMileageCents: 0,
    autoHomeOfficeCents: 0,
    monthsEntered: 12, // pretend the figures are already year-end
  };
}
