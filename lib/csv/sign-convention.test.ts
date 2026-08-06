import { describe, it, expect } from "vitest";
import {
  detectSignConvention,
  interpretAmount,
  SIGN_CONFIDENCE_BANNER,
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
