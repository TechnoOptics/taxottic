import { describe, expect, it } from "vitest";
import { formatTierPrice } from "./format";
import { PLAN_PRICING } from "./limits";

describe("formatTierPrice", () => {
  it("drops the cents on a whole dollar amount", () => {
    expect(formatTierPrice(19900)).toBe("$199");
    expect(formatTierPrice(0)).toBe("$0");
  });

  it("keeps both digits when there are cents", () => {
    expect(formatTierPrice(1999)).toBe("$19.99");
    expect(formatTierPrice(499)).toBe("$4.99");
    expect(formatTierPrice(1990)).toBe("$19.90");
  });

  it("formats every price the billing engine can charge", () => {
    // The pricing page reads PLAN_PRICING through this function, so a new
    // SKU with an odd amount must not come out as "$29.900000000000002".
    for (const plan of Object.values(PLAN_PRICING)) {
      expect(formatTierPrice(plan.amountCents)).toMatch(/^\$\d+(\.\d{2})?$/);
    }
  });
});
