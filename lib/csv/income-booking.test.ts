import { describe, it, expect } from "vitest";
import {
  planIncomeBooking,
  type IncomeBookingContext,
} from "./income-booking";
import { interpretAmount, type SignConvention } from "./sign-convention";

const ctx = (over: Partial<IncomeBookingContext> = {}): IncomeBookingContext => ({
  convention: "charges_negative",
  taxYear: 2026,
  currentMonth: 8,
  isSubscription: false,
  ...over,
});

const row = (
  over: Partial<Parameters<typeof planIncomeBooking>[0]> = {},
): Parameters<typeof planIncomeBooking>[0] => ({
  amountCents: 250000,
  postedAt: "2026-06-14",
  appliedCategoryCode: null,
  ...over,
});

describe("planIncomeBooking", () => {
  it("books a deposit dated in a past month of the tax year", () => {
    expect(planIncomeBooking(row(), ctx())).toEqual({
      kind: "book",
      month: 6,
      amountCents: 250000,
      recurrence: "one_off",
    });
  });

  it("books a deposit dated in the current month", () => {
    expect(
      planIncomeBooking(row({ postedAt: "2026-08-02" }), ctx()).kind,
    ).toBe("book");
  });

  it("marks a subscription-looking deposit as recurring", () => {
    expect(
      planIncomeBooking(row(), ctx({ isSubscription: true })),
    ).toMatchObject({ kind: "book", recurrence: "monthly" });
  });

  it("reports the magnitude, never a negative amount", () => {
    expect(
      planIncomeBooking(
        row({ amountCents: -250000 }),
        ctx({ convention: "charges_positive" }),
      ),
    ).toMatchObject({ kind: "book", amountCents: 250000 });
  });

  it("takes the month from postedAt, not from today", () => {
    expect(
      planIncomeBooking(row({ postedAt: "2026-01-31" }), ctx({ currentMonth: 8 })),
    ).toMatchObject({ kind: "book", month: 1 });
  });

  it("skips a row with no date", () => {
    expect(planIncomeBooking(row({ postedAt: null }), ctx())).toEqual({
      kind: "skip",
      reason: "no_date",
    });
  });

  it("skips an unparseable date rather than booking month NaN", () => {
    expect(planIncomeBooking(row({ postedAt: "not-a-date" }), ctx())).toEqual({
      kind: "skip",
      reason: "no_date",
    });
  });

  it("skips another tax year", () => {
    expect(planIncomeBooking(row({ postedAt: "2025-12-30" }), ctx())).toEqual({
      kind: "skip",
      reason: "other_tax_year",
    });
  });

  it("skips a future month", () => {
    expect(planIncomeBooking(row({ postedAt: "2026-09-01" }), ctx())).toEqual({
      kind: "skip",
      reason: "future_month",
    });
  });

  it("skips a zero amount", () => {
    expect(planIncomeBooking(row({ amountCents: 0 }), ctx())).toEqual({
      kind: "skip",
      reason: "zero_amount",
    });
  });

  it("refuses anything the convention reads as a charge", () => {
    // The mirror of planExpenseBooking's last guard. -4065 under
    // charges_negative is a purchase, not revenue.
    expect(
      planIncomeBooking(
        row({ amountCents: -4065 }),
        ctx({ convention: "charges_negative" }),
      ),
    ).toEqual({ kind: "skip", reason: "not_income" });
  });

  it("reads the same amount either way depending only on the convention", () => {
    const r = row({ amountCents: 400000 });
    expect(planIncomeBooking(r, ctx({ convention: "charges_negative" })).kind).toBe(
      "book",
    );
    expect(
      planIncomeBooking(r, ctx({ convention: "charges_positive" })),
    ).toEqual({ kind: "skip", reason: "not_income" });
  });
});

