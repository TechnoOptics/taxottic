import { describe, it, expect } from "vitest";
import {
  isSubscriptionLike,
  subscriptionFallbackKey,
  findCoveringRecurringRow,
  chargeFingerprint,
  type CoverCandidate,
  coverageKey,
} from "./subscription-dedupe";

describe("isSubscriptionLike", () => {
  it("matches subscription wording, any case", () => {
    expect(isSubscriptionLike("Adobe Subscription")).toBe(true);
    expect(isSubscriptionLike("SUBSCRIPTION renewal")).toBe(true);
    expect(isSubscriptionLike("Monthly subscr. fee")).toBe(true);
    expect(isSubscriptionLike("Subscribe & Save")).toBe(true);
  });
  it("ignores everything else", () => {
    expect(isSubscriptionLike("Stripe charge · Acme Co")).toBe(false);
    expect(isSubscriptionLike(null)).toBe(false);
    expect(isSubscriptionLike("")).toBe(false);
  });
});

describe("subscriptionFallbackKey", () => {
  it("is stable across cosmetic differences", () => {
    expect(subscriptionFallbackKey("Adobe  Subscription!", 8999)).toBe(
      subscriptionFallbackKey("adobe subscription", 8999),
    );
  });
  it("separates same vendor at different prices", () => {
    expect(subscriptionFallbackKey("Acme subscription", 5000)).not.toBe(
      subscriptionFallbackKey("Acme subscription", 9900),
    );
  });
});

const row = (over: Partial<CoverCandidate>): CoverCandidate => ({
  id: "r1",
  tax_year: 2026,
  month: 1,
  amount_cents: 50_000,
  recurrence: "monthly",
  recurrence_end_month: null,
  recurring_key: null,
  ...over,
});

describe("findCoveringRecurringRow (income)", () => {
  it("covers: manual monthly forecast row absorbs the synced charge (the reported bug)", () => {
    // User hand-forecast $500/mo in Jan; Stripe delivers the real $500
    // July charge. The manual row's projection already counts July.
    const covering = findCoveringRecurringRow(
      [row({ id: "manual", month: 1 })],
      { tax_year: 2026, month: 7, amount_cents: 50_000, recurring_key: "sub_abc" },
    );
    expect(covering?.id).toBe("manual");
  });

  it("does not cover a different amount", () => {
    expect(
      findCoveringRecurringRow([row({})], {
        tax_year: 2026,
        month: 7,
        amount_cents: 51_100,
      }),
    ).toBeNull();
  });

  it("does not cover across tax years", () => {
    expect(
      findCoveringRecurringRow([row({ tax_year: 2025 })], {
        tax_year: 2026,
        month: 3,
        amount_cents: 50_000,
      }),
    ).toBeNull();
  });

  it("two DIFFERENT subscriptions at the same price stay separate", () => {
    expect(
      findCoveringRecurringRow([row({ recurring_key: "sub_A" })], {
        tax_year: 2026,
        month: 5,
        amount_cents: 50_000,
        recurring_key: "sub_B",
      }),
    ).toBeNull();
  });

  it("same subscription key IS covered", () => {
    expect(
      findCoveringRecurringRow([row({ recurring_key: "sub_A" })], {
        tax_year: 2026,
        month: 5,
        amount_cents: 50_000,
        recurring_key: "sub_A",
      })?.id,
    ).toBe("r1");
  });

  it("a one_off row never covers", () => {
    expect(
      findCoveringRecurringRow([row({ recurrence: "one_off" })], {
        tax_year: 2026,
        month: 1,
        amount_cents: 50_000,
      }),
    ).toBeNull();
  });

  it("respects recurrence_end_month (stopped streams stop covering)", () => {
    expect(
      findCoveringRecurringRow([row({ recurrence_end_month: 4 })], {
        tax_year: 2026,
        month: 6,
        amount_cents: 50_000,
      }),
    ).toBeNull();
  });

  it("quarterly covers only its own cycle months", () => {
    const q = row({ recurrence: "quarterly", month: 1 });
    const probe = { tax_year: 2026, amount_cents: 50_000 };
    expect(findCoveringRecurringRow([q], { ...probe, month: 4 })?.id).toBe("r1");
    expect(findCoveringRecurringRow([q], { ...probe, month: 5 })).toBeNull();
  });

  it("does not cover months before the row starts", () => {
    expect(
      findCoveringRecurringRow([row({ month: 6 })], {
        tax_year: 2026,
        month: 3,
        amount_cents: 50_000,
      }),
    ).toBeNull();
  });
});

describe("findCoveringRecurringRow (expenses)", () => {
  it("covers when category + amount + projection line up", () => {
    const covering = findCoveringRecurringRow(
      [row({ category_code: "software_subscriptions" })],
      {
        tax_year: 2026,
        month: 9,
        amount_cents: 50_000,
        category_code: "software_subscriptions",
      },
    );
    expect(covering?.id).toBe("r1");
  });
  it("different category is not covered", () => {
    expect(
      findCoveringRecurringRow([row({ category_code: "travel" })], {
        tax_year: 2026,
        month: 9,
        amount_cents: 50_000,
        category_code: "software_subscriptions",
      }),
    ).toBeNull();
  });
});

describe("chargeFingerprint", () => {
  it("identical charge → identical fingerprint (day precision)", () => {
    expect(chargeFingerprint("2026-07-04T10:22:33Z", 8999, "Adobe Subscription")).toBe(
      chargeFingerprint("2026-07-04T18:00:00Z", 8999, "adobe  subscription"),
    );
  });
  it("different day / amount / description → different fingerprint", () => {
    const base = chargeFingerprint("2026-07-04", 8999, "Adobe");
    expect(chargeFingerprint("2026-07-05", 8999, "Adobe")).not.toBe(base);
    expect(chargeFingerprint("2026-07-04", 9000, "Adobe")).not.toBe(base);
    expect(chargeFingerprint("2026-07-04", 8999, "AWS")).not.toBe(base);
  });
});

// audit #26 regression: a recurring row projects ONE charge per covered
// month, so it must not absorb a second same-dollar deposit in that
// month. Before this cap a single keyless row swallowed every matching
// deposit for every covered month, deleting real revenue.
describe("audit #26: one absorption per (row, month)", () => {
  const row = {
    id: "row-1",
    tax_year: 2026,
    month: 1,
    amount_cents: 500_00,
    recurrence: "monthly" as const,
    recurring_key: null,
  };
  const probe = { tax_year: 2026, month: 5, amount_cents: 500_00 };

  it("absorbs the first charge in a covered month", () => {
    expect(findCoveringRecurringRow([row], probe, new Set())?.id).toBe("row-1");
  });

  it("refuses a second charge in the SAME month once consumed", () => {
    const consumed = new Set([coverageKey("row-1", 5)]);
    expect(findCoveringRecurringRow([row], probe, consumed)).toBeNull();
  });

  it("still absorbs in a DIFFERENT covered month", () => {
    const consumed = new Set([coverageKey("row-1", 5)]);
    expect(
      findCoveringRecurringRow([row], { ...probe, month: 6 }, consumed)?.id,
    ).toBe("row-1");
  });
});
