import { describe, expect, it } from "vitest";
import {
  MAX_PLAUSIBLE_MPS,
  rejectImplausibleJumps,
  type JumpPoint,
} from "./plausible-jump";
import { segmentTrips } from "./segmentation";

/**
 * The door gate. Refuse a point whose distance from the last accepted
 * point could not have been travelled in the elapsed time.
 *
 * MEASURED 2026-08-09, the owner's Fold. The driver pool held two
 * interleaved copies of one drive home, the second shifted about sixteen
 * minutes later than reality:
 *
 *   20:20:40.985  44.77954, -93.47072   Shakopee
 *   20:20:41.699  44.86004, -93.36702   Bloomington, 9 miles away
 *
 * Nine miles in 0.7 seconds is roughly 46,000 mph. Segmentation saw a
 * phone teleporting back and forth, produced nonsense, and the
 * plausibility gate downstream refused to write it, so 391 points sat
 * unconsumed for six hours and the drive home never materialised.
 *
 * The duplicate's origin is below our code: every one of its timestamps
 * shares a .699 sub-second at a uniform 4.8s cadence, the signature of
 * times reconstructed from a boot anchor inside the background
 * geolocation plugin's own buffer. We cannot fix that from here, but we
 * can refuse to let it into the pool.
 *
 * The asymmetry that sets the threshold: rejecting a real point loses a
 * few metres of a drive, while accepting a teleport poisons an entire
 * day of segmentation. So the bar is set where no car can reach it and
 * everything a car CAN do passes untouched.
 */

const T0 = 1_760_000_000_000;
const SEC = 1000;

/** Shakopee and a point ~9 miles north, the real pair from the incident. */
const SHAKOPEE: JumpPoint = { lat: 44.77954, lng: -93.47072, ts: T0 };
const BLOOMINGTON = { lat: 44.86004, lng: -93.36702 };

