import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  HEARTBEAT_EVERY_MS,
  __resetHeartbeatTimerForTest,
  beatOnForeground,
  registerHeartbeatSender,
} from "./heartbeat-timer";
import { runReturnRefresh } from "./return-refresh";

/**
 * THE INVARIANT: opening the app produces the one piece of evidence
 * `shouldCloseOpenTail` is waiting for, and the drive log is re-rendered
 * AFTER that evidence lands rather than before it.
 *
 * ## The hole
 *
 * A finished drive becomes a trip only when finalize can prove the phone
 * was ALIVE AND QUIET: `mileage_device_status.reported_at` at least one
 * TRIP_END_DWELL_MS (10 minutes) newer than the last GPS point. Heartbeats
 * are the only thing that advances that column, and a parked phone emits
 * no GPS, so the ingest-driven beat stops the moment the driver parks.
 * Nothing was left to restart it except the six-hour ceiling and the
 * ten-minute cron.
 *
 * MEASURED on the reporting driver's Galaxy Fold (driver 89871e98), three
 * drives on 2026-08-23:
 *
 *   ended 14:59 UTC   trip row created 2026-08-24 03:35   +12h 35m
 *   ended 18:43 UTC   trip row created 2026-08-24 03:40   +8h 57m
 *   ended 21:09 UTC   trip row created 2026-08-24 03:42   +6h 33m
 *
 * The heartbeat table for that device shows one 851-minute silence,
 * 04:01 to 18:12, and all three trips materialised within four minutes of
 * the beats resuming at 03:31. The drives were not lost; they were
 * un-closeable, and every one of those hours is a driver opening the app
 * and finding nothing.
 *
 * ## Why this cannot shorten a drive
 *
 * A heartbeat is evidence of LIFE, never of parking. `shouldCloseOpenTail`
 * refuses before `TRIP_END_DWELL_MS` of GPS silence no matter how fresh
 * the beat is, so a driver still moving is untouched. `forceClose` is the
 * flag that would bypass that check, and nothing here goes near it.
 */

const NATIVE_TRACKER = "lib/mileage/native-tracker.ts";
const AUTO_REFRESH = "components/mileage/MileageAutoRefresh.tsx";

/**
 * Strip block comments and line comments, INCLUDING line comments that
 * trail real code.
 *
 * Not pedantry: a guard in this repo stayed green because the code it
 * asserted on had been deleted and left behind as a trailing `// ...`
 * note, and a stripper that only handles whole-line comments cannot see
 * that. native-tracker.ts in particular discusses `appStateChange`,
 * `visibilitychange` and heartbeats in prose at length, so every positive
 * assertion below rests on this. The `:` lookbehind keeps a `https://`
 * inside a string literal from reading as the start of a comment.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(?<!:)\/\/[^\n]*/g, "");
}