/**
 * THE INCIDENT, 2026-08-06, on a real return.
 *
 * The owner coded a $4,000 transaction "IN *OJALA-BARBOUR" as
 * legal_pro, an EXPENSE category. The import was still typed
 * business_checking, i.e. charges_negative, where +400000 reads as
 * money coming in, so the inline income branch booked it as $4,000 of
 * income while the row still carried his expense code: $4,000 of
 * invented revenue plus a $4,000 deduction lost, an $8,000 swing
 * against him on a Schedule C.
 *
 * Every other guard in the function PASSES on this row. Its date is
 * good, its year is the filing year, its month is past, its amount is
 * non-zero, and the convention agrees it is money in. The only thing
 * standing between this row and the same $8,000 error is the category
 * check, which is why it gets its own block.
 */
describe("the OJALA-BARBOUR row: a user's category outranks the sign", () => {
  const incident = row({
    amountCents: 400000,
    postedAt: "2026-07-15",
    appliedCategoryCode: "legal_pro",
  });
  const incidentCtx = ctx({ convention: "charges_negative" });

  it("is NOT booked as income", () => {
    const d = planIncomeBooking(incident, incidentCtx);
    expect(d.kind).toBe("skip");
    expect(d).toEqual({ kind: "skip", reason: "user_category_conflict" });
  });

  it("would otherwise have been booked, which is what makes the guard load-bearing", () => {
    // Same row, same context, category removed. If this does not book,
    // the test above proves nothing: it would be passing on some other
    // guard and the category check could be deleted unnoticed.
    const d = planIncomeBooking(
      { ...incident, appliedCategoryCode: null },
      incidentCtx,
    );
    expect(d).toEqual({
      kind: "book",
      month: 7,
      amountCents: 400000,
      recurrence: "one_off",
    });
  });

  it("names the conflict rather than reporting a date or amount problem", () => {
    const d = planIncomeBooking(incident, incidentCtx);
    // A CPA reading the skip reason next April needs to know a human
    // disagreed, not that something was wrong with the row.
    expect(d).toMatchObject({ reason: "user_category_conflict" });
  });

  it("outranks every other skip reason, whatever else is wrong with the row", () => {
    // The category check is first for a reason: a row a human coded
    // legal_pro is not income in July and income in August. Reporting
    // "wrong tax year" would be true and useless.
    const wrecked = [
      { postedAt: null },
      { postedAt: "not-a-date" },
      { postedAt: "2019-01-01" },
      { postedAt: "2026-12-31" },
      { amountCents: 0 },
      { amountCents: -400000 },
    ];
    for (const over of wrecked) {
      expect(
        planIncomeBooking({ ...incident, ...over }, incidentCtx),
      ).toEqual({ kind: "skip", reason: "user_category_conflict" });
    }
  });

  it("does not treat Bella's own suggestion as a human decision", () => {
    // suggested_category_code is a different column and is never passed
    // in. Only applied_category_code, which nothing but a human write
    // sets on this path, can veto. Otherwise Bella would veto Bella and
    // no import would ever book income again.
    expect(
      planIncomeBooking(row({ appliedCategoryCode: "" }), incidentCtx).kind,
    ).toBe("book");
  });
});

/**
 * runBellaCategorize carried its own inline copy of these rules. It
 * books the larger share of an import's rows: unattended, at upload
 * time, before any human sees the review screen. Routing it through
 * planIncomeBooking removes the second copy, and this block is the
 * proof that removing it changed nothing EXCEPT the new category guard.
 *
 * `legacyIncomeDecision` is that inline code, transcribed verbatim from
 * the loop in app/c/[publicId]/import/actions.ts as it stood before the
 * refactor, down to the order of the guards, and deliberately WITHOUT
 * the category check, which it never had. So the comparison below runs
 * only over rows with no user category, where the two must agree
 * exactly; the rows where they differ are the bug, and they are covered
 * above.
 */
type LegacyOutcome =
  | { booked: false }
  | { booked: true; month: number; amountCents: number; recurrence: string };

