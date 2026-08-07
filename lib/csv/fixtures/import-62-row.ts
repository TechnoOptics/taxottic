// The 2026-08-01 import that exposed the sign-convention bug.
// Charges positive, refunds negative, uploaded as business_checking.
// 62 rows: 60 positive, 2 negative. 48 booked as expenses at the time
// this fixture was taken, 14 unresolved (including one income-looking
// positive row that was never booked to anything).
//
// description/postedAt were added for the import-duplicate-detection
// spec (2026-08-06). This is a fixture SHAPED LIKE the real import that
// prompted that spec, not the real file itself: the descriptions and
// dates below were invented for this branch. Every row gets a distinct
// amount_cents (the b/o series already varied theirs for the
// sign-convention fixture), so no row collides with any other on
// fingerprint except the two Delta rows, which are the deliberate
// duplicate pair described in the spec: same merchant, same day, same
// amount.
//
// This array's exact length (62), negative-amount count (2) and
// applied count (48) are asserted by lib/csv/sign-convention.test.ts.
// Do not add or remove rows here; add adversarial duplicate-detection
// cases to ADVERSARIAL_DUPLICATE_ROWS below instead.
export type FixtureRow = {
  id: string;
  amountCents: number;
  appliedCategoryCode: string | null;
  appliedExpenseId: string | null;
  description: string;
  postedAt: string;
};

const booked = (
  id: string,
  amountCents: number,
  code: string,
  description: string,
  postedAt: string,
): FixtureRow => ({
  id,
  amountCents,
  appliedCategoryCode: code,
  appliedExpenseId: `exp_${id}`,
  description,
  postedAt,
});
const open = (
  id: string,
  amountCents: number,
  description: string,
  postedAt: string,
): FixtureRow => ({
  id,
  amountCents,
  appliedCategoryCode: null,
  appliedExpenseId: null,
  description,
  postedAt,
});

export const LIVE_IMPORT_ROWS: FixtureRow[] = [
  booked("delta1", 1168463, "travel", "DELTA AIR LINES ATLANTA", "2026-07-07"),
  booked("delta2", 1168463, "travel", "DELTA AIR LINES ATLANTA", "2026-07-07"),
  booked("sams1", 20647, "supplies", "SAMS CLUB #4471", "2026-07-01"),
  booked("autozone", 6773, "vehicle_repairs", "AUTOZONE STORE 3390", "2026-07-02"),
  booked("lowes_refund", -2445, "supplies", "LOWES HOME IMPROVEMENT", "2026-07-03"),
  ...Array.from({ length: 43 }, (_, i) =>
    booked(
      `b${i}`,
      1000 + i * 37,
      "software_subscriptions",
      `SOFTWARE VENDOR ${i}`,
      `2026-06-${String((i % 28) + 1).padStart(2, "0")}`,
    ),
  ),
  open("ojala", 400000, "OJALA CONSULTING LLC", "2026-07-05"),
  open("target1", 40653, "TARGET T-1122", "2026-07-06"),
  open("vercel_credit", -84, "VERCEL INC", "2026-07-04"),
  ...Array.from({ length: 10 }, (_, i) =>
    open(
      `o${i}`,
      500 + i * 211,
      `OTHER MERCHANT ${i}`,
      `2026-07-${String((i % 20) + 8).padStart(2, "0")}`,
    ),
  ),
];

// Row count: 5 + 43 booked = 48 booked, 3 + 10 open = 13 open, plus
// one income row appended below for a total of 62.
LIVE_IMPORT_ROWS.push({
  id: "income1",
  amountCents: 25000,
  appliedCategoryCode: null,
  appliedExpenseId: null,
  description: "CLIENT PAYMENT RECEIVED",
  postedAt: "2026-07-10",
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

// Adversarial cases for the within-file duplicate guard
// (findWithinFileDuplicates). Kept separate from LIVE_IMPORT_ROWS so
// this array can be shaped for the guard test without disturbing the
// row-count assertions sign-convention.test.ts makes against
// LIVE_IMPORT_ROWS.
//
// Every row in LIVE_IMPORT_ROWS has a unique amount_cents by
// construction, which means a test built only from that fixture cannot
// prove the merchant-key length matters: even a badly broken merchant
// normalizer (MERCHANT_KEY_TOKENS set too low) would still fail to
// collide those rows, because the amount alone already disambiguates
// them. A guard test that cannot fail is not a guard. These rows exist
// specifically to close that gap: they include a pair that shares a
// merchant's FIRST token, the same date and the same amount, but is
// genuinely two different merchants once you read past token one.
export type AdversarialRow = {
  id: string;
  description: string;
  postedAt: string;
  amountCents: number;
};

export const ADVERSARIAL_DUPLICATE_ROWS: AdversarialRow[] = [
  // Real amounts from the import that prompted the spec: same
  // merchant, same day, genuinely the same charge twice. Must pair.
  { id: "launchpad1", description: "SQ *LAUNCHPAD GOLF", postedAt: "2026-06-22", amountCents: 13046 },
  // Same merchant, same day, DIFFERENT amount (two real trips, not a
  // duplicate). Amount is always part of the fingerprint regardless of
  // merchant-key length, so this must never pair with the row above.
  { id: "launchpad2", description: "SQ *LAUNCHPAD GOLF", postedAt: "2026-06-22", amountCents: 25081 },
  // Three $20 Anthropic charges. Only the two on 07-12 are a real
  // duplicate; 07-11 is a distinct subscription cycle and must not be
  // folded in just because the merchant and amount match.
  { id: "anthropic1", description: "ANTHROPIC", postedAt: "2026-07-11", amountCents: 2000 },
  { id: "anthropic2", description: "ANTHROPIC", postedAt: "2026-07-12", amountCents: 2000 },
  { id: "anthropic3", description: "ANTHROPIC", postedAt: "2026-07-12", amountCents: 2000 },
  // Two DIFFERENT merchants that happen to share a date and an exact
  // amount, and share their first whitespace-separated token
  // ("COSTCO"). The real difference (WHOLESALE vs GAS STATION) only
  // shows up at the second token. With the correct 3-token merchant
  // key these stay distinct; with a 1-token key they collapse into one
  // and wrongly pair. This is the case that actually exercises
  // MERCHANT_KEY_TOKENS.
  { id: "costco1", description: "COSTCO WHOLESALE 445", postedAt: "2026-07-08", amountCents: 4500 },
  { id: "costco2", description: "COSTCO GAS STATION 12", postedAt: "2026-07-08", amountCents: 4500 },
];