describe("coming back to the app produces a heartbeat", () => {
  let beats: number;

  beforeEach(() => {
    vi.useFakeTimers();
    __resetHeartbeatTimerForTest();
    beats = 0;
    registerHeartbeatSender(() => {
      beats++;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetHeartbeatTimerForTest();
  });

  it("beats when the app comes forward after a silent stretch", async () => {
    // The whole point. No ingest has happened (the car is parked, so
    // there is no GPS), no timer has fired (a backgrounded WebView
    // freezes setInterval), and the beat must still go out.
    const sent = await beatOnForeground();
    expect(sent, "foregrounding produced no heartbeat").toBe(true);
    expect(beats).toBe(1);
  });

  it("does not beat again when the driver toggles between apps", async () => {
    await beatOnForeground();
    // Six app switches inside the interval. A driver checking a text
    // message and coming back must not post six heartbeats.
    for (let i = 0; i < 6; i++) {
      vi.setSystemTime(Date.now() + 10_000);
      expect(await beatOnForeground()).toBe(false);
    }
    expect(
      beats,
      "app switching inside the heartbeat interval posted extra beats",
    ).toBe(1);
  });

  it("beats again once a full heartbeat interval of wall clock has passed", async () => {
    await beatOnForeground();
    // Wall clock only. Timers are never run, which is exactly what a
    // backgrounded WebView does to them.
    vi.setSystemTime(Date.now() + HEARTBEAT_EVERY_MS + 1_000);
    expect(await beatOnForeground()).toBe(true);
    expect(beats).toBe(2);
  });

  it("shares its gate with the ingest-driven beat rather than keeping a second one", async () => {
    // Two schemes for "how recently did we beat" is two answers, and the
    // one nobody reads is the one that spams. ensureHeartbeatTimer's beat
    // must close the foreground gate too.
    const { ensureHeartbeatTimer } = await import("./heartbeat-timer");
    ensureHeartbeatTimer();
    await vi.advanceTimersByTimeAsync(0);
    expect(beats).toBe(1);

    vi.setSystemTime(Date.now() + 30_000);
    expect(
      await beatOnForeground(),
      "the foreground path beat again 30s after an ingest beat",
    ).toBe(false);
    expect(beats).toBe(1);
  });

  it("collapses concurrent callers onto ONE beat that both of them see", async () => {
    // Both triggers fire on the same return: the OS app-state event in
    // native-tracker and the page's own visibility handler. If the second
    // caller were simply refused, the drive log would never learn that
    // the evidence it is waiting for had just landed, and the render
    // would go out too early again.
    let release: () => void = () => {};
    registerHeartbeatSender(
      () =>
        new Promise<void>((resolve) => {
          beats++;
          release = resolve;
        }),
    );

    const a = beatOnForeground();
    const b = beatOnForeground();
    await vi.advanceTimersByTimeAsync(0);
    expect(beats, "the two triggers posted two heartbeats").toBe(1);

    release();
    expect(await a).toBe(true);
    expect(
      await b,
      "the second caller was told no beat happened, so nothing re-renders",
    ).toBe(true);
  });

  it("resolves only after the heartbeat has actually landed", async () => {
    // ORDERING. The whole fix depends on this promise settling AFTER the
    // POST, because the re-render that follows it reads reported_at from
    // the server. sendHeartbeat spends up to a dozen seconds in
    // time-boxed native probes before it posts; resolving early puts the
    // render back in front of the evidence.
    let settled = false;
    let release: () => void = () => {};
    registerHeartbeatSender(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    void beatOnForeground().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled, "resolved before the heartbeat was sent").toBe(false);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
  });

  it("reports no beat when the sender throws, so nothing claims fresh evidence", async () => {
    registerHeartbeatSender(() => Promise.reject(new Error("offline")));
    expect(await beatOnForeground()).toBe(false);
  });

  it("adds no timer of its own", () => {
    // A backgrounded WebView freezes setInterval; this repo has measured
    // timer_lag_ms in the hours. Any schedule armed before the app went
    // away is worthless at exactly the moment it is needed, which is why
    // this rides a real OS event and gates on the wall clock.
    const src = stripComments(readFileSync("lib/mileage/heartbeat-timer.ts", "utf8"));
    const body = src.slice(src.indexOf("export function beatOnForeground"));
    expect(body).not.toMatch(/set(Interval|Timeout)\s*\(/);
  });
});

describe("the drive log re-renders after the evidence, not before it", () => {
  it("renders once immediately and again once the beat has landed", async () => {
    // Two renders, in this order. The first is #622's behaviour and
    // covers everything the server already knew (the cron closed it, a
    // heartbeat arrived during the drive). The second exists solely for
    // the drive whose tail could not close until the beat this return
    // just produced.
    const calls: string[] = [];
    await runReturnRefresh({
      refresh: () => calls.push("refresh"),
      beat: async () => {
        calls.push("beat");
        return true;
      },
    });
    expect(calls).toEqual(["refresh", "beat", "refresh"]);
  });

  it("does not re-render when no beat went out", async () => {
    // The anti-spam gate refused, so the server holds no evidence it did
    // not already hold at the first render. A second render would be a
    // poll by another name.
    const calls: string[] = [];
    await runReturnRefresh({
      refresh: () => calls.push("refresh"),
      beat: async () => false,
    });
    expect(calls).toEqual(["refresh"]);
  });

  it("still renders when the beat rejects outright", async () => {
    // A heartbeat failing must never cost the driver the refresh they
    // would have got anyway.
    const calls: string[] = [];
    await runReturnRefresh({
      refresh: () => calls.push("refresh"),
      beat: () => Promise.reject(new Error("chunk failed to load")),
    });
    expect(calls).toEqual(["refresh"]);
  });
});

describe("the triggers are wired to the right signals", () => {
  const tracker = stripComments(readFileSync(NATIVE_TRACKER, "utf8"));
  const autoRefresh = stripComments(readFileSync(AUTO_REFRESH, "utf8"));

  it("reads the sources at all", () => {
    // A guard whose file read silently returned nothing passes every
    // assertion below vacuously.
    expect(tracker.length).toBeGreaterThan(1000);
    expect(autoRefresh.length).toBeGreaterThan(500);
  });

  it("beats from appStateChange isActive, the OS's own statement about the app", () => {
    // NOT from a poll, and not from a page effect. This listener is the
    // only signal in the codebase that is PROOF the app came forward.
    const at = tracker.indexOf('addListener("appStateChange"');
    expect(at, "the app-state listener is gone").toBeGreaterThan(-1);
    const handler = tracker.slice(at, at + 800);
    expect(
      handler,
      "foregrounding refreshes a local cache and tells the server nothing",
    ).toMatch(/beatOnForeground\s*\(/);
  });

  it("keeps visibilitychange as the weaker signal it is", () => {
    // A WebView can be hidden without the app being backgrounded and
    // vice versa. Treating visibility as proof of foreground is the exact
    // mistake that made the tracker watchdog dead code for months, so the
    // tracker's visibility listener stays a cache refresh only. The drive
    // log's own visibility handler may still kick a beat: a page whose JS
    // thread is demonstrably running is alive whatever the OS thinks, and
    // the shared gate stops the two paths from doubling up.
    const at = tracker.indexOf('addEventListener("visibilitychange"');
    expect(at).toBeGreaterThan(-1);
    const handler = tracker.slice(at, at + 400);
    expect(
      handler,
      "the tracker now treats a visibility gain as proof of foreground",
    ).not.toMatch(/beatOnForeground\s*\(/);
  });

  it("registers a sender that RETURNS the send, so waiting on it means something", () => {
    // The one defect the behavioural tests above structurally cannot see:
    // they register their own sender, so they stay green whatever the real
    // registration does. It read `() => { void sendHeartbeat(); }` for the
    // ingest path, which discards the promise. Awaiting that resolves on
    // the next microtask, before a single byte has been posted, and the
    // drive log renders in front of the evidence again with every test
    // passing. This repo's default failure is a correct module fed by a
    // caller that lies to it.
    const at = tracker.indexOf("registerHeartbeatSender(");
    expect(at, "nothing registers a heartbeat sender").toBeGreaterThan(-1);
    const call = tracker.slice(at, at + 160);
    expect(
      call,
      "the registered sender discards the promise it is awaited on",
    ).not.toMatch(/void\s+sendHeartbeat/);
    expect(call).toMatch(/=>\s*sendHeartbeat\s*\(\s*\)/);
  });

  it("sequences the drive log's refresh through the tested helper", () => {
    expect(autoRefresh).toMatch(/runReturnRefresh\s*\(/);
    expect(autoRefresh).toMatch(/beatOnForeground/);
  });

  it("still never polls, because a driver leaves this page open", () => {
    expect(
      /setInterval\s*\(/.test(autoRefresh),
      "a poll would run on every parked phone with the app open",
    ).toBe(false);
  });

  it("never reaches for forceClose", () => {
    // forceClose bypasses the parked check entirely. It is how a drive
    // gets severed at the last uploaded point and the backlog becomes a
    // second trip, and a fabricated mile is worse than a missed one.
    // Nothing on the foregrounding path may touch it.
    const timer = stripComments(
      readFileSync("lib/mileage/heartbeat-timer.ts", "utf8"),
    );
    const returnRefresh = stripComments(
      readFileSync("lib/mileage/return-refresh.ts", "utf8"),
    );
    for (const [name, src] of [
      ["heartbeat-timer.ts", timer],
      ["return-refresh.ts", returnRefresh],
      ["MileageAutoRefresh.tsx", autoRefresh],
    ] as const) {
      expect(src, `${name} reaches for forceClose`).not.toMatch(/forceClose/);
    }
  });
});
