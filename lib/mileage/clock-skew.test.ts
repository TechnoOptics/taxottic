import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  correctBatchClockSkew,
  SKEW_TOLERANCE_MS,
  MAX_BEHIND_SHIFT_MS,
  CLUSTER_WINDOW_MS,
} from "./clock-skew";

/**
 * The case that mattered is the MIXED batch, so it is the first test.
 *
 * Reconstructed from the production incident rather than invented: 203
 * distinct coordinates re-delivered at a constant +1157s, identified by
 * the arithmetic
 *
 *   lag_b - lag_a  =  recv_gap - delta
 *        -1243.2   =    -85.9  - 1157      (observed vs predicted, exact)
 *
 * which places the second copy 1157s later in captured_at while having
 * ARRIVED 86s earlier. Only a forward shift produces that ordering.
 */
const MIN = 60_000;
const RECEIPT = 1_760_000_000_000;

describe("a flush carrying backlog behind one fresh fix", () => {
  // Newest point lags 19.3 min: inside the shiftable band, so the batch
  // reads as clock drift. The rest is two-hour-old offline backlog.
  const newest = RECEIPT - 1157 * 1000;
  const batch = [
    { ts: newest - 2 * 60 * MIN, id: "backlog-a" },
    { ts: newest - 2 * 60 * MIN + 30_000, id: "backlog-b" },
    { ts: newest, id: "fresh" },
  ];

  it("does not drag the backlog forward with the fresh fix", () => {
    const r = correctBatchClockSkew(batch, RECEIPT);
    expect(r.shifted).toBe(true);
    const held = r.points.filter((p) => p.id.startsWith("backlog"));
    expect(held.map((p) => p.ts)).toEqual([
      newest - 2 * 60 * MIN,
      newest - 2 * 60 * MIN + 30_000,
    ]);
    expect(r.backlogHeld).toBe(2);
  });

  it("still corrects the point that actually showed the drift", () => {
    const r = correctBatchClockSkew(batch, RECEIPT);
    const fresh = r.points.find((p) => p.id === "fresh")!;
    expect(fresh.ts).toBe(RECEIPT);
  });

  it("keeps re-delivery idempotent, which is the whole point", () => {
    // The same backlog arriving again, moments later, in a batch with no
    // fresh companion. Both deliveries must produce the SAME timestamps,
    // or the (driver, company, captured_at) upsert key stops matching and
    // the staging table gains a second copy of the drive.
    const first = correctBatchClockSkew(batch, RECEIPT);
    const second = correctBatchClockSkew(
      batch.filter((p) => p.id.startsWith("backlog")),
      RECEIPT + 86_000,
    );
    const tsOf = (rs: { points: { ts: number; id: string }[] }, id: string) =>
      rs.points.find((p) => p.id === id)!.ts;
    expect(tsOf(second, "backlog-a")).toBe(tsOf(first, "backlog-a"));
    expect(tsOf(second, "backlog-b")).toBe(tsOf(first, "backlog-b"));
  });
});

/**
 * The band this codebase has NEVER exercised in production, and is about
 * to for the first time.
 *
 * Across 1593 batches over 10 days, exactly zero had a newest point
 * between SKEW_TOLERANCE_MS and MAX_BEHIND_SHIFT_MS behind receipt: live
 * flushes pass BELOW the window (newest point p50 about 0.01 min) and
 * cold-start drains pass ABOVE it (hours). Draining the native buffer
 * every couple of minutes lands squarely in the gap, because a buffer
 * read shortly after a drive ends carries a newest fix that is minutes,
 * not seconds and not hours, old.
 *
 * That is the shape the shift was built for and it is the wrong answer
 * here. A native buffer read IS a backlog by construction, so the client
 * says so instead of leaving the server to infer it from a lag magnitude
 * that cannot tell the two apart.
 */
