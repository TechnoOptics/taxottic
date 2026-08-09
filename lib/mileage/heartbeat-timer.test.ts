import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
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

  it("the timer module does not import native-tracker, so there is no cycle", () => {
    // native-tracker imports device-status, and device-status arms the
    // timer. If the timer module reached back into native-tracker the cycle
    // would resolve to undefined at module-init on exactly one path, which
    // is the failure mode this subsystem can least afford.
    const src = readFileSync(join(MILEAGE_DIR, "heartbeat-timer.ts"), "utf8");
    expect(src).not.toContain('from "./native-tracker"');
  });

  it("native-tracker registers a sender, or the timer can never fire", () => {
    const src = readFileSync(join(MILEAGE_DIR, "native-tracker.ts"), "utf8");
    expect(src).toContain("registerHeartbeatSender(");
  });
});
