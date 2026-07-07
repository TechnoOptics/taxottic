import { describe, it, expect } from "vitest";
import {
  annualizePaystubs,
  inferPayFrequency,
} from "./paystub-annualize";
import type { PaystubRead } from "@/lib/ocr/extract-paystub";

const stub = (over: Partial<PaystubRead>): PaystubRead => ({
  pay_date: null,
  period_start: null,
  period_end: null,
  gross_cents: 200_000,
  federal_withheld_cents: 22_000,
  state_withheld_cents: 8_000,
  pretax_retirement_cents: 10_000,
  pretax_health_cents: 6_000,
  hsa_cents: 4_000,
  ytd_gross_cents: null,
  ytd_federal_withheld_cents: null,
  ...over,
});

describe("inferPayFrequency", () => {
  it("weekly from 7-day pay-date gaps", () => {
    const s = [
      stub({ pay_date: "2026-06-05" }),
      stub({ pay_date: "2026-06-12" }),
      stub({ pay_date: "2026-06-19" }),
    ];
    expect(inferPayFrequency(s, [])).toBe("weekly");
  });

  it("biweekly from 14-day gaps on mid-week dates", () => {
    const s = [
      stub({ pay_date: "2026-06-05" }),
      stub({ pay_date: "2026-06-19" }),
    ];
    expect(inferPayFrequency(s, [])).toBe("biweekly");
  });

  it("semimonthly when ~15-day gaps land on 15th/EOM", () => {
    const s = [
      stub({ pay_date: "2026-05-15" }),
      stub({ pay_date: "2026-05-31" }),
      stub({ pay_date: "2026-06-15" }),
    ];
    expect(inferPayFrequency(s, [])).toBe("semimonthly");
  });

  it("monthly from ~30-day gaps", () => {
    const s = [
      stub({ pay_date: "2026-04-30" }),
      stub({ pay_date: "2026-05-31" }),
    ];
    expect(inferPayFrequency(s, [])).toBe("monthly");
  });

  it("single stub: printed period length decides", () => {
    const s = [
      stub({ period_start: "2026-06-01", period_end: "2026-06-14" }),
    ];
    expect(inferPayFrequency(s, [])).toBe("biweekly");
  });

  it("single stub, no dates but YTD: snaps to the closest schedule", () => {
    // Pay date June 30 (~49.7% of year), YTD = 12 × gross → ~24.1/yr → semimonthly.
    const s = [
      stub({ pay_date: "2026-06-30", ytd_gross_cents: 2_400_000 }),
    ];
    expect(inferPayFrequency(s, [])).toBe("semimonthly");
  });

  it("nothing to go on: defaults biweekly and warns", () => {
    const warnings: string[] = [];
    expect(inferPayFrequency([stub({})], warnings)).toBe("biweekly");
    expect(warnings.length).toBe(1);
  });
});

describe("annualizePaystubs", () => {
  it("per-period basis: gross × periods, Box 1 nets out every pre-tax deduction", () => {
    const a = annualizePaystubs([
      stub({ pay_date: "2026-06-05" }),
      stub({ pay_date: "2026-06-19" }),
    ]);
    expect(a.frequency).toBe("biweekly");
    expect(a.basis).toBe("per_period");
    expect(a.annualGrossCents).toBe(200_000 * 26);
    // Box 1 = gross − 401k − health − HSA
    expect(a.annualBox1WagesCents).toBe((200_000 - 10_000 - 6_000 - 4_000) * 26);
    // SS wages keep the 401k in, drop health + HSA
    expect(a.annualSsWagesCents).toBe((200_000 - 6_000 - 4_000) * 26);
    expect(a.annualFederalWithheldCents).toBe(22_000 * 26);
  });

  it("YTD basis wins when printed (captures raises/bonuses)", () => {
    // Pay date 2026-07-01 ≈ 0.4986 of the year. YTD gross 3,000,000
    // → annual ≈ 6,017,000-ish; definitely NOT 200,000 × 26.
    const a = annualizePaystubs([
      stub({
        pay_date: "2026-07-01",
        period_start: "2026-06-18",
        period_end: "2026-07-01",
        ytd_gross_cents: 3_000_000,
        ytd_federal_withheld_cents: 330_000,
      }),
    ]);
    expect(a.basis).toBe("ytd");
    expect(a.annualGrossCents).toBeGreaterThan(5_800_000);
    expect(a.annualGrossCents).toBeLessThan(6_300_000);
    // Withholding follows the same YTD anchor.
    expect(a.annualFederalWithheldCents).toBeGreaterThan(630_000);
    expect(a.annualFederalWithheldCents).toBeLessThan(700_000);
  });

  it("warns when YTD pace diverges >25% from paycheck × schedule", () => {
    const a = annualizePaystubs([
      stub({
        pay_date: "2026-07-01",
        period_start: "2026-06-18",
        period_end: "2026-07-01",
        // 200k biweekly ⇒ 5.2M/yr; YTD pace ⇒ ~8M/yr (big bonus).
        ytd_gross_cents: 4_000_000,
      }),
    ]);
    expect(a.warnings.some((w) => w.includes("YTD"))).toBe(true);
  });

  it("throws when gross is unreadable", () => {
    expect(() =>
      annualizePaystubs([stub({ gross_cents: null })]),
    ).toThrow(/gross/i);
  });

  it("missing deduction lines annualize as zero, not NaN", () => {
    const a = annualizePaystubs([
      stub({
        pay_date: "2026-06-05",
        period_start: "2026-05-30",
        period_end: "2026-06-05",
        pretax_retirement_cents: null,
        pretax_health_cents: null,
        hsa_cents: null,
      }),
    ]);
    expect(a.annualPretaxRetirementCents).toBe(0);
    expect(a.annualBox1WagesCents).toBe(a.annualGrossCents);
    expect(a.annualSsWagesCents).toBe(a.annualGrossCents);
  });
});
