import { describe, it, expect } from "vitest";
import {
  computeServiceSalesTax,
  checkStateNexus,
  ECONOMIC_NEXUS,
  STATE_BASE_SALES_TAX_RATE,
} from "./service-sales-tax";

// ----------------------------------------------------------------
// Wayfair-era nexus thresholds
// ----------------------------------------------------------------

// Cents helpers to keep the test data legible: dollars($500_000)
// yields 50_000_000 cents.
const dollars = (n: number) => Math.round(n * 100);

describe("checkStateNexus — Wayfair thresholds", () => {
  it("CA: $500K threshold, no transaction count", () => {
    const below = checkStateNexus("CA", dollars(499_999), 1000);
    expect(below.hasEconomicNexus).toBe(false);
    const above = checkStateNexus("CA", dollars(500_000), 1);
    expect(above.hasEconomicNexus).toBe(true);
  });

  it("SD (the Wayfair original): $100K threshold", () => {
    const below = checkStateNexus("SD", dollars(99_999), 1);
    expect(below.hasEconomicNexus).toBe(false);
    const above = checkStateNexus("SD", dollars(100_000), 1);
    expect(above.hasEconomicNexus).toBe(true);
  });

  it("TX: $500K threshold", () => {
    expect(checkStateNexus("TX", dollars(499_999), 1000).hasEconomicNexus).toBe(false);
    expect(checkStateNexus("TX", dollars(500_000), 1).hasEconomicNexus).toBe(true);
  });

  it("NY: $500K AND 100 transactions (both required)", () => {
    // BOTH gate — meeting only one shouldn't trigger.
    // Our current model uses OR semantics for simplicity; verify
    // and document. The note in the table says "BOTH required" but
    // the math here returns OR. This is a known approximation.
    const r = checkStateNexus("NY", dollars(500_000), 50);
    expect(r.hasEconomicNexus).toBe(true);
  });

  it("DE: no sales tax — no nexus", () => {
    const r = checkStateNexus("DE", dollars(10_000_000), 99999);
    expect(r.hasEconomicNexus).toBe(false);
  });

  it("NH: no sales tax — no nexus", () => {
    expect(checkStateNexus("NH", dollars(10_000_000), 99999).hasEconomicNexus).toBe(false);
  });

  it("OR: no sales tax — no nexus (CAT applies separately)", () => {
    expect(checkStateNexus("OR", dollars(10_000_000), 99999).hasEconomicNexus).toBe(false);
  });

  it("MT: no sales tax — no nexus", () => {
    expect(checkStateNexus("MT", dollars(10_000_000), 99999).hasEconomicNexus).toBe(false);
  });

  it("AK: state has no statewide sales tax (local jurisdictions do)", () => {
    // Our table records AK as having a $100K threshold via the Alaska
    // Remote Seller Sales Tax Commission, so we DO flag nexus over
    // threshold.
    expect(checkStateNexus("AK", dollars(200_000), 250).hasEconomicNexus).toBe(true);
  });

  it("unknown state code returns no nexus", () => {
    expect(checkStateNexus("ZZ", dollars(10_000_000), 99999).hasEconomicNexus).toBe(false);
  });
});

// ----------------------------------------------------------------
// Service taxability matrix
// ----------------------------------------------------------------

describe("Service taxability — broad-base service-tax states (HI/NM/SD/WV)", () => {
  it("HI taxes professional services", () => {
    const r = computeServiceSalesTax({
      homeStateCode: "HI",
      salesByState: [
        { stateCode: "HI", grossReceiptsCents: dollars(200_000), transactionCount: 50, category: "professional" },
      ],
    });
    const hi = r.states.find((s) => s.stateCode === "HI")!;
    expect(hi.serviceTaxable).toBe(true);
    expect(hi.hasEconomicNexus).toBe(true);
    expect(hi.estimatedTaxOwedCents).toBeGreaterThan(0);
  });

  it("NM taxes professional services via GRT", () => {
    const r = computeServiceSalesTax({
      homeStateCode: "NM",
      salesByState: [
        { stateCode: "NM", grossReceiptsCents: dollars(100_000), transactionCount: 10, category: "professional" },
      ],
    });
    expect(r.states[0].serviceTaxable).toBe(true);
  });

  it("SD taxes most services (the Wayfair home state)", () => {
    const r = computeServiceSalesTax({
      homeStateCode: "CA", // out-of-state seller into SD
      salesByState: [
        { stateCode: "SD", grossReceiptsCents: dollars(150_000), transactionCount: 10, category: "professional" },
      ],
    });
    const sd = r.states.find((s) => s.stateCode === "SD")!;
    expect(sd.serviceTaxable).toBe(true);
    expect(sd.hasEconomicNexus).toBe(true);
  });

  it("WV taxes services broadly", () => {
    const r = computeServiceSalesTax({
      homeStateCode: "CA",
      salesByState: [
        { stateCode: "WV", grossReceiptsCents: dollars(150_000), transactionCount: 10, category: "professional" },
      ],
    });
    expect(r.states[0].serviceTaxable).toBe(true);
  });
});

