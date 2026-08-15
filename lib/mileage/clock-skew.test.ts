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
    expect(src).toContain("correctBatchClockSkew(finite, receiptMs)");
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
