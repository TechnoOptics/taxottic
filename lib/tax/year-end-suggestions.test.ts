import { describe, it, expect } from "vitest";
import {
  buildYearEndSuggestions,
  type SuggestionContext,
  type SuggestionInput,
} from "./year-end-suggestions";
import type { ForecastResult } from "./forecast";

// Minimal forecast result tuned so ONLY two suggestions can fire:
//   - home_office_setup  (business)  — hasHomeOffice is null below
//   - charitable_giving  (personal)  — charitableGivenCents is 0 below
// Everything else is starved: no quarterly estimates, no underpayment
// risk, zero net business income (so SEP-IRA / SE-health can't fire),
// and month 6 (so the Oct+ deferral move can't fire).
const RESULT = {
  quarterlyEstimates: [],
  underpaymentRisk: false,
  totalTaxCents: 500_000,
  alreadyPaidCents: 500_000,
  projectedNetBusinessIncomeCents: 0,
  marginalRate: 0.22,
} as unknown as ForecastResult;

function input(contexts: readonly SuggestionContext[]): SuggestionInput {
  return {
    result: RESULT,
    filingStatus: "single",
    entityType: "sole_prop",
    publicId: "abc123",
    ytdRetirementContributionsCents: 0,
    ytdSelfEmployedHealthCents: 100, // > 0 so se_health can't fire
    hasVehicle: false,
    vehicleBusinessMiles: null,
    vehicleMethod: "standard",
    daysSinceLastBusinessMile: 0,
    hasHomeOffice: null, // → home_office_setup fires (business)
    homeOfficeSqft: null,
    itemize: false,
    ytdItemizedCents: 0,
    charitableGivenCents: 0, // → charitable_giving fires (personal)
    currentMonth: 6,
    companyCreatedAt: null,
    contexts,
  };
}

const ids = (contexts: readonly SuggestionContext[]) =>
  buildYearEndSuggestions(input(contexts)).map((s) => s.id);

describe("buildYearEndSuggestions context scoping", () => {
  it("emits both business and personal advice when both contexts are requested (combined)", () => {
    const got = ids(["business", "personal"]);
    expect(got).toContain("home_office_setup");
    expect(got).toContain("charitable_giving");
  });

  it("drops personal-return advice on a standalone business forecast", () => {
    const got = ids(["business"]);
    expect(got).toContain("home_office_setup");
    // "give to charity" / "switch to standard" are personal 1040 moves —
    // they must not surface on a business number that isn't combined.
    expect(got).not.toContain("charitable_giving");
  });

  it("drops business advice on a personal-only surface", () => {
    const got = ids(["personal"]);
    expect(got).toContain("charitable_giving");
    expect(got).not.toContain("home_office_setup");
  });
});