describe("a native-buffer drain is backlog by construction, not clock drift", () => {
  // A drive that ended five minutes ago, still sitting in the native
  // store. Without the flag this reads as a five-minute clock lag.
  const lag = 5 * MIN;
  const batch = [0, 30_000, 60_000].map((o) => ({
    ts: RECEIPT - lag + o,
    id: String(o),
  }));

  it("keeps the device's own timestamps instead of shifting them", () => {
    const r = correctBatchClockSkew(batch, RECEIPT, { backlog: true });
    expect(r.shifted).toBe(false);
    expect(r.points.map((p) => p.ts)).toEqual(batch.map((p) => p.ts));
  });

  it("shifts the identical batch when it is NOT flagged as backlog", () => {
    // Pins the flag as the thing doing the work. If this stops shifting,
    // the test above is passing for a reason that has nothing to do with
    // the change it is guarding.
    const r = correctBatchClockSkew(batch, RECEIPT);
    expect(r.shifted).toBe(true);
  });

  it("survives re-delivery at a different receipt instant", () => {
    // THE DUPLICATE BUG, in the form this change would resurrect.
    //
    // A drain posts, the server accepts, and consumeBuffer fails, a case
    // geofence.ts explicitly tolerates on the grounds that "ingest is
    // idempotent on (driver, company, captured_at)". That claim is only
    // true while the same fixes produce the same captured_at. Under the
    // behind-shift they do not: the offset is measured against receipt,
    // so the retry two minutes later writes every point two minutes
    // further forward and the upsert key stops matching.
    const first = correctBatchClockSkew(batch, RECEIPT, { backlog: true });
    const retry = correctBatchClockSkew(batch, RECEIPT + 2 * MIN, {
      backlog: true,
    });
    expect(retry.points.map((p) => p.ts)).toEqual(
      first.points.map((p) => p.ts),
    );
  });

  it("still refuses a future timestamp, which is never a real capture", () => {
    // Asymmetric on purpose. Backlog explains a lag; nothing explains a
    // capture from the future, and a future captured_at makes the
    // finalizer's parked test read negative so the drive never closes
    // (audit #14). The flag suppresses the BEHIND branch only.
    const pts = [{ ts: RECEIPT + 10 * MIN, id: "a" }];
    const r = correctBatchClockSkew(pts, RECEIPT, { backlog: true });
    expect(r.shifted).toBe(true);
    expect(r.points[0].ts).toBe(RECEIPT);
  });

  it("leaves an unflagged batch exactly as it was", () => {
    // The regression that matters most: every live flush in production is
    // unflagged, so omitting the option must change nothing at all.
    const pts = [{ ts: RECEIPT - 5 * MIN, id: "a" }];
    expect(correctBatchClockSkew(pts, RECEIPT)).toEqual(
      correctBatchClockSkew(pts, RECEIPT, {}),
    );
  });
});

describe("the corrections that must keep working", () => {
  it("shifts a genuinely skewed contemporaneous batch, clock behind", () => {
    // Audit #13: every point looks old, the parked test force-closes a
    // live drive, one drive is shredded into fragments.
    const lag = 5 * MIN;
    const pts = [0, 30_000, 60_000].map((o) => ({
      ts: RECEIPT - lag + o,
      id: String(o),
    }));
    const r = correctBatchClockSkew(pts, RECEIPT);
    expect(r.shifted).toBe(true);
    expect(r.backlogHeld).toBe(0);
    expect(r.points.map((p) => p.ts)).toEqual([
      RECEIPT - 60_000,
      RECEIPT - 30_000,
      RECEIPT,
    ]);
  });

  it("shifts a clock that is ahead, which is never legitimate", () => {
    const pts = [{ ts: RECEIPT + 10 * MIN, id: "a" }];
    const r = correctBatchClockSkew(pts, RECEIPT);
    expect(r.shifted).toBe(true);
    expect(r.points[0].ts).toBe(RECEIPT);
  });

  it("preserves relative spacing, so a track stays a track", () => {
    // Audit #14: collapsing a batch onto one instant let the by-time
    // dedupe keep a single point and delete the drive's shape.
    const pts = [0, 20_000, 55_000].map((o) => ({
      ts: RECEIPT - 5 * MIN + o,
      id: String(o),
    }));
    const r = correctBatchClockSkew(pts, RECEIPT);
    const gaps = r.points.slice(1).map((p, i) => p.ts - r.points[i].ts);
    expect(gaps).toEqual([20_000, 35_000]);
    expect(new Set(r.points.map((p) => p.ts)).size).toBe(3);
  });

  it("leaves a whole-batch backlog alone", () => {
    // A 2-day-dark phone flushing its buffer. Shifting this produced the
    // 808 mi and 314 mi impossible trips.
    const pts = [{ ts: RECEIPT - 48 * 60 * MIN, id: "a" }];
    const r = correctBatchClockSkew(pts, RECEIPT);
    expect(r.shifted).toBe(false);
    expect(r.points[0].ts).toBe(RECEIPT - 48 * 60 * MIN);
  });

  it("leaves ordinary network jitter alone", () => {
    const pts = [{ ts: RECEIPT - 20_000, id: "a" }];
    const r = correctBatchClockSkew(pts, RECEIPT);
    expect(r.shifted).toBe(false);
    expect(r.points[0].ts).toBe(RECEIPT - 20_000);
  });

  it("survives an empty batch without inventing a skew", () => {
    const r = correctBatchClockSkew([], RECEIPT);
    expect(r).toMatchObject({ shifted: false, skewMs: 0, backlogHeld: 0 });
    expect(r.points).toEqual([]);
  });
});

