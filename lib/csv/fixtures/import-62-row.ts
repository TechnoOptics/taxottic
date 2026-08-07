// The 2026-08-01 import that exposed the sign-convention bug.
// Charges positive, refunds negative, uploaded as business_checking.
// 62 rows: 60 positive, 2 negative. 48 booked as expenses at the time
// this fixture was taken, 14 unresolved (including one income-looking
// positive row that was never booked to anything).
export type FixtureRow = {
  id: string;
  amountCents: number;
  appliedCategoryCode: string | null;
  appliedExpenseId: string | null;
};

const booked = (id: string, amountCents: number, code: string): FixtureRow => ({
  id,
  amountCents,
  appliedCategoryCode: code,
  appliedExpenseId: `exp_${id}`,
});
const open = (id: string, amountCents: number): FixtureRow => ({
  id,
  amountCents,
  appliedCategoryCode: null,
  appliedExpenseId: null,
});

export const LIVE_IMPORT_ROWS: FixtureRow[] = [
  booked("delta1", 1168463, "travel"),
  booked("delta2", 1168463, "travel"),
  booked("sams1", 20647, "supplies"),
  booked("autozone", 6773, "vehicle_repairs"),
  booked("lowes_refund", -2445, "supplies"),
  ...Array.from({ length: 43 }, (_, i) =>
    booked(`b${i}`, 1000 + i * 37, "software_subscriptions"),
  ),
  open("ojala", 400000),
  open("target1", 40653),
  open("vercel_credit", -84),
  ...Array.from({ length: 10 }, (_, i) => open(`o${i}`, 500 + i * 211)),
];

// Row count: 5 + 43 booked = 48 booked, 3 + 10 open = 13 open, plus
// one income row appended below for a total of 62.
LIVE_IMPORT_ROWS.push({
  id: "income1",
  amountCents: 25000,
  appliedCategoryCode: null,
  appliedExpenseId: null,
});

// ---------------------------------------------------------------------
// The same 62 rows with every column the completion and batch-selection
// work reads. FixtureRow above carries only what planFlip needs; these
// add the ignore flag, the income link, the Bella suggestion, and the
// owning import and company, so a batch action's server-side re-derivation
// can be tested without a database.
//
// Two variants, because the two specs photograph the import one row
// apart and both counts are worth pinning:
//
//   LIVE_IMPORT_62               the file exactly as it sits today. The
//                                +$250.00 row reads as an expense under
//                                charges_positive and is not booked to
//                                anything, so it is one of the 14
//                                unresolved rows and one of the 13 that
//                                a select-all may offer.
//   LIVE_IMPORT_62_INCOME_BOOKED the same import after that row is
//                                booked as income, which is the shape
//                                the completion spec quotes: 48 booked,
//                                1 income, 13 unresolved.
//
// The refunds are the point of both. Under charges_positive a negative
// amount is money coming back:
//   lowes_refund   -$24.45  already booked as a deduction, the live
//                           error these specs exist to stop repeating.
//   vercel_credit   -$0.84  still unresolved, and must never be
//                           reachable by select-all plus Apply.
// Neither is ever selectable: the first because it is booked, the
// second because it is a refund.
// ---------------------------------------------------------------------

export const LIVE_IMPORT_ID = "imp_2026_08_01";
export const LIVE_COMPANY_ID = "co_live";
/** The convention detected for this file: charges positive, refunds negative. */
export const LIVE_CONVENTION = "charges_positive" as const;

export type ImportFixtureRow = {
  id: string;
  importId: string;
  companyId: string;
  amountCents: number;
  suggestedCategoryCode: string | null;
  appliedCategoryCode: string | null;
  appliedExpenseId: string | null;
  appliedIncomeId: string | null;
  ignored: boolean;
};

/**
 * Derived from LIVE_IMPORT_ROWS so the two views of this import can
 * never drift apart. A row that is unresolved and reads as a charge
 * carries a Bella suggestion, which is exactly what the user sees:
 * thirteen rows displaying a category that looks chosen and is not,
 * because suggested_category_code is not applied_category_code.
 */
export const LIVE_IMPORT_62: ImportFixtureRow[] = LIVE_IMPORT_ROWS.map((r) => {
  const isCharge = r.amountCents > 0;
  const unresolved = !r.appliedExpenseId;
  return {
    id: r.id,
    importId: LIVE_IMPORT_ID,
    companyId: LIVE_COMPANY_ID,
    amountCents: r.amountCents,
    suggestedCategoryCode: unresolved && isCharge ? "supplies" : null,
    appliedCategoryCode: r.appliedCategoryCode,
    appliedExpenseId: r.appliedExpenseId,
    appliedIncomeId: null,
    ignored: false,
  };
});

/** LIVE_IMPORT_62 with the +$250.00 row booked as income. */
export const LIVE_IMPORT_62_INCOME_BOOKED: ImportFixtureRow[] =
  LIVE_IMPORT_62.map((r) =>
    r.id === "income1"
      ? {
          ...r,
          suggestedCategoryCode: null,
          appliedIncomeId: "inc_income1",
        }
      : r,
  );
