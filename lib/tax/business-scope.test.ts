import { describe, it, expect } from "vitest";
import { forecast } from "./forecast";
import { neutralForecastInput, toCents } from "@/lib/calculators/base-input";

/**
 * Item 17: the BUSINESS forecast (scope:"business") must not include
 * individual-return credits (child tax credit, EITC, Saver's, education).
 * Those belong on the personal return. The default (personal) scope keeps
 * computing them, so this pins both directions.
 */
const base = (over: Record<string, unknown>) => ({
  ...neutralForecastInput(2026, "married_filing_jointly"),
  ...over,
});

describe("business-scope forecast suppresses individual credits", () => {
  it("personal scope computes the child/dependent credit; business scope zeroes it", () => {
    const input = base({
      dependents: 3,
      dependentsUnder17: 3,
      ytdIncomeCents: toCents(60_000),
    });
    const personal = forecast(input);
    const business = forecast({ ...input, scope: "business" });

    expect(personal.childAndDependentCreditsCents).toBeGreaterThan(0);
    expect(business.childAndDependentCreditsCents).toBe(0);
  });

  it("business scope zeroes the EITC for a low-income filer with children", () => {
    const input = base({
      dependents: 2,
      dependentsUnder17: 2,
      ytdIncomeCents: toCents(20_000),
    });
    const personal = forecast(input);
    const business = forecast({ ...input, scope: "business" });

    expect(personal.eitcCents).toBeGreaterThan(0);
    expect(business.eitcCents).toBe(0);
  });

  it("removing personal credits never lowers the business tax", () => {
    const input = base({
      dependents: 3,
      dependentsUnder17: 3,
      ytdIncomeCents: toCents(60_000),
    });
    const personal = forecast(input);
    const business = forecast({ ...input, scope: "business" });
    expect(business.totalTaxCents).toBeGreaterThanOrEqual(
      personal.totalTaxCents,
    );
  });
});