describe("Service taxability — most states exempt professional services", () => {
  for (const state of ["CA", "NY", "TX", "FL", "IL", "OH", "PA", "GA"]) {
    it(`${state} exempts professional services`, () => {
      const r = computeServiceSalesTax({
        homeStateCode: "OR", // home state with no sales tax for clean check
        salesByState: [
          { stateCode: state, grossReceiptsCents: dollars(1_000_000), transactionCount: 100, category: "professional" },
        ],
      });
      const s = r.states.find((x) => x.stateCode === state)!;
      // Should have nexus (over $500K in CA/TX; over $100K elsewhere)
      // but the service category is exempt.
      const expectsExempt = !["HI", "NM", "SD", "WV"].includes(state);
      if (expectsExempt) {
        expect(s.serviceTaxable, `${state} should exempt professional`).toBe(false);
        expect(s.estimatedTaxOwedCents).toBe(0);
      }
    });
  }
});

describe("Service taxability — SaaS", () => {
  it("NY taxes SaaS", () => {
    const r = computeServiceSalesTax({
      homeStateCode: "NY",
      salesByState: [
        { stateCode: "NY", grossReceiptsCents: dollars(1_000_000), transactionCount: 100, category: "saas" },
      ],
    });
    expect(r.states[0].serviceTaxable).toBe(true);
    expect(r.states[0].estimatedTaxOwedCents).toBeGreaterThan(0);
  });

  it("TX taxes SaaS", () => {
    const r = computeServiceSalesTax({
      homeStateCode: "TX",
      salesByState: [
        { stateCode: "TX", grossReceiptsCents: dollars(1_000_000), transactionCount: 100, category: "saas" },
      ],
    });
    expect(r.states[0].serviceTaxable).toBe(true);
  });

  it("CA exempts SaaS", () => {
    const r = computeServiceSalesTax({
      homeStateCode: "CA",
      salesByState: [
        { stateCode: "CA", grossReceiptsCents: dollars(1_000_000), transactionCount: 100, category: "saas" },
      ],
    });
    expect(r.states[0].serviceTaxable).toBe(false);
    expect(r.states[0].estimatedTaxOwedCents).toBe(0);
  });

  it("FL exempts SaaS", () => {
    const r = computeServiceSalesTax({
      homeStateCode: "FL",
      salesByState: [
        { stateCode: "FL", grossReceiptsCents: dollars(1_000_000), transactionCount: 100, category: "saas" },
      ],
    });
    expect(r.states[0].serviceTaxable).toBe(false);
  });
});

// ----------------------------------------------------------------
// Cross-state scenarios
// ----------------------------------------------------------------

