import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * WITHDRAWN GUARD, kept as a record of a wrong diagnosis.
 *
 * This file used to pin the arithmetic of a read-time clock correction
 * in TaxotticGeofenceStore.java. Both the correction and this test were
 * mistakes, and the way they were wrong is worth keeping.
 *
 * THE EVIDENCE. One Home-to-Zinpro commute landed twice, the copies a
 * constant 19.3 minutes apart and 0 to 9 m apart in space, with 166
 * points in one and 909 in the other.
 *
 * THE WRONG READ. A boot-anchor shift replaying one buffer. That theory
 * predicts an IDENTICAL copy: same buffer lines, same coordinates, 0 m
 * apart. It cannot produce a 9 m spread or a fivefold density
 * difference. The contradicting evidence was in the first measurement
 * and went unexamined because the theory already fit the headline.
 *
 * THE ACTUAL MECHANISM, read from source rather than inferred:
 *
 *   1. Every Android drive is captured TWICE. native-tracker.ts starts
 *      TaxotticResurrectionService on driving fixes, and that service
 *      buffers at 1 Hz (MIN_INTERVAL_MS 1000, MIN_DISTANCE_M 0)
 *      independently of the WebView's own stream.
 *   2. The two streams upload as separate batches.
 *   3. app/api/mileage/ingest shifts a whole batch forward when its
 *      newest point is 2 to 30 minutes behind receipt. One batch is
 *      shifted, the other is not.
 *
 * Same journey, two sampling instants (hence the metres), two
 * densities, one constant offset. Every observation accounted for.
 *
 * WHY THE TEST ITSELF WAS ALSO WRONG. It re-implemented the Java in
 * TypeScript and asserted against the copy, so it could never have
 * caught the regression the Java introduced. That is the same
 * anti-pattern found twice elsewhere on the same day.
 *
 * What remains is the one assertion worth keeping: the withdrawn code
 * must not quietly return.
 */

const STORE = "android/app/src/main/java/com/taxottic/app/TaxotticGeofenceStore.java";

describe("the read-time clock correction stays withdrawn", () => {
  it("does not rewrite a fix timestamp on read", () => {
    const src = readFileSync(STORE, "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(
      code,
      "Re-deriving a stored timestamp at READ time makes it depend on the " +
        "wall clock at that moment, which breaks the idempotent-on-" +
        "captured_at property the drain relies on and can manufacture the " +
        "duplicate it was meant to prevent.",
    ).not.toMatch(/correctTime\s*\(/);
  });

  it("still records the monotonic clock as evidence", () => {
    // Recording it is free and is the right raw material for diagnosing
    // real clock movement. Only USING it to rewrite history was wrong.
    expect(readFileSync(STORE, "utf8")).toContain("elapsedNanos");
  });
});
