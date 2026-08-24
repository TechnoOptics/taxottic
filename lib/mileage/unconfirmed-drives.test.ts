import { describe, expect, it } from "vitest";
import {
  MAX_LISTED,
  NEW_DRIVE_MIN_GAP_MS,
  REMIND_EVERY_MS,
  SETTLE_PERIOD_MS,
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
    endedAt: new Date(NOW - 3 * DAY + 20 * 60_000).toISOString(),
    distanceMiles: 12.4,
    startPlace: "home",
    endPlace: "office",
    lastRemindedAt: null,
    ...over,
  };
}

describe("settling before sending", () => {
  it("leaves a drive alone for the first half hour after it ENDS", () => {
    // Not a quiet period any more, a settle window. Its only job is to
    // let a multi-leg errand finish so the legs arrive in one email.
    const justParked = drive({
      startedAt: new Date(NOW - 40 * 60_000).toISOString(),
      endedAt: new Date(NOW - 10 * 60_000).toISOString(),
    });
    expect(ripe([justParked], NOW)).toEqual([]);
    expect(buildReminders([justParked], NOW)).toEqual([]);
  });

  it("includes a drive once the settle window has passed", () => {
    const d = drive({
      endedAt: new Date(NOW - SETTLE_PERIOD_MS).toISOString(),
    });
    expect(ripe([d], NOW)).toHaveLength(1);
  });

  it("measures from the END of the drive, not the start", () => {
    // A drive that began three days ago and only parked five minutes
    // ago has not settled. Reading started_at, which is what this code
    // did until 2026-08-24, would call it ripe and mail mid-errand.
    const longHaul = drive({
      startedAt: new Date(NOW - 3 * DAY).toISOString(),
      endedAt: new Date(NOW - 5 * 60_000).toISOString(),
    });
    expect(ripe([longHaul], NOW)).toEqual([]);
  });

  it("batches two drives that ended within the same errand run", () => {
    // The coordinator's case: 17:02 and 17:40 are one email, not two.
    const first = drive({
      tripId: "leg1",
      endedAt: new Date(NOW - 58 * 60_000).toISOString(),
    });
    const second = drive({
      tripId: "leg2",
      endedAt: new Date(NOW - 20 * 60_000).toISOString(),
    });
    // Only leg1 has settled, so leg2 is held back rather than splitting
    // the run across two messages an hour apart.
    expect(ripe([first, second], NOW).map((d) => d.tripId)).toEqual(["leg1"]);
    const later = NOW + 20 * 60_000;
    expect(ripe([first, second], later).map((d) => d.tripId).sort()).toEqual([
      "leg1",
      "leg2",
    ]);
    expect(buildReminders([first, second], later)).toHaveLength(1);
  });

  it("drops a drive with an unreadable date rather than crashing", () => {
    expect(ripe([drive({ endedAt: "not a date" })], NOW)).toEqual([]);
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
    // Six drives in a day must not be six emails. A driver mailed one
    // second ago is silent even though the newest drive is unmentioned.
    const out = buildReminders(
      [
        drive({ tripId: "old", lastRemindedAt: new Date(NOW - 1_000).toISOString() }),
        drive({ tripId: "new", lastRemindedAt: null }),
      ],
      NOW,
    );
    expect(out).toEqual([]);
  });

  it("does not make a backlog delay the FIRST mention of a new drive", () => {
    // THE BUG THIS FIXES, measured on production 2026-08-24.
    //
    // The stamp is rewritten on every pending drive at send time, and the
    // throttle read max() across them. A driver who never clears their
    // backlog therefore reset their own 3-day clock every 3 days, and a
    // drive finishing the day after a send waited for the next
    // anniversary. Trip 68e4fcb2 ended 2026-08-22 21:46 and was first
    // mailed 2026-08-24 17:31: 43.7 hours, none of it its own fault.
    const out = buildReminders(
      [
        drive({
          tripId: "backlog",
          lastRemindedAt: new Date(NOW - 7 * 3_600_000).toISOString(),
        }),
        drive({ tripId: "fresh", lastRemindedAt: null }),
      ],
      NOW,
    );
    expect(out, "a never-mentioned drive must not inherit the backlog cadence").toHaveLength(1);
    expect(out[0].newDrives).toBe(1);
  });

  it("still holds a new drive back inside the new-drive floor", () => {
    const out = buildReminders(
      [
        drive({
          tripId: "backlog",
          lastRemindedAt: new Date(NOW - (NEW_DRIVE_MIN_GAP_MS - 60_000)).toISOString(),
        }),
        drive({ tripId: "fresh", lastRemindedAt: null }),
      ],
      NOW,
    );
    expect(out).toEqual([]);
  });

  it("keeps the slow cadence when nothing is new", () => {
    // Nothing has changed for this driver, so this would be a repeat of
    // a message they already have. That is the case the 3 days is for.
    const out = buildReminders(
      [
        drive({
          tripId: "old",
          lastRemindedAt: new Date(NOW - 7 * 3_600_000).toISOString(),
        }),
      ],
      NOW,
    );
    expect(out).toEqual([]);
  });

  it("floors new-drive mail at one hour", () => {
    // Was six hours for one day. Production settled it: a driver mailed
    // at 17:31 on 2026-08-24 then took five drives ending 19:18 to
    // 19:49, and the six-hour floor held every one until 23:31, about
    // four hours after the first. The request was to be told when a
    // drive completes.
    //
    // The floor is NOT what stops a burst becoming a burst of email.
    // SETTLE_PERIOD_MS collapses drives that end close together into
    // one message, and those five would have been a single email at
    // either setting. The floor only governs how soon the NEXT message
    // may follow, which is why pricing it for the pathological case
    // cost timeliness and bought very little.
    expect(NEW_DRIVE_MIN_GAP_MS).toBe(60 * 60_000);
    expect(NEW_DRIVE_MIN_GAP_MS).toBeLessThan(REMIND_EVERY_MS);
  });

  it("leaves the burst bound to the settle window, not the floor", () => {
    // If the floor were ever the thing holding that line, lowering it
    // would flood an inbox. It is not, and this says so out loud.
    expect(SETTLE_PERIOD_MS).toBeLessThan(NEW_DRIVE_MIN_GAP_MS);
    expect(SETTLE_PERIOD_MS).toBeGreaterThanOrEqual(15 * 60_000);
  });

  it("keeps the repeat cadence far slower than the new-drive floor", () => {
    // The whole point of two speeds. If these converge, a driver either
    // gets nagged about old drives or waits out a backlog's cadence to
    // hear about a new one, which is the 43.7-hour bug this module was
    // rewritten to end.
    expect(REMIND_EVERY_MS).toBeGreaterThan(NEW_DRIVE_MIN_GAP_MS * 12);
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

  it("says the drive just finished when every drive is new AND recent", () => {
    const r = buildReminders(
      [
        drive({
          lastRemindedAt: null,
          startedAt: new Date(NOW - 2 * 3_600_000).toISOString(),
          endedAt: new Date(NOW - 90 * 60_000).toISOString(),
        }),
      ],
      NOW,
    )[0];
    expect(r.newDrives).toBe(1);
    expect(r.justFinished).toBe(true);
    expect(summarize(r)).toContain("just finished");
    expect(summarize(r)).toContain("business or personal");
  });

  it("does not say 'just finished' about a three-week-old drive nobody reached", () => {
    // Never-mentioned is not the same as recent. A backlog drive from
    // 2026-07-29 that this sweep has never reached is unmentioned and
    // three weeks old; claiming it just finished would be a lie in the
    // subject line of the email whose job is to stop the driver guessing.
    const r = buildReminders(
      [
        drive({
          lastRemindedAt: null,
          startedAt: new Date(NOW - 21 * DAY).toISOString(),
          endedAt: new Date(NOW - 21 * DAY + 20 * 60_000).toISOString(),
        }),
      ],
      NOW,
    )[0];
    expect(r.newDrives).toBe(1);
    expect(r.justFinished).toBe(false);
    expect(summarize(r)).not.toContain("just finished");
    expect(summarize(r)).toContain("21 days");
  });

  it("does not say 'just finished' when one leg is fresh and the rest are old", () => {
    const r = buildReminders(
      [
        drive({ tripId: "old", startedAt: new Date(NOW - 9 * DAY).toISOString(),
                endedAt: new Date(NOW - 9 * DAY + 20 * 60_000).toISOString() }),
        drive({ tripId: "fresh", endedAt: new Date(NOW - 40 * 60_000).toISOString(),
                startedAt: new Date(NOW - 70 * 60_000).toISOString() }),
      ],
      NOW,
    )[0];
    expect(r.justFinished).toBe(false);
  });

  it("does not claim a drive just finished when it is an old backlog", () => {
    const r = buildReminders(
      [
        drive({
          lastRemindedAt: new Date(NOW - REMIND_EVERY_MS).toISOString(),
        }),
      ],
      NOW,
    )[0];
    expect(r.newDrives).toBe(0);
    expect(summarize(r)).not.toContain("just finished");
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

  it("caps the listed drives so a 45-day sweep is not a wall of rows", () => {
    // A reinstall triggers a 45-day recovery sweep. Aggregation already
    // makes that ONE email; this keeps that one email readable, without
    // lying about how many drives are actually waiting.
    const many = Array.from({ length: 30 }, (_, i) =>
      drive({
        tripId: `t${i}`,
        distanceMiles: 2,
        startedAt: new Date(NOW - (i + 2) * DAY).toISOString(),
        endedAt: new Date(NOW - (i + 2) * DAY + 20 * 60_000).toISOString(),
      }),
    );
    const r = buildReminders(many, NOW)[0];
    expect(r.drives).toHaveLength(30);
    expect(r.listed).toHaveLength(MAX_LISTED);
    expect(r.omitted).toBe(30 - MAX_LISTED);
    // The count and the mileage still describe all 30, or the email
    // would understate what is waiting.
    expect(r.totalMiles).toBe(60);
    expect(summarize(r)).toContain("30 drives");
    // Oldest first, so the ones nearest to being forgotten are the ones
    // shown, and oldestDays still refers to a listed row.
    expect(r.listed[0].tripId).toBe("t29");
  });

  it("lists everything when the backlog is small", () => {
    const r = buildReminders([drive({ tripId: "a" }), drive({ tripId: "b" })], NOW)[0];
    expect(r.listed).toHaveLength(2);
    expect(r.omitted).toBe(0);
  });

  it("says nothing rather than 'unknown to unknown'", () => {
    // Endpoints only began being recorded on 2026-08-15, so older
    // drives have none. Printing placeholders would read like a bug.
    expect(routeLabel(drive({ startPlace: null, endPlace: null }))).toBe("");
  });
});
