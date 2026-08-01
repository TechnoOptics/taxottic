import { describe, it, expect } from "vitest";
import {
  rowEligibility,
  defaultSelectedIds,
  selectableIds,
  summarize,
  effectiveCategory,
  type SelectableRow,
} from "./selection";

const CTX = { isCredit: false, taxYear: 2026, currentMonth: 8 };

function tx(over: Partial<SelectableRow> = {}): SelectableRow {
  return {
    id: "t1",
    posted_at: "2026-03-04",
    description: "COSTCO",
    amount_cents: -1234,
    applied_category_code: null,
    suggested_category_code: null,
    applied_expense_id: null,
    applied_income_id: null,
    ignored: false,
    ...over,
  };
}

describe("rowEligibility", () => {
  it("is eligible when a human already picked a category", () => {
    expect(rowEligibility(tx({ applied_category_code: "office" }), CTX)).toBe(
      "eligible",
    );
  });

  it("is eligible when only a machine suggested a category", () => {
    expect(rowEligibility(tx({ suggested_category_code: "office" }), CTX)).toBe(
      "eligible",
    );
  });

  it("needs a category when nothing has categorized it", () => {
    expect(rowEligibility(tx(), CTX)).toBe("needs_category");
  });

  it("is already booked once an expense row exists", () => {
    expect(
      rowEligibility(
        tx({ applied_category_code: "office", applied_expense_id: "e1" }),
        CTX,
      ),
    ).toBe("booked");
  });

  it("is ignored when the row was skipped", () => {
    expect(
      rowEligibility(tx({ ignored: true, applied_category_code: "office" }), CTX),
    ).toBe("ignored");
  });

  it("needs a date when posted_at never parsed", () => {
    // applyTransactions skips undated rows without a word. Naming the state
    // is what makes that visible instead of silent.
    expect(
      rowEligibility(tx({ posted_at: null, applied_category_code: "office" }), CTX),
    ).toBe("needs_date");
  });

  it("is out of range for a prior tax year", () => {
    expect(
      rowEligibility(
        tx({ posted_at: "2025-11-02", applied_category_code: "office" }),
        CTX,
      ),
    ).toBe("out_of_range");
  });

  it("is out of range for a future month", () => {
    expect(
      rowEligibility(
        tx({ posted_at: "2026-11-02", applied_category_code: "office" }),
        CTX,
      ),
    ).toBe("out_of_range");
  });

  it("is not an expense when a checking row is a deposit", () => {
    expect(
      rowEligibility(
        tx({ amount_cents: 5000, applied_category_code: "office" }),
        CTX,
      ),
    ).toBe("not_an_expense");
  });

  it("is not an expense when a zero-amount row appears", () => {
    expect(
      rowEligibility(tx({ amount_cents: 0, applied_category_code: "office" }), CTX),
    ).toBe("not_an_expense");
  });

  it("treats a POSITIVE amount as the expense on a credit card", () => {
    const credit = { ...CTX, isCredit: true };
    expect(
      rowEligibility(tx({ amount_cents: 5000, applied_category_code: "office" }), credit),
    ).toBe("eligible");
    // A negative on a card is a refund or a payment, never a deduction.
    expect(
      rowEligibility(tx({ amount_cents: -5000, applied_category_code: "office" }), credit),
    ).toBe("not_an_expense");
  });
});

describe("defaultSelectedIds", () => {
  it("pre-selects a row a human categorized", () => {
    const rows = [tx({ id: "a", applied_category_code: "office" })];
    expect(defaultSelectedIds(rows, CTX)).toEqual(["a"]);
  });

  it("does NOT pre-select a row only a machine guessed", () => {
    // The safety asymmetry: an unchecked row that should have been claimed is
    // a missed deduction the user can still see and fix on this screen. A
    // checked row that should not have been claimed is a wrong number on a
    // Schedule C, found later by an auditor. Never let a guess ride in.
    const rows = [tx({ id: "a", suggested_category_code: "office" })];
    expect(defaultSelectedIds(rows, CTX)).toEqual([]);
  });

  it("never pre-selects anything that is not eligible", () => {
    const rows = [
      tx({ id: "a", applied_category_code: "office", applied_expense_id: "e1" }),
      tx({ id: "b", applied_category_code: "office", posted_at: null }),
      tx({ id: "c", applied_category_code: "office", ignored: true }),
      tx({ id: "d", applied_category_code: "office", amount_cents: 100 }),
    ];
    expect(defaultSelectedIds(rows, CTX)).toEqual([]);
  });

  it("selects only the human-picked rows out of a mixed import", () => {
    const rows = [
      tx({ id: "a", applied_category_code: "office" }),
      tx({ id: "b", suggested_category_code: "meals" }),
      tx({ id: "c", applied_category_code: "travel" }),
      tx({ id: "d" }),
    ];
    expect(defaultSelectedIds(rows, CTX)).toEqual(["a", "c"]);
  });
});

describe("selectableIds", () => {
  it("is what Select all reaches, and it includes machine guesses", () => {
    // Select all is the deliberate bulk action the user asked for, so it
    // reaches every eligible row, guesses included. It still cannot reach a
    // row that has no category, no date, or the wrong sign.
    const rows = [
      tx({ id: "a", applied_category_code: "office" }),
      tx({ id: "b", suggested_category_code: "meals" }),
      tx({ id: "c" }),
      tx({ id: "d", applied_category_code: "office", posted_at: null }),
    ];
    expect(selectableIds(rows, CTX)).toEqual(["a", "b"]);
  });
});

describe("effectiveCategory", () => {
  it("prefers the human pick over the machine guess", () => {
    expect(
      effectiveCategory(
        tx({ applied_category_code: "office", suggested_category_code: "meals" }),
      ),
    ).toBe("office");
  });

  it("falls back to the machine guess", () => {
    expect(effectiveCategory(tx({ suggested_category_code: "meals" }))).toBe(
      "meals",
    );
  });

  it("is null when nothing categorized the row", () => {
    expect(effectiveCategory(tx())).toBeNull();
  });
});

describe("summarize", () => {
  it("counts and totals the selected rows as positive cents", () => {
    const rows = [
      tx({ id: "a", amount_cents: -1234, applied_category_code: "office" }),
      tx({ id: "b", amount_cents: -6600, applied_category_code: "meals" }),
      tx({ id: "c", amount_cents: -9900, applied_category_code: "travel" }),
    ];
    expect(summarize(rows, new Set(["a", "b"]), CTX)).toEqual({
      count: 2,
      totalCents: 7834,
    });
  });

  it("ignores a selected id that is no longer eligible", () => {
    // Stale client state must never book a row the server would reject.
    const rows = [
      tx({ id: "a", amount_cents: -1234, applied_category_code: "office" }),
      tx({ id: "b", amount_cents: -6600, applied_expense_id: "e1" }),
    ];
    expect(summarize(rows, new Set(["a", "b"]), CTX)).toEqual({
      count: 1,
      totalCents: 1234,
    });
  });

  it("is zero for an empty selection", () => {
    expect(summarize([tx()], new Set(), CTX)).toEqual({
      count: 0,
      totalCents: 0,
    });
  });

  it("stays in integer cents across many rows", () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      tx({ id: String(i), amount_cents: -1015, applied_category_code: "office" }),
    );
    const ids = new Set(["0", "1", "2"]);
    expect(summarize(rows, ids, CTX).totalCents).toBe(3045);
    expect(Number.isInteger(summarize(rows, ids, CTX).totalCents)).toBe(true);
  });
});
