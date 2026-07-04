import { describe, it, expect } from "vitest";
import {
  sumPersonalExpenses,
  personalCategory,
  PERSONAL_EXPENSE_CODES,
} from "./personal-expense-categories";

describe("personal-expense-categories", () => {
  it("maps each category to a distinct forecast field", () => {
    const fields = new Set(
      [...PERSONAL_EXPENSE_CODES].map((c) => personalCategory(c)!.field),
    );
    expect(fields.size).toBe(PERSONAL_EXPENSE_CODES.size);
  });

  it("sums rows into the right forecast fields", () => {
    const totals = sumPersonalExpenses([
      { category: "charitable", amount_cents: 5000 },
      { category: "charitable", amount_cents: 2500 },
      { category: "salt", amount_cents: 100000 },
      { category: "student_loan_interest", amount_cents: 30000 },
    ]);
    expect(totals.itemizedCharityCents).toBe(7500);
    expect(totals.itemizedSaltCents).toBe(100000);
    expect(totals.studentLoanInterestCents).toBe(30000);
    // Untouched categories are absent (so callers fall back to the profile).
    expect(totals.itemizedMedicalCents).toBeUndefined();
  });

  it("ignores unknown categories", () => {
    const totals = sumPersonalExpenses([
      { category: "not_a_category", amount_cents: 999 },
      { category: "medical", amount_cents: 4200 },
    ]);
    expect(totals.itemizedMedicalCents).toBe(4200);
    expect(Object.keys(totals)).toEqual(["itemizedMedicalCents"]);
  });
});
