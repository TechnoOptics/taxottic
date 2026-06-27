import { describe, it, expect } from "vitest";
import {
  computeRecurrenceUpdates,
  type ExpenseRowForRecurrence,
} from "./recurring";

const row = (
  id: string,
  month: number,
  amount_cents: number,
  category_code: string | null = "software_subscriptions",
  recurrence: string | null = "one_off",
): ExpenseRowForRecurrence => ({ id, month, amount_cents, category_code, recurrence });

describe("computeRecurrenceUpdates", () => {
  it("marks only the LATEST occurrence of a monthly stream (no double-count)", () => {
    // Adobe $90 in months 1..6, all currently one_off.
    const rows = [1, 2, 3, 4, 5, 6].map((m) => row(`a${m}`, m, 8999));
    const updates = computeRecurrenceUpdates(rows);
    // Only month-6 anchor flips to monthly; 1..5 already one_off → no change.
    expect(updates).toEqual([{ id: "a6", recurrence: "monthly" }]);
  });

  it("detects a quarterly stream (gap of 3) on the latest occurrence", () => {
    const rows = [1, 4, 7].map((m) => row(`q${m}`, m, 20000));
    const updates = computeRecurrenceUpdates(rows);
    expect(updates).toEqual([{ id: "q7", recurrence: "quarterly" }]);
  });

  it("leaves a non-recurring expense (< 3 months) as one_off", () => {
    const rows = [row("x1", 2, 4999), row("x2", 5, 4999)]; // only 2 months
    expect(computeRecurrenceUpdates(rows)).toEqual([]);
  });

  it("different amounts in the same category are separate streams", () => {
    const adobe = [1, 2, 3].map((m) => row(`ad${m}`, m, 8999));
    const aws = [1, 2, 3].map((m) => row(`aw${m}`, m, 34250));
    const updates = computeRecurrenceUpdates([...adobe, ...aws]);
    expect(updates).toContainEqual({ id: "ad3", recurrence: "monthly" });
    expect(updates).toContainEqual({ id: "aw3", recurrence: "monthly" });
    expect(updates).toHaveLength(2);
  });

  it("is idempotent — re-running on already-marked rows yields no changes", () => {
    const rows = [
      row("a1", 1, 8999, "software_subscriptions", "one_off"),
      row("a2", 2, 8999, "software_subscriptions", "one_off"),
      row("a3", 3, 8999, "software_subscriptions", "monthly"), // anchor already set
    ];
    expect(computeRecurrenceUpdates(rows)).toEqual([]);
  });

  it("demotes a stale recurring mark when the stream is no longer recurring", () => {
    // Was marked monthly but only 2 occurrences now → back to one_off.
    const rows = [
      row("a1", 1, 8999, "software_subscriptions", "monthly"),
      row("a2", 2, 8999, "software_subscriptions", "one_off"),
    ];
    expect(computeRecurrenceUpdates(rows)).toEqual([
      { id: "a1", recurrence: "one_off" },
    ]);
  });

  it("moves the anchor forward when a new month arrives", () => {
    // Previously month-6 was the monthly anchor; now month 7 exists.
    const rows = [
      row("a4", 4, 8999, "software_subscriptions", "one_off"),
      row("a5", 5, 8999, "software_subscriptions", "one_off"),
      row("a6", 6, 8999, "software_subscriptions", "monthly"), // old anchor
      row("a7", 7, 8999, "software_subscriptions", "one_off"), // new latest
    ];
    const updates = computeRecurrenceUpdates(rows);
    expect(updates).toContainEqual({ id: "a6", recurrence: "one_off" });
    expect(updates).toContainEqual({ id: "a7", recurrence: "monthly" });
    expect(updates).toHaveLength(2);
  });
});
