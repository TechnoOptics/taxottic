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
