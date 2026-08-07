import { describe, it, expect } from "vitest";
import { findRefundPairs, type NettableTx } from "./net-refunds";

// Fix round 1 (2026-08-06): the convention-aware rewrite of the bucket
// step originally used `else if (direction === "refund")`. Under
// charges_negative, interpretAmount never returns "refund" (a positive
// row there is "income"), so the refund bucket was permanently empty
// and findRefundPairs found zero pairs for every charges_negative
// import, silently, with 742 unrelated tests still green. There was no
// test file for this module before this one.

const tx = (o: Partial<NettableTx> & { id: string; amount_cents: number }): NettableTx => ({
  description: "DELTA AIR LINES 123",
  posted_at: "2026-05-16",
  applied_category_code: null,
  applied_expense_id: null,
  applied_income_id: null,
  ignored: false,
  ...o,
});

describe("findRefundPairs", () => {
  it("finds a charge/refund pair under charges_negative (the default)", () => {
    const charge = tx({ id: "charge", amount_cents: -1120, posted_at: "2026-05-16" });
    const refund = tx({ id: "refund", amount_cents: 1120, posted_at: "2026-05-19" });
    const pairs = findRefundPairs([charge, refund]);
    expect(pairs).toHaveLength(1);
    expect(new Set([pairs[0].chargeId, pairs[0].refundId])).toEqual(
      new Set(["charge", "refund"]),
    );
    expect(pairs[0].amountCents).toBe(1120);
  });

  it("finds the same pair under charges_positive", () => {
    // Same two rows, same raw signs, only the convention passed in
    // changes. Which one interpretAmount calls the "charge" flips
    // (chargeId/refundId swap), but the netting outcome, that these
    // two specific rows pair and both get removed from candidates,
    // does not depend on which convention the caller has detected.
    const a = tx({ id: "a", amount_cents: -1120, posted_at: "2026-05-16" });
    const b = tx({ id: "b", amount_cents: 1120, posted_at: "2026-05-19" });
    const pairs = findRefundPairs([a, b], "charges_positive");
    expect(pairs).toHaveLength(1);
    expect(new Set([pairs[0].chargeId, pairs[0].refundId])).toEqual(
      new Set(["a", "b"]),
    );
    expect(pairs[0].amountCents).toBe(1120);
  });

  it("does not pair rows with no opposite-signed counterpart", () => {
    // Two charges, same merchant and amount, no refund on either side.
    const c1 = tx({ id: "c1", amount_cents: -1120 });
    const c2 = tx({ id: "c2", amount_cents: -1120 });
    expect(findRefundPairs([c1, c2])).toHaveLength(0);
    expect(findRefundPairs([c1, c2], "charges_positive")).toHaveLength(0);
  });

  it("does not pair rows from different merchants even at the same amount", () => {
    const a = tx({ id: "a", amount_cents: -1120, description: "DELTA AIR LINES" });
    const b = tx({ id: "b", amount_cents: 1120, description: "BEST BUY 006114" });
    expect(findRefundPairs([a, b])).toHaveLength(0);
  });

  it("never touches a row the user has already applied or categorized", () => {
    const charge = tx({ id: "charge", amount_cents: -1120 });
    const alreadyApplied = tx({
      id: "applied",
      amount_cents: 1120,
      applied_expense_id: "exp_1",
    });
    expect(findRefundPairs([charge, alreadyApplied])).toHaveLength(0);
  });
});