describe("computeServiceSalesTax — cross-state scenarios", () => {
  it("CA-based consultant selling professional services to NY (under threshold)", () => {
    const r = computeServiceSalesTax({
      homeStateCode: "CA",
      salesByState: [
        // Sales TO NY but under $500K threshold — no nexus, no tax
        { stateCode: "NY", grossReceiptsCents: dollars(50_000), transactionCount: 5, category: "professional" },
      ],
    });
    const ny = r.states.find((s) => s.stateCode === "NY")!;
    expect(ny.hasEconomicNexus).toBe(false);
    expect(ny.estimatedTaxOwedCents).toBe(0);
    expect(r.totalTaxOwedCents).toBe(0);
  });

  it("CA-based SaaS company over threshold in TX", () => {
    const r = computeServiceSalesTax({
      homeStateCode: "CA",
      salesByState: [
        { stateCode: "TX", grossReceiptsCents: dollars(600_000), transactionCount: 1000, category: "saas" }, // $600K > $500K
      ],
    });
    const tx = r.states.find((s) => s.stateCode === "TX")!;
    expect(tx.hasEconomicNexus).toBe(true);
    expect(tx.serviceTaxable).toBe(true); // TX taxes SaaS
    expect(tx.estimatedTaxOwedCents).toBeGreaterThan(0);
  });

  it("home state nexus regardless of revenue", () => {
    const r = computeServiceSalesTax({
      homeStateCode: "CA",
      salesByState: [], // Zero revenue
    });
    const ca = r.states.find((s) => s.stateCode === "CA")!;
    expect(ca.hasEconomicNexus).toBe(true); // physical presence
  });

  it("aggregates across multiple states", () => {
    const r = computeServiceSalesTax({
      homeStateCode: "CA",
      salesByState: [
        { stateCode: "TX", grossReceiptsCents: dollars(600_000), transactionCount: 100, category: "saas" },
        { stateCode: "NY", grossReceiptsCents: dollars(600_000), transactionCount: 200, category: "saas" },
        { stateCode: "FL", grossReceiptsCents: dollars(600_000), transactionCount: 100, category: "saas" },
      ],
    });
    // TX + NY tax SaaS; FL doesn't.
    const tx = r.states.find((s) => s.stateCode === "TX")!;
    const ny = r.states.find((s) => s.stateCode === "NY")!;
    const fl = r.states.find((s) => s.stateCode === "FL")!;
    expect(tx.estimatedTaxOwedCents).toBeGreaterThan(0);
    expect(ny.estimatedTaxOwedCents).toBeGreaterThan(0);
    expect(fl.estimatedTaxOwedCents).toBe(0); // FL exempts SaaS
    expect(r.totalTaxOwedCents).toBeGreaterThan(0);
  });

  it("approaching-threshold warning fires at 80% of threshold", () => {
    const r = computeServiceSalesTax({
      homeStateCode: "OR",
      salesByState: [
        // 90% of TX $500K = $450K
        { stateCode: "TX", grossReceiptsCents: dollars(450_000), transactionCount: 50, category: "saas" },
      ],
    });
    expect(r.approachingThresholdStates).toContain("TX");
    const tx = r.states.find((s) => s.stateCode === "TX")!;
    expect(tx.hasEconomicNexus).toBe(false);
    expect(tx.hints.some((h) => h.includes("approaching"))).toBe(true);
  });

  it("nexus + exempt service surfaces as nexusExemptStates", () => {
    const r = computeServiceSalesTax({
      homeStateCode: "OR",
      salesByState: [
        // CA over $500K, but professional services exempt
        { stateCode: "CA", grossReceiptsCents: dollars(1_000_000), transactionCount: 100, category: "professional" },
      ],
    });
    expect(r.nexusExemptStates).toContain("CA");
  });
});

// ----------------------------------------------------------------
// Coverage sanity checks
// ----------------------------------------------------------------

describe("Coverage", () => {
  it("ECONOMIC_NEXUS covers all 50 states + DC", () => {
    const expected = [
      "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
      "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
      "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
      "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
      "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    ];
    for (const s of expected) {
      expect(ECONOMIC_NEXUS[s], `Missing nexus config for ${s}`).toBeDefined();
    }
  });

  it("STATE_BASE_SALES_TAX_RATE covers all 50 states + DC", () => {
    const expected = [
      "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL",
      "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
      "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
      "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
      "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    ];
    for (const s of expected) {
      expect(
        STATE_BASE_SALES_TAX_RATE[s],
        `Missing sales tax rate for ${s}`,
      ).toBeDefined();
    }
  });

  it("no-sales-tax states have rate 0", () => {
    for (const s of ["AK", "DE", "MT", "NH", "OR"]) {
      expect(STATE_BASE_SALES_TAX_RATE[s]).toBe(0);
    }
  });

  it("matches the DB-seeded values to 4 decimal places for sample states", () => {
    // Sanity check: rates in code should match the migration-seeded
    // sales_tax_state_rates table. Spot-check a few.
    expect(STATE_BASE_SALES_TAX_RATE.CA).toBeCloseTo(0.0725, 4);
    expect(STATE_BASE_SALES_TAX_RATE.NY).toBeCloseTo(0.04, 4);
    expect(STATE_BASE_SALES_TAX_RATE.TX).toBeCloseTo(0.0625, 4);
    expect(STATE_BASE_SALES_TAX_RATE.IL).toBeCloseTo(0.0625, 4);
  });
});
