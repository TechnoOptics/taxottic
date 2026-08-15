import { describe, expect, it } from "vitest";
import {
  QUIET_PERIOD_MS,
  REMIND_EVERY_MS,
  STALE_AFTER_DAYS,
  buildReminders,
  ripe,
  routeLabel,
  summarize,
  type PendingDrive,
} from "./unconfirmed-drives";

/**
 * Ten drives were sitting unconfirmed in production when this was
 * written, the oldest for seventeen days, across two drivers. Nothing
 * had ever told either of them, because the only reminder channel was
 * push and there are zero iOS push tokens.
 *
 * These tests pin the two things that make the reminder useful rather
 * than annoying: it waits before nagging, and it never nags more often
 * than it said it would.
 */

const NOW = Date.parse("2026-08-15T18:00:00Z");
const DAY = 86_400_000;

function drive(over: Partial<PendingDrive> = {}): PendingDrive {
  return {
    tripId: "t1",
    driverUserId: "abel",
    driverName: "Abel Ark",
    driverEmail: "abel@example.com",
    startedAt: new Date(NOW - 3 * DAY).toISOString(),
    distanceMiles: 12.4,
    startPlace: "home",
    endPlace: "office",
    lastRemindedAt: null,
    ...over,
  };
}

describe("waiting before nagging", () => {
  it("ignores a drive from the last day", () => {
    // Auto-apply and the driver's own evening app-open resolve most of
    // these. Mail sent inside the quiet period is mail about problems
    // that were about to solve themselves.
    const fresh = drive({ startedAt: new Date(NOW - 2 * 3_600_000).toISOString() });
    expect(ripe([fresh], NOW)).toEqual([]);
    expect(buildReminders([fresh], NOW)).toEqual([]);
  });

  it("includes a drive once it is a day old", () => {
    const d = drive({ startedAt: new Date(NOW - QUIET_PERIOD_MS).toISOString() });
    expect(ripe([d], NOW)).toHaveLength(1);
  });

  it("drops a drive with an unreadable date rather than crashing", () => {
    expect(ripe([drive({ startedAt: "not a date" })], NOW)).toEqual([]);
  });
});

describe("one message per driver, not one per drive", () => {
  it("groups a driver's drives into a single reminder", () => {
    const out = buildReminders(
      [
        drive({ tripId: "a", distanceMiles: 10 }),
        drive({ tripId: "b", distanceMiles: 5.5 }),
        drive({ tripId: "c", distanceMiles: 4.5 }),
      ],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0].drives).toHaveLength(3);
    expect(out[0].totalMiles).toBe(20);
  });

  it("separates two drivers", () => {
    const out = buildReminders(
      [drive(), drive({ driverUserId: "grace", driverName: "Grace", driverEmail: "g@example.com" })],
      NOW,
    );
    expect(out).toHaveLength(2);
    expect(new Set(out.map((r) => r.driverUserId))).toEqual(new Set(["abel", "grace"]));
  });

  it("puts the oldest drive first, and reports its age", () => {
    const out = buildReminders(
      [
        drive({ tripId: "new", startedAt: new Date(NOW - 2 * DAY).toISOString() }),
        drive({ tripId: "old", startedAt: new Date(NOW - 17 * DAY).toISOString() }),
      ],
      NOW,
    );
    expect(out[0].drives[0].tripId).toBe("old");
    expect(out[0].oldestDays).toBe(17);
  });

  it("skips a driver with no email instead of failing the run", () => {
    expect(buildReminders([drive({ driverEmail: null })], NOW)).toEqual([]);
    expect(buildReminders([drive({ driverEmail: "   " })], NOW)).toEqual([]);
  });
});

describe("throttling", () => {
  it("stays quiet inside the reminder window", () => {
    const d = drive({
      lastRemindedAt: new Date(NOW - (REMIND_EVERY_MS - 1)).toISOString(),
    });
    expect(buildReminders([d], NOW)).toEqual([]);
  });

  it("reminds again once the window has passed", () => {
    const d = drive({ lastRemindedAt: new Date(NOW - REMIND_EVERY_MS).toISOString() });
    expect(buildReminders([d], NOW)).toHaveLength(1);
  });

  it("throttles on the NEWEST reminder, proven with two real timestamps", () => {
    // The original version of this test used null for one drive. Nulls
    // are filtered before the reduce, so only one timestamp survived and
    // min equalled max: swapping the comparator still passed. Two real
    // timestamps are required to tell the two apart.
    //
    // If it throttled on the OLDEST, a driver with a 10-day-old reminder
    // and a 1-hour-old one would be mailed again immediately.
    const out = buildReminders(
      [
        drive({ tripId: "old", lastRemindedAt: new Date(NOW - 10 * DAY).toISOString() }),
        drive({ tripId: "recent", lastRemindedAt: new Date(NOW - 3_600_000).toISOString() }),
      ],
      NOW,
    );
    expect(out, "the 1-hour-old reminder must suppress this driver").toEqual([]);
  });

  it("throttles on the most recent reminder across the driver's drives", () => {
    // A driver accumulating new drives daily must not get a fresh email
    // every day just because the newest drive has never been mentioned.
    const out = buildReminders(
      [
        drive({ tripId: "old", lastRemindedAt: new Date(NOW - 1_000).toISOString() }),
        drive({ tripId: "new", lastRemindedAt: null }),
      ],
      NOW,
    );
    expect(out).toEqual([]);
  });

  it("is slower than the tracker alarm, on purpose", () => {
    // A degraded tracker loses money hourly and earns a daily mail. A
    // recorded drive awaiting a yes/no does not.
    expect(REMIND_EVERY_MS).toBeGreaterThan(24 * 60 * 60_000);
  });
});

describe("what the driver reads", () => {
  it("names the count and the miles", () => {
    const r = buildReminders([drive({ distanceMiles: 12.4 })], NOW)[0];
    expect(summarize(r)).toContain("1 drive");
    expect(summarize(r)).toContain("12.4 miles");
  });

  it("changes tone once something is genuinely stale", () => {
    const r = buildReminders(
      [drive({ startedAt: new Date(NOW - 17 * DAY).toISOString() })],
      NOW,
    )[0];
    expect(r.hasStale).toBe(true);
    expect(summarize(r)).toContain("17 days");
    expect(STALE_AFTER_DAYS).toBe(14);
  });

  it("writes a route when both endpoints are known", () => {
    expect(routeLabel(drive())).toBe("home to office");
  });

  it("writes the honest partial when only one end is known", () => {
    expect(routeLabel(drive({ endPlace: null }))).toBe("from home");
    expect(routeLabel(drive({ startPlace: null }))).toBe("to office");
  });

  it("says nothing rather than 'unknown to unknown'", () => {
    // Endpoints only began being recorded on 2026-08-15, so older
    // drives have none. Printing placeholders would read like a bug.
    expect(routeLabel(drive({ startPlace: null, endPlace: null }))).toBe("");
  });
});
