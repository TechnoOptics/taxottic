import { describe, expect, it } from "vitest";
import { nextPaymentSummary } from "./next-payment";

const Q = (quarter: 1 | 2 | 3 | 4, dueDate: string, amountCents: number, isPast: boolean) => ({ quarter, dueDate, amountCents, isPast });

describe("next payment", () => {
  const asOf = new Date("2026-09-05T00:00:00Z");
  it("picks the first future quarter with money owed and counts the days", () => {
    const s = nextPaymentSummary({
      quarters: [Q(1, "2026-04-15", 300000, true), Q(2, "2026-06-15", 300000, true), Q(3, "2026-09-15", 342000, false), Q(4, "2027-01-15", 342000, false)],
      paidSoFarCents: 600000,
      asOf,
    });
    expect(s.next).toEqual({ quarter: 3, dueDate: "2026-09-15", daysUntil: 10, amountCents: 342000 });
    expect(s.stillToPayCents).toBe(684000);
    expect(s.paidSoFarCents).toBe(600000);
    expect(s.progress).toBeCloseTo(600000 / (600000 + 684000), 6);
  });
  it("skips future quarters that need no payment and reports null when nothing is owed", () => {
    const s = nextPaymentSummary({ quarters: [Q(3, "2026-09-15", 0, false), Q(4, "2027-01-15", -500, false)], paidSoFarCents: 0, asOf });
    expect(s.next).toBeNull();
    expect(s.stillToPayCents).toBe(0);
    expect(s.progress).toBe(0);
  });
  it("never reports negative days: a due date today is 0", () => {
    const s = nextPaymentSummary({ quarters: [Q(3, "2026-09-05", 1000, false)], paidSoFarCents: 0, asOf });
    expect(s.next?.daysUntil).toBe(0);
  });
});
