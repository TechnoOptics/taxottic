import { describe, it, expect } from "vitest";
import { planExpenseBooking, type BookingContext } from "./expense-booking";

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
