import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import {
  HEARTBEAT_EVERY_MS,
  __resetHeartbeatTimerForTest,
  ensureHeartbeatTimer,
  registerHeartbeatSender,
} from "./heartbeat-timer";
import { join } from "node:path";

/**
 * THE INVARIANT: if points are reaching /api/mileage/ingest, health is
 * being reported alongside them.
 *
 * This is a static test rather than a behavioural one on purpose. The bug it
 * guards is not "the timer is wrong", it is "a NEW ingest path was added and
 * nobody armed the heartbeat on it". No unit test of the timer can catch
 * that, because the timer is fine in isolation every single time.
 *
 * The history, because it took three attempts:
 *
 *   original  heartbeat rode the flush interval (flushCount % 10)
 *   v166      gave it its own timer, armed from the tracker's location
 *             callback only. STILL ONE PATH. Shipped, verified on a real
 *             device, changed nothing.
 *   v167      timer in its own module, armed from every ingest caller
 *
 * Between the original and v167 a real phone uploaded GPS every few seconds
 * for 27 hours and sent zero heartbeats, which blinded the stall sweep, the
 * foreground-only detector, arm_interrupted_at and web_build simultaneously
 * while each of them individually looked healthy.
 *
 * So: any file that posts to the ingest endpoint must also arm the timer.
 * If you are adding a fourth ingest path and this test is failing, the test
 * is right.
 */

const MILEAGE_DIR = "lib/mileage";
const INGEST_ENDPOINT = "/api/mileage/ingest";
const ARM_CALL = "ensureHeartbeatTimer()";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile())
    .filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"));
}