function legacyIncomeDecision(
  tx: { amount_cents: number; posted_at: string | null },
  args: {
    taxYear: number;
    currentMonth: number;
    convention: SignConvention;
    isSubscription: boolean;
  },
): LegacyOutcome {
  // if (!tx.posted_at) continue;
  if (!tx.posted_at) return { booked: false };
  const posted = new Date(tx.posted_at + "T00:00:00Z");
  const txYear = posted.getUTCFullYear();
  const txMonth = posted.getUTCMonth() + 1;
  // if (txYear !== taxYear) continue;
  if (txYear !== args.taxYear) return { booked: false };
  // if (txMonth > currentMonth) continue;
  if (txMonth > args.currentMonth) return { booked: false };

  // const absCents = Math.abs(tx.amount_cents); if (absCents === 0) continue;
  const absCents = Math.abs(tx.amount_cents);
  if (absCents === 0) return { booked: false };

  // if (interpretAmount(...).direction === "expense") continue;
  if (interpretAmount(tx.amount_cents, args.convention).direction === "expense") {
    return { booked: false };
  }

  return {
    booked: true,
    month: txMonth,
    amountCents: absCents,
    recurrence: args.isSubscription ? "monthly" : "one_off",
  };
}

describe("planIncomeBooking matches the rules runBellaCategorize used to inline", () => {
  const dates = [
    null,
    "",
    "2026-01-01",
    "2026-06-14",
    "2026-08-01",
    "2026-08-31",
    "2026-09-01",
    "2026-12-31",
    "2025-12-31",
    "2027-01-01",
    "not-a-date",
  ];
  const amounts = [0, 1, -1, 1168463, -2445, -84, 400000, 25000];
  const conventions: SignConvention[] = ["charges_positive", "charges_negative"];
  const subs = [true, false];

  it("agrees on every combination of date, amount, convention and subscription", () => {
    let compared = 0;
    let booked = 0;
    for (const posted_at of dates) {
      for (const amount_cents of amounts) {
        for (const convention of conventions) {
          for (const isSubscription of subs) {
            const legacy = legacyIncomeDecision(
              { amount_cents, posted_at },
              { taxYear: 2026, currentMonth: 8, convention, isSubscription },
            );
            const next = planIncomeBooking(
              {
                amountCents: amount_cents,
                postedAt: posted_at,
                // No user category: the one input on which the two are
                // allowed to disagree, and must not here.
                appliedCategoryCode: null,
              },
              { convention, taxYear: 2026, currentMonth: 8, isSubscription },
            );
            compared++;

            expect(next.kind === "book").toBe(legacy.booked);
            if (legacy.booked && next.kind === "book") {
              booked++;
              expect(next.month).toBe(legacy.month);
              expect(next.amountCents).toBe(legacy.amountCents);
              expect(next.recurrence).toBe(legacy.recurrence);
            }
          }
        }
      }
    }
    // Guard the guard: a matrix that never books, or never declines,
    // would pass while proving nothing.
    expect(compared).toBe(
      dates.length * amounts.length * conventions.length * subs.length,
    );
    expect(booked).toBeGreaterThan(0);
    expect(booked).toBeLessThan(compared);
  });

  it("differs from the legacy rules on exactly one axis: a user category", () => {
    // The whole delta of this refactor, stated as a test. Every row the
    // old code would have booked, and which carries a human's category,
    // is now declined.
    let divergences = 0;
    for (const amount_cents of [400000, 25000, 1168463]) {
      for (const convention of conventions) {
        const legacy = legacyIncomeDecision(
          { amount_cents, posted_at: "2026-07-15" },
          { taxYear: 2026, currentMonth: 8, convention, isSubscription: false },
        );
        const next = planIncomeBooking(
          {
            amountCents: amount_cents,
            postedAt: "2026-07-15",
            appliedCategoryCode: "legal_pro",
          },
          { convention, taxYear: 2026, currentMonth: 8, isSubscription: false },
        );
        expect(next.kind).toBe("skip");
        if (legacy.booked) divergences++;
      }
    }
    expect(divergences).toBeGreaterThan(0);
  });
});
