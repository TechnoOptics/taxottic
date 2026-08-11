import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseRateParam } from "./rate-param";

/**
 * The calculator URLs are public, shareable and indexable, so the query
 * string is untrusted input on a page that computes United States tax.
 * Two failures were reachable by typing in the address bar:
 *
 *   ?rate=abc   rendered "Tax saved: $NaN"
 *   ?rate=5     rendered "Net cost after tax: -$71,280.00"
 *
 * A confident nonsense number is worse than no number, and a negative
 * cost reads like a finding rather than a bug.
 */

describe("parseRateParam", () => {
  it("accepts a real bracket", () => {
    expect(parseRateParam("0.22", 0.3)).toBe(0.22);
    expect(parseRateParam("0.37", 0.3)).toBe(0.37);
  });

  it("falls back when the parameter is absent or blank", () => {
    expect(parseRateParam(undefined, 0.3)).toBe(0.3);
    expect(parseRateParam("", 0.3)).toBe(0.3);
    expect(parseRateParam("   ", 0.3)).toBe(0.3);
  });

  it("never returns NaN, the $NaN bug", () => {
    for (const junk of ["abc", "NaN", "e", ".", "--1", "0x10"]) {
      const out = parseRateParam(junk, 0.3);
      expect(Number.isFinite(out), `"${junk}" produced a non-finite rate`).toBe(
        true,
      );
      expect(out).toBe(0.3);
    }
  });

  it("rejects a rate above 100 percent, the negative-cost bug", () => {
    // ?rate=5 meant 500 percent and drove the net cost negative.
    expect(parseRateParam("5", 0.21)).toBe(0.21);
    expect(parseRateParam("1.01", 0.21)).toBe(0.21);
    expect(parseRateParam("100", 0.21)).toBe(0.21);
  });

  it("rejects zero and negatives", () => {
    expect(parseRateParam("0", 0.3)).toBe(0.3);
    expect(parseRateParam("-0.22", 0.3)).toBe(0.3);
  });

  it("accepts exactly 100 percent as the boundary", () => {
    expect(parseRateParam("1", 0.3)).toBe(1);
  });

  it("rejects Infinity", () => {
    expect(parseRateParam("Infinity", 0.3)).toBe(0.3);
    expect(parseRateParam("-Infinity", 0.3)).toBe(0.3);
  });
});

describe("every calculator actually uses it", () => {
  /**
   * The point of the helper is that no component parses the parameter
   * itself. This is a source check ON TOP OF the behavioural tests
   * above, not instead of them: it catches a NEW calculator copying the
   * old unguarded one-liner, which no unit test of this module could
   * ever see.
   */
  it("no component parses a rate parameter by hand", () => {
    const dir = "components/calculators";
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
      const src = readFileSync(join(dir, f), "utf8");
      src.split("\n").forEach((line, i) => {
        if (/parseFloat\(\s*initial\??\.\s*rate/.test(line)) {
          offenders.push(`${dir}/${f}:${i + 1}`);
        }
      });
    }
    expect(
      offenders,
      "These parse the rate query parameter directly. Use " +
        "parseRateParam(initial?.rate, fallback), which cannot return " +
        "NaN or a rate above 100 percent.",
    ).toEqual([]);
  });
});