describe("rejectImplausibleJumps", () => {
  it("keeps everything when there is nothing to compare against", () => {
    const out = rejectImplausibleJumps([SHAKOPEE], null);
    expect(out.kept).toHaveLength(1);
    expect(out.rejected).toHaveLength(0);
  });

  it("rejects the real 9 mile jump in 0.7 seconds", () => {
    const teleport: JumpPoint = { ...BLOOMINGTON, ts: T0 + 714 };
    const out = rejectImplausibleJumps([teleport], SHAKOPEE);
    expect(out.kept).toHaveLength(0);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0].impliedMps).toBeGreaterThan(1000);
  });

  it("accepts the SAME distance when enough time has passed", () => {
    // 9 miles in 20 minutes is a normal drive. The gate must key on
    // implied speed, never on distance alone, or every long capture gap
    // would be read as a teleport.
    const later: JumpPoint = { ...BLOOMINGTON, ts: T0 + 20 * 60 * SEC };
    const out = rejectImplausibleJumps([later], SHAKOPEE);
    expect(out.kept).toHaveLength(1);
    expect(out.rejected).toHaveLength(0);
  });

  it("accepts sustained highway speed", () => {
    // 31 m/s is about 70 mph, the speed on the owner's real drive.
    const fast: JumpPoint = { lat: 44.79, lng: -93.47072, ts: T0 + 40 * SEC };
    const out = rejectImplausibleJumps([fast], SHAKOPEE);
    expect(out.kept).toHaveLength(1);
  });

  it("chains: a rejected point does not become the reference", () => {
    // THE POINT OF THE WHOLE GATE. Interleaved streams alternate, so if a
    // teleport became the new reference, the NEXT real point would look
    // like a teleport back and the gate would reject the genuine stream
    // instead of the phantom one.
    const realNext: JumpPoint = { lat: 44.77800, lng: -93.47070, ts: T0 + 5 * SEC };
    const teleport: JumpPoint = { ...BLOOMINGTON, ts: T0 + 1 * SEC };
    const out = rejectImplausibleJumps([teleport, realNext], SHAKOPEE);
    expect(out.rejected).toHaveLength(1);
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]).toBe(realNext);
  });

  it("survives a whole interleaved run, keeping the coherent stream", () => {
    // Ten alternating points: five walking south from Shakopee, five
    // phantom copies 9 miles north.
    const pts: JumpPoint[] = [];
    for (let i = 1; i <= 5; i++) {
      pts.push({ lat: 44.77954 - i * 0.002, lng: -93.47072, ts: T0 + i * 10 * SEC });
      pts.push({ ...BLOOMINGTON, ts: T0 + i * 10 * SEC + 700 });
    }
    const out = rejectImplausibleJumps(pts, SHAKOPEE);
    expect(out.kept).toHaveLength(5);
    expect(out.rejected).toHaveLength(5);
    // Every survivor is from the coherent southbound stream.
    expect(out.kept.every((p) => p.lat < 44.78)).toBe(true);
  });

  it("does not divide by zero on identical timestamps", () => {
    const dup: JumpPoint = { ...BLOOMINGTON, ts: T0 };
    const out = rejectImplausibleJumps([dup], SHAKOPEE);
    // Same instant, 9 miles apart: impossible, so it goes.
    expect(out.rejected).toHaveLength(1);
    expect(Number.isFinite(out.rejected[0].impliedMps)).toBe(true);
  });

  it("keeps a duplicate timestamp at the same place", () => {
    // Zero distance in zero time is not a teleport, just a repeat.
    const same: JumpPoint = { lat: SHAKOPEE.lat, lng: SHAKOPEE.lng, ts: T0 };
    expect(rejectImplausibleJumps([same], SHAKOPEE).kept).toHaveLength(1);
  });

  it("ignores out-of-order points rather than rejecting them", () => {
    // A batch can arrive unsorted. A negative dt must not be read as an
    // infinite speed, or a late-but-valid point would be discarded.
    const earlier: JumpPoint = { lat: 44.78, lng: -93.47, ts: T0 - 30 * SEC };
    expect(rejectImplausibleJumps([earlier], SHAKOPEE).kept).toHaveLength(1);
  });

  it("checks WITHIN a backfill batch that is entirely older than the anchor", () => {
    // THE HOLE THE REVIEW FOUND, and the one that mattered most.
    //
    // An out-of-order point is kept and does NOT advance the reference,
    // which is right for one stray late fix. But when the WHOLE batch
    // predates the stored anchor (an offline backlog uploaded after the
    // phone reconnects), every point compares negative against that
    // anchor, so the reference never becomes a member of the batch and
    // no pair inside the batch is ever checked. A teleport buried in a
    // backlog sailed straight through the gate that exists to stop it.
    //
    // Caller contract: pass `null` when the anchor does not precede the
    // batch, so the batch self-anchors on its own first point.
    const anchorIsNewer = null;
    const older = T0 - 60 * 60 * SEC;
    const batch: JumpPoint[] = [
      { lat: SHAKOPEE.lat, lng: SHAKOPEE.lng, ts: older },
      { ...BLOOMINGTON, ts: older + 1 * SEC },
      { lat: SHAKOPEE.lat - 0.002, lng: SHAKOPEE.lng, ts: older + 10 * SEC },
    ];
    const out = rejectImplausibleJumps(batch, anchorIsNewer);
    expect(
      out.rejected,
      "the teleport inside the backlog must still be caught",
    ).toHaveLength(1);
    expect(out.kept).toHaveLength(2);
  });

  it("sets the bar above any car and below any teleport", () => {
    // 89 m/s is about 200 mph. Nothing a car does approaches it, and the
    // incident's implied speeds were three orders of magnitude past it.
    expect(MAX_PLAUSIBLE_MPS).toBeGreaterThan(60);
    expect(MAX_PLAUSIBLE_MPS).toBeLessThan(200);
  });
});

