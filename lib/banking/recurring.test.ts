import { describe, it, expect } from "vitest";
import {
  computeRecurrenceUpdates,
  computeIncomeRecurrenceUpdates,
  type ExpenseRowForRecurrence,
  type IncomeRowForRecurrence,
} from "./recurring";

const row = (
  id: string,
  month: number,
  amount_cents: number,
  category_code: string | null = "software_subscriptions",
  recurrence: string | null = "one_off",
  recurrence_end_month: number | null = null,
): ExpenseRowForRecurrence => ({
  id,
  month,
  amount_cents,
  category_code,
  recurrence,
  recurrence_end_month,
});

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

  describe("stopped-stream detection (asOfMonth)", () => {
    it("does nothing when asOfMonth is omitted, even with a stale anchor", () => {
      // Anchor is month 3, but there's no way to know "now" — no
      // asOfMonth means no stopped-stream inference at all.
      const rows = [1, 2, 3].map((m) =>
        row(`a${m}`, m, 8999, "software_subscriptions", m === 3 ? "monthly" : "one_off"),
      );
      expect(computeRecurrenceUpdates(rows)).toEqual([]);
    });

    it("does NOT flag a stream as stopped within the grace window", () => {
      // Monthly anchor at month 3, asOfMonth 4 — only one silent cycle,
      // could just be a slightly-late sync. STOPPED_AFTER_CYCLES is 2.
      const rows = [1, 2, 3].map((m) =>
        row(`a${m}`, m, 8999, "software_subscriptions", m === 3 ? "monthly" : "one_off"),
      );
      expect(computeRecurrenceUpdates(rows, 4)).toEqual([]);
    });

    it("caps recurrence_end_month at the anchor's own month after 2 silent monthly cycles", () => {
      // Monthly anchor at month 3, asOfMonth 5 — two full months of
      // silence with no new occurrence → treat as cancelled.
      const rows = [1, 2, 3].map((m) =>
        row(`a${m}`, m, 8999, "software_subscriptions", m === 3 ? "monthly" : "one_off"),
      );
      expect(computeRecurrenceUpdates(rows, 5)).toEqual([
        { id: "a3", recurrence: "monthly", recurrence_end_month: 3 },
      ]);
    });

    it("does not flag a quarterly stream within its 1-cycle (3-month) grace window", () => {
      // Quarterly anchor at month 7 (3 occurrences: 1, 4, 7 — the
      // earliest a quarterly stream can qualify as recurring at all,
      // since MIN_RECURRING_MONTHS = 3). asOfMonth 9 is only 2 months
      // of silence — under the 3-month (1-cycle) threshold.
      const rows = [1, 4, 7].map((m) =>
        row(`q${m}`, m, 20000, "software_subscriptions", m === 7 ? "quarterly" : "one_off"),
      );
      expect(computeRecurrenceUpdates(rows, 9)).toEqual([]);
    });

    it("flags a quarterly stream stopped after 1 full missed quarter (3 months silent)", () => {
      const rows = [1, 4, 7].map((m) =>
        row(`q${m}`, m, 20000, "software_subscriptions", m === 7 ? "quarterly" : "one_off"),
      );
      expect(computeRecurrenceUpdates(rows, 10)).toEqual([
        { id: "q7", recurrence: "quarterly", recurrence_end_month: 7 },
      ]);
    });

    it("clears a stale end month if the anchor is within the grace window again", () => {
      // a3 carries a stored recurrence_end_month of 3 from an earlier
      // run, but THIS run's asOfMonth (4) is within the grace window —
      // not actually stopped — so the stale cap gets cleared back to
      // null even though the recurrence value itself doesn't change.
      const rows = [
        row("a1", 1, 8999, "software_subscriptions", "one_off"),
        row("a2", 2, 8999, "software_subscriptions", "one_off"),
        row("a3", 3, 8999, "software_subscriptions", "monthly", 3),
      ];
      expect(computeRecurrenceUpdates(rows, 4)).toEqual([
        { id: "a3", recurrence: "monthly", recurrence_end_month: null },
      ]);
    });

    it("does not re-emit an update once the stopped cap is already persisted", () => {
      // a3 already has recurrence "monthly" AND recurrence_end_month 3
      // stored — a re-run with the same asOfMonth should be a no-op.
      const rows = [
        row("a1", 1, 8999, "software_subscriptions", "one_off"),
        row("a2", 2, 8999, "software_subscriptions", "one_off"),
        row("a3", 3, 8999, "software_subscriptions", "monthly", 3),
      ];
      expect(computeRecurrenceUpdates(rows, 5)).toEqual([]);
    });

    it("never touches a manually-set end month on a stream too short to be recurring", () => {
      // Only 2 distinct months → not recurring at all; a manual
      // recurrence_end_month set on one of them stays untouched because
      // the detector expresses no opinion on end month at all when it
      // never anchors a stream (undefined key ⇒ omitted from the update).
      const rows = [
        row("x1", 2, 4999, "software_subscriptions", "one_off", 6),
        row("x2", 5, 4999, "software_subscriptions", "one_off"),
      ];
      expect(computeRecurrenceUpdates(rows, 6)).toEqual([]);
    });
  });
});

