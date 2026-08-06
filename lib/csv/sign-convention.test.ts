import { describe, it, expect } from "vitest";
import {
  detectSignConvention,
  interpretAmount,
  SIGN_CONFIDENCE_BANNER,
  planFlip,
  type FlipRow,
} from "./sign-convention";

const rows = (...amounts: (number | null)[]) =>
  amounts.map((amountCents) => ({ amountCents }));

describe("detectSignConvention", () => {
  it("reads a charges-positive file (the live 60/2 failure)", () => {
    const r = rows(...Array(60).fill(1000), -100, -200);
    const out = detectSignConvention(r);
    expect(out.convention).toBe("charges_positive");
    expect(out.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("reads a normal chequing export as charges-negative", () => {
    const r = rows(...Array(40).fill(-1000), 500000, 500000);
    expect(detectSignConvention(r).convention).toBe("charges_negative");
  });

  it("falls back to charges_negative when the split is near even", () => {
    const r = rows(...Array(11).fill(-100), ...Array(10).fill(100));
    const out = detectSignConvention(r);
    expect(out.convention).toBe("charges_negative");
    expect(out.confidence).toBeLessThan(SIGN_CONFIDENCE_BANNER);
  });

  it("falls back when too few rows carry an amount", () => {
    const out = detectSignConvention(rows(100, 100, 100));
    expect(out.convention).toBe("charges_negative");
    expect(out.confidence).toBeLessThan(SIGN_CONFIDENCE_BANNER);
  });

  it("never throws on empty, all-zero, or unparseable input", () => {
    expect(detectSignConvention([]).convention).toBe("charges_negative");
    expect(detectSignConvention(rows(0, 0, 0)).convention).toBe(
      "charges_negative",
    );
    expect(detectSignConvention(rows(null, null)).convention).toBe(
      "charges_negative",
    );
  });
});

describe("interpretAmount", () => {
  it("treats positives as expenses under charges_positive", () => {
    expect(interpretAmount(1250, "charges_positive")).toEqual({
      direction: "expense",
      magnitudeCents: 1250,
    });
  });

  it("treats negatives as refunds under charges_positive", () => {
    expect(interpretAmount(-2445, "charges_positive")).toEqual({
      direction: "refund",
      magnitudeCents: 2445,
    });
  });

  it("treats negatives as expenses under charges_negative", () => {
    expect(interpretAmount(-1250, "charges_negative")).toEqual({
      direction: "expense",
      magnitudeCents: 1250,
    });
  });

  it("treats positives as income under charges_negative", () => {
    expect(interpretAmount(500000, "charges_negative")).toEqual({
      direction: "income",
      magnitudeCents: 500000,
    });
  });

  it("returns income for zero, never expense", () => {
    expect(interpretAmount(0, "charges_positive").direction).toBe("income");
  });

  it("falls back to charges_negative on an unknown convention", () => {
    const bogus = "nonsense" as unknown as "charges_negative";
    expect(interpretAmount(-100, bogus).direction).toBe("expense");
  });
});

const row = (o: Partial<FlipRow> & { id: string; amountCents: number }): FlipRow => ({
  appliedCategoryCode: null,
  appliedExpenseId: null,
  ...o,
});

describe("planFlip", () => {
  it("never puts a booked row anywhere but needsReview", () => {
    const rows = [
      row({ id: "a", amountCents: 1000, appliedExpenseId: "e1" }),
      row({ id: "b", amountCents: 1000, appliedExpenseId: "e2",
            appliedCategoryCode: "supplies" }),
    ];
    const out = planFlip(rows, "charges_positive", "charges_negative");
    expect(out.needsReview).toEqual(["a", "b"]);
    expect(out.clearTag).toEqual([]);
    expect(out.reinterpret).toEqual([]);
  });

  it("clears a tag only when the direction actually changes", () => {
    const rows = [
      row({ id: "flips", amountCents: 1000, appliedCategoryCode: "supplies" }),
      row({ id: "stays", amountCents: 0, appliedCategoryCode: "supplies" }),
    ];
    const out = planFlip(rows, "charges_positive", "charges_negative");
    expect(out.clearTag).toEqual(["flips"]);
    expect(out.reinterpret).toContain("stays");
  });

  it("reinterprets untouched rows without clearing anything", () => {
    const rows = [row({ id: "u", amountCents: -500 })];
    const out = planFlip(rows, "charges_negative", "charges_positive");
    expect(out.reinterpret).toEqual(["u"]);
    expect(out.clearTag).toEqual([]);
    expect(out.needsReview).toEqual([]);
  });

  it("is a no-op when the convention does not change", () => {
    const rows = [
      row({ id: "a", amountCents: 1000, appliedCategoryCode: "supplies" }),
      row({ id: "b", amountCents: -1000, appliedExpenseId: "e1" }),
    ];
    const out = planFlip(rows, "charges_positive", "charges_positive");
    expect(out.clearTag).toEqual([]);
    expect(out.needsReview).toEqual([]);
    expect(out.reinterpret).toEqual(["a", "b"]);
  });
});
