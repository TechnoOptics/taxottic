import { describe, expect, it } from "vitest";
import {
  evaluateForegroundOnlyTracker,
  MIN_BASELINE_BACKGROUND,
  MIN_RECENT_FOREGROUND,
  RENOTIFY_MS,
} from "./foreground-only";

const NOW = Date.parse("2026-08-08T13:00:00Z");

const healthy = {
  baselineBackground: 284,
  recentBackground: 40,
  recentForeground: 3,
  nowMs: NOW,
  lastNotifiedMs: null as number | null,
};

describe("evaluateForegroundOnlyTracker", () => {
  it("stays quiet while background reporting is alive", () => {
    expect(evaluateForegroundOnlyTracker(healthy)).toBe("clear");
  });

  // The incident this exists for, using the real counts measured from
  // mileage_device_heartbeats. Grace's iPhone: 284 background heartbeats on
  // 1.3.6, then zero, while she kept opening the app (foreground heartbeats
  // on Aug 7). Four days of drives lost with every existing alarm silent.
  it("catches the real Grace signature: proven capable, now foreground only", () => {
    expect(
      evaluateForegroundOnlyTracker({
        ...healthy,
        // Counted straight out of production on 2026-08-08 over the 48h
        // window: baseline 285 background heartbeats in 14d, 0 background
        // in 48h, 3 foreground in 48h.
        baselineBackground: 285,
        recentBackground: 0,
        recentForeground: 3,
      }),
    ).toBe("notify");
  });

  // The window-sizing bug, caught by checking production before shipping
  // rather than after. Over a 24h window this same device had only ONE
  // foreground heartbeat, because a phone with dead background tracking
  // reports a few times a day rather than a few times a minute. With
  // RECENT_WINDOW_MS at 24h the detector returned "silent" on the one
  // incident it was written for. Shrinking the window back re-breaks it.
  it("would have missed the incident on a 24h window (why RECENT_WINDOW_MS is 48h)", () => {
    const overA24hWindow = {
      ...healthy,
      baselineBackground: 285,
      recentBackground: 0,
      recentForeground: 1, // the real 24h count
    };
    expect(evaluateForegroundOnlyTracker(overA24hWindow)).toBe("silent");
    // Same device, same failure, counted over 48h instead.
    expect(
      evaluateForegroundOnlyTracker({ ...overA24hWindow, recentForeground: 3 }),
    ).toBe("notify");
  });

  // Abel's real Android numbers over the same 48h window. Two independent
  // reasons this stays quiet (one background heartbeat present, and a
  // baseline far below the floor), which is the intended belt and braces.
  it("stays quiet on the real Android device over the same window", () => {
    expect(
      evaluateForegroundOnlyTracker({
        ...healthy,
        baselineBackground: 5,
        recentBackground: 1,
        recentForeground: 13,
      }),
    ).toBe("clear");
  });

  // THE FALSE-POSITIVE TEST, and the reason this is calibrated rather than a
  // plain ratio. Abel's real Android numbers: background heartbeats peaking
  // at 2 in a day against 6 to 9 foreground ones, which is normal for that
  // platform. Alerting here would fire daily on a device that is fine, and a
  // daily false alarm trains everyone to ignore the real one.
  it("never fires on an Android device that was never background-heavy", () => {
    expect(
      evaluateForegroundOnlyTracker({
        ...healthy,
        baselineBackground: 2,
        recentBackground: 0,
        recentForeground: 6,
      }),
    ).toBe("silent");
  });

  it("does not judge a brand-new install with no track record", () => {
    expect(
      evaluateForegroundOnlyTracker({
        ...healthy,
        baselineBackground: 0,
        recentBackground: 0,
        recentForeground: 4,
      }),
    ).toBe("silent");
  });

  // A phone that is simply off looks the same on the background axis. That
  // is the silent sweep's job; firing here too would double-notify one
  // person for one problem with two different messages.
  it("leaves a switched-off phone to the silence alarm", () => {
    expect(
      evaluateForegroundOnlyTracker({
        ...healthy,
        baselineBackground: 284,
        recentBackground: 0,
        recentForeground: 0,
      }),
    ).toBe("silent");
  });

  // THE CLIFF THAT THE FIRST VERSION HAD. `recentBackground > 0` returned
  // "clear", so a device collapsing from ~142 background heartbeats a day to
  // ONE per 48h read as healthy AND had its open alert row deleted. It is
  // losing drives continuously. Reverting to a zero-test fails this.
  it("still fires when background collapses to a trickle, not just to zero", () => {
    expect(
      evaluateForegroundOnlyTracker({
        ...healthy,
        baselineBackground: 285,
        recentBackground: 1,
        recentForeground: 3,
      }),
    ).toBe("notify");
  });

  it("clears when background returns at the device's own normal rate", () => {
    // 285 over 14d is ~41 per 48h; a fifth of that is the floor.
    expect(
      evaluateForegroundOnlyTracker({
        ...healthy,
        baselineBackground: 285,
        recentBackground: 41,
        recentForeground: 3,
      }),
    ).toBe("clear");
  });

  it("judges each device against itself, not a fleet-wide number", () => {
    // A low-baseline device is held to a floor of 1, so one background
    // heartbeat is genuinely healthy FOR IT. The same single heartbeat from
    // the 285-baseline device above is a failure. Same input, opposite and
    // correct verdicts.
    expect(
      evaluateForegroundOnlyTracker({
        ...healthy,
        baselineBackground: 21,
        recentBackground: 1,
        recentForeground: 3,
      }),
    ).toBe("clear");
  });

  it("clears the episode as soon as one background heartbeat returns", () => {
    // Checked before the baseline gate on purpose: recovery must close an
    // open episode even for a device that would no longer qualify to be
    // judged, so the next regression alerts fresh.
    expect(
      evaluateForegroundOnlyTracker({
        ...healthy,
        baselineBackground: 1,
        recentBackground: 1,
        recentForeground: 9,
      }),
    ).toBe("clear");
  });

  describe("renotify cadence", () => {
    const stalled = {
      ...healthy,
      baselineBackground: 284,
      recentBackground: 0,
      recentForeground: 3,
    };

    it("stays quiet inside the renotify window", () => {
      expect(
        evaluateForegroundOnlyTracker({
          ...stalled,
          lastNotifiedMs: NOW - (RENOTIFY_MS - 60_000),
        }),
      ).toBe("silent");
    });

    it("reminds once the window has elapsed", () => {
      expect(
        evaluateForegroundOnlyTracker({
          ...stalled,
          lastNotifiedMs: NOW - RENOTIFY_MS,
        }),
      ).toBe("notify");
    });
  });

  describe("threshold boundaries", () => {
    it("judges a device exactly at the baseline floor", () => {
      expect(
        evaluateForegroundOnlyTracker({
          ...healthy,
          baselineBackground: MIN_BASELINE_BACKGROUND,
          recentBackground: 0,
          recentForeground: 3,
        }),
      ).toBe("notify");
    });

    it("declines to judge one heartbeat below the floor", () => {
      expect(
        evaluateForegroundOnlyTracker({
          ...healthy,
          baselineBackground: MIN_BASELINE_BACKGROUND - 1,
          recentBackground: 0,
          recentForeground: 3,
        }),
      ).toBe("silent");
    });

    it("treats exactly MIN_RECENT_FOREGROUND as alive", () => {
      expect(
        evaluateForegroundOnlyTracker({
          ...healthy,
          baselineBackground: 284,
          recentBackground: 0,
          recentForeground: MIN_RECENT_FOREGROUND,
        }),
      ).toBe("notify");
    });

    it("treats one below MIN_RECENT_FOREGROUND as not alive", () => {
      expect(
        evaluateForegroundOnlyTracker({
          ...healthy,
          baselineBackground: 284,
          recentBackground: 0,
          recentForeground: MIN_RECENT_FOREGROUND - 1,
        }),
      ).toBe("silent");
    });
  });
});
