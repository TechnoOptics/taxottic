import { describe, it, expect } from "vitest";
import { computeNextIssueAt } from "./schedule";

// Synthetic load sanity-check for the schedule helper. The cron
// route invokes computeNextIssueAt once per template, at firm
// scale that means low-thousands per tick. If the helper ever
// regressed into a slow path (e.g., locale-aware Intl
// instantiation per call), the cron's wall budget would tighten
// fast. This test catches a 10x slowdown without flakily failing
// on a fast CI machine.

describe("computeNextIssueAt, load profile", () => {
  it("handles 10,000 invocations under 250ms", () => {
    const start = Date.now();
    for (let i = 0; i < 10_000; i++) {
      computeNextIssueAt({
        cadence: i % 3 === 0 ? "monthly" : i % 3 === 1 ? "quarterly" : "annual",
        issueDayOfMonth: (i % 28) + 1,
        reference: new Date(Date.UTC(2026, i % 12, 1)),
      });
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(250);
  });
});
