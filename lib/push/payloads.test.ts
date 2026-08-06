import { describe, it, expect } from "vitest";
import { buildPayload, type PushEvent } from "./payloads";

describe("buildPayload", () => {
  it("trip_classify is actionable + stable dedupe key", () => {
    const p = buildPayload({ kind: "trip_classify", tripId: "t1" });
    expect(p.category).toBe("TRIP_CLASSIFY");
    expect(p.data).toEqual({ kind: "trip_classify", tripId: "t1" });
    expect(p.dedupeKey).toBe("trip_classify:t1");
  });

  it("clarify wording switches on subject", () => {
    expect(
      buildPayload({ kind: "clarify", subject: "meal", refId: "e1" }).body,
    ).toMatch(/meal/i);
    expect(
      buildPayload({ kind: "clarify", subject: "trip", refId: "x" }).body,
    ).toMatch(/trip/i);
    const exp = buildPayload({
      kind: "clarify",
      subject: "expense",
      refId: "e2",
    });
    expect(exp.category).toBe("CLARIFY");
    expect(exp.dedupeKey).toBe("clarify:expense:e2");
  });

  it("non-interactive kinds carry no category", () => {
    for (const e of [
      { kind: "expense_applied", refId: "e1" },
      { kind: "goal_met", goalLabel: "Roth", goalId: "g1" },
      { kind: "badge_awarded", badgeLabel: "First filing", badgeCode: "b1" },
      {
        kind: "message",
        fromName: "Dana",
        threadId: "th1",
        messageId: "m1",
      },
      {
        kind: "trip_logged",
        tripId: "t1",
        classification: "business",
      },
    ] as PushEvent[]) {
      expect(buildPayload(e).category).toBeUndefined();
    }
  });

  it("trip_logged wording switches on classification + stable dedupe", () => {
    const biz = buildPayload({
      kind: "trip_logged",
      tripId: "t1",
      classification: "business",
    });
    expect(biz.body).toMatch(/business/i);
    expect(biz.body).not.toMatch(/\$|\d{2,}/); // privacy: no $, no miles
    expect(biz.dedupeKey).toBe("trip_logged:t1");
    expect(biz.data.classification).toBe("business");

    const personal = buildPayload({
      kind: "trip_logged",
      tripId: "t2",
      classification: "personal",
    });
    expect(personal.body).toMatch(/personal/i);
    expect(personal.dedupeKey).toBe("trip_logged:t2");
  });

  it("dedupe keys are unique per logical event", () => {
    expect(
      buildPayload({ kind: "badge_awarded", badgeLabel: "X", badgeCode: "b" })
        .dedupeKey,
    ).toBe("badge_awarded:b");
    expect(
      buildPayload({
        kind: "message",
        fromName: "A",
        threadId: "t",
        messageId: "m",
      }).dedupeKey,
    ).toBe("message:t:m");
  });

  it("privacy: no $ amounts in any notification body", () => {
    const events: PushEvent[] = [
      { kind: "trip_classify", tripId: "t" },
      { kind: "trip_logged", tripId: "t", classification: "business" },
      { kind: "trip_logged", tripId: "t", classification: "personal" },
      { kind: "clarify", subject: "meal", refId: "r" },
      { kind: "expense_applied", refId: "r" },
      { kind: "goal_met", goalLabel: "Q3 set-aside", goalId: "g" },
      { kind: "badge_awarded", badgeLabel: "Saver", badgeCode: "c" },
      { kind: "message", fromName: "Pat", threadId: "t", messageId: "m" },
      { kind: "outstanding_reminder", count: 12, dayKey: "2026-07-01" },
    ];
    for (const e of events) {
      expect(buildPayload(e).body).not.toMatch(/\$|\d{2,}/);
    }
  });

  it("outstanding_reminder: count stays out of the body, dedupes per day", () => {
    const p = buildPayload({
      kind: "outstanding_reminder",
      count: 7,
      dayKey: "2026-07-01",
    });
    // Privacy: the count is useful for the in-app badge but must not leak
    // onto the lock screen, only `data` carries it.
    expect(p.body).not.toMatch(/7/);
    expect(p.data.count).toBe("7");
    expect(p.category).toBeUndefined();
    expect(p.dedupeKey).toBe("outstanding_reminder:2026-07-01");

    // Same day, different count → SAME dedupe key (at most one push/day).
    const again = buildPayload({
      kind: "outstanding_reminder",
      count: 9,
      dayKey: "2026-07-01",
    });
    expect(again.dedupeKey).toBe(p.dedupeKey);

    // Different day → different dedupe key.
    const tomorrow = buildPayload({
      kind: "outstanding_reminder",
      count: 7,
      dayKey: "2026-07-02",
    });
    expect(tomorrow.dedupeKey).not.toBe(p.dedupeKey);
  });
});

describe("tracker_stalled", () => {
  it("no detail on the lock screen, per-day dedupe, /mileage routing kind", async () => {
    const { buildPayload } = await import("./payloads");
    const p = buildPayload({ kind: "tracker_stalled", dayKey: "2026-07-11" });
    expect(p.title).toBe("Mileage tracking stopped");
    expect(p.data).toEqual({ kind: "tracker_stalled" });
    expect(p.dedupeKey).toBe("tracker_stalled:2026-07-11");
    // Privacy rule: nothing personal/identifying in the visible text.
    expect(p.body).not.toMatch(/mi\b|\$|@/);
  });
});

describe("driver_tracker_unreachable", () => {
  it("dedupes per driver per day so two dark drivers both get through", async () => {
    const { buildPayload } = await import("./payloads");
    const a = buildPayload({
      kind: "driver_tracker_unreachable",
      driverLabel: "Grace",
      driverId: "driver-a",
      dayKey: "2026-08-06",
    });
    const b = buildPayload({
      kind: "driver_tracker_unreachable",
      driverLabel: "Sam",
      driverId: "driver-b",
      dayKey: "2026-08-06",
    });
    // Keyed on the driver, not just the day. Keyed on the day alone, the
    // first unreachable driver would claim the dedupe and silence every
    // other one for the rest of the day — the exact failure this
    // escalation exists to prevent.
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
    expect(a.dedupeKey).toBe("driver_tracker_unreachable:driver-a:2026-08-06");
    // Same driver, same day, twice = one nudge.
    expect(
      buildPayload({
        kind: "driver_tracker_unreachable",
        driverLabel: "Grace",
        driverId: "driver-a",
        dayKey: "2026-08-06",
      }).dedupeKey,
    ).toBe(a.dedupeKey);
  });

  it("carries a name but never a location, a distance, or an id in the text", async () => {
    const { buildPayload } = await import("./payloads");
    const p = buildPayload({
      kind: "driver_tracker_unreachable",
      driverLabel: "Grace",
      driverId: "c6218e2c-c971-4321-a768-744f047c708c",
      dayKey: "2026-08-06",
    });
    expect(p.body).toContain("Grace");
    // A manager gets told WHO needs a nudge, never where they were or
    // how far they drove. The routing id stays in data, out of sight.
    expect(p.body).not.toMatch(/\d+\.\d+|mi\b|\$|@|c6218e2c/);
    expect(p.data.driverId).toBe("c6218e2c-c971-4321-a768-744f047c708c");
  });
});