/**
 * MEASURED 2026-08-17, driver 89871e98. The gate above was blind to this
 * one, because the teleport did not exist inside any single batch.
 *
 *   1. A drive uploads live, on whole-second timestamps.
 *   2. About 26 minutes later the native buffer replays the SAME drive
 *      twice more, on .297 and .928 sub-second offsets, coordinates
 *      identical to each other. 631 ms apart, so the
 *      (driver, company, captured_at) upsert key sees two distinct rows
 *      and stores both.
 *   3. The replay batch is wholly older than the newest stored point, so
 *      the route drops the anchor by design and the batch self-anchors.
 *      The replay is internally perfect, so the gate refused nothing.
 *
 * Merged in captured_at order, consecutive rows alternate between the
 * live position and a replay still 4.6 km behind: 1,263 of 3,351
 * transitions over 60 m/s, worst 88,783 m/s. segmentTrips renders one
 * 1,527 mi / 25 min trip, isPlausibleTrip refuses it, no trip is
 * inserted, consumeRange never runs, and the pool freezes permanently.
 *
 * Each stream ALONE segments to the correct 19.56 mi at 54 mph, so the
 * information is present. What was missing is that no gate compared an
 * incoming point to the stored points it lands BETWEEN.
 *
 * WHY NOT THE TWO OBVIOUS FIXES.
 *
 * Widening the idempotency key to whole-second resolution collapses the
 * two replays into each other (they are 631 ms apart) and leaves the
 * survivor interleaved with the live stream. The replay is time-SHIFTED
 * by about three minutes, not sub-second-shifted, so no achievable key
 * resolution makes it collide with the live copy. It halves the row
 * count and changes the outcome not at all. `refuses one replay but not
 * the teleport it forms with the live stream` pins that.
 *
 * Keying on the sub-second offset as a delivery fingerprint describes
 * one incident rather than a rule: live fixes are not obliged to land on
 * whole seconds, and a replay is not obliged to avoid them. It is a
 * diagnostic, and it is logged as one, but it cannot be the gate.
 *
 * Speed-gating the merged stream naively yields 23.14 mi against a true
 * 19.56, an 18% fabrication that looks innocent at 56 mph. The tests
 * below therefore assert MILEAGE, not just rejection counts.
 */

const CADENCE_MS = 5_000;
/** 54 mph, the measured average of the real drive. */
const DRIVE_MPS = 24.14;
const METERS_PER_TICK = (DRIVE_MPS * CADENCE_MS) / 1000;
const DEG_LAT_PER_M = 1 / 111_320;
/** ~4.6 km of displacement, the measured lag between the copies. */
const REPLAY_SHIFT_MS = 190_000;
/** The replay path's sub-second signature, measured. */
const REPLAY_SUBSECOND_MS = 297;
/** 261 ticks at 120.7 m is 31.5 km, the real 19.56 mile drive. */
const DRIVE_TICKS = 261;

/** A straight northbound drive from Shakopee at a constant 54 mph. */
function liveDrive(): JumpPoint[] {
  return Array.from({ length: DRIVE_TICKS }, (_, i) => ({
    lat: SHAKOPEE.lat + i * METERS_PER_TICK * DEG_LAT_PER_M,
    lng: SHAKOPEE.lng,
    ts: T0 + i * CADENCE_MS,
  }));
}

/** Parked at the drive's destination, the same cadence, for `minutes`. */
function dwellAfter(drive: JumpPoint[], minutes: number): JumpPoint[] {
  const last = drive[drive.length - 1];
  const n = (minutes * 60 * SEC) / CADENCE_MS;
  return Array.from({ length: n }, (_, i) => ({
    lat: last.lat,
    lng: last.lng,
    ts: last.ts + (i + 1) * CADENCE_MS,
  }));
}

/**
 * The native buffer's copy: identical geometry, every timestamp pushed
 * REPLAY_SHIFT_MS later than truth, on the replay path's sub-second.
 */
function replayOf(drive: JumpPoint[], subsecondMs = REPLAY_SUBSECOND_MS): JumpPoint[] {
  return drive.map((p) => ({
    lat: p.lat,
    lng: p.lng,
    ts: p.ts + REPLAY_SHIFT_MS + subsecondMs,
  }));
}

function milesOf(points: JumpPoint[]): number {
  return segmentTrips([...points].sort((a, b) => a.ts - b.ts)).reduce(
    (sum, t) => sum + t.distanceMiles,
    0,
  );
}

