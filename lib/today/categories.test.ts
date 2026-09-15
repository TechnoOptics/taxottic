import { describe, expect, it } from "vitest";
import { categoryTotals } from "./categories";

describe("year to date by category", () => {
  it("sums by code, labels, orders by amount and scales fractions to the largest", () => {
    const out = categoryTotals(
      [
        { categoryCode: "advertising", amountCents: 100000 },
        { categoryCode: "software", amountCents: 250000 },
        { categoryCode: "advertising", amountCents: 24000 },
        { categoryCode: null, amountCents: 5000 },
      ],
      (c) => ({ advertising: "Advertising", software: "Software" })[c] ?? c,
    );
    expect(out.map((o) => [o.label, o.amountCents, o.fraction])).toEqual([
      ["Software", 250000, 1],
      ["Advertising", 124000, 0.496],
      ["Uncategorised", 5000, 0.02],
    ]);
  });
  it("caps the list", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ categoryCode: `c${i}`, amountCents: 1000 * (8 - i) }));
    expect(categoryTotals(rows, (c) => c, 5)).toHaveLength(5);
  });
});