const inc = (
  id: string,
  month: number,
  recurring_key: string | null,
  recurrence: string | null = "monthly",
): IncomeRowForRecurrence => ({ id, month, recurring_key, recurrence });

describe("computeIncomeRecurrenceUpdates", () => {
  it("keeps only the latest charge of a subscription projecting forward", () => {
    // One sub billed monthly in months 1,2,3 — all tagged monthly at sync.
    const rows = [1, 2, 3].map((m) => inc(`c${m}`, m, "sub_A"));
    const updates = computeIncomeRecurrenceUpdates(rows);
    // months 1,2 demote to one_off; month 3 (anchor) already monthly.
    expect(updates).toContainEqual({ id: "c1", recurrence: "one_off" });
    expect(updates).toContainEqual({ id: "c2", recurrence: "one_off" });
    expect(updates).toHaveLength(2);
  });

  it("a single charge is already its own anchor — no change", () => {
    expect(computeIncomeRecurrenceUpdates([inc("c1", 4, "sub_A")])).toEqual([]);
  });

  it("does NOT collapse two different subs that share a plan price", () => {
    // Two customers, same $ amount but distinct subscription ids: each is its
    // own stream and each keeps its single charge as the monthly anchor.
    const rows = [inc("x1", 5, "sub_A"), inc("y1", 5, "sub_B")];
    expect(computeIncomeRecurrenceUpdates(rows)).toEqual([]);
  });

  it("anchors each of two subs independently across months", () => {
    const a = [1, 2].map((m) => inc(`a${m}`, m, "sub_A"));
    const b = [1, 2].map((m) => inc(`b${m}`, m, "sub_B"));
    const updates = computeIncomeRecurrenceUpdates([...a, ...b]);
    expect(updates).toContainEqual({ id: "a1", recurrence: "one_off" });
    expect(updates).toContainEqual({ id: "b1", recurrence: "one_off" });
    expect(updates).toHaveLength(2); // a2 & b2 stay monthly anchors
  });

  it("ignores income rows with no recurring_key (one-off sales)", () => {
    const rows = [
      inc("s1", 1, null, "one_off"),
      inc("s2", 2, null, "one_off"),
      inc("s3", 3, null, "one_off"),
    ];
    expect(computeIncomeRecurrenceUpdates(rows)).toEqual([]);
  });

  it("preserves the stream cadence (quarterly) on the anchor", () => {
    const rows = [1, 4].map((m) => inc(`q${m}`, m, "sub_Q", "quarterly"));
    const updates = computeIncomeRecurrenceUpdates(rows);
    expect(updates).toEqual([{ id: "q1", recurrence: "one_off" }]);
    // q4 already quarterly → stays the anchor, no update emitted.
  });

  it("is idempotent — re-running on anchored rows yields no changes", () => {
    const rows = [
      inc("c1", 1, "sub_A", "one_off"),
      inc("c2", 2, "sub_A", "one_off"),
      inc("c3", 3, "sub_A", "monthly"), // anchor already set
    ];
    expect(computeIncomeRecurrenceUpdates(rows)).toEqual([]);
  });

  it("moves the anchor to a new charge and demotes the old one", () => {
    const rows = [
      inc("c2", 2, "sub_A", "one_off"),
      inc("c3", 3, "sub_A", "monthly"), // old anchor
      inc("c4", 4, "sub_A", "monthly"), // new charge from this sync
    ];
    const updates = computeIncomeRecurrenceUpdates(rows);
    expect(updates).toEqual([{ id: "c3", recurrence: "one_off" }]);
  });
});
