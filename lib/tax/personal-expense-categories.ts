// Individual-side deduction categories for the personal expense tracker
// (item 14). These are the deductible personal items a W-2 / individual filer
// can track through the year: each one maps to a specific ForecastInput field
// so a tracked total flows straight into the personal forecast. Business
// (Schedule C) expenses are deliberately NOT here, they live on the company
// side; this keeps the individual/business split clean (items 15-16).

import type { ForecastInput } from "@/lib/tax/forecast";

/** The ForecastInput fields a personal expense category can drive. */
export type PersonalDeductionField =
  | "itemizedCharityCents"
  | "itemizedMedicalCents"
  | "itemizedMortgageInterestCents"
  | "itemizedSaltCents"
  | "studentLoanInterestCents"
  | "qualifiedEducationExpensesCents";

export type PersonalExpenseCategory = {
  /** Stable machine code stored in the DB. */
  code: string;
  label: string;
  /** One-line explainer shown under the category. */
  hint: string;
  /** The forecast input this category's annual total feeds. */
  field: PersonalDeductionField;
  /** True when the deduction only counts if the filer itemizes. */
  itemizedOnly: boolean;
};

export const PERSONAL_EXPENSE_CATEGORIES: PersonalExpenseCategory[] = [
  {
    code: "charitable",
    label: "Charitable donations",
    hint: "Cash or goods given to qualified nonprofits.",
    field: "itemizedCharityCents",
    itemizedOnly: true,
  },
  {
    code: "medical",
    label: "Medical & dental",
    hint: "Out-of-pocket medical costs (only the portion over 7.5% of income counts).",
    field: "itemizedMedicalCents",
    itemizedOnly: true,
  },
  {
    code: "mortgage_interest",
    label: "Mortgage interest",
    hint: "Home mortgage interest from your Form 1098.",
    field: "itemizedMortgageInterestCents",
    itemizedOnly: true,
  },
  {
    code: "salt",
    label: "State & local taxes",
    hint: "State income, sales, and property taxes (capped at $10k).",
    field: "itemizedSaltCents",
    itemizedOnly: true,
  },
  {
    code: "student_loan_interest",
    label: "Student loan interest",
    hint: "Interest paid on student loans (above-the-line, no itemizing needed).",
    field: "studentLoanInterestCents",
    itemizedOnly: false,
  },
  {
    code: "education",
    label: "Education expenses",
    hint: "Qualified tuition and fees that may earn an education credit.",
    field: "qualifiedEducationExpensesCents",
    itemizedOnly: false,
  },
];

export const PERSONAL_EXPENSE_CODES = new Set(
  PERSONAL_EXPENSE_CATEGORIES.map((c) => c.code),
);

export function personalCategory(code: string): PersonalExpenseCategory | undefined {
  return PERSONAL_EXPENSE_CATEGORIES.find((c) => c.code === code);
}

/**
 * Sum tracked rows into per-field cent totals. Used both by the tracker page
 * (to show category totals) and by the personal forecast (to override the
 * manually-entered itemized profile fields with what the user actually logged).
 */
export function sumPersonalExpenses(
  rows: { category: string; amount_cents: number }[],
): Partial<Record<PersonalDeductionField, number>> {
  const totals: Partial<Record<PersonalDeductionField, number>> = {};
  for (const r of rows) {
    const cat = personalCategory(r.category);
    if (!cat) continue;
    totals[cat.field] = (totals[cat.field] ?? 0) + r.amount_cents;
  }
  return totals;
}

// Compile-time guard: every field above must be a real ForecastInput key.
type _AssertFields = PersonalDeductionField extends keyof ForecastInput
  ? true
  : never;
const _assertFields: _AssertFields = true;
void _assertFields;
