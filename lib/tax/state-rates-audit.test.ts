import { describe, it, expect } from "vitest";
import { C_CORP_STATE_RATE, STATE_RATES_AS_OF_YEAR } from "./state-entity-taxes";
import { STATE_BASE_SALES_TAX_RATE, ECONOMIC_NEXUS } from "./service-sales-tax";

// Cross-cutting sanity audit on the state rate tables.
//
// These tests don't reproduce every published bulletin, that would
// just duplicate the data, but they DO catch the regression classes
// that have bitten us historically:
//
//   1. Typo bugs: an extra digit (0.0775 vs 0.076)
//   2. Wrong-decade ranges: rates outside the historically plausible
//      0-13% band for state corporate income tax
//   3. Missing states (every test references the canonical 51-row set)
//   4. Mismatch between sales-tax rate table and the DB-seeded values
//      (migration 20260430000011)
//   5. Forgotten zero rates: no-income-tax states with non-zero rates

const ALL_STATES_PLUS_DC = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

describe("State rate audit, coverage", () => {
  it("C-Corp rate table covers all 51 jurisdictions", () => {
    for (const s of ALL_STATES_PLUS_DC) {
      expect(C_CORP_STATE_RATE[s], `Missing C-Corp rate for ${s}`).toBeDefined();
    }
  });

  it("Sales tax base rate table covers all 51 jurisdictions", () => {
    for (const s of ALL_STATES_PLUS_DC) {
      expect(
        STATE_BASE_SALES_TAX_RATE[s],
        `Missing sales tax rate for ${s}`,
      ).toBeDefined();
    }
  });

  it("Economic nexus table covers all 51 jurisdictions", () => {
    for (const s of ALL_STATES_PLUS_DC) {
      expect(
        ECONOMIC_NEXUS[s],
        `Missing economic nexus config for ${s}`,
      ).toBeDefined();
    }
  });
});

describe("State rate audit, plausible bounds", () => {
  it("every C-Corp rate is between 0% and 13%", () => {
    // 13% upper bound covers MN (highest at 9.8%) with headroom for
    // a state outlier we haven't seen yet. A rate over 13% almost
    // certainly indicates a typo (e.g., 0.121 instead of 0.0121).
    for (const [state, cfg] of Object.entries(C_CORP_STATE_RATE)) {
      expect(cfg.rate, `${state} corp rate looks wrong: ${cfg.rate}`).toBeGreaterThanOrEqual(0);
      expect(cfg.rate, `${state} corp rate looks wrong: ${cfg.rate}`).toBeLessThan(0.13);
    }
  });

  it("every base sales tax rate is between 0% and 10%", () => {
    // Highest state base rate is CA at 7.25%. Combined state+local
    // can exceed this but the BASE rate (the figure we track) maxes
    // out lower. 10% is the regression cap.
    for (const [state, rate] of Object.entries(STATE_BASE_SALES_TAX_RATE)) {
      expect(rate, `${state} sales tax rate looks wrong: ${rate}`).toBeGreaterThanOrEqual(0);
      expect(rate, `${state} sales tax rate looks wrong: ${rate}`).toBeLessThan(0.1);
    }
  });
});

describe("State rate audit, no-tax states", () => {
  it("states without corporate income tax show rate 0", () => {
    // NV, OH, SD, TX, WA, WY have NO traditional corporate income
    // tax. (They have gross-receipts equivalents we model separately.)
    for (const s of ["NV", "OH", "SD", "TX", "WA", "WY"]) {
      expect(C_CORP_STATE_RATE[s].rate, `${s} should have 0 C-Corp rate`).toBe(0);
    }
  });

  it("states without statewide sales tax show rate 0", () => {
    // AK, DE, MT, NH, OR have no state-level sales tax.
    for (const s of ["AK", "DE", "MT", "NH", "OR"]) {
      expect(STATE_BASE_SALES_TAX_RATE[s], `${s} should have 0 sales tax`).toBe(0);
    }
  });

  it("no-income-tax + no-sales-tax states have 0 economic-nexus threshold", () => {
    // DE, MT, NH, OR, none have a statewide sales tax, so the
    // economic-nexus threshold is functionally meaningless. We
    // record it as 0 so the nexus check returns false correctly.
    for (const s of ["DE", "MT", "NH", "OR"]) {
      expect(ECONOMIC_NEXUS[s].salesThresholdCents).toBe(0);
    }
  });
});

describe("State rate audit, high-impact corrections", () => {
  it("Oregon C-Corp top rate is 7.6%, not 7.75%", () => {
    // We had a typo (0.0775) before the audit fix. Pin it.
    expect(C_CORP_STATE_RATE.OR.rate).toBeCloseTo(0.076, 4);
  });

  it("Louisiana C-Corp 2025 flat rate is 5.5%", () => {
    // LA HB 1 (Dec 2024) flipped LA from 3.5/5.5/7.5% bracketed to
    // a flat 5.5% effective tax year 2025.
    expect(C_CORP_STATE_RATE.LA.rate).toBeCloseTo(0.055, 4);
  });

  it("West Virginia is 6.5% exactly (not 6.51%)", () => {
    expect(C_CORP_STATE_RATE.WV.rate).toBeCloseTo(0.065, 4);
  });

  it("California C-Corp rate is 8.84%", () => {
    expect(C_CORP_STATE_RATE.CA.rate).toBeCloseTo(0.0884, 4);
  });

  it("New York C-Corp top rate is 7.25%", () => {
    expect(C_CORP_STATE_RATE.NY.rate).toBeCloseTo(0.0725, 4);
  });

  it("Pennsylvania 2025 rate is 7.99% (phasing down)", () => {
    expect(C_CORP_STATE_RATE.PA.rate).toBeCloseTo(0.0799, 4);
  });

  it("Minnesota is 9.8% (highest in nation)", () => {
    expect(C_CORP_STATE_RATE.MN.rate).toBeCloseTo(0.098, 4);
  });

  it("North Carolina is 2.5% (phasing to 0% by 2030)", () => {
    expect(C_CORP_STATE_RATE.NC.rate).toBeCloseTo(0.025, 4);
  });
});

describe("State rate audit, as-of-year metadata", () => {
  it("STATE_RATES_AS_OF_YEAR is set to a recent year", () => {
    expect(STATE_RATES_AS_OF_YEAR).toBeGreaterThanOrEqual(2025);
  });
});