describe("a batch that lands among already-stored points", () => {
  it("refuses a replayed copy of a drive that is already stored", () => {
    // The measured incident. The batch is wholly older than the newest
    // stored point, so the route passes a null anchor, exactly as it
    // does today. Nothing inside the batch is wrong, so the intra-batch
    // gate has nothing to say. Only the stored neighbours can see it.
    const stored = [...liveDrive(), ...dwellAfter(liveDrive(), 12)];
    const replay = replayOf(liveDrive());

    const out = rejectImplausibleJumps(replay, null, stored);

    expect(
      out.kept,
      "every point of the replay is 4.6 km from the stored point beside it",
    ).toHaveLength(0);
  });

  it("leaves the stored drive's mileage exactly as it was", () => {
    // THE CRITERION. Refusing most of the replay is not enough: the 18%
    // fabrication that a naive merged-stream speed gate produces also
    // refuses most of it. The number that has to survive is the mileage.
    const stored = [...liveDrive(), ...dwellAfter(liveDrive(), 12)];
    const clean = milesOf(stored);
    expect(clean).toBeGreaterThan(19);
    expect(clean).toBeLessThan(20);

    const out = rejectImplausibleJumps(replayOf(liveDrive()), null, stored);

    expect(milesOf([...stored, ...out.kept])).toBeCloseTo(clean, 6);
  });

  it("follows the refused run past the end of the stored points", () => {
    // The leak a per-point speed test cannot close on its own. The
    // replay is time-shifted, so its tail extends past the live stream
    // and converges on the destination. Judged one point at a time,
    // those tail points are reachable from the last stored point at an
    // ordinary speed, so they are accepted, and they segment into a
    // fabricated drive back to a destination the car never left.
    const stored = liveDrive();
    const out = rejectImplausibleJumps(replayOf(liveDrive()), null, stored);

    expect(out.kept, "the tail of the refused delivery came in too").toHaveLength(0);
    expect(milesOf([...stored, ...out.kept])).toBeCloseTo(milesOf(stored), 6);
    expect(out.rejected.some((r) => r.reason === "run")).toBe(true);
  });

  it("refuses one replay but not the teleport it forms with the live stream", () => {
    // Why widening the idempotency key is not the fix. The two replays
    // are 631 ms apart, so a whole-second key collapses them. The
    // survivor is still 4.6 km from the live copy at the same instant,
    // and no key resolution reaches a three minute shift.
    const stored = [...liveDrive(), ...dwellAfter(liveDrive(), 12)];
    const bothReplays = [
      ...replayOf(liveDrive(), 297),
      ...replayOf(liveDrive(), 928),
    ].sort((a, b) => a.ts - b.ts);

    const secondResolution = new Map<number, JumpPoint>();
    for (const p of bothReplays) {
      const key = Math.floor(p.ts / 1000);
      if (!secondResolution.has(key)) secondResolution.set(key, p);
    }
    const survivors = [...secondResolution.values()];
    expect(survivors.length).toBeLessThan(bothReplays.length);
    expect(
      milesOf([...stored, ...survivors]),
      "a whole-second key halves the rows and leaves the teleport",
    ).toBeGreaterThan(100);

    const out = rejectImplausibleJumps(bothReplays, null, stored);
    expect(milesOf([...stored, ...out.kept])).toBeCloseTo(milesOf(stored), 6);
  });

  it("admits a genuine backlog that fills a gap between stored points", () => {
    // The case that must not regress. A phone offline for the middle of
    // a drive uploads the missing stretch afterwards. It lands inside
    // the stored span, which is the same shape as the replay, and it is
    // legitimate: the neighbours either side are minutes and miles away
    // in the proportion a car actually manages.
    const full = liveDrive();
    const stored = [...full.slice(0, 60), ...full.slice(200)];
    const backlog = full.slice(60, 200);

    const out = rejectImplausibleJumps(backlog, null, stored);

    expect(out.rejected).toHaveLength(0);
    expect(milesOf([...stored, ...out.kept])).toBeCloseTo(milesOf(full), 6);
  });

  it("judges a point with no stored predecessor against its successor", () => {
    // A batch older than everything stored has no predecessor to answer
    // to, which is precisely the shape the intra-batch anchor is dropped
    // for. Its only witness is the stored point that comes after it.
    const drive = liveDrive();
    const stored = drive.slice(200);
    const strayFar = {
      lat: BLOOMINGTON.lat,
      lng: BLOOMINGTON.lng,
      ts: stored[0].ts - 1000,
    };

    const out = rejectImplausibleJumps([strayFar], null, stored);
    expect(out.rejected, "its successor is a second away and miles off").toHaveLength(1);
  });

  it("keeps a point whose stored PREDECESSOR is the only outlier", () => {
    // The pool this ships into already holds contaminated rows. If a
    // single bad stored point could condemn the live points beside it,
    // closing the door would start destroying good drives instead of
    // just refusing bad ones. A real point has a real neighbour on at
    // least one side; a delivered-from-elsewhere point has neither.
    const drive = liveDrive();
    const stored = [
      ...drive,
      { lat: BLOOMINGTON.lat, lng: BLOOMINGTON.lng, ts: drive[100].ts + 1000 },
    ].sort((a, b) => a.ts - b.ts);
    const genuine = { ...drive[100], ts: drive[100].ts + 2000 };

    const out = rejectImplausibleJumps([genuine], null, stored);
    expect(out.kept).toHaveLength(1);
  });

  it("keeps a point whose stored SUCCESSOR is the only outlier", () => {
    // The mirror, and the reason the backward look is not decoration.
    // Without it a contaminated row would condemn the genuine points
    // that arrive just before it exactly as it would those just after.
    const drive = liveDrive();
    const stored = [
      ...drive,
      { lat: BLOOMINGTON.lat, lng: BLOOMINGTON.lng, ts: drive[100].ts + 3000 },
    ].sort((a, b) => a.ts - b.ts);
    const genuine = { ...drive[100], ts: drive[100].ts + 2000 };

    const out = rejectImplausibleJumps([genuine], null, stored);
    expect(out.kept).toHaveLength(1);
  });

  it("does not spread one refusal across a batch that storage agrees with", () => {
    // The bound on the run rule. Following a refused run is right when
    // the batch as a whole is displaced from storage, which is what a
    // second delivery path looks like. It is badly wrong when the batch
    // agrees with storage everywhere except one contaminated pocket,
    // because then the run rule would eat a genuine upload whole.
    const drive = liveDrive();
    // Bracketing one incoming point, which is the worst case: that point
    // has an implausible neighbour on BOTH sides and is refused outright.
    const bad = [
      { lat: BLOOMINGTON.lat, lng: BLOOMINGTON.lng, ts: drive[101].ts - 1_000 },
      { lat: BLOOMINGTON.lat, lng: BLOOMINGTON.lng, ts: drive[101].ts + 1_000 },
    ];
    const stored = [...drive.filter((_, i) => i % 2 === 0), ...bad].sort(
      (a, b) => a.ts - b.ts,
    );
    const batch = drive.filter((_, i) => i % 2 === 1);

    const out = rejectImplausibleJumps(batch, null, stored);

    expect(
      out.rejected.map((r) => r.point),
      "only the point bracketed by the contaminated pair",
    ).toEqual([drive[101]]);
    expect(out.kept).toHaveLength(batch.length - 1);
  });

  it("treats an exact-timestamp match as a retry, not a second source", () => {
    // A re-sent flush carries the same captured_at, which the upsert
    // key already dedupes, so the row never lands twice. Reading it as
    // a same-instant neighbour would make every retry look like a
    // teleport onto itself.
    const drive = liveDrive();
    const resend = drive.slice(50, 60);
    const out = rejectImplausibleJumps(resend, null, drive);
    expect(out.rejected).toHaveLength(0);
  });

  it("still checks within the batch when no stored points are supplied", () => {
    // The stored pass is additive. With an empty pool the gate must
    // behave exactly as it did before, or the first upload of a new
    // driver loses its own protection.
    const teleport: JumpPoint = { ...BLOOMINGTON, ts: T0 + 714 };
    const out = rejectImplausibleJumps([teleport], SHAKOPEE, []);
    expect(out.rejected).toHaveLength(1);
  });
});
