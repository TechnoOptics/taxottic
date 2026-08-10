import { describe, expect, it } from "vitest";
import {
  MAX_PLAUSIBLE_MPS,
  rejectImplausibleJumps,
  type JumpPoint,
} from "./plausible-jump";

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
