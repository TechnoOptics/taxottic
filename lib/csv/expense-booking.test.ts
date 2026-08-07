import { describe, it, expect } from "vitest";
import { planExpenseBooking, type BookingContext } from "./expense-booking";
import { interpretAmount, type SignConvention } from "./sign-convention";

const ctx = (over: Partial<BookingContext> = {}): BookingContext => ({
  convention: "charges_positive",
  taxYear: 2026,
  currentMonth: 8,
  isNonBusinessCategory: false,
  isCardPayment: false,
  isSubscription: false,
  ...over,
});

describe("planExpenseBooking", () => {
  it("books a charge dated in a past month of the tax year", () => {
    const d = planExpenseBooking(
      { amountCents: 20647, postedAt: "2026-06-14" },
      ctx(),
    );
    expect(d).toEqual({
      kind: "book",
      month: 6,
      amountCents: 20647,
      recurrence: "one_off",
    });
  });

  it("books a charge dated in the current month", () => {
    const d = planExpenseBooking(
      { amountCents: 1000, postedAt: "2026-08-02" },
      ctx(),
    );
    expect(d.kind).toBe("book");
  });

  it("marks a subscription line as recurring from day one", () => {
    const d = planExpenseBooking(
      { amountCents: 1200, postedAt: "2026-07-01" },
      ctx({ isSubscription: true }),
    );
    expect(d).toMatchObject({ kind: "book", recurrence: "monthly" });
  });

  it("reports the magnitude, never a negative amount", () => {
    const d = planExpenseBooking(
      { amountCents: -4065, postedAt: "2026-07-01" },
      ctx({ convention: "charges_negative" }),
    );
    expect(d).toMatchObject({ kind: "book", amountCents: 4065 });
  });

  it("takes the month from posted_at, not from today", () => {
    const d = planExpenseBooking(
      { amountCents: 1000, postedAt: "2026-01-31" },
      ctx({ currentMonth: 8 }),
    );
    expect(d).toMatchObject({ kind: "book", month: 1 });
  });

  it("labels a card payment without booking it, whatever its date", () => {
    const d = planExpenseBooking(
      { amountCents: 50000, postedAt: "2019-01-01" },
      ctx({ isCardPayment: true }),
    );
    // A card payment is an inter-account transfer in January and in
    // December alike. Reporting it as "wrong tax year" would be true
    // and useless.
    expect(d).toEqual({ kind: "label_only", reason: "card_payment" });
  });

  it("labels a transfer, Schedule A or tax-credit category without booking", () => {
    const d = planExpenseBooking(
      { amountCents: 12000, postedAt: "2026-07-04" },
      ctx({ isNonBusinessCategory: true }),
    );
    expect(d).toEqual({ kind: "label_only", reason: "not_deductible" });
  });

  it("prefers the card-payment label over the category label", () => {
    const d = planExpenseBooking(
      { amountCents: 12000, postedAt: "2026-07-04" },
      ctx({ isCardPayment: true, isNonBusinessCategory: true }),
    );
    expect(d).toMatchObject({ reason: "card_payment" });
  });

  it("skips a row with no date, and says so", () => {
    expect(
      planExpenseBooking({ amountCents: 1000, postedAt: null }, ctx()),
    ).toEqual({ kind: "skip", reason: "no_date" });
  });

  it("skips an unparseable date rather than booking it to month NaN", () => {
    expect(
      planExpenseBooking({ amountCents: 1000, postedAt: "not-a-date" }, ctx()),
    ).toMatchObject({ kind: "skip" });
  });

  it("skips a row from another tax year", () => {
    expect(
      planExpenseBooking({ amountCents: 1000, postedAt: "2025-12-30" }, ctx()),
    ).toEqual({ kind: "skip", reason: "other_tax_year" });
  });

  it("skips a row dated in a future month", () => {
    expect(
      planExpenseBooking({ amountCents: 1000, postedAt: "2026-09-01" }, ctx()),
    ).toEqual({ kind: "skip", reason: "future_month" });
  });

  it("skips a zero-value row", () => {
    expect(
      planExpenseBooking({ amountCents: 0, postedAt: "2026-07-01" }, ctx()),
    ).toEqual({ kind: "skip", reason: "zero_amount" });
  });

  it("refuses a refund even when it is handed one directly", () => {
    // Defence in depth: partitionBatch has already refused every
    // refund, so reaching this means something upstream changed.
    expect(
      planExpenseBooking({ amountCents: -84, postedAt: "2026-07-01" }, ctx()),
    ).toEqual({ kind: "skip", reason: "not_an_expense" });
  });

  it("refuses income under charges_negative", () => {
    expect(
      planExpenseBooking(
        { amountCents: 400000, postedAt: "2026-07-01" },
        ctx({ convention: "charges_negative" }),
      ),
    ).toEqual({ kind: "skip", reason: "not_an_expense" });
  });

  it("reads the same amount differently under each convention", () => {
    const row = { amountCents: -2445, postedAt: "2026-07-01" };
    expect(planExpenseBooking(row, ctx({ convention: "charges_positive" }))).toEqual(
      { kind: "skip", reason: "not_an_expense" },
    );
    expect(
      planExpenseBooking(row, ctx({ convention: "charges_negative" })).kind,
    ).toBe("book");
  });
});