describe("heartbeat is armed wherever points are ingested", () => {
  const files = sourceFiles(MILEAGE_DIR);

  it("finds the mileage sources at all", () => {
    // Guard against the glob silently matching nothing, which would make
    // every assertion below vacuously pass. That failure mode has bitten
    // this repo before (a test file the vitest include never matched).
    expect(files.length).toBeGreaterThan(5);
  });

  // SCOPE NOTE. This static check now backstops ONE path: native-tracker's
  // flush(), which is not exported and so cannot be called from a test.
  // The other two ingest paths (drainGeofenceBuffer, drainNativeLocationBuffer)
  // are exported and are covered behaviourally in ingest-arms-heartbeat.test.ts,
  // which catches what a regex cannot: arming that is present in the source
  // but never actually reached. Mutation-verified, put the call behind a
  // false condition and the regex below still passes while the behavioural
  // test fails. Keep both; they cover different failures.
  it("arms the timer NEAR every individual POST, not just somewhere in the file", () => {
    // THE HOLE THAT LET v175 THROUGH, and the third recurrence of this
    // same class of bug.
    //
    // The check below is per FILE: it passes as long as the string
    // "ensureHeartbeatTimer()" appears anywhere. native-tracker.ts armed
    // the beat in its location callback and in startTracking, so the file
    // contained the string twice and passed — while BOTH of its actual
    // ingest POSTs, the flush loop and the orphan drain, armed nothing.
    //
    // Measured cost, 2026-08-09: a 40-point backlog landed at 23:54 after
    // a 47-minute upload stall and produced no heartbeat, because a
    // backlog drain goes through flush and never through the callback.
    // That is precisely the moment health reporting is most valuable.
    //
    // So the assertion is now positional. Every POST must have the arm
    // call within ARM_WITHIN_LINES after it.
    const ARM_WITHIN_LINES = 40;
    const POST_RE =
      /(?:fetch|postJson)\(\s*["'`]\/api\/mileage\/ingest/;

    const unarmed: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // A doc comment that NAMES the endpoint is not a call site. This
        // very module lists all three ingest paths in its header.
        const trimmed = line.trim();
        if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
          return;
        }
        if (!POST_RE.test(line)) return;
        // Symmetric window. Arming BEFORE the request is legitimate and
        // arguably better (geofence.ts and device-status.ts do it that
        // way), so look both directions.
        const window = lines
          .slice(Math.max(0, i - ARM_WITHIN_LINES), i + ARM_WITHIN_LINES)
          .join("\n");
        if (!window.includes(ARM_CALL)) {
          unarmed.push(`${file}:${i + 1}`);
        }
      });
    }

    expect(
      unarmed,
      `These individual POSTs to ${INGEST_ENDPOINT} have no ${ARM_CALL} ` +
        `within ${ARM_WITHIN_LINES} lines. A device whose points go out ` +
        `through one of them uploads GPS and reports no health, which is ` +
        `how a 47-minute stall passed unseen.`,
    ).toEqual([]);
  });

  it("every file that posts to the ingest endpoint also arms the timer", () => {
    const ingesters = files.filter((p) =>
      readFileSync(p, "utf8").includes(INGEST_ENDPOINT),
    );

    // If this drops to zero the check has stopped checking anything.
    expect(ingesters.length).toBeGreaterThan(0);

    const unarmed = ingesters.filter((p) => {
      const src = readFileSync(p, "utf8");
      // A file that only MENTIONS the endpoint in a comment is not an
      // ingester. Require an actual request alongside the reference.
      const posts =
        /fetch\(\s*["'`]\/api\/mileage\/ingest/.test(src) ||
        /postJson\(\s*["'`]\/api\/mileage\/ingest/.test(src);
      if (!posts) return false;
      return !src.includes(ARM_CALL);
    });

    expect(
      unarmed,
      `These files POST to ${INGEST_ENDPOINT} without calling ${ARM_CALL}. ` +
        `A device using one of these paths uploads GPS and reports no health, ` +
        `which blinds every heartbeat-based alarm at once.`,
    ).toEqual([]);
  });

  it("the timer reaches native-tracker dynamically, never statically", () => {
    // native-tracker imports device-status, and device-status arms the
    // timer. A STATIC import back into native-tracker closes that cycle and
    // resolves to undefined at module-init on exactly one path, which is the
    // failure mode this subsystem can least afford.
    //
    // A DYNAMIC import is required, not merely tolerated: it is what lets a
    // chunk that loaded geofence without native-tracker still get a sender.
    const src = readFileSync(join(MILEAGE_DIR, "heartbeat-timer.ts"), "utf8");
    expect(src, "static import would close an init cycle").not.toMatch(
      /^\s*import\s[^(]*from\s+["']\.\/native-tracker["']/m,
    );
    expect(src, "without this, a chunk with no native-tracker never beats").toContain(
      'import("./native-tracker")',
    );
  });

  it("arming does not depend on a sender having registered", () => {
    // The whole point. ensureHeartbeatTimer must start the timer even when
    // nothing has registered, because app/mileage/page.tsx -> TrackerStatus
    // -> geofence is a real chunk with no native-tracker in it. An early
    // return on a null sender reproduces the original outage exactly.
    const src = readFileSync(join(MILEAGE_DIR, "heartbeat-timer.ts"), "utf8");
    const body = src.slice(src.indexOf("export function ensureHeartbeatTimer"));
    const guard = body.slice(0, body.indexOf("setInterval"));
    expect(guard, "timer must arm regardless of sender registration").not.toMatch(
      /!\s*beat/,
    );
  });

  it("native-tracker still registers a sender, so the common path skips the import", () => {
    const src = readFileSync(join(MILEAGE_DIR, "native-tracker.ts"), "utf8");
    expect(src).toContain("registerHeartbeatSender(");
  });
});

/**
 * The behavioural half, and the one the static checks above cannot cover.
 *
 * These run with the interval deliberately never firing, because that is
 * the measured production condition: a backgrounded WebView freezes
 * timers while still delivering native location callbacks. Twelve hours
 * of ingest on a real handset produced ~600 points and three heartbeats,
 * all three from the two minutes the app was on screen.
 */
describe("the beat is driven by ingest, not by the timer", () => {
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

  it("beats on the first ingest", async () => {
    ensureHeartbeatTimer();
    await vi.advanceTimersByTimeAsync(0);
    expect(beats).toBe(1);
  });

  it("does not beat again on ingest inside the interval", async () => {
    ensureHeartbeatTimer();
    await vi.advanceTimersByTimeAsync(0);
    // Points arrive every ~70s on a parked phone. None of these should beat.
    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(Date.now() + 70_000);
      ensureHeartbeatTimer();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(beats).toBe(1);
  });

  it("beats from ingest alone once the interval has elapsed, with the timer frozen", async () => {
    ensureHeartbeatTimer();
    await vi.advanceTimersByTimeAsync(0);
    expect(beats).toBe(1);

    // Advance WALL CLOCK without running timers: exactly what a frozen
    // backgrounded WebView does. If the beat depended on setInterval this
    // stays at 1, which is the twelve-hour production silence.
    vi.setSystemTime(Date.now() + HEARTBEAT_EVERY_MS + 1_000);
    ensureHeartbeatTimer();
    await vi.advanceTimersByTimeAsync(0);

    expect(
      beats,
      "ingest after the interval must beat even though no timer fired",
    ).toBe(2);
  });

  it("keeps beating across a long background stretch of ingest", async () => {
    ensureHeartbeatTimer();
    await vi.advanceTimersByTimeAsync(0);
    // Twelve hours of parked-phone ingest, timers never running.
    for (let i = 0; i < 12 * 51; i++) {
      vi.setSystemTime(Date.now() + 70_000);
      ensureHeartbeatTimer();
      await vi.advanceTimersByTimeAsync(0);
    }
    // 12h of wall clock at one beat per 5 min, minus the interval already
    // spent, so well over a hundred rather than the three we shipped.
    expect(beats).toBeGreaterThan(100);
  });
});