describe("the boundaries are where the incident lived", () => {
  it("holds a point exactly one ms past the cluster window", () => {
    const newest = RECEIPT - 3 * MIN;
    const r = correctBatchClockSkew(
      [
        { ts: newest - CLUSTER_WINDOW_MS - 1, id: "out" },
        { ts: newest, id: "in" },
      ],
      RECEIPT,
    );
    expect(r.points.find((p) => p.id === "out")!.ts).toBe(
      newest - CLUSTER_WINDOW_MS - 1,
    );
    expect(r.points.find((p) => p.id === "in")!.ts).toBe(RECEIPT);
  });

  it("shifts a point exactly on the cluster window", () => {
    const newest = RECEIPT - 3 * MIN;
    const r = correctBatchClockSkew(
      [
        { ts: newest - CLUSTER_WINDOW_MS, id: "edge" },
        { ts: newest, id: "in" },
      ],
      RECEIPT,
    );
    expect(r.backlogHeld).toBe(0);
  });

  it("ties the cluster window to the backlog threshold on purpose", () => {
    // A lag we refuse to call clock drift for a whole batch must not
    // become clock drift merely because a fresher point travels with it.
    // If someone loosens one, this fails rather than silently reopening
    // the hole.
    expect(CLUSTER_WINDOW_MS).toBe(MAX_BEHIND_SHIFT_MS);
    expect(SKEW_TOLERANCE_MS).toBeLessThan(MAX_BEHIND_SHIFT_MS);
  });
});

/**
 * Call-site guard. Twice today a module was corrected while the caller
 * kept its own broken copy, and the module's own tests stayed green
 * throughout. The route must use this rule, not reimplement it.
 */
describe("the ingest route uses this rule rather than its own", () => {
  const ROUTE = "app/api/mileage/ingest/route.ts";
  const src = readFileSync(ROUTE, "utf8");

  it("calls correctBatchClockSkew", () => {
    expect(src).toContain("correctBatchClockSkew(finite, receiptMs");
  });

  it("forwards the client's backlog flag instead of re-deriving it", () => {
    // The flag is worthless if the route drops it. Read CODE, not the
    // comment above the call: this repo has twice shipped a guard that
    // matched a doc comment while the code did the opposite.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(code).toMatch(/backlog\s*=\s*body\.backlog === true/);
    expect(code).toMatch(
      /correctBatchClockSkew\(\s*finite,\s*receiptMs,\s*\{\s*backlog\s*\}/,
    );
  });

  it("keeps no inline shift of its own", () => {
    expect(src).not.toMatch(/ts:\s*pt\.ts\s*-\s*skewMs/);
    expect(src).not.toMatch(/const\s+shiftable\s*=/);
  });

  it("still stages on the timestamp the correction produced", () => {
    // captured_at IS the idempotency key. If staging ever stops deriving
    // it from the corrected point, re-delivery duplicates again.
    expect(src).toContain("captured_at: new Date(p.ts).toISOString()");
    expect(src).toContain('onConflict: "driver_user_id,company_id,captured_at"');
  });
});