/**
 * bellaAutoApply used to carry its own inline copy of these rules, and
 * it books the larger share of an import's rows: unattended, at upload
 * time, before any human sees the review screen. Routing it through
 * planExpenseBooking removes the second copy, and this block is the
 * proof that removing it changed nothing.
 *
 * `legacyExpenseDecision` is the old inline code, transcribed verbatim
 * from the loop in app/c/[publicId]/import/actions.ts as it stood before
 * the refactor, down to the order of the guards. If the two ever
 * disagree on any input below, the refactor was not behaviour
 * preserving.
 */
type LegacyOutcome =
  | { booked: false }
  | { booked: true; month: number; amountCents: number; recurrence: string };

function legacyExpenseDecision(
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

  // if (direction !== "expense") continue;
  const direction = interpretAmount(tx.amount_cents, args.convention).direction;
  if (direction !== "expense") return { booked: false };

  return {
    booked: true,
    month: txMonth,
    amountCents: absCents,
    recurrence: args.isSubscription ? "monthly" : "one_off",
  };
}

describe("planExpenseBooking matches the rules bellaAutoApply used to inline", () => {
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
            const legacy = legacyExpenseDecision(
              { amount_cents, posted_at },
              {
                taxYear: 2026,
                currentMonth: 8,
                convention,
                isSubscription,
              },
            );
            const next = planExpenseBooking(
              { amountCents: amount_cents, postedAt: posted_at },
              {
                convention,
                taxYear: 2026,
                currentMonth: 8,
                // Bella only picks business and both scopes, and card
                // payments never reach this branch, so both are false
                // on the path being compared.
                isNonBusinessCategory: false,
                isCardPayment: false,
                isSubscription,
              },
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

  it("still refuses both of the live import's refunds, exactly as before", () => {
    for (const amount of [-2445, -84]) {
      const args = {
        taxYear: 2026,
        currentMonth: 8,
        convention: "charges_positive" as const,
        isSubscription: false,
      };
      expect(
        legacyExpenseDecision({ amount_cents: amount, posted_at: "2026-07-01" }, args)
          .booked,
      ).toBe(false);
      expect(
        planExpenseBooking(
          { amountCents: amount, postedAt: "2026-07-01" },
          {
            convention: "charges_positive",
            taxYear: 2026,
            currentMonth: 8,
            isNonBusinessCategory: false,
            isCardPayment: false,
            isSubscription: false,
          },
        ).kind,
      ).toBe("skip");
    }
  });
});
