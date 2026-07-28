import { describe, it, expect } from "vitest";
import { removeUploadedPoints, capBuffer, flushAdmission } from "./buffer";
import type { GpsPoint } from "./segmentation";

const pt = (ts: number): GpsPoint => ({ lat: 44 + ts / 1e6, lng: -93, ts });

describe("removeUploadedPoints", () => {
  it("removes exactly the uploaded points", () => {
    const buf = [pt(1), pt(2), pt(3), pt(4)];
    expect(removeUploadedPoints(buf, [pt(1), pt(2)]).map((p) => p.ts)).toEqual([
      3, 4,
    ]);
  });

  it("REGRESSION: eviction during the in-flight POST must not delete unsent points", () => {
    // The drive is long and connectivity is poor. A 3-point batch is in
    // flight; meanwhile the callback pushes new fixes and the cap evicts
    // from the HEAD, so the batch's own points are gone from the buffer
    // and the head now holds NEWER, never-uploaded data.
    const batch = [pt(1), pt(2), pt(3)];
    const bufferAfterEviction = [pt(10), pt(11), pt(12), pt(13)];

    // Positional removal (the old `buffer.slice(batch.length)`) would
    // delete 10, 11 and 12 — three points the server never saw.
    const positional = bufferAfterEviction.slice(batch.length);
    expect(positional.map((p) => p.ts)).toEqual([13]); // the bug

    // Identity removal keeps every unsent point.
    const byIdentity = removeUploadedPoints(bufferAfterEviction, batch);
    expect(byIdentity.map((p) => p.ts)).toEqual([10, 11, 12, 13]);
  });

  it("partial eviction: keeps survivors, drops only what was sent", () => {
    const batch = [pt(1), pt(2), pt(3)];
    // 1 was evicted; 2 and 3 were sent and still present; 9,10 are new.
    const buf = [pt(2), pt(3), pt(9), pt(10)];
    expect(removeUploadedPoints(buf, batch).map((p) => p.ts)).toEqual([9, 10]);
  });

  it("empty batch leaves the buffer untouched", () => {
    const buf = [pt(1), pt(2)];
    expect(removeUploadedPoints(buf, [])).toEqual(buf);
  });

  it("never mutates its inputs", () => {
    const buf = [pt(1), pt(2)];
    const copy = [...buf];
    removeUploadedPoints(buf, [pt(1)]);
    expect(buf).toEqual(copy);
  });
});

describe("capBuffer", () => {
  it("drops OLDEST first and reports the count", () => {
    const buf = [pt(1), pt(2), pt(3), pt(4), pt(5)];
    const r = capBuffer(buf, 3);
    expect(r.points.map((p) => p.ts)).toEqual([3, 4, 5]);
    expect(r.evicted).toBe(2);
  });

  it("under the cap is a no-op with zero loss reported", () => {
    const buf = [pt(1), pt(2)];
    const r = capBuffer(buf, 5);
    expect(r.points.map((p) => p.ts)).toEqual([1, 2]);
    expect(r.evicted).toBe(0);
  });

  it("exactly at the cap does not evict", () => {
    expect(capBuffer([pt(1), pt(2)], 2).evicted).toBe(0);
  });
});

describe("flushAdmission", () => {
  const base = { flushInFlight: false, sessionEnded: false, bufferSize: 10, tracking: true };

  it("sends a normal flush when idle with data", () => {
    expect(flushAdmission(base)).toBe("send");
  });

  it("skips a routine flush while one is in flight", () => {
    expect(flushAdmission({ ...base, flushInFlight: true })).toBe("skip");
  });

  it("REGRESSION: a sessionEnded flush is QUEUED, never dropped", () => {
    // This is the defect that made walk-away fast-close dead code: the
    // drive-end force-close collided with the routine heartbeat flush
    // on the same tick and was silently discarded, so trips only closed
    // via the slow server timer.
    expect(
      flushAdmission({ ...base, flushInFlight: true, sessionEnded: true }),
    ).toBe("queue-session-end");
  });

  it("sends sessionEnded even with an empty buffer (the signal IS the payload)", () => {
    expect(
      flushAdmission({ ...base, bufferSize: 0, sessionEnded: true }),
    ).toBe("send");
  });

  it("skips an empty routine flush while tracking", () => {
    expect(flushAdmission({ ...base, bufferSize: 0 })).toBe("skip");
  });

  it("sends an empty buffer when tracking stopped (final drain)", () => {
    expect(
      flushAdmission({ ...base, bufferSize: 0, tracking: false }),
    ).toBe("send");
  });
});
