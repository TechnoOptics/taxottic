import { describe, expect, it } from "vitest";
import {
  CRITICAL_AFTER_HOURS,
  EMAIL_EVERY_MS,
  explainKind,
  findUndelivered,
  isUndelivered,
  shouldEmailManager,
  summarize,
  type TrackerAlertRow,
} from "./undelivered-alerts";

/**
 * Regression cover for a real five-day outage.
 *
 * On 2026-08-06 the detector correctly opened a `foreground_only`
 * episode for a driver. The driver had no push token, so every send
 * failed, `notified_at` stayed NULL, and the alert sat in the database
 * naming its own diagnosis while six days of driving went unrecorded.
 * Nobody learned about it until someone thought to ask.
 *
 * The production row, reproduced exactly in GRACE below, is the primary
 * fixture. If this module cannot spot that row, it has failed at the one
 * job it exists to do.
 */

const NOW = Date.parse("2026-08-11T03:00:00Z");
const H = 3_600_000;

/** The actual undelivered row from production. */
const GRACE: TrackerAlertRow = {
  driverUserId: "grace",
  driverName: "Grace Muchoki",
  companyId: "co-1",
  kind: "foreground_only",
  stalledSince: "2026-08-06T15:20:40.455Z",
  notifiedAt: null,
  deliveryFailedAt: "2026-08-11T02:50:40.664Z",
  escalatedAt: "2026-08-10T01:30:38.981Z",
};

/** Same shape, but the driver actually got told. */
const DELIVERED: TrackerAlertRow = {
  ...GRACE,
  driverUserId: "other",
  driverName: "Someone Else",
  kind: "parked",
  notifiedAt: "2026-08-11T03:01:35.467Z",
  deliveryFailedAt: null,
};

describe("the production outage is detected", () => {
  it("flags the exact row that went unseen for five days", () => {
    const out = findUndelivered([GRACE], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("foreground_only");
    // Aug 6 15:20 to Aug 11 03:00 is a bit over 4.5 days.
    expect(out[0].stalledHours).toBeGreaterThan(100);
    expect(out[0].severity).toBe("critical");
  });

  it("does not flag an alert the driver actually received", () => {
    expect(findUndelivered([DELIVERED], NOW)).toEqual([]);
  });

  it("treats escalation to a manager as no substitute for delivery", () => {
    // GRACE has escalated_at set. It still counts as undelivered,
    // because escalation fired into the same push channel and the
    // driver was never reached either way.
    expect(isUndelivered(GRACE)).toBe(true);
  });
});

describe("what counts as undelivered", () => {
  it("does not require a delivery-failure stamp", () => {
    // An episode whose sends were SKIPPED rather than attempted has no
    // failure stamp, and is just as undelivered. Requiring the stamp
    // would silently exclude it.
    const skipped: TrackerAlertRow = { ...GRACE, deliveryFailedAt: null };
    expect(isUndelivered(skipped)).toBe(true);
  });

  it("ignores rows that are not live episodes", () => {
    expect(isUndelivered({ ...GRACE, stalledSince: null })).toBe(false);
    expect(findUndelivered([{ ...GRACE, stalledSince: null }], NOW)).toEqual([]);
  });

  it("survives an unparseable timestamp instead of producing NaN", () => {
    const bad = findUndelivered([{ ...GRACE, stalledSince: "not a date" }], NOW);
    expect(bad).toHaveLength(1);
    expect(Number.isFinite(bad[0].stalledHours)).toBe(true);
    expect(bad[0].stalledHours).toBe(0);
  });

  it("never reports negative age for a clock-skewed future timestamp", () => {
    const future = findUndelivered(
      [{ ...GRACE, stalledSince: "2026-09-01T00:00:00Z" }],
      NOW,
    );
    expect(future[0].stalledHours).toBe(0);
  });
});

describe("severity and ordering", () => {
  const at = (hoursAgo: number, id: string): TrackerAlertRow => ({
    ...GRACE,
    driverUserId: id,
    driverName: id,
    stalledSince: new Date(NOW - hoursAgo * H).toISOString(),
  });

  it("escalates to critical only after a full day", () => {
    expect(findUndelivered([at(23, "a")], NOW)[0].severity).toBe("warning");
    expect(
      findUndelivered([at(CRITICAL_AFTER_HOURS, "b")], NOW)[0].severity,
    ).toBe("critical");
  });

  it("puts the longest-running episode first, it is losing the most miles", () => {
    const out = findUndelivered([at(2, "new"), at(200, "old"), at(50, "mid")], NOW);
    expect(out.map((r) => r.driverUserId)).toEqual(["old", "mid", "new"]);
  });

  it("returns an empty list rather than throwing on no input", () => {
    expect(findUndelivered([], NOW)).toEqual([]);
  });
});

describe("email throttling", () => {
  const one = findUndelivered([GRACE], NOW);

  it("emails when there is something to say and nothing has been sent", () => {
    expect(
      shouldEmailManager({ undelivered: one, lastEmailedMs: null, nowMs: NOW }),
    ).toBe(true);
  });

  it("stays quiet when there is nothing to report", () => {
    expect(
      shouldEmailManager({ undelivered: [], lastEmailedMs: null, nowMs: NOW }),
    ).toBe(false);
  });

  it("does not re-email inside the window", () => {
    expect(
      shouldEmailManager({
        undelivered: one,
        lastEmailedMs: NOW - (EMAIL_EVERY_MS - 1),
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("emails again once the window elapses, because the miles keep going", () => {
    expect(
      shouldEmailManager({
        undelivered: one,
        lastEmailedMs: NOW - EMAIL_EVERY_MS,
        nowMs: NOW,
      }),
    ).toBe(true);
  });
});

describe("the message a human reads", () => {
  it("names the driver and how long it has been broken", () => {
    const s = summarize(findUndelivered([GRACE], NOW));
    expect(s).toContain("Grace Muchoki");
    expect(s).toContain("4 days");
  });

  it("counts the others without listing them", () => {
    const rows = [GRACE, { ...GRACE, driverUserId: "b", driverName: "B" }];
    expect(summarize(findUndelivered(rows, NOW))).toContain("and 1 other");
  });

  it("uses hours when it has not been a day yet", () => {
    const recent: TrackerAlertRow = {
      ...GRACE,
      stalledSince: new Date(NOW - 3 * H).toISOString(),
    };
    expect(summarize(findUndelivered([recent], NOW))).toContain("3 hours");
  });

  it("falls back gracefully when the driver has no name", () => {
    const anon: TrackerAlertRow = { ...GRACE, driverName: null };
    expect(summarize(findUndelivered([anon], NOW))).toContain("A driver");
  });

  it("explains foreground_only in words a manager can act on", () => {
    const text = explainKind("foreground_only");
    expect(text).toMatch(/only while the app is open/i);
    expect(text).toMatch(/not being recorded/i);
  });

  it("has a sane fallback for a kind it has never seen", () => {
    expect(explainKind("some_future_kind")).toMatch(/not reporting normally/i);
  });
});
