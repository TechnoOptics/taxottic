import { describe, it, expect } from "vitest";
import { getTaxYearConstants } from "./constants";

/**
 * Fail-fast guard on the standard mileage rate — the one outright
 * ACCURACY risk flagged in the audit. The 2026 rate shipped as a 70¢
 * placeholder (the carried-forward 2025 value) with
 * isMileageRateProvisional=true, silently understating every 2026
 * mileage deduction by 2.5¢/mile until reconciled against IRS Notice
 * 2026-10 (72.5¢/mile).
 *
 * These tests pin the IRS-published values AND assert that no bundled
 * tax year is still on a provisional placeholder — so a future year
 * can't quietly ship the wrong rate through a filing season.
 */
describe("IRS standard mileage rate", () => {
  it("2025 business rate is 70¢/mile (IRS Notice 2025-05)", () => {
    expect(getTaxYearConstants(2025).MILEAGE_RATE_PER_MILE_CENTS).toBe(70);
  });

  it("2026 business rate is 72.5¢/mile (IRS Notice 2026-10)", () => {
    expect(getTaxYearConstants(2026).MILEAGE_RATE_PER_MILE_CENTS).toBe(72.5);
  });

  it("no bundled tax year still ships a provisional (placeholder) rate", () => {
    for (const year of [2025, 2026]) {
      expect(
        getTaxYearConstants(year).isMileageRateProvisional,
        `${year} mileage rate is still marked provisional — verify the IRS Notice and finalize MILEAGE_RATE_${year}_PER_MILE_CENTS before this year is used for filing.`,
      ).toBe(false);
    }
  });
});
